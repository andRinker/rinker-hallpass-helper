import { test } from "node:test";
import assert from "node:assert/strict";
import { parseRoster } from "../lib/names.js";
import { alreadyListed, dueToEnd, endsAt, isWaitingPass, nextToSend, queueEntry, reconcilePasses, studentFromText, suggestions } from "../lib/queue.js";

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

test("dueToEnd finds passes whose minutes are up, skipping failed and waiting passes", () => {
  const now = 20 * 60000;
  const outPasses = [
    { id: "a", startedAt: now - 7 * 60000 },
    { id: "b", startedAt: now - 6 * 60000 },
    { id: "c", startedAt: now - 30 * 60000, endFailed: "HallPass wasn't open." },
    { id: "w", status: "waiting", startedAt: null, queuedInHallPassAt: now - 25 * 60000 },
  ];
  assert.equal(isWaitingPass(outPasses[3]), true);
  assert.equal(endsAt(outPasses[3], 7), Infinity);
  assert.deepEqual(
    dueToEnd({ outPasses, autoEndMinutes: 7 }, now).map((p) => p.id),
    ["a"],
  );
  assert.deepEqual(
    dueToEnd({ outPasses, autoEndMinutes: 5 }, now).map((p) => p.id),
    ["a", "b"],
  );
});

test("reconcilePasses promotes waiting passes to active and clears manually ended passes safely", () => {
  const now = 100000;
  const waiting = { id: "w1", status: "waiting", startedAt: null, queuedInHallPassAt: now - 30000, lane: "hallpass", blockerLabel: "Destination room is at capacity", etaText: "< 5m" };
  const activeOld = { id: "a1", status: "active", startedAt: now - 30000, lane: "hallpass" };
  const activeFresh = { id: "a2", status: "active", startedAt: now - 3000, lane: "hallpass" };
  const popupPass = { id: "p1", status: "active", startedAt: now - 30000, lane: "create" };

  // Promote waiting -> active, clear manually ended activeOld, keep fresh pass (grace) and popup pass.
  const res = reconcilePasses(
    [waiting, activeOld, activeFresh, popupPass],
    { supported: true, filtered: false, requestsCollapsed: false, states: { w1: "active", a1: "missing", a2: "missing", p1: "missing" } },
    { now, graceMs: 12000, lane: "hallpass" },
  );
  assert.equal(res.changed, true);
  assert.deepEqual(res.promoted.map((p) => p.id), ["w1"]);
  assert.equal(res.promoted[0].status, "active");
  assert.equal(res.promoted[0].startedAt, now);
  assert.deepEqual(res.cleared.map((p) => p.id), ["a1"]);
  assert.deepEqual(res.outPasses.map((p) => p.id), ["w1", "a2", "p1"]);

  // Never clear anything when page is filtered or unsupported.
  const filteredRes = reconcilePasses(
    [activeOld],
    { supported: true, filtered: true, requestsCollapsed: false, states: { a1: "missing" } },
    { now },
  );
  assert.equal(filteredRes.changed, false);

  // Never clear a waiting pass when "Show requests" collapsed the requests section.
  const collapsedRes = reconcilePasses(
    [waiting],
    { supported: true, filtered: false, requestsCollapsed: true, states: { w1: "missing" } },
    { now },
  );
  assert.equal(collapsedRes.changed, false);
});
