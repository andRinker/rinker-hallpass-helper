import { test } from "node:test";
import assert from "node:assert/strict";
import { taughtSetup } from "../lib/export.js";

// Same idea as HallPassHelper.redact: roster words are shaped, everything else kept when it is in `keep`.
const redact = (text, { keep, roster }) => {
  const names = new Set(roster.flatMap((s) => [s.first.toLowerCase(), s.last.toLowerCase()]));
  return String(text).replace(/[\p{L}\p{N}]+/gu, (w) => (names.has(w.toLowerCase()) ? w.replace(/\p{Lu}/gu, "X").replace(/\p{Ll}/gu, "x") : w));
};

const click = (name, extra = {}) => ({ action: "click", role: "fixed", target: { role: "button", name, tag: "button", ...extra } });

test("taught setup lists both ways with steps, keeps placeholders and hides names", () => {
  const settings = {
    school: "Middle",
    destinations: ["Nurse"],
    roster: [{ first: "Jordan", last: "Miller" }],
    lane: "create",
    macros: {
      make: {
        hallpass: { host: "hallpass.goguardian.com", steps: [click("{student}", { context: "Jordan Miller card", testid: "row-123" })] },
        create: { host: "hallpass.goguardian.com", popup: true, steps: [click("Create")], opener: { host: "teacher.goguardian.com", steps: [click("Create Pass")] } },
      },
      endVia: { hallpass: { steps: [click("End Pass")] } },
    },
  };
  const out = JSON.parse(taughtSetup(settings, redact, "0.3.10 tester"));
  assert.equal(out.lane, "create");
  assert.deepEqual(Object.keys(out.makePass).sort(), ["create", "hallpass"]);
  assert.deepEqual(Object.keys(out.endPass), ["hallpass"]);
  assert.equal(out.makePass.hallpass.steps[0].target.name, "{student}");
  assert.equal(out.makePass.hallpass.steps[0].target.testid, "row-#");
  assert.equal(out.makePass.create.opener.steps[0].target.name, "Create Pass");
  assert.equal(out.makePass.create.popup, true);
  assert.ok(!/Jordan|Miller/.test(JSON.stringify(out)));
});
