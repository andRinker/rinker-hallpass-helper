// Everything lives in this browser's own storage. Nothing is sent anywhere.

export const HALLPASS_URL = "https://hallpass.goguardian.com/";

export const DEFAULTS = {
  school: "",
  teacherName: "",
  origin: "",
  destinations: [],
  rosterText: "",
  roster: [],
  // How many of my students can be out (or waiting in HallPass) at once before the next one is sent.
  maxOut: 1,
  // Passes are ended in HallPass after this many minutes.
  autoEndMinutes: 7,
  // Taught steps: { create: { steps, taughtAt, host }, end: { steps, taughtAt, host } }
  macros: {},
  // Students waiting their turn, in order: [{ id, student, label, destination, addedAt }]
  queue: [],
  queuePaused: false,
  // Why the queue stopped, shown in the side panel until it's resumed.
  queueProblem: "",
  // Passes the helper made that haven't ended: [{ id, student, label, destination, startedAt, endFailed? }]
  outPasses: [],
};

export function loadSettings() {
  return chrome.storage.local.get(DEFAULTS);
}

export function saveSettings(patch) {
  return chrome.storage.local.set(patch);
}
