// The Teach card: record a create or end run in HallPass, review the steps, save them.
import { saveSettings } from "../lib/storage.js";
import { hostOf } from "../lib/tabs.js";
import { $, h, hallpassTab, toast } from "./shared.js";

const HPH = globalThis.HallPassHelper;

const ROLE_CHOICES = {
  fixed: "Same every time",
  student: "The student",
  destination: "The destination",
  final: "Final button (I click it)",
};

const COPY = {
  create: {
    button: "Teach: make a pass",
    watching: "Watching… make a pass in HallPass",
    how: "Do it the way you always do, for any student, all the way through clicking Create. It makes one real pass; you can end it right after.",
  },
  end: {
    button: "Teach: end a pass",
    watching: "Watching… end a pass in HallPass",
    how: "Find a pass that's out and end it the way you always do, including any \"Are you sure?\" step.",
  },
};

let mode = { name: "idle" }; // idle | recording { kind, host, count, last } | review { kind, host, steps, roles }
let getSettings = () => ({});

export async function initTeach(settingsGetter) {
  getSettings = settingsGetter;
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg?.type === "teach-progress" && mode.name === "recording") {
      mode = { ...mode, count: msg.count, last: msg.last };
      renderTeach();
    }
  });
  // Pick up a recording that was already running when the panel opened.
  const { state, tab } = await hallpassTab();
  if (state === "ready") {
    const status = await chrome.tabs.sendMessage(tab.id, { type: "teach-status" }).catch(() => null);
    if (status?.recording) mode = { name: "recording", kind: status.kind, host: hostOf(tab.url), count: status.count, last: "" };
  }
  renderTeach();
}

async function start(kind) {
  const { state, tab, name } = await hallpassTab();
  if (state !== "ready") {
    toast(state === "closed" ? `Open ${name} first, then teach.` : `Reload your ${name} tab first.`);
    return;
  }
  await chrome.tabs.sendMessage(tab.id, { type: "teach-start", kind });
  await chrome.tabs.update(tab.id, { active: true });
  mode = { name: "recording", kind, host: hostOf(tab.url), count: 0, last: "" };
  renderTeach();
}

async function stop(keep) {
  const { tab } = await hallpassTab(mode.host);
  const result = tab ? await chrome.tabs.sendMessage(tab.id, { type: "teach-stop" }).catch(() => null) : null;
  const { kind, host } = mode;
  mode = { name: "idle" };
  if (keep) {
    const steps = result?.steps ?? [];
    if (!steps.length) toast("No steps were recorded. Start again and click through HallPass while it's watching.");
    else {
      const { roster, destinations } = getSettings();
      mode = { name: "review", kind, host, steps, roles: HPH.guessRoles(steps, kind, { roster, destinations }) };
    }
  }
  renderTeach();
}

// [{ text, blocking }]: blocking problems stop Save, the rest are warnings.
function problems({ kind, roles }) {
  const list = [];
  if (!roles.includes("student")) list.push({ text: "Mark the step where you picked the student.", blocking: true });
  if (roles.filter((r) => r === "final").length > 1)
    list.push({ text: "Only one step can be the final button.", blocking: true });
  if (kind === "create" && !roles.includes("final"))
    list.push({
      text: "No final button marked, so the helper won't know when you've made a pass and Who's Out won't fill in.",
      blocking: false,
    });
  return list;
}

async function save() {
  const { kind, host, steps, roles } = mode;
  const blocking = problems(mode).find((p) => p.blocking);
  if (blocking) {
    toast(blocking.text);
    return;
  }
  const { macros } = getSettings();
  await saveSettings({ macros: { ...macros, [kind]: { steps: HPH.scrubSteps(steps, roles), taughtAt: Date.now(), host } } });
  mode = { name: "idle" };
  toast(kind === "create" ? "Saved. Tap a student to try it." : "Saved. Back buttons will now end passes in HallPass.");
  renderTeach();
}

function reviewView() {
  const { kind, steps, roles } = mode;
  const choices = Object.entries(ROLE_CHOICES).filter(([role]) => kind === "create" || role !== "final");
  const issues = problems(mode);
  return [
    h("h2", {}, "Check the steps"),
    h("p", { class: "hint" }, "The helper guessed which steps change each time. Fix any that look wrong."),
    h(
      "ol",
      { class: "steps" },
      steps.map((step, i) =>
        h(
          "li",
          {},
          h("div", { class: "step-label" }, HPH.stepLabel(step)),
          h(
            "select",
            {
              "aria-label": `What step ${i + 1} is`,
              onchange: (e) => {
                mode.roles[i] = e.target.value;
                renderTeach();
              },
            },
            choices.map(([role, label]) => {
              const option = new Option(label, role);
              option.selected = roles[i] === role;
              return option;
            }),
          ),
        ),
      ),
    ),
    issues.length ? h("ul", { class: "warnings" }, issues.map((p) => h("li", {}, p.text))) : null,
    h(
      "div",
      { class: "row" },
      h("button", { class: "primary", type: "button", onclick: save }, "Save"),
      h("button", { type: "button", onclick: () => start(kind) }, "Start over"),
      h("button", { class: "link", type: "button", onclick: () => ((mode = { name: "idle" }), renderTeach()) }, "Cancel"),
    ),
  ];
}

function recordingView() {
  const copy = COPY[mode.kind];
  return [
    h("h2", {}, copy.watching),
    h("p", { class: "hint" }, copy.how),
    h("p", { class: "recording" }, `${mode.count} step${mode.count === 1 ? "" : "s"} so far`, mode.last ? ` · last: ${mode.last}` : ""),
    h(
      "div",
      { class: "row" },
      h("button", { class: "primary", type: "button", onclick: () => stop(true) }, "Done"),
      h("button", { type: "button", onclick: () => stop(false) }, "Cancel"),
    ),
  ];
}

function idleView() {
  const { macros } = getSettings();
  if (!macros.create) {
    return [
      h("h2", {}, "Teach the helper"),
      h("p", { class: "hint" }, "Make one pass in HallPass while the helper watches. After that, tapping a student fills it in for you."),
      h("button", { class: "primary", type: "button", onclick: () => start("create") }, COPY.create.button),
    ];
  }
  if (!macros.end) {
    return [
      h("p", { class: "taught" }, "✓ Knows how to make a pass"),
      h("p", { class: "hint" }, "Next, end a pass while it watches, so Back and end-at-the-bell work in HallPass too."),
      h(
        "div",
        { class: "row" },
        h("button", { class: "primary", type: "button", onclick: () => start("end") }, COPY.end.button),
        h("button", { class: "link", type: "button", onclick: () => start("create") }, "Re-teach making"),
      ),
    ];
  }
  return [
    h(
      "div",
      { class: "row taught" },
      h("span", {}, "✓ Knows how to make and end a pass"),
      h("button", { class: "link", type: "button", onclick: () => start("create") }, "Re-teach"),
      h("button", { class: "link", type: "button", onclick: () => start("end") }, "Re-teach ending"),
    ),
  ];
}

export function renderTeach() {
  const view = mode.name === "recording" ? recordingView() : mode.name === "review" ? reviewView() : idleView();
  $("teach").replaceChildren(...view.filter(Boolean));
  $("teach").dataset.mode = mode.name;
}
