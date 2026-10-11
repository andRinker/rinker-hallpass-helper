import { test } from "node:test";
import assert from "node:assert/strict";
import { parseRoster } from "../lib/names.js";
import { alreadyListed, dueToEnd, nextToSend, queueEntry, studentFromText, suggestions } from "../lib/queue.js";

const roster = parseRoster("Jordan Miller\nJordan Martinez\nAva Lee\nSam Cho");
const entry = (first, last) => queueEntry({ student: { first, last }, destination: "Bathroom" });

test("suggestions show nothing until something is typed, then matching students with short labels", () => {
  assert.deepEqual(suggestions(roster, ""), []);
  assert.deepEqual(
    suggestions(roster, "jor").map((s) => s.label),
    ["Jordan Ma.", "Jordan Mi."],
  );
  assert.deepEqual(suggestions(roster, "lee")[0].student, { first: "Ava", last: "Lee" });
});

test("studentFromText takes the one roster match, or the name as typed", () => {
  assert.deepEqual(studentFromText(roster, "ava"), { ok: true, student: { first: "Ava", last: "Lee" }, label: "Ava L." });
  assert.deepEqual(studentFromText(roster, "jordan"), { ok: false, reason: "several", count: 2 });
  assert.deepEqual(studentFromText(roster, "  Priya   Shah "), {
    ok: true,
    student: { first: "Priya", last: "Shah" },
    label: "Priya Shah",
  });
  assert.deepEqual(studentFromText(roster, "Shah, Priya").student, { first: "Priya", last: "Shah" });
  assert.deepEqual(studentFromText([], "Leo").student, { first: "Leo", last: "" });
  assert.deepEqual(studentFromText(roster, "  "), { ok: false, reason: "empty" });
});

test("alreadyListed catches the same student waiting or out", () => {
  const queue = [entry("Ava", "Lee")];
  const outPasses = [{ ...entry("Sam", "Cho"), startedAt: 0 }];
  assert.equal(alreadyListed({ queue, outPasses }, { first: "ava", last: "LEE" }), "queue");
  assert.equal(alreadyListed({ queue, outPasses }, { first: "Sam", last: "Cho" }), "out");
  assert.equal(alreadyListed({ queue, outPasses }, { first: "Jordan", last: "Miller" }), null);
});

test("nextToSend waits for a spot, and sends nobody while paused", () => {
  const queue = [entry("Ava", "Lee"), entry("Sam", "Cho")];
  const out = [{ ...entry("Jordan", "Miller"), startedAt: 0 }];
  assert.equal(nextToSend({ queue, outPasses: [], maxOut: 1 }), queue[0]);
  assert.equal(nextToSend({ queue, outPasses: out, maxOut: 1 }), null);
  assert.equal(nextToSend({ queue, outPasses: out, maxOut: 2 }), queue[0]);
  assert.equal(nextToSend({ queue, outPasses: [], maxOut: 1, queuePaused: true }), null);
  assert.equal(nextToSend({ queue: [], outPasses: [], maxOut: 1 }), null);
  assert.equal(nextToSend({ queue, outPasses: [], maxOut: 0 }), queue[0], "a cap below 1 still lets one go");
});

test("dueToEnd finds passes whose minutes are up, skipping ones that already failed to end", () => {
  const now = 20 * 60000;
  const outPasses = [
    { id: "a", startedAt: now - 7 * 60000 },
    { id: "b", startedAt: now - 6 * 60000 },
    { id: "c", startedAt: now - 30 * 60000, endFailed: "HallPass wasn't open." },
  ];
  assert.deepEqual(
    dueToEnd({ outPasses, autoEndMinutes: 7 }, now).map((p) => p.id),
    ["a"],
  );
  assert.deepEqual(
    dueToEnd({ outPasses, autoEndMinutes: 5 }, now).map((p) => p.id),
    ["a", "b"],
  );
});
