import { loadSettings, saveSettings } from "../lib/storage.js";
import { parseRoster, shortLabels } from "../lib/names.js";

const $ = (id) => document.getElementById(id);
const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
const lines = (text) =>
  text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

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

const whole = (value, min, max, fallback) => Math.min(max, Math.max(min, Math.round(Number(value) || fallback)));

async function save() {
  const rosterText = $("roster").value;
  const maxOut = whole($("maxOut").value, 1, 10, 1);
  const autoEndMinutes = whole($("autoEndMinutes").value, 1, 60, 7);
  await saveSettings({
    school: $("school").value.trim(),
    teacherName: $("teacherName").value.trim(),
    origin: $("origin").value.trim(),
    destinations: lines($("destinations").value),
    maxOut,
    autoEndMinutes,
    rosterText,
    roster: parseRoster(rosterText),
  });
  $("maxOut").value = maxOut;
  $("autoEndMinutes").value = autoEndMinutes;
  $("saved").hidden = false;
  setTimeout(() => ($("saved").hidden = true), 2000);
}

async function load() {
  const s = await loadSettings();
  $("school").value = s.school;
  $("teacherName").value = s.teacherName;
  $("origin").value = s.origin;
  $("destinations").value = s.destinations.join("\n");
  $("maxOut").value = s.maxOut;
  $("autoEndMinutes").value = s.autoEndMinutes;
  $("roster").value = s.rosterText;
  renderRosterPreview();
}

$("roster").addEventListener("input", renderRosterPreview);
$("save").addEventListener("click", save);
load();
