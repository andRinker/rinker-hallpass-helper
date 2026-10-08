import { test } from "node:test";
import assert from "node:assert/strict";
import {
  currentPeriod,
  formatClock,
  formatPeriods,
  nextBell,
  parseLooseTime,
  parseScheduleText,
  scheduleForDate,
} from "../lib/bells.js";

const at = (hhmm, day = "2026-10-08") => new Date(`${day}T${hhmm}:00`);

test("parseLooseTime reads times the way teachers type them", () => {
  assert.equal(parseLooseTime("8:05"), 8 * 60 + 5);
  assert.equal(parseLooseTime("12:30"), 12 * 60 + 30);
  assert.equal(parseLooseTime("1:20"), 13 * 60 + 20);
  assert.equal(parseLooseTime("13:20"), 13 * 60 + 20);
  assert.equal(parseLooseTime("1:20 pm"), 13 * 60 + 20);
  assert.equal(parseLooseTime("7:45am"), 7 * 60 + 45);
  assert.equal(parseLooseTime("12:00am"), 0);
  assert.equal(parseLooseTime("8"), 8 * 60);
  assert.equal(parseLooseTime("25:00"), null);
  assert.equal(parseLooseTime("8:75"), null);
  assert.equal(parseLooseTime("lunch"), null);
});

test("parseScheduleText handles common line formats", () => {
  const { periods, errors } = parseScheduleText(
    ["Period 1 8:00-8:50", "2: 8:55 - 9:45", "Lunch 11:30 a.m. to 12:05 p.m.", "Period 6 12:10-1:00", ""].join(
      "\n",
    ),
  );
  assert.deepEqual(errors, []);
  assert.deepEqual(periods, [
    { name: "Period 1", start: "08:00", end: "08:50" },
    { name: "2", start: "08:55", end: "09:45" },
    { name: "Lunch", start: "11:30", end: "12:05" },
    { name: "Period 6", start: "12:10", end: "13:00" },
  ]);
});

test("parseScheduleText reports unreadable lines and overlaps", () => {
  const { errors } = parseScheduleText("Period 1 8:00-8:50\nPeriod 2 8:45-9:30\nAdvisory sometime");
  assert.equal(errors.length, 2);
  assert.match(errors[0], /Line 3/);
  assert.match(errors[1], /Period 2 starts before Period 1 ends/);
});

test("formatPeriods round-trips through parseScheduleText", () => {
  const { periods } = parseScheduleText("Period 1 8:00-8:50\nPeriod 6 12:10-1:00");
  assert.equal(formatPeriods(periods), "Period 1 8:00am-8:50am\nPeriod 6 12:10pm-1:00pm");
  assert.deepEqual(parseScheduleText(formatPeriods(periods)).periods, periods);
  assert.equal(formatClock("00:15"), "12:15am");
});

const regular = { id: "reg", name: "Regular", periods: parseScheduleText("1 8:00-8:50\n2 8:55-9:45").periods };
const early = { id: "early", name: "Early release", periods: parseScheduleText("1 8:00-8:30").periods };
const settings = { schedules: [regular, early], weekdaySchedule: { 3: "early", 4: "reg" } };

test("scheduleForDate uses the weekday default unless today was switched", () => {
  assert.equal(scheduleForDate(settings, at("09:00", "2026-10-07")).id, "early"); // Wednesday
  assert.equal(scheduleForDate(settings, at("09:00", "2026-10-08")).id, "reg"); // Thursday
  assert.equal(scheduleForDate(settings, at("09:00", "2026-10-10")), null); // Saturday
  const switched = { ...settings, todayOverride: { date: "2026-10-08", scheduleId: "early" } };
  assert.equal(scheduleForDate(switched, at("09:00", "2026-10-08")).id, "early");
  assert.equal(scheduleForDate(switched, at("09:00", "2026-10-15")).id, "reg"); // override was for last week
});

test("currentPeriod and nextBell", () => {
  assert.equal(currentPeriod(regular, at("08:10")).name, "1");
  assert.equal(currentPeriod(regular, at("08:52")), null); // passing time
  assert.equal(currentPeriod(regular, at("08:50")), null); // the bell itself ends period 1

  const bell = nextBell(regular, at("08:10"));
  assert.equal(bell.period.name, "1");
  assert.equal(bell.at.getTime(), at("08:50").getTime());

  assert.equal(nextBell(regular, at("08:52")).period.name, "2");
  assert.equal(nextBell(regular, at("07:00")).period.name, "1");
  assert.equal(nextBell(regular, at("09:45")), null);
  assert.equal(nextBell(null, at("09:00")), null);
});
