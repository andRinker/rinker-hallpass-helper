import { loadSettings } from "./lib/storage.js";
import { goGuardianTab, taughtHost } from "./lib/tabs.js";
import { nextBell, scheduleForDate } from "./lib/bells.js";

const BELL_KEYS = ["schedules", "weekdaySchedule", "todayOverride"];

chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  armBell();
  syncOverdue();
});
chrome.runtime.onStartup.addListener(() => {
  armBell();
  syncOverdue();
});
chrome.storage.onChanged.addListener((changes) => {
  if (BELL_KEYS.some((k) => k in changes)) armBell();
  if ("outPasses" in changes || "overdueMinutes" in changes) syncOverdue();
});

// A bell alarm that fires late (laptop asleep) is skipped, so it can't end passes made after that bell.
const LATE_BELL_MS = 2 * 60 * 1000;

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name.startsWith("overdue:")) return onOverdue(alarm.name.slice("overdue:".length));
  if (alarm.name === "bell" && Date.now() - alarm.scheduledTime < LATE_BELL_MS) await onBell();
  armBell();
});

// One alarm for the next bell today; after the last bell, wake just after midnight to arm tomorrow's.
async function armBell() {
  const settings = await loadSettings();
  const now = new Date();
  const bell = nextBell(scheduleForDate(settings, now), now);
  await Promise.all([chrome.alarms.clear("bell"), chrome.alarms.clear("rearm")]);
  if (bell) {
    chrome.alarms.create("bell", { when: bell.at.getTime() });
  } else {
    const tomorrow = new Date(now);
    tomorrow.setHours(24, 1, 0, 0);
    chrome.alarms.create("rearm", { when: tomorrow.getTime() });
  }
}

// One alarm per pass that's out, set for the moment it becomes overdue.
async function syncOverdue() {
  const { outPasses, overdueMinutes } = await loadSettings();
  const wanted = new Map(outPasses.map((p) => [`overdue:${p.id}`, p.startedAt + overdueMinutes * 60000]));
  const existing = (await chrome.alarms.getAll()).filter((a) => a.name.startsWith("overdue:"));
  const current = new Set();
  for (const alarm of existing) {
    if (Math.abs((wanted.get(alarm.name) ?? 0) - alarm.scheduledTime) < 1000) current.add(alarm.name);
    else await chrome.alarms.clear(alarm.name);
  }
  for (const [name, when] of wanted) {
    if (!current.has(name) && when > Date.now()) chrome.alarms.create(name, { when });
  }
}

async function onOverdue(id) {
  const { outPasses, overdueMinutes } = await loadSettings();
  const pass = outPasses.find((p) => p.id === id);
  if (!pass) return;
  const where = pass.destination ? ` (${pass.destination})` : "";
  notify("Overdue pass", `${pass.label} has been out ${overdueMinutes} minutes${where}.`);
}

async function onBell() {
  const { endAtBell, outPasses, macros } = await loadSettings();
  if (!endAtBell || !outPasses.length) return;
  const tab = await goGuardianTab(taughtHost(macros.end));
  if (!tab) {
    notify("Bell rang", "HallPass isn't open, so no passes were ended.");
    return;
  }
  // Background tabs run timers slowly, so show HallPass while it clicks through, then switch back.
  const [previous] = await chrome.tabs.query({ active: true, windowId: tab.windowId });
  await chrome.tabs.update(tab.id, { active: true });
  const result = await chrome.tabs.sendMessage(tab.id, { type: "end-my-passes" }).catch(() => null);
  if (previous && previous.id !== tab.id) chrome.tabs.update(previous.id, { active: true }).catch(() => {});
  if (!result) {
    notify("Bell rang", "Couldn't reach HallPass. Reload the HallPass tab and check your passes.");
    return;
  }
  if (result.reason === "no-end-macro") {
    notify("Bell rang", "Teach the helper how you end a pass (in the side panel) so it can end passes at the bell.");
    return;
  }
  if (result.ended.length) {
    notify("Ended at the bell", result.ended.map((p) => `${p.student} (out ${p.minutesOut} min)`).join(", "));
  }
  if (result.failed.length) {
    notify("Still open after the bell", `Couldn't end: ${result.failed.map((p) => p.student).join(", ")}. Check HallPass.`);
  }
}

function notify(title, message) {
  chrome.notifications.create({ type: "basic", iconUrl: "icons/icon128.png", title, message });
}
