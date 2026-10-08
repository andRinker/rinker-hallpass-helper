import { test } from "node:test";
import assert from "node:assert/strict";
import { pickTab, taughtHost } from "../lib/tabs.js";

const tab = (id, url, lastAccessed) => ({ id, url, lastAccessed });
const tabs = [
  tab(1, "https://hallpass.goguardian.com/dashboard", 100),
  tab(2, "https://teacher.goguardian.com/", 300),
  tab(3, "https://www.goguardian.com/hall-pass", 500),
  tab(4, "https://example.com/goguardian.com", 900),
];

test("pickTab prefers the site the steps were taught on", () => {
  assert.equal(pickTab(tabs, "hallpass.goguardian.com").id, 1);
  assert.equal(pickTab(tabs, "teacher.goguardian.com").id, 2);
});

test("pickTab falls back to the most recent GoGuardian tab, skipping the marketing site", () => {
  assert.equal(pickTab(tabs).id, 2);
  assert.equal(pickTab(tabs, "app.goguardian.com").id, 2);
  assert.equal(pickTab([tabs[2], tabs[3]]), null);
});

test("taughtHost treats older steps as taught on HallPass", () => {
  assert.equal(taughtHost(undefined), null);
  assert.equal(taughtHost({ steps: [] }), "hallpass.goguardian.com");
  assert.equal(taughtHost({ steps: [], host: "teacher.goguardian.com" }), "teacher.goguardian.com");
});
