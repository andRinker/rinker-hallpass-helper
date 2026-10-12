import { test } from "node:test";
import assert from "node:assert/strict";
import { endMethods, kindOfMacro, makeMethods, methodPlace, openerPlace, METHODS } from "../lib/methods.js";

test("steps taught before several ways existed are sorted by where they were taught", () => {
  assert.equal(kindOfMacro({ popup: true }), "create");
  assert.equal(kindOfMacro({ host: "hallpass.goguardian.com" }), "hallpass");
  assert.equal(kindOfMacro({}), "hallpass");
    assert.equal(kindOfMacro({ kind: "hallpass", popup: true }), "hallpass");
});

test("makeMethods merges the old single macro without overriding a newer one", () => {
  assert.deepEqual(makeMethods({}), {});
  const old = { popup: true, steps: [1] };
  assert.deepEqual(Object.keys(makeMethods({ create: old })), ["create"]);
  const newer = { kind: "create", steps: [2] };
  assert.equal(makeMethods({ create: old, make: { create: newer } }).create, newer);
  assert.deepEqual(Object.keys(makeMethods({ make: { create: {} }, create: { kind: "hallpass" } })).sort(), ["create", "hallpass"]);
  assert.deepEqual(Object.keys(makeMethods({ make: { home: {} } })), []);
});

test("each way runs only where it was taught", () => {
  assert.deepEqual(methodPlace("create", {}), { kind: "create", host: undefined });
  assert.equal(methodPlace("hallpass", {}).host, "hallpass.goguardian.com");
  assert.deepEqual(openerPlace({ opener: { host: "teacher.goguardian.com" } }), { kind: "home", host: "teacher.goguardian.com" });
  assert.equal(openerPlace({}), null);
});

test("every way has plain directions", () => {
  assert.equal(METHODS.length, 2);
  for (const m of METHODS) assert.ok(m.name && m.use && m.closed && m.steps.length);
});

test("ending has the same two ways, and an older single end macro is sorted by where it was taught", () => {
  assert.deepEqual(endMethods({}), {});
  assert.deepEqual(Object.keys(endMethods({ end: { popup: true } })), ["create"]);
  assert.deepEqual(Object.keys(endMethods({ end: {} })), ["hallpass"]);
  const newer = { kind: "create" };
  assert.equal(endMethods({ end: { popup: true }, endVia: { create: newer } }).create, newer);
  for (const m of METHODS) assert.ok(m.end.label && m.end.steps.length);
});

test("the lane is the one the teacher picked, else the first way taught, and never both", async () => {
  const { chosenLane } = await import("../lib/methods.js");
  assert.equal(chosenLane({}), "hallpass");
  assert.equal(chosenLane({ macros: { make: { create: {} } } }), "create");
  assert.equal(chosenLane({ macros: { make: { create: {}, hallpass: {} } } }), "hallpass");
  assert.equal(chosenLane({ lane: "create", macros: { make: { hallpass: {} } } }), "create");
  assert.equal(chosenLane({ lane: "home" }), "hallpass");
});
