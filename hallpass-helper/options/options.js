import { loadSettings, saveSettings } from "../lib/storage.js";
import { formatPeriods, parseScheduleText } from "../lib/bells.js";
import { parseRoster, shortLabels } from "../lib/names.js";

const DAYS = [
  [1, "Monday"],
  [2, "Tuesday"],
  [3, "Wednesday"],
  [4, "Thursday"],
  [5, "Friday"],
];

const $ = (id) => document.getElementById(id);
const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
const lines = (text) =>
  text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

function scheduleCards() {
  return [...$("schedules").querySelectorAll(".schedule")];
}

function cardName(card, i) {
  return card.querySelector(".schedule-name").value.trim() || `Schedule ${i + 1}`;
}

function addScheduleCard(schedule = { id: crypto.randomUUID(), name: "", periods: [] }) {
  const card = $("scheduleTemplate").content.firstElementChild.cloneNode(true);
  card.dataset.id = schedule.id;
  card.querySelector(".schedule-name").value = schedule.name;
  card.querySelector(".schedule-periods").value = formatPeriods(schedule.periods);
  card.querySelector(".schedule-periods").placeholder = "Period 1 8:00-8:50\nPeriod 2 8:55-9:45\nLunch 11:30-12:05";
  card.querySelector(".schedule-name").addEventListener("input", () => renderWeekdays());
  card.querySelector(".remove").addEventListener("click", () => {
    card.remove();
    renderWeekdays();
  });
  $("schedules").append(card);
}

function currentWeekdays() {
  return Object.fromEntries([...$("weekdays").querySelectorAll("select")].map((s) => [s.dataset.day, s.value]));
}

function renderWeekdays(selected = currentWeekdays()) {
  const cards = scheduleCards();
  $("weekdays").replaceChildren(
    ...DAYS.map(([day, label]) => {
      const select = document.createElement("select");
      select.dataset.day = day;
      select.append(new Option("No school", ""));
      cards.forEach((card, i) => select.append(new Option(cardName(card, i), card.dataset.id)));
      select.value = cards.some((c) => c.dataset.id === selected[day]) ? selected[day] : "";
      const wrap = document.createElement("label");
      wrap.append(label, select);
      return wrap;
    }),
  );
}

function renderRosterPreview() {
  const roster = parseRoster($("roster").value);
  if (!roster.length) {
    $("rosterPreview").replaceChildren();
    return;
  }
  const labels = shortLabels(roster);
  const groups = new Map();
  roster.forEach((s, i) => {
    const key = s.period ?? "";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(labels[i]);
  });
  const periodCount = [...groups.keys()].filter(Boolean).length;
  const summary = document.createElement("div");
  summary.className = "muted";
  summary.textContent = `${plural(roster.length, "student")}${
    periodCount ? ` in ${plural(periodCount, "period")}` : ""
  }. Names will show like this:`;
  const groupNodes = [...groups].map(([period, names]) => {
    const group = document.createElement("div");
    group.className = "group";
    if (period) {
      const title = document.createElement("strong");
      title.textContent = `Period ${period}`;
      group.append(title);
    }
    const chips = document.createElement("div");
    chips.className = "names";
    chips.append(
      ...names.map((n) => {
        const chip = document.createElement("span");
        chip.textContent = n;
        return chip;
      }),
    );
    group.append(chips);
    return group;
  });
  $("rosterPreview").replaceChildren(summary, ...groupNodes);
}

async function save() {
  $("saveErrors").textContent = "";
  let valid = true;
  const schedules = [];
  scheduleCards().forEach((card, i) => {
    const text = card.querySelector(".schedule-periods").value;
    const name = card.querySelector(".schedule-name").value.trim();
    const errorBox = card.querySelector(".errors");
    if (!name && !text.trim()) {
      errorBox.textContent = "";
      return; // blank card: ignore it
    }
    const { periods, errors } = parseScheduleText(text);
    if (!periods.length && !errors.length) errors.push("Add at least one period.");
    errorBox.textContent = errors.join("\n");
    if (errors.length) valid = false;
    schedules.push({ id: card.dataset.id, name: cardName(card, i), periods });
  });
  if (!valid) {
    $("saveErrors").textContent = "Fix the bell schedule problems above, then save again.";
    return;
  }

  const ids = new Set(schedules.map((s) => s.id));
  const weekdaySchedule = Object.fromEntries(Object.entries(currentWeekdays()).filter(([, id]) => ids.has(id)));
  const rosterText = $("roster").value;
  await saveSettings({
    school: $("school").value.trim(),
    teacherName: $("teacherName").value.trim(),
    origin: $("origin").value.trim(),
    destinations: lines($("destinations").value),
    rosterText,
    roster: parseRoster(rosterText),
    schedules,
    weekdaySchedule,
    endAtBell: $("endAtBell").checked,
  });

  // Show the cleaned-up times so any misread is obvious.
  for (const card of scheduleCards()) {
    const saved = schedules.find((s) => s.id === card.dataset.id);
    if (saved) card.querySelector(".schedule-periods").value = formatPeriods(saved.periods);
  }
  $("saved").hidden = false;
  setTimeout(() => ($("saved").hidden = true), 2000);
}

async function load() {
  const s = await loadSettings();
  $("school").value = s.school;
  $("teacherName").value = s.teacherName;
  $("origin").value = s.origin;
  $("destinations").value = s.destinations.join("\n");
  $("roster").value = s.rosterText;
  $("endAtBell").checked = s.endAtBell;
  s.schedules.forEach((schedule) => addScheduleCard(schedule));

  let weekdays = s.weekdaySchedule;
  if (!s.schedules.length) {
    addScheduleCard();
    const id = scheduleCards()[0].dataset.id;
    weekdays = Object.fromEntries(DAYS.map(([day]) => [day, id]));
  }
  renderWeekdays(weekdays);
  renderRosterPreview();
}

$("roster").addEventListener("input", renderRosterPreview);
$("addSchedule").addEventListener("click", () => {
  addScheduleCard();
  renderWeekdays();
});
$("save").addEventListener("click", save);
load();
