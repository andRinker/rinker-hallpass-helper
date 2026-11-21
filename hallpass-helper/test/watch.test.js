import { test } from "node:test";
import assert from "node:assert/strict";
import { BUILTIN_MACROS } from "../lib/builtin.js";
import { parseRoster } from "../lib/names.js";
import {
  addLearned,
  applyEvent,
  buildRoute,
  demonstrationOf,
  emptyWatch,
  guessRoles,
  learnedReport,
  mergeSiteMap,
  problems,
  routeSignature,
  routesOf,
  withLearned,
  wordsToCheck,
} from "../lib/watch.js";

const HPH = globalThis.HallPassHelper;
const roster = parseRoster("Jordan Miller\nAva Lee");
const destinations = ["Nurse", "Library"];
const hallpass = { kind: "hallpass", host: "campus.goguardian.com" };
const target = (name, extra = {}) => ({ role: "button", name, tag: "button", classes: [], context: "", index: 0, pointer: false, ...extra });
const click = (name, extra) => ({ action: "click", target: target(name, extra) });

const active = () => ({ ...emptyWatch(), active: true, goal: "end" });

test("steps, what appeared after them, screens and links are gathered; typing in the same box is replaced", () => {
  let s = active();
  s = applyEvent(s, { ev: "step", uid: "a", step: click("Jordan Miller") }, hallpass);
  s = applyEvent(s, { ev: "appears", uid: "a", appears: [target("End Pass")] }, hallpass);
  s = applyEvent(s, { ev: "step", uid: "b", step: { action: "type", target: target("Search", { role: "textbox" }), value: "jo" } }, hallpass);
  s = applyEvent(s, { ev: "step", uid: "c", step: { action: "type", target: target("Search", { role: "textbox" }), value: "jordan" } }, hallpass);
  s = applyEvent(s, { ev: "screen", id: "/#|Active Passes", path: "/", landmarks: [{ role: "button", name: "New Pass" }] }, hallpass);
  s = applyEvent(s, { ev: "screen", id: "/#|Active Passes", path: "/", landmarks: [{ role: "button", name: "End Pass" }] }, hallpass);
  s = applyEvent(s, { ev: "edge", from: "x", to: "y", via: "New Pass" }, hallpass);
  assert.deepEqual(s.events.map((e) => e.uid), ["a", "c"]);
  assert.equal(s.events[0].appears[0].name, "End Pass");
  const screen = Object.values(s.screens)[0];
  assert.equal(screen.seen, 2);
  assert.deepEqual(screen.landmarks.map((l) => l.name).sort(), ["End Pass", "New Pass"]);
  assert.equal(Object.values(s.edges)[0].count, 1);
});

test("nothing is gathered when no one is watching, and the list stops growing", () => {
  assert.equal(applyEvent(emptyWatch(), { ev: "step", uid: "a", step: click("x") }, hallpass).events.length, 0);
  let s = active();
  for (let i = 0; i < 450; i++) s = applyEvent(s, { ev: "step", uid: `u${i}`, step: click(`b${i}`) }, hallpass);
  assert.equal(s.events.length, 400);
  assert.equal(s.full, true);
});

test("a demonstration is the pages of one way: the window when it opened, else the HallPass website", () => {
  const ev = (kind, step) => ({ uid: "x", page: { kind, host: "h" }, step });
  const viaWindow = demonstrationOf([ev("home", click("Create a new hall pass")), ev("create", click("Select")), ev("create", click("Submit"))]);
  assert.equal(viaWindow.lane, "create");
  assert.deepEqual(viaWindow.steps.map((s) => s.target.name), ["Select", "Submit"]);
  assert.equal(demonstrationOf([ev("hallpass", click("New Pass"))]).lane, "hallpass");
  assert.equal(demonstrationOf([ev("home", click("Anything"))]), null);
  assert.equal(demonstrationOf([]), null);
});

test("ending a pass: the student is the first click, End Pass finishes it", () => {
  const steps = [click("Jordan Miller"), click("End Pass"), click("Close")];
  const roles = guessRoles(steps, { goal: "end", lane: "hallpass", roster, destinations });
  assert.deepEqual(roles, ["student", "final", "fixed"]);
  assert.deepEqual(problems({ goal: "end", lane: "hallpass", roles }), []);
  // From the home screen the student is picked on the home screen, so the window part needs no student.
  const inWindow = guessRoles([click("End Pass"), click("Close")], { goal: "end", lane: "create", roster, destinations });
  assert.deepEqual(inWindow, ["final", "fixed"]);
  assert.deepEqual(problems({ goal: "end", lane: "create", roles: inWindow }), []);
});

test("saving is blocked until the route says which step finishes it", () => {
  assert.ok(problems({ goal: "end", lane: "hallpass", roles: ["student", "fixed"] }).some((p) => p.blocking));
  assert.ok(problems({ goal: "make", lane: "hallpass", roles: ["fixed", "final"] }).some((p) => /student/.test(p.text)));
  assert.ok(problems({ goal: "make", lane: "hallpass", roles: [] }).some((p) => p.blocking));
});

test("a route keeps no names, skips only the opening clicks that are already done, and treats what comes after the end as optional", () => {
  const steps = [
    { ...click("More options"), appears: [target("End Pass"), target("Report")] },
    { ...click("Jordan Miller", { context: "Jordan Miller 3 min" }), appears: [target("End Pass")] },
    { ...click("Open details", { context: "Jordan Miller" }), appears: [target("Details")] },
    { ...click("End Pass", { context: "Jordan Miller" }), appears: [target("Close")] },
    click("Close"),
  ];
  const roles = ["fixed", "student", "fixed", "final", "fixed"];
  const route = buildRoute({ goal: "end", steps, roles, keep: [], roster });
  assert.ok(!/jordan|miller/i.test(JSON.stringify(route)), JSON.stringify(route));
  assert.deepEqual(route[0].done.map((d) => d.name), ["End Pass", "Report"], "before anyone is picked, a click can be skipped when its result is already there");
  assert.equal(route[1].target.name, "{student}");
  assert.equal(route[1].done, undefined, "the student click is never skipped");
  assert.equal(route[2].done, undefined, "after the student is picked, what's showing could be someone else's: always runs");
  assert.equal(route[3].commit, true);
  assert.equal(route[3].done, undefined, "the step that ends the pass is never skipped");
  assert.equal(route[4].optional, true, "after the pass is ended, only tidying up is left");
});

test("words that aren't ordinary button words are flagged for a look", () => {
  const steps = [click("Close"), click("Zelda Quartermain")];
  assert.deepEqual(wordsToCheck(steps, ["fixed", "fixed"], { roster }), [1]);
  assert.deepEqual(wordsToCheck(steps, ["fixed", "student"], { roster }), []);
});

const endRoute = (names) => names.map((name, i) => ({ ...click(name), role: i === 0 ? "student" : "fixed", ...(i === names.length - 1 ? { role: "final" } : {}) }));

test("a way the helper already has isn't added again, a new one is, and built-in ways stay put", () => {
  const base = BUILTIN_MACROS.endVia.hallpass;
  const same = [
    { ...click("{student}"), role: "student" },
    { ...click("End Pass"), role: "final", commit: true },
  ];
  assert.equal(addLearned({}, { goal: "endVia", lane: "hallpass", route: same, base }).status, "known");
  const other = endRoute(["{student}", "More", "End Pass"]);
  const first = addLearned({}, { goal: "endVia", lane: "hallpass", route: other, base });
  assert.equal(first.status, "added");
  assert.equal(addLearned(first.learned, { goal: "endVia", lane: "hallpass", route: other, base }).status, "known");
  // The learned way becomes one more way after the built-in ones.
  const merged = withLearned(BUILTIN_MACROS, first.learned);
  assert.equal(routesOf(merged.endVia.hallpass).length, routesOf(BUILTIN_MACROS.endVia.hallpass).length + 1);
  assert.equal(routesOf(BUILTIN_MACROS.endVia.hallpass).length, 2, "the built-in macros themselves are not changed");
  assert.equal(merged.end, merged.endVia.hallpass);
  assert.equal(merged.create, merged.make.hallpass);
  // Nothing learned: the very same objects come back.
  assert.equal(withLearned(BUILTIN_MACROS, {}).make.hallpass, BUILTIN_MACROS.make.hallpass);
});

test("a route's signature ignores steps that only tidy up", () => {
  const a = [click("New Pass"), { ...click("Submit"), role: "final" }, click("Close")];
  const b = [{ ...click("Close"), peek: true }, click("New Pass"), { ...click("Submit"), role: "final" }];
  assert.equal(routeSignature(a), routeSignature(b));
});

test("the map of screens adds up what was seen and keeps the count of times", () => {
  const screens = { "hallpass|a": { kind: "hallpass", host: "h", path: "/", landmarks: [{ role: "button", name: "New Pass" }], seen: 2 } };
  const edges = { "hallpass|a>New Pass>b": { kind: "hallpass", from: "a", to: "b", via: "New Pass", count: 1 } };
  const once = mergeSiteMap(undefined, { screens, edges }, 5);
  const twice = mergeSiteMap(once, { screens, edges }, 6);
  assert.equal(twice.screens["hallpass|a"].seen, 4);
  assert.equal(Object.values(twice.edges)[0].count, 2);
});

test("the report to paste into a chat hides names, even from a step that was marked wrong", () => {
  const settings = {
    roster,
    destinations,
    school: "Middle School South",
    teacherName: "Ms. Rivera",
    macros: withLearned(BUILTIN_MACROS, { endVia: { hallpass: [{ steps: [{ ...click("Jordan Miller"), role: "fixed" }, { ...click("End Pass"), role: "final" }], learnedAt: 1 }] } }),
    siteMap: { screens: { a: { kind: "hallpass", path: "/", seen: 1, landmarks: [{ role: "button", name: "Jordan Miller" }, { role: "button", name: "New Pass" }] } }, edges: {} },
    lastRun: { goal: "end", ok: false, step: 2, label: 'Click "Ava Lee"', at: Date.now(), notes: ["Skipped Click \"Ava Lee\""] },
  };
  const text = learnedReport(settings, { version: "0.5.0 tester" });
  assert.ok(!/jordan|miller|\bava\b|\blee\b/i.test(text), text);
  assert.ok(/New Pass/.test(text) && /End Pass/.test(text));
  assert.ok(/Xxxxx/.test(text), "the hidden words are shaped like names");
});
