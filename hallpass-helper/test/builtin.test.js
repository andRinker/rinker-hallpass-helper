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
  assert.equal(BUILTIN_MACROS.endVia.hallpass.steps[0].role, "student");
  assert.equal(BUILTIN_MACROS.endVia.create.opener.steps[0].role, "student");
});
