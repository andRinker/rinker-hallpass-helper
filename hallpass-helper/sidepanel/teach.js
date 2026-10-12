// The Teach card: record a create or end run in HallPass, review the steps, save them.
import { saveSettings } from "../lib/storage.js";
import { METHODS, makeMethods, method } from "../lib/methods.js";
import { allGoGuardianTabs, hostOf, isPopupTab, pageKind, popupWindowIds } from "../lib/tabs.js";
import { renderGuide } from "./guide.js";
import { $, h, hallpassTab, toast } from "./shared.js";

const HPH = globalThis.HallPassHelper;

const ROLE_CHOICES = {
  fixed: "Same every time",
  student: "The student",
  destination: "The destination",
  final: "Final button (Create)",
};

const END_COPY = {
  watching: "Watching… end a pass",
  how: "Find a pass that's out and end it the way you always do, including any \"Are you sure?\" step.",
};

// Ending a pass is taught wherever you end passes; making is taught once per way (see lib/methods.js).
const placeOf = async (tab) => ({ host: hostOf(tab.url), popup: await isPopupTab(tab) });

let mode = { name: "idle" }; // idle | recording { kind, method?, place, count, last } | review { kind, method?, place, steps, roles }
let getSettings = () => ({});

export async function initTeach(settingsGetter) {
  getSettings = settingsGetter;
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg?.type === "teach-progress" && mode.name === "recording") {
      mode = { ...mode, count: msg.count, last: msg.last };
      renderTeach();
      switchToWindow(false);
    }
  });
  chrome.tabs.onUpdated.addListener((_id, info) => info.status === "complete" && switchToWindow(false));
  chrome.windows.onCreated.addListener(() => setTimeout(() => switchToWindow(false), 1500));
  // Pick up a recording that was already running when the panel opened.
  const popups = await popupWindowIds();
  for (const tab of await allGoGuardianTabs()) {
    const status = await chrome.tabs.sendMessage(tab.id, { type: "teach-status" }).catch(() => null);
    if (!status?.recording) continue;
    const kind = pageKind(tab, popups);
    const opening = status.kind === "open";
    mode = {
      name: "recording",
      kind: opening ? "create" : status.kind,
      method: status.kind === "end" ? undefined : kind === "hallpass" ? "hallpass" : "create",
      stage: opening ? "opener" : "make",
      place: status.kind === "end" ? await placeOf(tab) : { kind, host: hostOf(tab.url) },
      count: status.count,
      last: "",
    };
    break;
  }
  renderTeach();
}

// kind is "create" (making a pass, taught per method) or "end".
async function start(kind, how) {
  if (kind === "create" && how === "create") return startWindow();
  const { state, tab } = await hallpassTab(kind === "create" ? { kind: how } : undefined);
  if (state !== "ready") {
    toast(state === "closed" ? (kind === "create" ? method(how).closed : "Open HallPass first, then teach.") : "Reload your GoGuardian tab first.");
    return;
  }
  await chrome.tabs.sendMessage(tab.id, { type: "teach-start", kind });
  await chrome.tabs.update(tab.id, { active: true });
  const place = kind === "create" ? { kind: how, host: hostOf(tab.url) } : await placeOf(tab);
  mode = { name: "recording", kind, method: how, stage: "make", place, count: 0, last: "" };
  renderTeach();
}

// The Create Pass window method has two parts. Part 1 watches the home screen click Create Pass; once
// the window opens, part 2 watches the pass being made in it.
async function startWindow() {
  const win = await hallpassTab({ kind: "create" });
  if (win.state === "ready") {
    // Already open: teach just the pass; whatever was taught about opening it stays.
    await chrome.tabs.sendMessage(win.tab.id, { type: "teach-start", kind: "create" });
    await chrome.tabs.update(win.tab.id, { active: true });
    mode = { name: "recording", kind: "create", method: "create", stage: "make", place: { kind: "create", host: hostOf(win.tab.url) }, count: 0, last: "", windowOnly: true };
    return renderTeach();
  }
  const home = await hallpassTab({ kind: "home" });
  if (home.state !== "ready") {
    toast(home.state === "closed" ? method("create").closed : "Reload your GoGuardian home screen first.");
    return;
  }
  await chrome.tabs.sendMessage(home.tab.id, { type: "teach-start", kind: "open" });
  await chrome.tabs.update(home.tab.id, { active: true });
  mode = { name: "recording", kind: "create", method: "create", stage: "opener", place: { kind: "home", host: hostOf(home.tab.url) }, count: 0, last: "" };
  renderTeach();
}

let switching = false;
// Part 1 -> part 2: the Create Pass window is open, so stop watching the home screen and watch the window.
// `manual` is the teacher clicking the button, so say what's wrong; the automatic checks stay quiet.
async function switchToWindow(manual) {
  if (switching || mode.name !== "recording" || mode.stage !== "opener") return;
  if (!manual && mode.count < 1) return;
  switching = true;
  try {
    const win = await hallpassTab({ kind: "create" });
    if (win.state !== "ready") {
      if (manual) toast(win.state === "stale" ? "Reload the Create Pass window first." : "The Create Pass window isn't open yet. Click Create Pass on the home screen.");
      return;
    }
    const home = await hallpassTab(mode.place);
    const part1 = home.tab ? await chrome.tabs.sendMessage(home.tab.id, { type: "teach-stop" }).catch(() => null) : null;
    await chrome.tabs.sendMessage(win.tab.id, { type: "teach-start", kind: "create" });
    await chrome.tabs.update(win.tab.id, { active: true });
    mode = { ...mode, stage: "make", openerSteps: part1?.steps ?? [], openerHost: mode.place.host, place: { kind: "create", host: hostOf(win.tab.url) }, count: 0, last: "" };
    renderTeach();
  } finally {
    switching = false;
  }
}

async function stop(keep) {
  const { tab } = await hallpassTab(mode.place);
  const result = tab ? await chrome.tabs.sendMessage(tab.id, { type: "teach-stop" }).catch(() => null) : null;
  const { kind, method: how, place, openerSteps, openerHost } = mode;
  mode = { name: "idle" };
  if (keep) {
    const steps = result?.steps ?? [];
    if (!steps.length) toast("No steps were recorded. Start again and click through the page while it's watching.");
    else {
      const { roster, destinations } = getSettings();
      mode = { name: "review", kind, method: how, place, openerSteps, openerHost, steps, roles: HPH.guessRoles(steps, kind, { roster, destinations }) };
    }
  }
  renderTeach();
}

// [{ text, blocking }]: blocking problems stop Save, the rest are warnings.
function problems({ roles }) {
  const list = [];
  if (!roles.includes("student")) list.push({ text: "Mark the step where you picked the student.", blocking: true });
  if (roles.filter((r) => r === "final").length > 1)
    list.push({ text: "Only one step can be the final button.", blocking: true });
  return list;
}

async function save() {
  const { kind, method: how, place, steps, roles, openerSteps, openerHost } = mode;
  const blocking = problems(mode).find((p) => p.blocking);
  if (blocking) {
    toast(blocking.text);
    return;
  }
  const { macros } = getSettings();
  const macro = { steps: HPH.scrubSteps(steps, roles), taughtAt: Date.now(), host: place.host, popup: kind === "create" ? how === "create" : place.popup };
  if (kind === "create") {
    // Part 1 of the Create Pass window method: how the home screen opens it. Kept if only the window was retaught.
    const old = makeMethods(macros)[how]?.opener;
    const opener = openerSteps?.length ? { steps: HPH.scrubSteps(openerSteps, openerSteps.map(() => "fixed")), host: openerHost } : old;
    const taught = { ...macro, kind: how, ...(opener ? { opener } : {}) };
    // `create` stays as the most recently taught way, so older checks that look for it keep working.
    await saveSettings({ macros: { ...macros, make: { ...makeMethods(macros), [how]: taught }, create: taught } });
  } else await saveSettings({ macros: { ...macros, end: macro } });
  mode = { name: "idle" };
  toast(kind === "create" ? `Saved: ${method(how).name}. The queue will use it when that page is open.` : "Saved. Passes will now end on time in HallPass.");
  renderTeach();
}

function reviewView() {
  const { kind, steps, roles } = mode;
  const choices = Object.entries(ROLE_CHOICES).filter(([role]) => kind === "create" || role !== "final");
  const issues = problems(mode);
  return [
    h("h2", {}, kind === "create" ? `Check the steps: ${method(mode.method).name}` : "Check the steps: ending a pass"),
    mode.openerSteps?.length ? h("p", { class: "hint" }, `Part 1 learned: ${mode.openerSteps.map((st) => HPH.stepLabel(st)).join(", then ")}. Part 2, the pass itself:`) : null,
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
      h("button", { type: "button", onclick: () => start(kind, mode.method) }, "Start over"),
      h("button", { class: "link", type: "button", onclick: () => ((mode = { name: "idle" }), renderTeach()) }, "Cancel"),
    ),
  ];
}

function recordingView() {
  const m = mode.kind === "create" ? method(mode.method) : null;
  const opening = mode.stage === "opener";
  const title = !m
    ? END_COPY.watching
    : mode.method === "create"
      ? `Watching: ${opening ? "part 1 of 2, the home screen" : mode.windowOnly ? "the Create Pass window" : "part 2 of 2, the Create Pass window"}`
      : `Watching: ${m.name}`;
  const lines = !m ? [END_COPY.how] : mode.method !== "create" ? m.steps : opening ? [m.steps[0], m.steps[1]] : [m.steps[1]];
  return [
    h("h2", {}, title),
    m ? h("p", { class: "hint" }, `You're teaching one way: ${m.name}.`) : null,
    h("ol", { class: "hint" }, lines.map((line) => h("li", {}, line))),
    m && mode.windowOnly ? h("p", { class: "hint" }, "The window was already open, so only the pass itself is learned. To also teach how it's opened, cancel, close the window and start again from the home screen.") : null,
    h("p", { class: "recording" }, `${mode.count} step${mode.count === 1 ? "" : "s"} so far`, mode.last ? ` · last: ${mode.last}` : ""),
    h(
      "div",
      { class: "row" },
      opening
        ? h("button", { class: "primary", type: "button", onclick: () => switchToWindow(true) }, "The window is open: continue")
        : h("button", { class: "primary", type: "button", onclick: () => stop(true) }, "Done"),
      h("button", { type: "button", onclick: () => stop(false) }, "Cancel"),
    ),
  ];
}

function idleView() {
  const { macros } = getSettings();
  const taught = makeMethods(macros);
  const any = Object.keys(taught).length > 0;
  return [
    h("h2", {}, "Teach the helper"),
    h(
      "p",
      { class: "hint" },
      "A pass can be made two ways. Each has its own button below, and each button watches only what it names. Teach every way you use; the helper then uses whichever taught page is open.",
    ),
    ...METHODS.map((m) =>
      h(
        "div",
        { class: "method", "data-taught": taught[m.kind] ? "yes" : "no" },
        h("strong", {}, `${taught[m.kind] ? "✓ " : ""}${m.name}`),
        h("p", { class: "hint" }, `Use this if: ${m.use}`),
        h("button", { class: taught[m.kind] || !any ? "" : "primary", type: "button", onclick: () => start("create", m.kind) }, `${taught[m.kind] ? "Re-teach" : "Teach"}: ${m.short}`),
      ),
    ),
    h(
      "div",
      { class: "method", "data-taught": macros.end ? "yes" : "no" },
      h("strong", {}, `${macros.end ? "✓ " : ""}Ending a pass`),
      h("p", { class: "hint" }, "Teach this once, so passes end on time and Back ends them in HallPass."),
      h("button", { class: macros.end || !any ? "" : "primary", type: "button", onclick: () => start("end") }, macros.end ? "Re-teach: end a pass" : "Teach: end a pass"),
    ),
  ];
}

export function renderTeach() {
  const view = mode.name === "recording" ? recordingView() : mode.name === "review" ? reviewView() : idleView();
  $("teach").replaceChildren(...view.filter(Boolean));
  $("teach").dataset.mode = mode.name;
  renderGuide(getSettings(), mode.name === "recording");
}
