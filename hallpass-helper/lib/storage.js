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
};

export function loadSettings() {
  return chrome.storage.local.get(DEFAULTS);
}

export function saveSettings(patch) {
  return chrome.storage.local.set(patch);
}
