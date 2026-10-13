// The engine: sends the next student in the teacher's queue to HallPass when a spot opens,
// and ends each pass once its time is up. Everything that clicks through HallPass runs here,
// one thing at a time, so the queue, the timers and the Back button never trip over each other.
import { loadSettings, saveSettings } from "./lib/storage.js";
import { capitalize, goGuardianTab, hostOf, siteName } from "./lib/tabs.js";
import { installBuiltin } from "./lib/builtin.js";
import { END_ORDER, SEND_ORDER, chosenLane, endMethods, kindOfMacro, makeMethods, method, methodPlace, openerPlace } from "./lib/methods.js";
import { dueToEnd, endsAt, nextToSend } from "./lib/queue.js";

const WATCHED = ["queue", "queuePaused", "outPasses", "maxOut", "autoEndMinutes", "macros"];

function setup() {
  // A steady heartbeat, in case Chrome put the helper to sleep between alarms.
  chrome.alarms.create("tick", { periodInMinutes: 0.5 });
  sync();
}
chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  setup();
});
chrome.runtime.onStartup.addListener(setup);
chrome.alarms.onAlarm.addListener(() => sync());
chrome.storage.onChanged.addListener((changes) => {
  if (WATCHED.some((k) => k in changes)) sync();
});
// Opening or reloading HallPass may be what the queue was waiting for.
chrome.tabs.onUpdated.addListener((_id, info, tab) => {
  if (info.status === "complete" && hostOf(tab.url).endsWith("goguardian.com")) sync();
});

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type !== "end-now") return false;
  serial(() => endPass(msg.id, { manual: true })).then(sendResponse, (err) =>
    sendResponse({ ok: false, reason: String(err) }),
  );
  return true;
});

// --- one thing at a time ---

let chain = Promise.resolve();
const serial = (fn) => (chain = chain.catch(() => {}).then(fn));

// Many storage changes in a row only need one more look.
let lookQueued = false;
function sync() {
  if (lookQueued) return chain;
  lookQueued = true;
  return serial(async () => {
    lookQueued = false;
    await look();
  });
}

async function look() {
  let s = await loadSettings();
  await armEndAlarms(s);
  // End first, so a pass that's up frees its spot before the next student goes.
  for (const pass of dueToEnd(s)) await endPass(pass.id);
  s = await loadSettings();
  s = await saveMethods(s);
  const next = nextToSend(s);
  if (next && Object.keys(makeMethods(s.macros)).length) await send(next);
  // A note like "Open HallPass so Ava can go" is stale once no one is waiting to go.
  else if (!next && !s.queuePaused && s.queueProblem) await saveSettings({ queueProblem: "" });
}

// One alarm per open pass, at the moment its time is up.
async function armEndAlarms({ outPasses, autoEndMinutes }) {
  const wanted = new Map(
    outPasses.filter((p) => !p.endFailed).map((p) => [`end:${p.id}`, endsAt(p, autoEndMinutes)]),
  );
  const existing = (await chrome.alarms.getAll()).filter((a) => a.name.startsWith("end:"));
  const current = new Set();
  for (const alarm of existing) {
    if (Math.abs((wanted.get(alarm.name) ?? 0) - alarm.scheduledTime) < 1000) current.add(alarm.name);
    else await chrome.alarms.clear(alarm.name);
  }
  for (const [name, when] of wanted) {
    if (!current.has(name) && when > Date.now()) chrome.alarms.create(name, { when });
  }
}

// Background tabs run timers slowly, so show the HallPass tab while it clicks through, then switch back.
// If HallPass has a window of its own, nothing the teacher is looking at changes.
async function inTab(tab, message) {
  const [previous] = await chrome.tabs.query({ active: true, windowId: tab.windowId });
  const switching = previous && previous.id !== tab.id;
  if (switching) await chrome.tabs.update(tab.id, { active: true });
  try {
    return await chrome.tabs.sendMessage(tab.id, message);
  } catch {
    return null;
  } finally {
    if (switching) chrome.tabs.update(previous.id, { active: true }).catch(() => {});
  }
}

// Reasons to just try again on the next look, without bothering the teacher.
const TRY_LATER = new Set(["busy", "teaching"]);

function stuckText(result, name) {
  switch (result?.reason) {
    case "ambiguous":
      return "More than one student in HallPass matches that name.";
    case "stuck":
      return `Got stuck at step ${result.step} (${result.label}). Try re-teaching, or copy the page outline for Claude.`;
    case "not-taught":
    case "no-end-macro":
      return "The helper hasn't been taught that yet.";
    case undefined:
      return `Couldn't reach ${name}. Reload it.`;
    default:
      return `Something went wrong in ${name}.`;
  }
}

// A single "create" taught before there were several ways to make a pass moves into macros.make,
// where the page it's replayed on looks it up by kind.
async function saveMethods(s) {
  const create = s.macros.create;
  if (!create || s.macros.make?.[kindOfMacro(create)]) return s;
  await saveSettings({ macros: { ...s.macros, make: makeMethods(s.macros) } });
  return loadSettings();
}

const pick = (all, kind) => (all[kind] ? { [kind]: all[kind] } : {});

async function readyTab(place) {
  const tab = await goGuardianTab(place);
  if (!tab) return { state: "closed" };
  const pong = await chrome.tabs.sendMessage(tab.id, { type: "ping" }).catch(() => null);
  return { state: pong?.ok ? "ready" : "stale", tab };
}

// The first taught way to make a pass whose page is open, and a name for what to tell the teacher.
async function openMethod(methods, order = SEND_ORDER) {
  const taught = order.filter((kind) => methods[kind]);
  let stale = null;
  for (const kind of taught) {
    const place = methodPlace(kind, methods[kind]);
    const page = await readyTab(place);
    if (page.state === "ready") return { kind, tab: page.tab, name: siteName(place) };
    if (page.state === "stale") stale ??= { kind, name: siteName(place) };
    // The Create Pass window is closed: the home screen's Create Pass button can open it.
    const opener = openerPlace(methods[kind]);
    if (opener) {
      const home = await readyTab(opener);
      if (home.state === "ready") return { kind, name: siteName(place), opener: home.tab };
      if (home.state === "stale") stale ??= { kind, name: siteName(opener) };
    }
  }
  return { taught, stale };
}

// Clicks Create Pass on the home screen and waits for the window it opens.
async function openCreateWindow(homeTab, name, message) {
  const result = await inTab(homeTab, { type: "run-opener", ...message });
  if (!result?.ok) return { ok: false, why: stuckText(result, "the GoGuardian home screen") };
  for (let i = 0; i < 30; i++) {
    const page = await readyTab({ kind: "create" });
    if (page.state === "ready" && page.tab.status === "complete") {
      // A new window can still reload as it starts up, so let it settle and check it again.
      await new Promise((r) => setTimeout(r, 1500));
      const again = await readyTab({ kind: "create" });
      if (again.state === "ready" && again.tab.status === "complete") return { ok: true, tab: again.tab };
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  return { ok: false, why: `${capitalize(name)} didn't open after clicking Create Pass.` };
}

async function send(entry) {
  const settings = await loadSettings();
  // Only the chosen lane is used: the helper never moves to the other way by itself.
  const lane = chosenLane(settings);
  const methods = pick(makeMethods(settings.macros), lane);
  if (!methods[lane]) {
    await saveSettings({ queueProblem: `The helper hasn't been taught ${method(lane).name} yet. Teach it, or switch to the other way.` });
    return;
  }
  const found = await openMethod(methods);
  if (!found.tab && !found.opener) {
    const problem = found.stale
      ? `Reload ${found.stale.name} so ${entry.label} can go.`
      : `Open ${found.taught.map((k) => method(k).where.split(",")[0]).join(" or ")} so ${entry.label} can go.`;
    await saveSettings({ queueProblem: problem });
    return;
  }
  const { name, kind } = found;
  let tab = found.tab;
  if (found.opener) {
    const opened = await openCreateWindow(found.opener, name, { which: "make" });
    if (!opened.ok) {
      await saveSettings({ queuePaused: true, queueProblem: `${entry.label} wasn't sent. ${opened.why}` });
      notify("Queue paused", `${entry.label} wasn't sent. ${opened.why}`);
      return;
    }
    tab = opened.tab;
  }
  let result = await inTab(tab, { type: "make-pass", method: kind, student: entry.student, destination: entry.destination });
  // The Create Pass window may close itself once the pass is made, which cuts the reply off. A window that's
  // gone after no reply means it finished (a stuck step would have left it open).
  if (!result && kind === "create" && (await readyTab({ kind: "create" })).state === "closed") result = { ok: true };
  if (TRY_LATER.has(result?.reason)) return;
  if (!result?.ok) {
    const why = stuckText(result, name);
    await saveSettings({ queuePaused: true, queueProblem: `${entry.label} wasn't sent. ${why}` });
    notify("Queue paused", `${entry.label} wasn't sent. ${why}`);
    return;
  }
  const s = await loadSettings();
  await saveSettings({
    queue: s.queue.filter((e) => e.id !== entry.id),
    outPasses: [
      ...s.outPasses,
      {
        id: entry.id,
        student: entry.student,
        label: entry.label,
        destination: entry.destination,
        startedAt: Date.now(),
      },
    ],
    queueProblem: "",
  });
}

async function markFailed(pass, why) {
  const { outPasses } = await loadSettings();
  await saveSettings({ outPasses: outPasses.map((p) => (p.id === pass.id ? { ...p, endFailed: why } : p)) });
}

// Ends a pass in HallPass. Time's up unless `manual` (the teacher pressed Back).
async function endPass(id, { manual = false } = {}) {
  const settings = await loadSettings();
  const { outPasses, macros, autoEndMinutes } = settings;
  const pass = outPasses.find((p) => p.id === id);
  if (!pass) return { ok: true };
  const lane = chosenLane(settings);
  const timesUp = `${pass.label}'s ${autoEndMinutes} minutes are up`;
  const methods = pick(endMethods(macros), lane);
  if (!methods[lane]) {
    const need = Object.keys(endMethods(macros)).length ? `It only knows how to end a pass the other way. Switch ways, or teach ending ${method(lane).end.label}.` : "Teach the helper how you end a pass.";
    if (!manual) {
      await markFailed(pass, need);
      notify("Pass not ended", `${timesUp}. ${need}`);
    }
    return { ok: false, reason: "no-end-macro" };
  }
  const found = await openMethod(methods, END_ORDER);
  if (!found.tab && !found.opener) {
    const where = found.stale ? found.stale.name : found.taught.map((k) => method(k).where.split(",")[0]).join(" or ");
    if (!manual) {
      await markFailed(pass, found.stale ? `Reload ${where}.` : `Open ${where}.`);
      notify("Pass not ended", `${timesUp}, but ${where} ${found.stale ? "needs a reload" : "isn't open"}. End it by hand.`);
    }
    return { ok: false, reason: "closed" };
  }
  const { name, kind } = found;
  let tab = found.tab;
  if (found.opener) {
    const opened = await openCreateWindow(found.opener, name, { which: "end", student: pass.student });
    if (!opened.ok) {
      await markFailed(pass, opened.why);
      if (!manual) notify("Pass not ended", `${timesUp}, but the helper couldn't end it. ${opened.why}`);
      return { ok: false };
    }
    tab = opened.tab;
  }
  let result = await inTab(tab, { type: "end-pass", method: kind, student: pass.student });
  // The window may close itself once the pass is ended, which cuts the reply off.
  if (!result && kind === "create" && (await readyTab({ kind: "create" })).state === "closed") result = { ok: true };
  if (TRY_LATER.has(result?.reason)) return result;
  if (!result?.ok) {
    const why = stuckText(result, name);
    await markFailed(pass, why);
    if (!manual) notify("Pass not ended", `${timesUp}, but the helper couldn't end it. ${why}`);
    return result ?? { ok: false };
  }
  const latest = await loadSettings();
  await saveSettings({ outPasses: latest.outPasses.filter((p) => p.id !== id) });
  if (!manual) notify("Pass ended", `${pass.label}'s pass ended at ${autoEndMinutes} minutes.`);
  return { ok: true };
}

function notify(title, message) {
  chrome.notifications.create({ type: "basic", iconUrl: "icons/icon128.png", title, message });
}

// The steps for making and ending passes are built in. Written on install, on browser start and whenever this wakes.
installBuiltin();
chrome.runtime.onInstalled.addListener(installBuiltin);
chrome.runtime.onStartup.addListener(installBuiltin);
