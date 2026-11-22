// Runs inside HallPass and GoGuardian's home screen (any goguardian.com page) and answers the side panel and background.
// HallPass itself is learned by watching (watch.js) and replayed (replay.js), so nothing
// here hard-codes HallPass's page layout. Deciding who to send and when lives in background.js.
(() => {
  const HPH = globalThis.HallPassHelper;

  const getMacros = async () => (await chrome.storage.local.get({ macros: {} })).macros;

  // While the teacher is showing the helper around (Watch mode), the helper keeps its hands off the page.
  const teaching = () => HPH.isWatching();

  const handlers = {
    ping: async () => ({ ok: true }),
    "watch-start": async (settings) => {
      HPH.startWatching(settings);
      return { ok: true };
    },
    "watch-stop": async () => {
      HPH.stopWatching();
      return { ok: true };
    },
    // Makes the pass all the way through the final button.
    "make-pass": async ({ student, destination, method }) => {
      if (teaching()) return { ok: false, reason: "teaching" };
      const { create, make } = await getMacros();
      const macro = method ? make?.[method] : create;
      if (!macro) return { ok: false, reason: "not-taught" };
      return HPH.runMacro(macro, { student, destination });
    },
    // Clicks the button on the GoGuardian home screen that opens the Create Pass window.
    "run-opener": async ({ which, student }) => {
      if (teaching()) return { ok: false, reason: "teaching" };
      const { create, make, end, endVia } = await getMacros();
      const opener = (which === "end" ? (endVia?.create ?? end) : (make?.create ?? create))?.opener;
      if (!opener) return { ok: false, reason: "not-taught" };
      return HPH.runMacro(opener, { student });
    },
    "end-pass": async ({ student, method }) => {
      if (teaching()) return { ok: false, reason: "teaching" };
      const { end, endVia } = await getMacros();
      const macro = method ? endVia?.[method] : end;
      if (!macro) return { ok: false, reason: "no-end-macro" };
      return HPH.runMacro(macro, { student });
    },
    outline: async () => {
      const s = await chrome.storage.local.get({
        school: "",
        teacherName: "",
        origin: "",
        destinations: [],
        roster: [],
        macros: {},
        lastRun: null,
      });
      const keep = [s.school, s.teacherName, s.origin, ...s.destinations];
      return { ok: true, text: HPH.pageOutline({ keep, roster: s.roster, macros: s.macros, lastRun: s.lastRun }) };
    },
    snapshot: async ({ isPopup = false } = {}) => {
      const s = await chrome.storage.local.get({
        school: "",
        teacherName: "",
        origin: "",
        roster: [],
      });
      const forbidden = [
        { value: s.school, replacement: "Sample School" },
        { value: s.teacherName, replacement: "Sample Teacher" },
        { value: s.origin, replacement: "Room 101" },
      ];
      return HPH.captureSnapshot({ roster: s.roster, forbidden, isPopup });
    },
    diagnose: async ({ isPopup = false } = {}) => {
      const s = await chrome.storage.local.get({
        school: "",
        teacherName: "",
        origin: "",
        destinations: [],
        roster: [],
        macros: {},
        lane: "",
        outPasses: [],
        queue: [],
      });
      const forbidden = [
        { value: s.school, replacement: "Sample School" },
        { value: s.teacherName, replacement: "Sample Teacher" },
        { value: s.origin, replacement: "Room 101" },
      ];
      return HPH.diagnosePage({
        macros: s.macros,
        lane: s.lane,
        roster: s.roster,
        forbidden,
        outPasses: s.outPasses,
        queue: s.queue,
        destinations: s.destinations,
        isPopup,
      });
    },
  };

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    const handler = handlers[msg?.type];
    if (!handler) return false;
    handler(msg).then(sendResponse, (err) => sendResponse({ ok: false, reason: String(err) }));
    return true;
  });
})();
