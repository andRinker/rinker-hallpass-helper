import { test } from "node:test";
import assert from "node:assert/strict";
import "../content/core.js";
import "../content/scrub.js";
import { parseRoster } from "../lib/names.js";

const HPH = globalThis.HallPassHelper;

const roster = parseRoster("Jordan Miller\nAva Lee\nJordan Close\nWill May\nLi Wu\nJosé Núñez");
const forbidden = [
  { value: "Middle School South", replacement: "Sample School" },
  { value: "Ms. Rivera", replacement: "Sample Teacher" },
  { value: "Room 112", replacement: "Room 101" },
];

test("createScrubber replaces roster names deterministically without breaking UI buttons", () => {
  const scrubber = HPH.createScrubber({ roster, forbidden });

  const first = scrubber.scrubText("Active pass: Jordan Miller · Bathroom");
  const second = scrubber.scrubText("Pass Details — Miller, Jordan");
  assert.match(first, /Student Alpha/);
  assert.match(second, /Student Alpha/);
  assert.ok(!/Jordan|Miller/i.test(first + second));

  // Student whose last name is a UI word ("Close") is scrubbed as a full name, while the Close button stays intact.
  const tricky = scrubber.scrubText("Jordan Close");
  const button = scrubber.scrubText("Close");
  assert.equal(tricky, "Student Bravo");
  assert.equal(button, "Close");
});

test("createScrubber catches unknown non-roster names, emails, URLs, UUIDs, and long numbers", () => {
  const scrubber = HPH.createScrubber({ roster, forbidden });

  const out = scrubber.scrubText(
    "Marcus Vance (mvance29@school.edu) · ID 884291 · https://campus.goguardian.com/users/123e4567-e89b-12d3-a456-426614174000",
  );
  assert.ok(!/Marcus|Vance|mvance|school\.edu|884291|123e4567/i.test(out), out);
  assert.match(out, /Demo Alpha/);
  assert.match(out, /redacted@example\.invalid/);
  assert.match(out, /https:\/\/redacted\.invalid/);
  assert.match(out, /999/);

  // Same non-roster student mentioned again gets the same synthetic Demo label.
  const again = scrubber.scrubText("End pass for Marcus Vance");
  assert.match(again, /Demo Alpha/);
  assert.ok(!/Marcus|Vance/i.test(again));
});

test("createScrubber scrubs teacher name, school name, and room/origin settings", () => {
  const scrubber = HPH.createScrubber({ roster, forbidden });

  const out = scrubber.scrubText("Middle School South · Ms. Rivera · Room 112");
  assert.equal(out, "Sample School · Sample Teacher · Room 101");
  assert.ok(!/Middle|South|Rivera|112/i.test(out));
});

test("createScrubber tracks kept UI words in its audit and never includes names", () => {
  const scrubber = HPH.createScrubber({ roster, forbidden });
  scrubber.scrubText("New Pass · Active Passes · Jordan Miller · Bathroom · End Pass · Waiting");
  const audit = scrubber.audit();

  assert.ok(audit.keptWords.includes("bathroom"));
  assert.ok(audit.keptWords.includes("waiting"));
  assert.ok(audit.keptWords.includes("pass"));
  assert.ok(!audit.keptWords.includes("jordan"));
  assert.ok(!audit.keptWords.includes("miller"));
  assert.ok(audit.syntheticNames.includes("Student Alpha"));
  assert.equal(audit.stats.rosterHits, 1);
});

test("scrubClasses keeps Tailwind/layout classes and strips hashes and roster tokens", () => {
  const scrubber = HPH.createScrubber({ roster, forbidden });
  const kept = scrubber.scrubClasses([
    "inline-flex",
    "items-center",
    "rounded-md",
    "sc-bdVaJa",
    "css-1a2b3c",
    "jordan-card",
    "rivera-badge",
    "w-full",
  ]);
  assert.deepEqual(kept, ["inline-flex", "items-center", "rounded-md", "w-full"]);
});

test("verifyClean detects leaked roster names, settings, and emails while ignoring HTML tags like <li>", () => {
  const cleanHtml =
    '<!doctype html><html><head><style>li { margin: 4px; }</style></head><body><ul><li><button aria-label="Student Alpha">End Pass</button></li></ul></body></html>';
  assert.deepEqual(HPH.verifyClean(cleanHtml, { roster, forbidden }), { clean: true, leaks: [] });

  const leakedRoster = '<div><button aria-label="Jordan Miller">End Pass</button></div>';
  const r1 = HPH.verifyClean(leakedRoster, { roster, forbidden });
  assert.equal(r1.clean, false);
  assert.ok(r1.leaks.some((l) => l.startsWith("roster name")));

  const leakedShortName = "<div><span>Wu</span></div>";
  const r2 = HPH.verifyClean(leakedShortName, { roster, forbidden });
  assert.equal(r2.clean, false);
  assert.ok(r2.leaks.some((l) => l.startsWith("roster word")));

  const leakedEmail = "<div>Contact student@district.org</div>";
  const r3 = HPH.verifyClean(leakedEmail, { roster, forbidden });
  assert.equal(r3.clean, false);
  assert.ok(r3.leaks.some((l) => l.startsWith("email")));

  const leakedSchool = "<div>Welcome to Middle School South</div>";
  const r4 = HPH.verifyClean(leakedSchool, { roster, forbidden });
  assert.equal(r4.clean, false);
  assert.ok(r4.leaks.some((l) => l.startsWith("setting")));
});

test("createScrubSession keeps synthetic names consistent across multiple frames", () => {
  const session = HPH.createScrubSession();
  const s1 = HPH.createScrubber({ roster, forbidden, session });
  const frame1 = s1.scrubText("Active: Jordan Miller and Marcus Vance");
  assert.match(frame1, /Student Alpha/);
  assert.match(frame1, /Demo Alpha/);

  const s2 = HPH.createScrubber({ roster, forbidden, session });
  const frame2 = s2.scrubText("Pass Details: Ava Lee, Jordan Miller, Marcus Vance");
  assert.match(frame2, /Student Bravo/);
  assert.match(frame2, /Student Alpha/);
  assert.match(frame2, /Demo Alpha/);
  assert.ok(s2.audit().syntheticNames.includes("Student Alpha"));
  assert.ok(s2.audit().syntheticNames.includes("Student Bravo"));
});
