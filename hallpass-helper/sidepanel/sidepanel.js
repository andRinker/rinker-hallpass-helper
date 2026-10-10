import { HALLPASS_URL, loadSettings, saveSettings } from "../lib/storage.js";
import { alreadyListed, queueEntry, studentFromText, suggestions } from "../lib/queue.js";
import { taughtHost } from "../lib/tabs.js";
import { $, askHallPass, hallpassTab, h, toast } from "./shared.js";
import { initTeach, renderTeach } from "./teach.js";
import { initWhosOut, renderWhosOut } from "./whos-out.js";

let settings;
let destination = null;

async function refresh() {
  settings = await loadSettings();
  if (!settings.destinations.includes(destination)) destination = settings.destinations[0] ?? null;
  renderDestinations();
  renderSuggestions();
  renderQueue();
  renderTeach();
  renderWhosOut();
  renderHallPass();
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
        $("addName").focus();
      });
      return pill;
    }),
  );
}

// --- adding to the queue ---

async function add({ student, label }) {
  const latest = await loadSettings();
  const where = alreadyListed(latest, student);
  if (where) {
    toast(where === "queue" ? `${label} is already in the queue.` : `${label} is already out.`);
    return;
  }
  await saveSettings({ queue: [...latest.queue, queueEntry({ student, label, destination })] });
  $("addName").value = "";
  renderSuggestions();
  $("addName").focus();
}

function renderSuggestions() {
  const found = suggestions(settings.roster, $("addName").value);
  $("suggestions").replaceChildren(
    ...found.map((s) =>
      h("button", { type: "button", title: `${s.student.first} ${s.student.last}`.trim(), onclick: () => add(s) }, s.label),
    ),
  );
}

$("addName").addEventListener("input", renderSuggestions);
$("addForm").addEventListener("submit", (e) => {
  e.preventDefault();
  const result = studentFromText(settings.roster, $("addName").value);
  if (result.ok) add(result);
  else if (result.reason === "several") toast("More than one student matches. Tap the right one below.");
});

// --- the queue itself ---

function queueStatus() {
  const { macros, queue, outPasses, queuePaused, queueProblem, maxOut, autoEndMinutes } = settings;
  if (queueProblem) return { text: queueProblem, problem: true };
  if (queuePaused) return { text: "Paused. No one is sent until you resume." };
  if (!macros.create) return { text: "Teach the helper to make a pass first. Students wait here until then." };
  const pace = maxOut === 1 ? "one at a time" : `${maxOut} at a time`;
  if (!queue.length) return { text: `Add students and the helper sends them to HallPass ${pace}.` };
  if (outPasses.length < maxOut) return { text: `Sending ${queue[0].label}…` };
  const waitingOn =
    maxOut === 1 ? `${outPasses[0].label} is back or their ${autoEndMinutes} minutes are up` : "a spot opens";
  return { text: `${queue[0].label} goes next, when ${waitingOn}.` };
}

async function move(id, by) {
  const { queue } = await loadSettings();
  const i = queue.findIndex((e) => e.id === id);
  const j = i + by;
  if (i < 0 || j < 0 || j >= queue.length) return;
  const next = [...queue];
  [next[i], next[j]] = [next[j], next[i]];
  await saveSettings({ queue: next });
}

async function removeFromQueue(id) {
  const { queue } = await loadSettings();
  await saveSettings({ queue: queue.filter((e) => e.id !== id) });
}

function renderQueue() {
  const { queue, queuePaused } = settings;
  const status = queueStatus();
  $("queueStatus").textContent = status.text;
  $("queueStatus").classList.toggle("problem", !!status.problem);
  $("queueCount").textContent = queue.length ? `(${queue.length})` : "";
  $("pause").textContent = queuePaused ? "Resume" : "Pause";
  $("pause").classList.toggle("primary", queuePaused);
  $("queueList").replaceChildren(
    ...queue.map((entry, i) =>
      h(
        "li",
        { class: "queue-row" },
        h("span", { class: "place" }, `${i + 1}`),
        h(
          "div",
          { class: "who" },
          h("strong", {}, entry.label),
          entry.destination ? h("span", { class: "muted" }, entry.destination) : null,
        ),
        h("button", {
          class: "link",
          type: "button",
          title: "Move up",
          "aria-label": `Move ${entry.label} up`,
          disabled: i === 0,
          onclick: () => move(entry.id, -1),
        }, "↑"),
        h("button", {
          class: "link remove",
          type: "button",
          title: "Take out of the queue",
          "aria-label": `Take ${entry.label} out of the queue`,
          onclick: () => removeFromQueue(entry.id),
        }, "×"),
      ),
    ),
  );
}

$("pause").addEventListener("click", async () => {
  const { queuePaused } = await loadSettings();
  await saveSettings(queuePaused ? { queuePaused: false, queueProblem: "" } : { queuePaused: true });
});

// --- HallPass status and the outline ---

async function renderHallPass() {
  const { state, name } = await hallpassTab(taughtHost(settings?.macros.create));
  const messages = {
    ready: `${name} is open.`,
    stale: `Reload your ${name} tab so the helper can see it.`,
    closed: `${name} isn't open. The queue waits until it is.`,
  };
  $("hallpass").dataset.state = state;
  $("hallpass").querySelector(".text").textContent = messages[state];
  $("openHallpass").hidden = state === "ready";
  $("openHallpass").textContent = state === "stale" ? "Reload it" : `Open ${name}`;
}

async function showOutline() {
  const result = await askHallPass({ type: "outline" });
  if (!result?.ok) return;
  $("outlineText").value = result.text;
  $("outlineBox").hidden = false;
}

$("settings").addEventListener("click", () => chrome.runtime.openOptionsPage());
// Reloads or opens the same site the status line is talking about: the one the steps were taught on.
$("openHallpass").addEventListener("click", async () => {
  const host = taughtHost(settings?.macros.create);
  const { state, tab } = await hallpassTab(host);
  if (state === "stale") chrome.tabs.reload(tab.id);
  else chrome.tabs.create({ url: host ? `https://${host}/` : HALLPASS_URL, pinned: true });
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
  renderWhosOut();
  renderHallPass();
}, 15000);

settings = await loadSettings();
const getSettings = () => settings;
initWhosOut(getSettings);
initTeach(getSettings);
refresh();
