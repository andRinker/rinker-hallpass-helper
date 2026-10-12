import { test } from "node:test";
import assert from "node:assert/strict";
import { kindOfMacro, makeMethods, methodPlace, METHODS } from "../lib/methods.js";

test("steps taught before several ways existed are sorted by where they were taught", () => {
  assert.equal(kindOfMacro({ popup: true }), "create");
  assert.equal(kindOfMacro({ host: "hallpass.goguardian.com" }), "hallpass");
  assert.equal(kindOfMacro({}), "hallpass");
  assert.equal(kindOfMacro({ host: "teacher.goguardian.com" }), "home");
  assert.equal(kindOfMacro({ kind: "home", popup: true }), "home");
});

test("makeMethods merges the old single macro without overriding a newer one", () => {
  assert.deepEqual(makeMethods({}), {});
  const old = { popup: true, steps: [1] };
  assert.deepEqual(Object.keys(makeMethods({ create: old })), ["create"]);
  const newer = { kind: "create", steps: [2] };
  assert.equal(makeMethods({ create: old, make: { create: newer } }).create, newer);
  assert.deepEqual(Object.keys(makeMethods({ make: { home: {} }, create: { kind: "hallpass" } })).sort(), ["hallpass", "home"]);
});

test("each way runs only where it was taught", () => {
  assert.deepEqual(methodPlace("create", {}), { kind: "create", host: undefined });
  assert.equal(methodPlace("hallpass", {}).host, "hallpass.goguardian.com");
  assert.equal(methodPlace("home", { host: "teacher.goguardian.com" }).host, "teacher.goguardian.com");
});

test("every way has plain directions", () => {
  assert.equal(METHODS.length, 3);
  for (const m of METHODS) assert.ok(m.name && m.use && m.closed && m.steps.length);
});
