// Everything lives in this browser's own storage. Nothing is sent anywhere.

export const HALLPASS_URL = "https://hallpass.goguardian.com/";

export const DEFAULTS = {
  school: "",
  teacherName: "",
  origin: "",
  destinations: [],
  rosterText: "",
  roster: [],
  schedules: [],
  weekdaySchedule: {},
  todayOverride: null,
  endAtBell: false,
  overdueMinutes: 10,
  // Taught steps: { create: { steps, taughtAt }, end: { steps, taughtAt } }
  macros: {},
  // Passes made through the helper that haven't ended: [{ id, student, label, destination, startedAt }]
  outPasses: [],
};

export function loadSettings() {
  return chrome.storage.local.get(DEFAULTS);
}

export function saveSettings(patch) {
  return chrome.storage.local.set(patch);
}
