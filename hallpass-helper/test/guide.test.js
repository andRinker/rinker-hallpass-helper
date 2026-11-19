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
  const g = guide({ settings: { ...settings, lane: "create" }, pages: { ...closed, home: "stale" } });
  assert.equal(g.steps[0].done, false);
  assert.ok(g.steps[0].lines.some((l) => /Reload the GoGuardian home screen/.test(l)));
});

test("steps are ticked off in order as things get set up", () => {
  const ready = { ...closed, hallpass: "ready" };
  const next = (st) => {
    const g = guide({ settings: st, pages: ready });
    return g.steps[g.current].id;
  };
  assert.equal(next({}), "settings");
  assert.equal(next(settings), "send");
  const g = guide({ settings: { ...settings, queue: [{}] }, pages: ready });
  assert.equal(g.complete, true);
  assert.equal(g.doneCount, 3);
});

test("pageKind tells the three GoGuardian pages apart", () => {
  const popups = new Set([9]);
  assert.equal(pageKind({ url: "https://hallpass.goguardian.com/x", windowId: 1 }, popups), "hallpass");
  assert.equal(pageKind({ url: "https://teacher.goguardian.com/", windowId: 1 }, popups), "home");
  assert.equal(pageKind({ url: "https://hallpass.goguardian.com/s/passes/create", windowId: 9 }, popups), "create");
});

test("the way you didn't pick sleeps: its pages aren't needed", () => {
  const hp = guide({ settings: { ...settings, lane: "hallpass" }, pages: { ...closed, hallpass: "ready", home: "stale" } });
  assert.equal(hp.steps[0].done, true);
  assert.equal(hp.pages.find((p) => p.key === "home").state, "off");
  const home = guide({ settings: { ...settings, lane: "create" }, pages: { ...closed, home: "ready" } });
  assert.equal(home.steps[0].done, true);
  assert.equal(home.pages.find((p) => p.key === "hallpass").state, "off");
  assert.equal(home.pages.find((p) => p.key === "create").state, "closed");
});
