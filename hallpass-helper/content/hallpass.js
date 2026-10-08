// Runs inside hallpass.goguardian.com and answers the side panel and background.
// HallPass itself is learned by watching (recorder.js) and replayed (replay.js), so nothing
// here hard-codes HallPass's page layout.
(() => {
  const HPH = globalThis.HallPassHelper;

  const minutesSince = (t) => Math.max(0, Math.round((Date.now() - t) / 60000));

  // Called by replay.js when the teacher clicks the final button.
  HPH.onPassCreated = async ({ student, destination }) => {
    const { outPasses } = await chrome.storage.local.get({ outPasses: [] });
    outPasses.push({
      id: crypto.randomUUID(),
      student: { first: student.first, last: student.last },
      label: student.label ?? `${student.first} ${student.last}`.trim(),
      destination: destination ?? "",
      startedAt: Date.now(),
    });
    await chrome.storage.local.set({ outPasses });
  };

  // Ends the given passes (all of them when ids is null) with the taught "end" steps.
  async function endPasses(ids) {
    const { macros, outPasses } = await chrome.storage.local.get({ macros: {}, outPasses: [] });
    if (!macros.end) return { ok: false, reason: "no-end-macro", ended: [], failed: [] };
    const ended = [];
    const failed = [];
    for (const pass of outPasses.filter((p) => !ids || ids.includes(p.id))) {
      const result = await HPH.runMacro(macros.end, { student: pass.student }, { stopAtFinal: false });
      const summary = { id: pass.id, student: pass.label, minutesOut: minutesSince(pass.startedAt) };
      if (result.ok) ended.push(summary);
      else failed.push({ ...summary, reason: result.reason, step: result.step, label: result.label });
    }
    if (ended.length) {
      const { outPasses: latest } = await chrome.storage.local.get({ outPasses: [] });
      await chrome.storage.local.set({ outPasses: latest.filter((p) => !ended.some((e) => e.id === p.id)) });
    }
    return { ok: !failed.length, ended, failed };
  }

  const handlers = {
    ping: async () => ({ ok: true }),
    "teach-start": async ({ kind }) => {
      HPH.startRecording(kind);
      return { ok: true };
    },
    "teach-status": async () => ({ ok: true, ...HPH.recordingStatus() }),
    "teach-stop": async () => ({ ok: true, ...HPH.stopRecording() }),
    "start-pass": async ({ student, destination }) => {
      const { macros } = await chrome.storage.local.get({ macros: {} });
      if (!macros.create) return { ok: false, reason: "not-taught" };
      return HPH.runMacro(macros.create, { student, destination });
    },
    "end-pass": ({ id }) => endPasses([id]),
    "end-my-passes": () => endPasses(null),
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
