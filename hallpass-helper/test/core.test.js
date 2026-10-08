import { test } from "node:test";
import assert from "node:assert/strict";
import "../content/core.js";
import { parseRoster } from "../lib/names.js";

const HPH = globalThis.HallPassHelper;
const roster = parseRoster("Jordan Miller\nJordan Martinez\nAva Lee\nMary-Kate O'Neil\nJosé Núñez");
const destinations = ["6th Grade Bathroom", "Nurse", "Library"];

const click = (name, extra = {}) => ({ action: "click", target: { role: "button", name, tag: "button", ...extra } });
const type = (name, value) => ({ action: "type", target: { role: "textbox", name, tag: "input" }, value });

// A teaching run the way a teacher would record it.
const createRun = [
  click("New Pass"),
  click("Middle School South", { role: "option", tag: "li" }),
  type("Search students", "jor"),
  click("Jordan Miller Grade 7", { role: "option", tag: "li", context: "Jordan Miller Grade 7" }),
  { action: "select", target: { role: "combobox", name: "Teacher", tag: "select" }, value: "Ms. Rivera" },
  click("6th Grade Bathroom"),
  click("Create Pass"),
];

test("nameMatches needs every part of the first and last name, in any order", () => {
  const jordan = roster[0];
  assert.ok(HPH.nameMatches("Jordan Miller", jordan));
  assert.ok(HPH.nameMatches("Miller, Jordan · Grade 7", jordan));
  assert.ok(!HPH.nameMatches("Jordan Martinez", jordan));
  assert.ok(!HPH.nameMatches("Jordan", jordan));
  assert.ok(HPH.nameMatches("O'Neil, Mary-Kate", roster[3]));
  assert.ok(HPH.nameMatches("josé núñez", roster[4]));
});

test("startsStudent and matchDestination", () => {
  assert.ok(HPH.startsStudent("jor", roster));
  assert.ok(HPH.startsStudent("Mart", roster));
  assert.ok(HPH.startsStudent("Jordan M", roster));
  assert.ok(!HPH.startsStudent("j", roster)); // too short to tell
  assert.ok(!HPH.startsStudent("library", roster));
  assert.equal(HPH.matchDestination("6th grade bathroom", destinations), "6th Grade Bathroom");
  assert.equal(HPH.matchDestination("Go to Nurse", destinations), "Nurse");
  assert.equal(HPH.matchDestination("Gym", destinations), null);
});

test("guessRoles for a create run", () => {
  assert.deepEqual(HPH.guessRoles(createRun, "create", { roster, destinations }), [
    "fixed",
    "fixed",
    "student",
    "student",
    "fixed",
    "destination",
    "final",
  ]);
});

test("guessRoles still finds the student with an empty roster", () => {
  const roles = HPH.guessRoles(createRun, "create", { roster: [], destinations: [] });
  assert.equal(roles[2], "student"); // the field is a student search
  assert.equal(roles[3], "student"); // the click right after the search
  assert.equal(roles[6], "final");
});

test("guessRoles for an end run marks the pass card as the student", () => {
  const endRun = [click("Jordan Miller 6th Grade Bathroom 4 min", { role: "generic", tag: "div" }), click("End Pass"), click("Yes, end it")];
  assert.deepEqual(HPH.guessRoles(endRun, "end", { roster }), ["student", "fixed", "fixed"]);
  // No roster: first click is the best guess.
  assert.deepEqual(HPH.guessRoles(endRun, "end", { roster: [] }), ["student", "fixed", "fixed"]);
});

test("scrubSteps leaves no trace of the teaching student", () => {
  const roles = HPH.guessRoles(createRun, "create", { roster, destinations });
  const saved = HPH.scrubSteps(createRun, roles);
  const json = JSON.stringify(saved);
  assert.ok(!/jordan|miller/i.test(json), json);
  assert.equal(saved[2].value, "{student}");
  assert.equal(saved[3].target.name, "{student}");
  assert.equal(saved[3].target.context, "{student} Grade 7");
  assert.equal(saved[5].target.name, "{destination}");
  assert.equal(saved[6].role, "final");
  assert.equal(saved[0].target.name, "New Pass");
});

test("scrubSteps also cleans names out of other steps' context", () => {
  const steps = [
    click("O'Neil, Mary-Kate", { role: "generic", tag: "div" }),
    click("End", { context: "Mary-Kate O'Neil Nurse 3 min" }),
  ];
  const saved = HPH.scrubSteps(steps, ["student", "fixed"]);
  assert.equal(saved[1].target.context, "{student} Nurse 3 min");
  assert.ok(!/mary|kate|neil/i.test(JSON.stringify(saved)));
});

test("addStep merges typing into the same field", () => {
  let steps = [];
  steps = HPH.addStep(steps, type("Search students", "j"));
  steps = HPH.addStep(steps, type("Search students", "jo"));
  steps = HPH.addStep(steps, type("Search students", "jor"));
  steps = HPH.addStep(steps, click("Jordan Miller"));
  steps = HPH.addStep(steps, type("Search students", "x"));
  assert.deepEqual(
    steps.map((s) => s.value ?? s.target.name),
    ["jor", "Jordan Miller", "x"],
  );
});

test("stepLabel reads like plain instructions", () => {
  assert.equal(HPH.stepLabel(createRun[0]), 'Click "New Pass"');
  assert.equal(HPH.stepLabel(createRun[2]), 'Type "jor" in "Search students"');
  assert.equal(HPH.stepLabel(createRun[4]), 'Choose "Ms. Rivera" in "Teacher"');
});

test("redact keeps UI words and the teacher's own settings, shapes everything else", () => {
  const opts = { keep: ["Middle School South", "Ms. Rivera", "6th Grade Bathroom"], roster };
  assert.equal(HPH.redact("Create Pass", opts), "Create Pass");
  assert.equal(HPH.redact("Middle School South", opts), "Middle School South");
  assert.equal(HPH.redact("Ms. Rivera", opts), "Ms. Rivera");
  assert.equal(HPH.redact("Mr. Okafor", opts), "Xx. Xxxxxx"); // another staff member
  assert.equal(HPH.redact("Jordan Miller", opts), "Xxxxxx Xxxxxx");
  assert.equal(HPH.redact("Sam Cho · Grade 7 · 10:45", opts), "Xxx Xxx · Grade 9 · 99:99");
  assert.equal(HPH.redact("Hunter Hall", opts), "Xxxxxx Xxxx"); // not on the roster, still hidden
  assert.equal(HPH.redact("José Núñez", opts), "Xxxx Xxxxx");
});

test("redact shapes roster names even when they look like UI words", () => {
  const tricky = parseRoster("Grace Nurse");
  assert.equal(HPH.redact("Grace Nurse", { roster: tricky, keep: ["Nurse"] }), "Xxxxx Xxxxx");
  assert.equal(HPH.redact("Nurse", { roster: tricky, keep: ["Nurse"] }), "Xxxxx");
});
