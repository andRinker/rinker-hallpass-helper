import { test } from "node:test";
import assert from "node:assert/strict";
import { findStudents, parseRoster, periodKey, shortLabels } from "../lib/names.js";

test("periodKey normalizes period names from schedules and rosters", () => {
  assert.equal(periodKey("Period 3"), "3");
  assert.equal(periodKey("3rd period"), "3");
  assert.equal(periodKey("P03"), "3");
  assert.equal(periodKey("Per. 4"), "4");
  assert.equal(periodKey("Lunch"), "lunch");
});

test("parseRoster reads both name orders and period headers", () => {
  const roster = parseRoster(
    ["Period 1", "Jordan Miller", "Martinez, Jordan", "", "3rd period:", "Ava Lee", "Ava Lee", "Mary Ann Smith"].join(
      "\n",
    ),
  );
  assert.deepEqual(roster, [
    { first: "Jordan", last: "Miller", period: "1" },
    { first: "Jordan", last: "Martinez", period: "1" },
    { first: "Ava", last: "Lee", period: "3" },
    { first: "Mary", last: "Ann Smith", period: "3" },
  ]);
});

test("parseRoster works without any period headers", () => {
  assert.deepEqual(parseRoster("Sam Cho\nPriya"), [
    { first: "Sam", last: "Cho", period: null },
    { first: "Priya", last: "", period: null },
  ]);
});

test("shortLabels uses the fewest letters that tell kids apart", () => {
  const roster = parseRoster(
    [
      "Period 1",
      "Jordan Miller",
      "Jordan Martinez",
      "Jordan Moore",
      "Ava Lee",
      "Priya",
      "Period 2",
      "Sam Cho",
      "Sam Cho",
      "Period 5",
      "Sam Cho",
    ].join("\n"),
  );
  assert.deepEqual(shortLabels(roster), [
    "Jordan Mi.",
    "Jordan Ma.",
    "Jordan Mo.",
    "Ava L.",
    "Priya",
    "Sam Cho (P2)",
    "Sam Cho (P5)",
  ]);
});

test("findStudents matches the start of first or last names", () => {
  const roster = parseRoster("Jordan Miller\nJordan Martinez\nAva Lee\nMary-Kate O'Neil");
  assert.deepEqual(
    findStudents(roster, "jo mi").map((s) => s.last),
    ["Miller"],
  );
  assert.equal(findStudents(roster, "jordan").length, 2);
  assert.equal(findStudents(roster, "kate").length, 1);
  assert.equal(findStudents(roster, "neil").length, 1);
  assert.equal(findStudents(roster, "  ").length, 4);
});
