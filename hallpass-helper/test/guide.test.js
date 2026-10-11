import { test } from "node:test";
import assert from "node:assert/strict";
import { guide } from "../lib/guide.js";
import { pageKind } from "../lib/tabs.js";

const closed = { hallpass: "closed", home: "closed", create: "closed" };
const settings = { destinations: ["Nurse"], school: "Middle", macros: {}, queue: [], outPasses: [] };

test("with nothing open, the first step is to open a page", () => {
  const g = guide({ settings: {}, pages: closed });
  assert.equal(g.steps[g.current].id, "open");
  assert.equal(g.doneCount, 0);
});

test("a page the helper can't see yet is asked to be reloaded", () => {
  const g = guide({ settings, pages: { ...closed, home: "stale" } });
  assert.equal(g.steps[0].done, false);
  assert.ok(g.steps[0].lines.some((l) => /Reload the GoGuardian home screen/.test(l)));
});

test("steps are ticked off in order as things get set up", () => {
  const ready = { ...closed, hallpass: "ready" };
  assert.equal(guide({ settings: {}, pages: ready }).steps[guide({ settings: {}, pages: ready }).current].id, "settings");
  assert.equal(guide({ settings, pages: ready }).steps[guide({ settings, pages: ready }).current].id, "make");
  const made = { ...settings, macros: { create: { steps: [] } } };
  assert.equal(guide({ settings: made, pages: ready }).steps[guide({ settings: made, pages: ready }).current].id, "end");
  const taught = { ...settings, macros: { create: {}, end: {} } };
  assert.equal(guide({ settings: taught, pages: ready }).steps[guide({ settings: taught, pages: ready }).current].id, "send");
  const sent = { ...taught, queue: [{}] };
  const g = guide({ settings: sent, pages: ready });
  assert.equal(g.complete, true);
  assert.equal(g.doneCount, 5);
});

test("the make-a-pass step points at the Create Pass window when only the home screen is open", () => {
  const g = guide({ settings, pages: { ...closed, home: "ready" } });
  assert.ok(g.steps[2].lines.some((l) => /click Create Pass on the home screen first/.test(l)));
  const open = guide({ settings, pages: { ...closed, home: "ready", create: "ready" } });
  assert.ok(!open.steps[2].lines.some((l) => /home screen first/.test(l)));
});

test("while teaching, the steps say the helper is watching", () => {
  const g = guide({ settings, pages: { ...closed, hallpass: "ready" }, teaching: true });
  assert.ok(g.steps[2].lines[0].startsWith("The helper is watching"));
});

test("pageKind tells the three GoGuardian pages apart", () => {
  const popups = new Set([9]);
  assert.equal(pageKind({ url: "https://hallpass.goguardian.com/x", windowId: 1 }, popups), "hallpass");
  assert.equal(pageKind({ url: "https://teacher.goguardian.com/", windowId: 1 }, popups), "home");
  assert.equal(pageKind({ url: "https://hallpass.goguardian.com/s/passes/create", windowId: 9 }, popups), "create");
});
