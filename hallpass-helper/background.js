// The engine: sends the next student in the teacher's queue to HallPass when a spot opens,
// and ends each pass once its time is up. Everything that clicks through HallPass runs here,
// one thing at a time, so the queue, the timers and the Back button never trip over each other.
import { loadSettings, saveSettings } from "./lib/storage.js";
import { capitalize, goGuardianTab, allGoGuardianTabs, hostOf, pageKind, popupWindowIds, siteName } from "./lib/tabs.js";
import { installBuiltin } from "./lib/builtin.js";
import { END_ORDER, METHODS, SEND_ORDER, chosenLane, endMethods, kindOfMacro, makeMethods, method, methodPlace, openerPlace } from "./lib/methods.js";
import { dueToEnd, endsAt, nextToSend } from "./lib/queue.js";
import { applyEvent, emptyWatch } from "./lib/watch.js";
import { addFrame, emptyRecording } from "./lib/bundle.js";

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
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && "learned" in changes) installBuiltin();
  if (area === "local" && WATCHED.some((k) => k in changes)) sync();
});
// Opening or reloading HallPass may be what the queue was waiting for.
chrome.tabs.onUpdated.addListener((_id, info, tab) => {
  if (info.status === "complete" && hostOf(tab.url).endsWith("goguardian.com")) sync();
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type === "end-now") {
    serial(() => endPass(msg.id, { manual: true })).then(sendResponse, (err) => sendResponse({ ok: false, reason: String(err) }));
    return true;
  }
  if (msg?.type?.startsWith("watch-")) {
    watchMessage(msg, sender).then(sendResponse, (err) => sendResponse({ ok: false, reason: String(err) }));
    return true;
  }
  if (msg?.type?.startsWith("record-")) {
    recordMessage(msg, sender).then(sendResponse, (err) => sendResponse({ ok: false, reason: String(err) }));
    return true;
  }
  return false;
});

// --- Watch mode: gathering what every GoGuardian page reports while the teacher shows the helper around ---
// Kept in session storage (memory only, gone when the browser closes) because it still has the names the
// teacher clicked. The side panel turns it into steps with the names taken out, and drops the rest.

const WATCH_KEY = "watch";
const getWatch = async () => (await chrome.storage.session.get({ [WATCH_KEY]: emptyWatch() }))[WATCH_KEY];
let watchChain = Promise.resolve();
// One change at a time, so two pages reporting together never overwrite each other.
function changeWatch(fn) {
  return (watchChain = watchChain.catch(() => {}).then(async () => {
    const state = await getWatch();
    const next = await fn(state);
    if (next && next !== state) await chrome.storage.session.set({ [WATCH_KEY]: next });
    return next ?? state;
  }));
}

const watchWords = async (goal) => {
  const s = await loadSettings();
  return { goal, keep: [s.school, s.teacherName, s.origin, ...s.destinations], roster: s.roster };
};

async function watchMessage(msg, sender) {
  if (msg.type === "watch-event") {
    const tab = sender.tab;
    if (!tab) return { ok: false };
    const page = { kind: pageKind(tab, await popupWindowIds()), host: hostOf(tab.url) };
    await changeWatch((state) => applyEvent(state, msg, page));
    return { ok: true };
  }
  if (msg.type === "watch-hello") {
    const state = await getWatch();
    return state.active ? { active: true, ...(await watchWords(state.goal)) } : { active: false };
  }
  if (msg.type === "watch-begin") {
    await changeWatch(() => ({ ...emptyWatch(), active: true, goal: msg.goal, startedAt: Date.now() }));
    const words = await watchWords(msg.goal);
    for (const tab of await allGoGuardianTabs()) chrome.tabs.sendMessage(tab.id, { type: "watch-start", ...words }).catch(() => {});
    return { ok: true };
  }
  if (msg.type === "watch-info") {
    const s = await getWatch();
    return { ok: true, active: s.active, goal: s.goal, steps: s.events.length, screens: Object.keys(s.screens).length, full: s.full, pages: [...new Set(s.events.map((e) => e.page.kind))] };
  }
  if (msg.type === "watch-end") {
    const state = await getWatch();
    for (const tab of await allGoGuardianTabs()) chrome.tabs.sendMessage(tab.id, { type: "watch-stop" }).catch(() => {});
    // Give each page a moment to hand over the last thing it was typing.
    await new Promise((r) => setTimeout(r, 700));
    const done = await getWatch();
    await changeWatch(() => emptyWatch());
    sync();
    return { ok: true, events: done.events.length >= state.events.length ? done.events : state.events, screens: done.screens, edges: done.edges, goal: state.goal };
  }
  return { ok: false };
}

// --- Scrubbed Flight Recorder: multi-frame session bundle stored only in memory (chrome.storage.session) ---

const RECORD_KEY = "recording";
const getRecording = async () => (await chrome.storage.session.get({ [RECORD_KEY]: emptyRecording() }))[RECORD_KEY];
let recordChain = Promise.resolve();
function changeRecording(fn) {
  return (recordChain = recordChain.catch(() => {}).then(async () => {
    const state = await getRecording();
    const next = await fn(state);
    if (next && next !== state) await chrome.storage.session.set({ [RECORD_KEY]: next });
    return next ?? state;
  }));
}

async function recordConfig(isPopup) {
  const s = await loadSettings();
  return {
    isPopup: !!isPopup,
    roster: s.roster,
    forbidden: [
      { value: s.school, replacement: "Sample School" },
      { value: s.teacherName, replacement: "Sample Teacher" },
      { value: s.origin, replacement: "Room 101" },
    ],
    macros: s.macros,
    lane: s.lane,
    outPasses: s.outPasses,
    queue: s.queue,
    destinations: s.destinations,
  };
}

async function recordMessage(msg, sender) {
  if (msg.type === "record-frame") {
    if (!msg.frame?.html) return { ok: false };
    await changeRecording((state) => addFrame(state, msg.frame));
    return { ok: true };
  }
  if (msg.type === "record-hello") {
    const state = await getRecording();
    if (!state.active) return { active: false };
    const popups = await popupWindowIds();
    const isPopup = !!(sender.tab && popups.has(sender.tab.windowId));
    return { active: true, settings: await recordConfig(isPopup) };
  }
  if (msg.type === "record-begin") {
    await changeRecording(() => ({ ...emptyRecording(), active: true, startedAt: Date.now() }));
    const popups = await popupWindowIds();
    const tabs = await allGoGuardianTabs();
    for (const tab of tabs) {
      const cfg = await recordConfig(popups.has(tab.windowId));
      chrome.tabs.sendMessage(tab.id, { type: "record-start", ...cfg }).catch(() => {});
    }
    return { ok: true, tabs: tabs.length };
  }
  if (msg.type === "record-info") {
    const s = await getRecording();
    return {
      ok: true,
      active: s.active,
      count: s.frames.length,
      dropped: s.dropped ?? 0,
      pages: [...new Set(s.frames.map((f) => f.meta?.host).filter(Boolean))],
      frames: s.active ? undefined : s.frames,
    };
  }
  if (msg.type === "record-end") {
    for (const tab of await allGoGuardianTabs()) {
      chrome.tabs.sendMessage(tab.id, { type: "record-stop" }).catch(() => {});
    }
    await new Promise((r) => setTimeout(r, 350));
    const done = await changeRecording((state) => ({ ...state, active: false }));
    return { ok: true, frames: done.frames ?? [], dropped: done.dropped ?? 0 };
  }
  if (msg.type === "record-clear") {
    await changeRecording(() => emptyRecording());
    return { ok: true };
  }
  return { ok: false };
}

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
  // While the teacher is showing the helper around, nothing is sent or ended.
  if ((await getWatch()).active) return;
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
      return "More than one student or button in HallPass matches, so the helper can't tell which is meant.";
    case "stuck":
      return `Got stuck at step ${result.step} (${result.label})${result.routes > 1 ? `, even after trying the other ${result.routes - 1 === 1 ? "way" : "ways"}` : ""}. Copy the page outline for Claude.`;
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

// What the helper did on its last try, for the side panel and the page outline: no names, only the steps.
async function saveRun(goal, lane, result) {
  const notes = (result?.notes ?? []).slice(0, 12);
  await saveSettings({
    lastRun: {
      goal,
      lane,
      at: Date.now(),
      ok: !!result?.ok,
      ...(result?.reason ? { reason: result.reason, step: result.step, label: result.label } : {}),
      ...(result?.routes > 1 ? { route: result.route, routes: result.routes } : {}),
      notes,
    },
  });
}

// Automatically freezes one strictly scrubbed snapshot + dry-run report when a run gets stuck or ambiguous,
// so the teacher can grab the exact failure state later without interrupting class. Only stored if verifyClean passes.
async function captureFailure(tab, { goal, lane, result }) {
  if (!tab?.id || !result || result.ok) return;
  try {
    const popups = await popupWindowIds();
    const isPopup = popups.has(tab.windowId);
    const trigger = `Auto-captured on ${goal} failure (${result.reason ?? "error"}${result.step ? ` at step ${result.step}` : ""})`;
    const res = await chrome.tabs.sendMessage(tab.id, { type: "capture-failure", isPopup, trigger }).catch(() => null);
    if (!res?.ok || !res.frame?.audit?.clean) return;
    await saveSettings({
      lastFailureCapture: {
        at: Date.now(),
        goal,
        lane,
        reason: result.reason ?? "stuck",
        step: result.step ?? null,
        label: result.label ?? "",
        frame: res.frame,
      },
    });
  } catch {
    // Best-effort diagnostic capture; never interfere with queue handling.
  }
}

// The other ways, for when "try the other way if this one gets stuck" is switched on.
const lanesToTry = (settings, lane) => (settings.fallback ? [lane, ...METHODS.map((m) => m.kind).filter((k) => k !== lane)] : [lane]);

// One go at sending `entry` through one way. Resolves { status: "sent" | "later" | "unavailable" | "failed", why }.
async function sendVia(entry, settings, lane) {
  const methods = pick(makeMethods(settings.macros), lane);
  if (!methods[lane]) return { status: "unavailable", why: `The helper hasn't been taught ${method(lane).name} yet. Switch to the other way.` };
  const found = await openMethod(methods);
  if (!found.tab && !found.opener) {
    const why = found.stale
      ? `Reload ${found.stale.name} so ${entry.label} can go.`
      : `Open ${found.taught.map((k) => method(k).where.split(",")[0]).join(" or ")} so ${entry.label} can go.`;
    return { status: "unavailable", why };
  }
  const { name, kind } = found;
  let tab = found.tab;
  if (found.opener) {
    const opened = await openCreateWindow(found.opener, name, { which: "make" });
    if (!opened.ok) return { status: "failed", why: opened.why };
    tab = opened.tab;
  }
  let result = await inTab(tab, { type: "make-pass", method: kind, student: entry.student, destination: entry.destination });
  // The Create Pass window may close itself once the pass is made, which cuts the reply off. A window that's
  // gone after no reply means it finished (a stuck step would have left it open).
  if (!result && kind === "create" && (await readyTab({ kind: "create" })).state === "closed") result = { ok: true };
  if (TRY_LATER.has(result?.reason)) return { status: "later" };
  await saveRun("make", kind, result);
  if (!result?.ok) {
    await captureFailure(tab, { goal: "make", lane: kind, result });
    // Only a clean "stuck" is safe to try another way after. No reply, or two matching students, is not.
    return { status: "failed", why: stuckText(result, name), retryable: result?.reason === "stuck" };
  }
  return { status: "sent" };
}

async function send(entry) {
  const settings = await loadSettings();
  // Normally only the chosen way is used. With the fallback switch on, a way that gets stuck (before anything
  // was made) hands over to the other one.
  const lane = chosenLane(settings);
  const outs = [];
  for (const kind of lanesToTry(settings, lane)) {
    const out = await sendVia(entry, settings, kind);
    if (out.status === "later") return;
    if (out.status === "sent") {
      const s = await loadSettings();
      await saveSettings({
        queue: s.queue.filter((e) => e.id !== entry.id),
        outPasses: [
          ...s.outPasses,
          { id: entry.id, student: entry.student, label: entry.label, destination: entry.destination, startedAt: Date.now() },
        ],
        queueProblem: "",
      });
      return;
    }
    outs.push(out);
    if (out.status === "failed" && !out.retryable) break;
  }
  const failed = outs.find((o) => o.status === "failed");
  if (!failed) {
    await saveSettings({ queueProblem: outs[0].why });
    return;
  }
  await saveSettings({ queuePaused: true, queueProblem: `${entry.label} wasn't sent. ${failed.why}` });
  notify("Queue paused", `${entry.label} wasn't sent. ${failed.why}`);
}

async function markFailed(pass, why) {
  const { outPasses } = await loadSettings();
  await saveSettings({ outPasses: outPasses.map((p) => (p.id === pass.id ? { ...p, endFailed: why } : p)) });
}

// One go at ending `pass` through one way. Resolves { status: "ended" | "later" | "unavailable" | "failed", why, reason }.
async function endVia(pass, settings, lane) {
  const methods = pick(endMethods(settings.macros), lane);
  if (!methods[lane]) {
    const need = Object.keys(endMethods(settings.macros)).length ? `It only knows how to end a pass the other way. Switch ways.` : "The helper doesn't know how to end a pass yet.";
    return { status: "unavailable", why: need, reason: "no-end-macro" };
  }
  const found = await openMethod(methods, END_ORDER);
  if (!found.tab && !found.opener) {
    const where = found.stale ? found.stale.name : found.taught.map((k) => method(k).where.split(",")[0]).join(" or ");
    return { status: "unavailable", why: found.stale ? `Reload ${where}.` : `Open ${where}.`, where, stale: !!found.stale, reason: "closed" };
  }
  const { name, kind } = found;
  let tab = found.tab;
  if (found.opener) {
    const opened = await openCreateWindow(found.opener, name, { which: "end", student: pass.student });
    if (!opened.ok) return { status: "failed", why: opened.why };
    tab = opened.tab;
  }
  let result = await inTab(tab, { type: "end-pass", method: kind, student: pass.student });
  // The window may close itself once the pass is ended, which cuts the reply off.
  if (!result && kind === "create" && (await readyTab({ kind: "create" })).state === "closed") result = { ok: true };
  if (TRY_LATER.has(result?.reason)) return { status: "later", result };
  await saveRun("end", kind, result);
  if (!result?.ok) {
    await captureFailure(tab, { goal: "end", lane: kind, result });
    return { status: "failed", why: stuckText(result, name), retryable: result?.reason === "stuck", result };
  }
  return { status: "ended" };
}

// Ends a pass in HallPass. Time's up unless `manual` (the teacher pressed Back).
async function endPass(id, { manual = false } = {}) {
  const settings = await loadSettings();
  const { outPasses, autoEndMinutes } = settings;
  const pass = outPasses.find((p) => p.id === id);
  if (!pass) return { ok: true };
  const lane = chosenLane(settings);
  const timesUp = `${pass.label}'s ${autoEndMinutes} minutes are up`;
  const outs = [];
  for (const kind of lanesToTry(settings, lane)) {
    const out = await endVia(pass, settings, kind);
    if (out.status === "later") return out.result;
    if (out.status === "ended") {
      const latest = await loadSettings();
      await saveSettings({ outPasses: latest.outPasses.filter((p) => p.id !== id) });
      if (!manual) notify("Pass ended", `${pass.label}'s pass ended at ${autoEndMinutes} minutes.`);
      return { ok: true };
    }
    outs.push(out);
    if (out.status === "failed" && !out.retryable) break;
  }
  const failed = outs.find((o) => o.status === "failed");
  const why = (failed ?? outs[0]).why;
  if (!failed) {
    // The page isn't there, or the helper wasn't taught this way: nothing was tried.
    if (!manual) {
      await markFailed(pass, why);
      const first = outs[0];
      notify(
        "Pass not ended",
        first.reason === "closed" ? `${timesUp}, but ${first.where} ${first.stale ? "needs a reload" : "isn't open"}. End it by hand.` : `${timesUp}. ${why}`,
      );
    }
    return { ok: false, reason: outs[0].reason };
  }
  await markFailed(pass, why);
  if (!manual) notify("Pass not ended", `${timesUp}, but the helper couldn't end it. ${why}`);
  return failed.result ?? { ok: false };
}

function notify(title, message) {
  chrome.notifications.create({ type: "basic", iconUrl: "icons/icon128.png", title, message });
}

// The steps for making and ending passes are built in. Written on install, on browser start and whenever this wakes.
installBuiltin();
chrome.runtime.onInstalled.addListener(installBuiltin);
chrome.runtime.onStartup.addListener(installBuiltin);
