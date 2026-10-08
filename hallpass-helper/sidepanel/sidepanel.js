import { HALLPASS_URL, loadSettings, saveSettings } from "../lib/storage.js";
import { currentPeriod, dateKey, formatClock, nextBell, scheduleForDate } from "../lib/bells.js";
import { findStudents, periodKey, shortLabels } from "../lib/names.js";

const $ = (id) => document.getElementById(id);
const displayPeriod = (name) => (/^\d+$/.test(name) ? `Period ${name}` : name);

let settings;
let destination = null;
let shownPeriod;

async function refresh() {
  settings = await loadSettings();
  if (!settings.destinations.includes(destination)) destination = settings.destinations[0] ?? null;
  renderSchedule();
  renderDestinations();
  renderClock();
  renderStudents();
  renderHallPass();
}

function renderSchedule() {
  const today = scheduleForDate(settings, new Date());
  const select = $("schedule");
  select.replaceChildren(new Option("No school today", ""), ...settings.schedules.map((s) => new Option(s.name, s.id)));
  select.value = today?.id ?? "";
  select.disabled = !settings.schedules.length;
}

function renderClock() {
  const now = new Date();
  const schedule = scheduleForDate(settings, now);
  const period = currentPeriod(schedule, now);
  const bell = nextBell(schedule, now);
  let text;
  if (!settings.schedules.length) text = "Add your bell schedules in Settings.";
  else if (!schedule) text = "No bell schedule today.";
  else if (!bell) text = "Done for the day.";
  else {
    const when = `${formatClock(bell.period.end)} (${Math.ceil((bell.at - now) / 60000)} min)`;
    text = period ? `${displayPeriod(period.name)} · bell at ${when}` : `Between periods · next bell ${when}`;
  }
  $("clock").textContent = text;
  if ((period ? periodKey(period.name) : null) !== shownPeriod) renderStudents();
}

function renderDestinations() {
  $("destinations").replaceChildren(
    ...settings.destinations.map((name) => {
      const pill = document.createElement("button");
      pill.type = "button";
      pill.setAttribute("role", "radio");
      pill.textContent = name;
      pill.setAttribute("aria-checked", String(name === destination));
      pill.addEventListener("click", () => {
        destination = name;
        renderDestinations();
      });
      return pill;
    }),
  );
}

// This period's students first; typing searches everyone on the roster.
function renderStudents() {
  const now = new Date();
  const period = currentPeriod(scheduleForDate(settings, now), now);
  shownPeriod = period ? periodKey(period.name) : null;

  const labels = shortLabels(settings.roster);
  let list = settings.roster.map((s, i) => ({ ...s, label: labels[i] }));
  let title = "My students";
  const query = $("search").value;
  if (query.trim()) {
    list = findStudents(list, query);
    title = "Search results";
  } else if (shownPeriod && list.some((s) => s.period === shownPeriod)) {
    list = list.filter((s) => s.period === shownPeriod);
    title = `My students · ${displayPeriod(period.name)}`;
  }
  list.sort((a, b) => a.label.localeCompare(b.label));

  $("studentsTitle").textContent = title;
  $("students").replaceChildren(
    ...list.map((student) => {
      const chip = document.createElement("button");
      chip.type = "button";
      chip.textContent = student.label;
      chip.title = `${student.first} ${student.last}`.trim();
      chip.addEventListener("click", () => quickPass(student));
      return chip;
    }),
  );
  const empty = !settings.roster.length ? "Add your class lists in Settings." : !list.length ? "No one matches." : "";
  $("studentsEmpty").textContent = empty;
  $("studentsEmpty").hidden = !empty;
}

async function hallpassTab() {
  const [tab] = await chrome.tabs.query({ url: `${HALLPASS_URL}*` });
  if (!tab) return { state: "closed" };
  const pong = await chrome.tabs.sendMessage(tab.id, { type: "ping" }).catch(() => null);
  return { state: pong?.ok ? "ready" : "stale", tab };
}

async function renderHallPass() {
  const { state } = await hallpassTab();
  const messages = {
    ready: "HallPass is open.",
    stale: "Reload your HallPass tab so the helper can see it.",
    closed: "HallPass isn't open.",
  };
  $("hallpass").dataset.state = state;
  $("hallpass").querySelector(".text").textContent = messages[state];
  $("openHallpass").hidden = state === "ready";
  $("openHallpass").textContent = state === "stale" ? "Reload it" : "Open HallPass";
}

async function quickPass(student) {
  const { state, tab } = await hallpassTab();
  if (state !== "ready") {
    toast(state === "closed" ? "Open HallPass first." : "Reload your HallPass tab first.");
    return;
  }
  const defaults = {
    school: settings.school,
    teacherName: settings.teacherName,
    origin: settings.origin,
    destination,
  };
  const result = await chrome.tabs.sendMessage(tab.id, { type: "start-pass", student, defaults }).catch(() => null);
  if (result?.ok) {
    chrome.tabs.update(tab.id, { active: true });
  } else if (result?.reason === "not-wired") {
    toast("One-tap passes turn on once the HallPass hookup is built. It needs screenshots of the real screens.");
  } else {
    toast("Couldn't start the pass. Check HallPass.");
  }
}

let toastTimer;
function toast(message) {
  $("toast").textContent = message;
  $("toast").hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => ($("toast").hidden = true), 5000);
}

$("schedule").addEventListener("change", (e) => {
  saveSettings({ todayOverride: { date: dateKey(new Date()), scheduleId: e.target.value } });
});
$("settings").addEventListener("click", () => chrome.runtime.openOptionsPage());
$("search").addEventListener("input", renderStudents);
$("openHallpass").addEventListener("click", async () => {
  const { state, tab } = await hallpassTab();
  if (state === "stale") chrome.tabs.reload(tab.id);
  else chrome.tabs.create({ url: HALLPASS_URL, pinned: true });
});

chrome.storage.onChanged.addListener(refresh);
chrome.tabs.onRemoved.addListener(renderHallPass);
chrome.tabs.onUpdated.addListener((_id, info) => info.status === "complete" && renderHallPass());
setInterval(() => {
  renderClock();
  renderHallPass();
}, 15000);
refresh();
