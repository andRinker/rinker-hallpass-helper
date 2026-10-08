// Roster parsing and short, unambiguous student labels.

// "Period 3", "Per. 3", "P3", "3rd period", "3rd" -> "3"; "Lunch" -> "lunch"
export function periodKey(name) {
  const text = String(name ?? "").trim().toLowerCase();
  const num = /(\d+)/.exec(text);
  if (num) return String(Number(num[1]));
  return text.replace(/^(period|per\.?)\s*/, "").trim();
}

const PERIOD_HEADER = /^(?:(?:period|per\.?|p)\s*\d+\w*|\d+(?:st|nd|rd|th)?\s+period)\s*:?$/i;

// One student per line, "First Last" or "Last, First".
// A line like "Period 3" or "3rd period" starts a group for the students under it.
export function parseRoster(text) {
  const students = [];
  const seen = new Set();
  let period = null;
  for (const raw of (text ?? "").split("\n")) {
    const line = raw.trim().replace(/\s+/g, " ");
    if (!line) continue;
    if (PERIOD_HEADER.test(line)) {
      period = periodKey(line);
      continue;
    }
    let first;
    let last;
    if (line.includes(",")) {
      [last, first] = line.split(",", 2).map((s) => s.trim());
    } else {
      [first, ...last] = line.split(" ");
      last = last.join(" ");
    }
    if (!first) continue;
    const key = `${first}|${last}|${period}`.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    students.push({ first, last, period });
  }
  return students;
}

// Shortest label that tells students with the same first name apart:
// "Jordan M.", then "Jordan Mi." / "Jordan Ma.", then the full last name.
export function shortLabels(students) {
  return students.map((s) => {
    if (!s.last) return s.first;
    const twins = students.filter(
      (o) => o !== s && o.first.toLowerCase() === s.first.toLowerCase() && o.last,
    );
    const last = s.last.toLowerCase();
    for (let k = 1; k < s.last.length; k++) {
      const prefix = last.slice(0, k);
      if (!twins.some((o) => o.last.toLowerCase().startsWith(prefix))) {
        return `${s.first} ${s.last.slice(0, k)}.`;
      }
    }
    const sameName = twins.some((o) => o.last.toLowerCase() === last);
    return sameName && s.period ? `${s.first} ${s.last} (P${s.period})` : `${s.first} ${s.last}`;
  });
}

// Every typed word must start a word of the student's name: "jo m" finds Jordan Miller.
export function findStudents(students, query) {
  const terms = (query ?? "").trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return students;
  return students.filter((s) => {
    const words = `${s.first} ${s.last}`.toLowerCase().split(/[\s'-]+/);
    return terms.every((t) => words.some((w) => w.startsWith(t)));
  });
}
