// The engine: sends the next student in the teacher's queue to HallPass when a spot opens,
// and ends each pass once its time is up. Everything that clicks through HallPass runs here,
// one thing at a time, so the queue, the timers and the Back button never trip over each other.
import { loadSettings, saveSettings } from "./lib/storage.js";
import { goGuardianTab, hostOf, siteName, taughtHost } from "./lib/tabs.js";
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
  const next = nextToSend(s);
  if (next && s.macros.create) await send(next);
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
      return `Couldn't reach ${name}. Reload the ${name} tab.`;
    default:
      return `Something went wrong in ${name}.`;
  }
}

async function send(entry) {
  const { macros } = await loadSettings();
  const host = taughtHost(macros.create);
  const name = siteName(host);
  const tab = await goGuardianTab(host);
  if (!tab) {
    await saveSettings({ queueProblem: `Open ${name} so ${entry.label} can go.` });
    return;
  }
  const result = await inTab(tab, { type: "make-pass", student: entry.student, destination: entry.destination });
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
  const { outPasses, macros, autoEndMinutes } = await loadSettings();
  const pass = outPasses.find((p) => p.id === id);
  if (!pass) return { ok: true };
  const host = taughtHost(macros.end);
  const name = siteName(host);
  const timesUp = `${pass.label}'s ${autoEndMinutes} minutes are up`;
  if (!macros.end) {
    if (!manual) {
      await markFailed(pass, "Teach the helper how to end a pass.");
      notify("Pass not ended", `${timesUp}. Teach the helper how you end a pass so it can do it for you.`);
    }
    return { ok: false, reason: "no-end-macro" };
  }
  const tab = await goGuardianTab(host);
  if (!tab) {
    if (!manual) {
      await markFailed(pass, `${name} wasn't open.`);
      notify("Pass not ended", `${timesUp}, but ${name} isn't open. End it in ${name}.`);
    }
    return { ok: false, reason: "closed" };
  }
  const result = await inTab(tab, { type: "end-pass", student: pass.student });
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
