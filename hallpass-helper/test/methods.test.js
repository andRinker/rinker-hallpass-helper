import { test } from "node:test";
import assert from "node:assert/strict";
import { kindOfMacro, makeMethods, methodPlace, openerPlace, METHODS } from "../lib/methods.js";

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
