import { HALLPASS_URL, loadSettings, saveSettings } from "../lib/storage.js";
import { currentPeriod, dateKey, formatClock, nextBell, scheduleForDate } from "../lib/bells.js";
import { findStudents, periodKey, shortLabels } from "../lib/names.js";
import { HALLPASS_HOST, hostOf, taughtHost } from "../lib/tabs.js";
import { $, askHallPass, hallpassTab, stuckMessage, toast } from "./shared.js";
import { initTeach, renderTeach } from "./teach.js";
import { initWhosOut, renderWhosOut } from "./whos-out.js";

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
  renderTeach();
  renderWhosOut();
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

async function renderHallPass() {
  const { state, tab } = await hallpassTab(taughtHost(settings?.macros.create));
  const messages = {
    ready: hostOf(tab?.url) === HALLPASS_HOST ? "HallPass is open." : "GoGuardian is open.",
    stale: "Reload your HallPass tab so the helper can see it.",
    closed: "HallPass isn't open.",
  };
  $("hallpass").dataset.state = state;
  $("hallpass").querySelector(".text").textContent = messages[state];
  $("openHallpass").hidden = state === "ready";
  $("openHallpass").textContent = state === "stale" ? "Reload it" : "Open HallPass";
}

async function quickPass(student) {
  if (!settings.macros.create) {
    toast('Teach the helper first: click "Teach: make a pass" above.');
    return;
  }
  const result = await askHallPass({ type: "start-pass", student, destination }, taughtHost(settings.macros.create));
  if (!result) return;
  if (result.waitingForFinal) toast(`Check it in HallPass, then click "${result.finalLabel}".`);
  else if (result.ok) toast("Filled in. Finish the pass in HallPass.");
  else toast(stuckMessage(result));
}

async function showOutline() {
  const result = await askHallPass({ type: "outline" });
  if (!result?.ok) return;
  $("outlineText").value = result.text;
  $("outlineBox").hidden = false;
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
$("outlineButton").addEventListener("click", showOutline);
$("closeOutline").addEventListener("click", () => ($("outlineBox").hidden = true));
$("copyOutline").addEventListener("click", async () => {
  await navigator.clipboard.writeText($("outlineText").value);
  toast("Copied. Paste it into an email or doc to yourself, then into your chat with Claude.");
});

chrome.storage.onChanged.addListener(refresh);
chrome.tabs.onRemoved.addListener(renderHallPass);
chrome.tabs.onUpdated.addListener((_id, info) => info.status === "complete" && renderHallPass());
setInterval(() => {
  renderClock();
  renderWhosOut();
  renderHallPass();
}, 15000);

settings = await loadSettings();
const getSettings = () => settings;
initWhosOut(getSettings);
initTeach(getSettings);
refresh();
