// Runs inside hallpass.goguardian.com. Everything that touches HallPass's own page
// lives in `adapter`, so when GoGuardian changes their layout this is the only code to fix.
//
// NOT WIRED UP YET: the adapter needs screenshots / saved pages of the real HallPass
// screens to know which buttons and fields to use. Until then every action reports
// "not-wired" and the side panel says so.

const adapter = {
  // Fill the new-pass form (school, teacher, origin, destination, student) and stop at Submit.
  async startPass(_student, _defaults) {
    return notWired();
  },
  // [{ id, student, destination, minutesOut, overdue }]
  async listActivePasses() {
    return notWired();
  },
  async endPass(_id) {
    return notWired();
  },
  // End this teacher's open passes; resolves { ok, ended: [{ student, minutesOut }] }.
  async endMyPasses() {
    return notWired();
  },
};

function notWired() {
  return { ok: false, reason: "not-wired" };
}

const handlers = {
  ping: async () => ({ ok: true }),
  "start-pass": (msg) => adapter.startPass(msg.student, msg.defaults),
  "list-active": () => adapter.listActivePasses(),
  "end-pass": (msg) => adapter.endPass(msg.id),
  "end-my-passes": () => adapter.endMyPasses(),
};

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  const handler = handlers[msg?.type];
  if (!handler) return false;
  handler(msg).then(sendResponse, (err) => sendResponse({ ok: false, reason: String(err) }));
  return true;
});
