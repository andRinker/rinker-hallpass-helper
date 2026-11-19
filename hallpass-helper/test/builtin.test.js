import { test } from "node:test";
import assert from "node:assert/strict";
import { BUILTIN_MACROS } from "../lib/builtin.js";
import { chosenLane, endMethods, makeMethods } from "../lib/methods.js";

test("both ways of making and ending a pass are built in", () => {
  const settings = { macros: BUILTIN_MACROS };
  assert.deepEqual(Object.keys(makeMethods(BUILTIN_MACROS)).sort(), ["create", "hallpass"]);
  assert.deepEqual(Object.keys(endMethods(BUILTIN_MACROS)).sort(), ["create", "hallpass"]);
  assert.equal(chosenLane(settings), "hallpass");
});

test("making a pass fills in the student and destination and ends on the final button", () => {
  for (const macro of Object.values(BUILTIN_MACROS.make)) {
    const roles = macro.steps.map((s) => s.role);
    assert.equal(roles.filter((r) => r === "final").length, 1);
    assert.ok(roles.includes("student") && roles.includes("destination"));
    assert.equal(macro.steps.at(-1).target.name, "Close");
  }
  assert.equal(BUILTIN_MACROS.make.create.popup, true);
  assert.equal(BUILTIN_MACROS.make.create.opener.host, "teacher.goguardian.com");
});

test("no student name is built in, and ending picks the student", () => {
  assert.ok(!/jordan|miller|ava|lee/i.test(JSON.stringify(BUILTIN_MACROS)));
  assert.equal(BUILTIN_MACROS.endVia.create.opener.steps[0].role, "student");
});

test("ending on the HallPass site has a way for an open pass box and a way for a closed one", () => {
  const [open, ...others] = [BUILTIN_MACROS.endVia.hallpass.steps, ...BUILTIN_MACROS.endVia.hallpass.alternates.map((a) => a.steps)];
  // Pass box already open: End Pass is right there, in the student's own box. Nothing opens it first.
  assert.equal(open[0].target.name, "End Pass");
  assert.equal(open[0].target.near, "{student}");
  assert.equal(open[0].role, "final");
  // Pass box closed: click the student's button first (as stable 0.4.4 does), then End Pass and Close when they show up.
  const [closed] = others;
  assert.equal(closed[0].role, "student");
  assert.ok(closed.slice(1).every((s) => s.optional));
  assert.ok(closed.some((s) => s.commit && s.target.name === "End Pass"));
});

test("making a pass skips what is already on screen", () => {
  const steps = BUILTIN_MACROS.make.hallpass.steps;
  const newPass = steps.find((s) => s.target.name === "New Pass");
  assert.ok(newPass.done?.length, "an open form means New Pass needs no click");
  const pick = steps.find((s) => s.role === "student" && s.action === "click");
  assert.equal(pick.done[0].name, "{student}", "a picked student is not picked again");
  assert.ok(steps.some((s) => s.peek), "a leftover Pass Details panel is closed first");
  // Nothing is ever skipped past the final button: it has no `done` to skip on.
  assert.ok(!steps.find((s) => s.role === "final").done);
  // The Create Pass window may open on the "Choose a site" screen or straight on the form.
  assert.ok(BUILTIN_MACROS.make.create.steps[0].done?.length);
});

test("student and destination boxes are both typed into before picking", () => {
  for (const macro of Object.values(BUILTIN_MACROS.make)) {
    for (const who of ["student", "destination"]) {
      const at = macro.steps.findIndex((s) => s.role === who && s.action === "type");
      assert.ok(at >= 0, `${who} is typed`);
      assert.equal(macro.steps[at + 1].action, "click");
      assert.equal(macro.steps[at + 1].role, who);
    }
  }
});
