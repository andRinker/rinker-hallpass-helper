// Everything lives in this browser's own storage. Nothing is sent anywhere.

export const HALLPASS_URL = "https://campus.goguardian.com/";

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
  // Which way passes are made AND ended: "hallpass" or "create" (home screen -> pop-up). Empty: the first one taught.
  lane: "",
  // On: when the chosen way gets stuck before anything was made or ended, the other way is tried. Off by default.
  fallback: false,
  // Other ways learned in Watch mode, added to the built-in steps: { make: { hallpass: [{ steps, learnedAt }] }, endVia: {...} }
  learned: {},
  // The screens the helper has seen while watching: { screens: {...}, edges: {...} }. Common words only.
  siteMap: { screens: {}, edges: {} },
  // What the helper did on its last try (no names): { goal, lane, at, ok, notes: [...] }
  lastRun: null,
  // Scrubbed snapshot + dry-run report automatically captured the last time the helper got stuck (zero PII).
  lastFailureCapture: null,
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
