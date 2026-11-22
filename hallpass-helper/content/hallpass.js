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
    // Makes the pass all the way through the final button, inspecting Pass Details for blockers afterward.
    "make-pass": async ({ student, destination, method }) => {
      if (teaching()) return { ok: false, reason: "teaching" };
      const { create, make } = await getMacros();
      const macro = method ? make?.[method] : create;
      if (!macro) return { ok: false, reason: "not-taught" };
      return HPH.runMacro(macro, { student, destination }, { inspectOutcome: true });
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
    // Read-only check of whether tracked students are currently Active, Waiting for Approval, or gone from My passes.
    "read-passes": async ({ passes = [] } = {}) => {
      if (HPH.busy || teaching()) return { ok: false, reason: "busy" };
      const snap = HPH.readMyPasses?.();
      if (!snap?.supported) return { ok: true, supported: false, requestsCollapsed: false, filtered: false, states: {} };
      const states = {};
      for (const p of passes) {
        const matches = snap.cards.filter((c) => HPH.nameMatches(c.text, p.student));
        const active = matches.find((c) => c.status === "active");
        const waiting = matches.find((c) => c.status === "waiting");
        states[p.id] = active ? "active" : waiting ? "waiting" : "missing";
      }
      const details = HPH.readPassDetails?.();
      const passDetails = details
        ? {
            open: true,
            status: details.status,
            hasBlockers: details.hasBlockers,
            hardBlockers: details.hardBlockers,
            autoBlockers: details.autoBlockers,
            etaText: details.etaText,
            canOverride: details.canOverride,
            canReject: details.canReject,
            canEnd: details.canEnd,
          }
        : null;
      return {
        ok: true,
        supported: true,
        requestsCollapsed: snap.requestsCollapsed,
        filtered: snap.filtered,
        states,
        passDetails,
      };
    },
    // Cancels/rejects a pass that is sitting in GoGuardian's "Waiting for Approval" queue.
    "cancel-waiting": async ({ student }) => {
      if (teaching()) return { ok: false, reason: "teaching" };
      if (HPH.busy) return { ok: false, reason: "busy" };
      HPH.busy = true;
      try {
        return await HPH.rejectWaitingPass(student);
      } finally {
        HPH.busy = false;
      }
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
    "record-start": async (settings) => {
      HPH.startRecording(settings);
      return { ok: true };
    },
    "record-stop": async () => {
      HPH.stopRecording();
      return { ok: true };
    },
    "capture-failure": async ({ isPopup = false, trigger = "Helper got stuck" } = {}) => {
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
      const session = HPH.createScrubSession();
      const snap = HPH.captureSnapshot({ roster: s.roster, forbidden, isPopup, session });
      const diag = HPH.diagnosePage({
        macros: s.macros,
        lane: s.lane,
        roster: s.roster,
        forbidden,
        outPasses: s.outPasses,
        queue: s.queue,
        destinations: s.destinations,
        isPopup,
      });
      const clean = !!(snap.audit?.clean && diag.audit?.clean);
      const leaks = [...new Set([...(snap.audit?.leaks ?? []), ...(diag.audit?.leaks ?? [])])];
      return {
        ok: true,
        frame: {
          at: Date.now(),
          trigger,
          fingerprint: HPH.screenFingerprint(),
          meta: snap.meta,
          html: snap.html,
          diagnoseReport: diag.report,
          audit: { ...snap.audit, clean, leaks },
        },
      };
    },
  };

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    const handler = handlers[msg?.type];
    if (!handler) return false;
    handler(msg).then(sendResponse, (err) => sendResponse({ ok: false, reason: String(err) }));
    return true;
  });
})();
