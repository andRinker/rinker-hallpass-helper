// Bell schedule math. Saved times are 24-hour "HH:MM" strings; a schedule is
// { id, name, periods: [{ name, start, end }] } with periods in time order.

export function toMinutes(hhmm) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm ?? "");
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

export function fromMinutes(total) {
  const h = Math.floor(total / 60);
  const m = total % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

// "8:05" -> "8:05am", "13:20" -> "1:20pm"
export function formatClock(hhmm) {
  const total = toMinutes(hhmm);
  if (total === null) return hhmm;
  const h = Math.floor(total / 60);
  const m = String(total % 60).padStart(2, "0");
  return `${h % 12 || 12}:${m}${h < 12 ? "am" : "pm"}`;
}

// Reads a time the way a teacher would type it: "8:05", "12:30", "1:20", "1:20 pm", "13:20".
// With no am/pm, 1:00–6:59 means afternoon, since school doesn't start that early.
export function parseLooseTime(text) {
  const m = /^\s*(\d{1,2})(?::(\d{2}))?\s*([ap])?m?\s*$/i.exec(text ?? "");
  if (!m) return null;
  let h = Number(m[1]);
  const min = Number(m[2] ?? 0);
  const suffix = m[3]?.toLowerCase();
  if (h > 23 || min > 59) return null;
  if (suffix) {
    if (h < 1 || h > 12) return null;
    if (suffix === "p" && h !== 12) h += 12;
    if (suffix === "a" && h === 12) h = 0;
  } else if (h >= 1 && h <= 6) {
    h += 12;
  }
  return h * 60 + min;
}

const TIME = String.raw`\d{1,2}(?::\d{2})?\s*(?:[ap]m?)?`;
const LINE = new RegExp(String.raw`^(.+?)[\s,:]+(${TIME})\s*(?:-|–|—|to)\s*(${TIME})\s*$`, "i");

// One period per line: "<name> <start>-<end>", e.g. "Period 1 8:00-8:50" or "Lunch 11:30am - 12:05pm".
export function parseScheduleText(text) {
  const periods = [];
  const errors = [];
  (text ?? "").split("\n").forEach((raw, i) => {
    const line = raw.replace(/\b([ap])\.m\.?/gi, "$1m").trim();
    if (!line) return;
    const m = LINE.exec(line);
    const start = m && parseLooseTime(m[2]);
    const end = m && parseLooseTime(m[3]);
    if (!m || start === null || end === null) {
      errors.push(`Line ${i + 1}: couldn't read "${raw.trim()}". Try "Period 1 8:00-8:50".`);
      return;
    }
    periods.push({ name: m[1].trim(), start: fromMinutes(start), end: fromMinutes(end) });
  });
  return { periods, errors: errors.concat(validatePeriods(periods)) };
}

export function validatePeriods(periods) {
  const errors = [];
  periods.forEach((p, i) => {
    if (toMinutes(p.end) <= toMinutes(p.start)) {
      errors.push(`${p.name} ends before it starts.`);
    }
    const prev = periods[i - 1];
    if (prev && toMinutes(p.start) < toMinutes(prev.end)) {
      errors.push(`${p.name} starts before ${prev.name} ends. List periods in order with no overlaps.`);
    }
  });
  return errors;
}

export function formatPeriods(periods) {
  return periods.map((p) => `${p.name} ${formatClock(p.start)}-${formatClock(p.end)}`).join("\n");
}

// Local calendar date as "YYYY-MM-DD".
export function dateKey(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

// Today's pick from the side panel wins; otherwise the weekday default.
export function scheduleForDate(settings, date) {
  const { schedules = [], weekdaySchedule = {}, todayOverride } = settings;
  const id =
    todayOverride?.date === dateKey(date) ? todayOverride.scheduleId : weekdaySchedule[date.getDay()];
  return schedules.find((s) => s.id === id) ?? null;
}

function minutesIntoDay(date) {
  return date.getHours() * 60 + date.getMinutes() + date.getSeconds() / 60;
}

export function currentPeriod(schedule, date) {
  const now = minutesIntoDay(date);
  return schedule?.periods.find((p) => toMinutes(p.start) <= now && now < toMinutes(p.end)) ?? null;
}

// The next period end after `date`, or null when the day's bells are done.
export function nextBell(schedule, date) {
  const now = minutesIntoDay(date);
  const period = schedule?.periods.find((p) => toMinutes(p.end) > now);
  if (!period) return null;
  const at = new Date(date);
  at.setHours(0, toMinutes(period.end), 0, 0);
  return { period, at };
}
