// The teacher's own line: who goes next, and when the helper may send them.
import { findStudents, shortLabels } from "./names.js";

const fullName = (s) => `${s.first} ${s.last}`.trim();
const sameStudent = (a, b) => fullName(a).toLowerCase() === fullName(b).toLowerCase();

// Roster students matching what's typed, with their short labels. Nothing until something is typed.
export function suggestions(roster, text, limit = 12) {
  if (!text.trim()) return [];
  const labels = shortLabels(roster);
  const withLabels = roster.map((s, i) => ({ student: { first: s.first, last: s.last }, label: labels[i] }));
  const found = new Set(findStudents(roster, text));
  return withLabels
    .filter((_, i) => found.has(roster[i]))
    .sort((a, b) => a.label.localeCompare(b.label))
    .slice(0, limit);
}

// What pressing Enter adds: the one roster match, or the name exactly as typed when no one matches.
// Several matches means the teacher has to pick.
export function studentFromText(roster, text) {
  const typed = text.trim().replace(/\s+/g, " ");
  if (!typed) return { ok: false, reason: "empty" };
  const matches = suggestions(roster, typed, Infinity);
  if (matches.length === 1) return { ok: true, ...matches[0] };
  if (matches.length > 1) return { ok: false, reason: "several", count: matches.length };
  let first;
  let last;
  if (typed.includes(",")) {
    [last, first] = typed.split(",", 2).map((s) => s.trim());
  } else {
    const [head, ...rest] = typed.split(" ");
    [first, last] = [head, rest.join(" ")];
  }
  if (!first) [first, last] = [last, ""];
  return { ok: true, student: { first, last }, label: fullName({ first, last }) };
}

// Who's already waiting or out, so the same student isn't lined up twice.
export function alreadyListed({ queue = [], outPasses = [] }, student) {
  if (queue.some((e) => sameStudent(e.student, student))) return "queue";
  if (outPasses.some((p) => sameStudent(p.student, student))) return "out";
  return null;
}

export function queueEntry({ student, label, destination }, now = Date.now()) {
  return {
    id: crypto.randomUUID(),
    student: { first: student.first, last: student.last },
    label: label || fullName(student),
    destination: destination ?? "",
    addedAt: now,
  };
}

// The student to send now, or null. Only one at a time is sent, and only while fewer than
// `maxOut` of the helper's passes are open.
export function nextToSend({ queue = [], outPasses = [], maxOut = 1, queuePaused = false }) {
  if (queuePaused || !queue.length) return null;
  return outPasses.length < Math.max(1, maxOut) ? queue[0] : null;
}

export const endsAt = (pass, minutes) => pass.startedAt + minutes * 60000;

// Passes whose time is up and haven't already failed to end.
export function dueToEnd({ outPasses = [], autoEndMinutes = 7 }, now = Date.now()) {
  return outPasses.filter((p) => !p.endFailed && endsAt(p, autoEndMinutes) <= now);
}
