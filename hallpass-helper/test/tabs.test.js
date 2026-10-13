import { test } from "node:test";
import assert from "node:assert/strict";
import { pickTab, siteName, taughtPlace } from "../lib/tabs.js";

const tab = (id, url, lastAccessed, windowId = 1) => ({ id, url, lastAccessed, windowId });
const tabs = [
  tab(1, "https://hallpass.goguardian.com/dashboard", 100),
  tab(2, "https://teacher.goguardian.com/", 300),
  tab(3, "https://www.goguardian.com/hall-pass", 500),
  tab(4, "https://example.com/goguardian.com", 900),
];

test("pickTab only uses the site the steps were taught on", () => {
  assert.equal(pickTab(tabs, { host: "hallpass.goguardian.com" }).id, 1);
  assert.equal(pickTab(tabs, { host: "teacher.goguardian.com" }).id, 2);
  assert.equal(pickTab(tabs, { host: "app.goguardian.com" }), null);
});

test("pickTab without a place takes the most recent GoGuardian tab, skipping the marketing site", () => {
  assert.equal(pickTab(tabs).id, 2);
  assert.equal(pickTab([tabs[2], tabs[3]]), null);
});

// The Create Pass window is on the HallPass site, in a pop-up window of its own.
const withPopup = [...tabs, tab(5, "https://hallpass.goguardian.com/s/passes/create", 200, 7)];
const popups = new Set([7]);

test("pickTab tells the pop-up from a normal tab on the same site", () => {
  assert.equal(pickTab(withPopup, { host: "hallpass.goguardian.com", popup: true }, popups).id, 5);
  assert.equal(pickTab(withPopup, { host: "hallpass.goguardian.com", popup: false }, popups).id, 1);
});

test("pickTab never falls back to a normal tab for steps taught in the pop-up", () => {
  assert.equal(pickTab(tabs, { host: "hallpass.goguardian.com", popup: true }, popups), null);
});

test("pickTab prefers an open pop-up when teaching, otherwise any tab", () => {
  assert.equal(pickTab(withPopup, { preferPopup: true }, popups).id, 5);
  assert.equal(pickTab(tabs, { preferPopup: true }, popups).id, 2);
});

test("taughtPlace treats older steps as taught in a normal HallPass tab", () => {
  assert.equal(taughtPlace(undefined), null);
  assert.deepEqual(taughtPlace({ steps: [] }), { host: "hallpass.goguardian.com", popup: false });
  assert.deepEqual(taughtPlace({ steps: [], host: "teacher.goguardian.com" }), { host: "teacher.goguardian.com", popup: false });
  assert.deepEqual(taughtPlace({ steps: [], host: "hallpass.goguardian.com", popup: true }), { host: "hallpass.goguardian.com", popup: true });
});

test("siteName calls the pop-up the Create Pass window and everything but HallPass GoGuardian", () => {
  assert.equal(siteName(null), "HallPass");
  assert.equal(siteName({ host: "hallpass.goguardian.com" }), "HallPass");
  assert.equal(siteName({ host: "teacher.goguardian.com" }), "GoGuardian");
  assert.equal(siteName({ host: "hallpass.goguardian.com", popup: true }), "the Create Pass window");
});

test("pickTab by kind finds that page, and siteName names it", () => {
  assert.equal(pickTab(withPopup, { kind: "create" }, popups).id, 5);
  assert.equal(pickTab(withPopup, { kind: "hallpass", host: "hallpass.goguardian.com" }, popups).id, 1);
  assert.equal(pickTab(withPopup, { kind: "home", host: "teacher.goguardian.com" }, popups).id, 2);
  assert.equal(pickTab(withPopup, { kind: "home", host: "other.goguardian.com" }, popups), null);
  assert.equal(siteName({ kind: "create" }), "the Create Pass window");
});
