import { test } from "node:test";
import assert from "node:assert/strict";
import { MAX_BUNDLE_FRAMES, addFrame, emptyRecording, exportBundle, removeFrame, summarizeBundle } from "../lib/bundle.js";

const makeFrame = (id, { fp = `fp-${id}`, host = "campus.goguardian.com", clean = true, leaks = [], words = ["pass"], syn = ["Student Alpha"] } = {}) => ({
  at: 1000 + id,
  trigger: `Step ${id}`,
  fingerprint: fp,
  meta: { host, path: "/home", isPopup: false },
  html: `<!doctype html><html><body>Frame ${id}</body></html>`,
  diagnoseReport: `Report ${id}`,
  audit: {
    clean,
    leaks,
    keptWords: words,
    syntheticNames: syn,
    stats: { elementsKept: 10, hiddenSkipped: 2, scriptsStripped: 1, imagesStripped: 1, rosterHits: 1, forbiddenHits: 0, unknownReplacements: 2, emailsStripped: 0 },
  },
});

test("addFrame ignores frames when inactive, deduplicates consecutive identical screens, and enforces cap", () => {
  const idle = emptyRecording();
  assert.equal(addFrame(idle, makeFrame(1)).frames.length, 0);

  let rec = { ...emptyRecording(), active: true };
  rec = addFrame(rec, makeFrame(1, { fp: "same" }));
  rec = addFrame(rec, makeFrame(2, { fp: "same" }));
  assert.equal(rec.frames.length, 1);

  rec = addFrame(rec, makeFrame(3, { fp: "different" }));
  assert.equal(rec.frames.length, 2);

  // Returning to an earlier screen after another screen IS recorded (e.g. closing a dialog).
  rec = addFrame(rec, makeFrame(4, { fp: "same" }));
  assert.equal(rec.frames.length, 3);

  for (let i = 5; i <= MAX_BUNDLE_FRAMES + 10; i++) rec = addFrame(rec, makeFrame(i));
  assert.equal(rec.frames.length, MAX_BUNDLE_FRAMES);
  assert.ok(rec.dropped > 0);
});

test("summarizeBundle merges words, stats, and fails clean if any frame has leaks", () => {
  const f1 = makeFrame(1, { words: ["active", "pass"], syn: ["Student Alpha"] });
  const f2 = makeFrame(2, { words: ["close", "pass", "waiting"], syn: ["Student Alpha", "Student Bravo"] });
  const ok = summarizeBundle([f1, f2]);
  assert.equal(ok.clean, true);
  assert.deepEqual(ok.keptWords, ["active", "close", "pass", "waiting"]);
  assert.deepEqual(ok.syntheticNames, ["Student Alpha", "Student Bravo"]);
  assert.equal(ok.stats.frames, 2);
  assert.equal(ok.stats.scriptsStripped, 2);
  assert.equal(ok.stats.rosterHits, 2);

  const bad = summarizeBundle([f1, makeFrame(3, { clean: false, leaks: ["email (xxxx@xxxx.xxx)"] })]);
  assert.equal(bad.clean, false);
  assert.deepEqual(bad.leaks, ["email (xxxx@xxxx.xxx)"]);
});

test("removeFrame drops one frame and exportBundle produces clean versioned JSON", () => {
  const frames = removeFrame([makeFrame(1), makeFrame(2), makeFrame(3)], 1);
  assert.equal(frames.length, 2);
  assert.equal(frames[1].trigger, "Step 3");

  const exported = exportBundle({ frames, helperVersion: "0.5.0 tester", lane: "hallpass", kind: "session" });
  assert.equal(exported.format, "hallpass-helper-bundle");
  assert.equal(exported.version, 1);
  assert.equal(exported.frames.length, 2);
  assert.equal(exported.frames[0].index, 1);
  assert.equal(exported.frames[1].index, 2);
  assert.equal(exported.summary.clean, true);
});
