// Runs inside HallPass and GoGuardian's home screen (any goguardian.com page) and answers the side panel and background.
// HallPass itself is learned by watching (recorder.js) and replayed (replay.js), so nothing
// here hard-codes HallPass's page layout. Deciding who to send and when lives in background.js.
(() => {
  const HPH = globalThis.HallPassHelper;

  const getMacros = async () => (await chrome.storage.local.get({ macros: {} })).macros;

  // While the teacher is teaching, the helper keeps its hands off the page.
  const teaching = () => HPH.recordingStatus().recording;

  const handlers = {
    ping: async () => ({ ok: true }),
    "teach-start": async ({ kind }) => {
      HPH.startRecording(kind);
      return { ok: true };
    },
    "teach-status": async () => ({ ok: true, ...HPH.recordingStatus() }),
    "teach-stop": async () => ({ ok: true, ...HPH.stopRecording() }),
    // Makes the pass all the way through the final button.
    "make-pass": async ({ student, destination }) => {
      if (teaching()) return { ok: false, reason: "teaching" };
      const { create } = await getMacros();
      if (!create) return { ok: false, reason: "not-taught" };
      return HPH.runMacro(create, { student, destination });
    },
    "end-pass": async ({ student }) => {
      if (teaching()) return { ok: false, reason: "teaching" };
      const { end } = await getMacros();
      if (!end) return { ok: false, reason: "no-end-macro" };
      return HPH.runMacro(end, { student });
    },
    outline: async () => {
      const s = await chrome.storage.local.get({
        school: "",
        teacherName: "",
        origin: "",
        destinations: [],
        roster: [],
        macros: {},
      });
      const keep = [s.school, s.teacherName, s.origin, ...s.destinations];
      return { ok: true, text: HPH.pageOutline({ keep, roster: s.roster, macros: s.macros }) };
    },
  };

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    const handler = handlers[msg?.type];
    if (!handler) return false;
    handler(msg).then(sendResponse, (err) => sendResponse({ ok: false, reason: String(err) }));
    return true;
  });
})();
