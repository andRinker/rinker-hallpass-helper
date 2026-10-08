import { HALLPASS_URL, loadSettings } from "./lib/storage.js";
import { nextBell, scheduleForDate } from "./lib/bells.js";

chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  armBell();
});
chrome.runtime.onStartup.addListener(armBell);
chrome.storage.onChanged.addListener(armBell);

// A bell alarm that fires late (laptop asleep) is skipped, so it can't end passes made after that bell.
const LATE_BELL_MS = 2 * 60 * 1000;

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === "bell" && Date.now() - alarm.scheduledTime < LATE_BELL_MS) await onBell();
  armBell();
});

// One alarm for the next bell today; after the last bell, wake just after midnight to arm tomorrow's.
async function armBell() {
  const settings = await loadSettings();
  const now = new Date();
  const bell = nextBell(scheduleForDate(settings, now), now);
  await chrome.alarms.clearAll();
  if (bell) {
    chrome.alarms.create("bell", { when: bell.at.getTime() });
  } else {
    const tomorrow = new Date(now);
    tomorrow.setHours(24, 1, 0, 0);
    chrome.alarms.create("rearm", { when: tomorrow.getTime() });
  }
}

async function onBell() {
  const { endAtBell } = await loadSettings();
  if (!endAtBell) return;
  const [tab] = await chrome.tabs.query({ url: `${HALLPASS_URL}*` });
  if (!tab) {
    notify("Bell rang", "HallPass isn't open, so no passes were ended.");
    return;
  }
  const result = await chrome.tabs.sendMessage(tab.id, { type: "end-my-passes" }).catch(() => null);
  if (!result?.ok) {
    notify("Bell rang", "Couldn't end passes automatically. Check HallPass.");
  } else if (result.ended.length) {
    const who = result.ended.map((p) => `${p.student} (out ${p.minutesOut} min)`).join(", ");
    notify("Ended at the bell", who);
  }
}

function notify(title, message) {
  chrome.notifications.create({ type: "basic", iconUrl: "icons/icon128.png", title, message });
}
