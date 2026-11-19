// The Watch card: the teacher clicks around GoGuardian and HallPass while the helper watches, then checks what it
// picked up. A way of making or ending a pass is saved as one more way the helper can use; the screens it saw are
// kept as a map. Student names are swapped for placeholders before anything is saved.
import { saveSettings } from "../lib/storage.js";
import { BUILTIN_MACROS } from "../lib/builtin.js";
import { METHODS, chosenLane } from "../lib/methods.js";
import { addLearned, buildRoute, demonstrationOf, guessRoles, learnedCount, learnedReport, mergeSiteMap, problems, routesOf, wordsToCheck } from "../lib/watch.js";
import { renderGuide } from "./guide.js";
import { $, h, toast } from "./shared.js";

const HPH = globalThis.HallPassHelper;

const GOALS = {
  make: { button: "Watch me make a pass", title: "making a pass", hint: "Make a real pass the way you like, for any student, all the way through the final button." },
  end: { button: "Watch me end a pass", title: "ending a pass", hint: "End a pass that's out, the way you like, including any \"Are you sure?\" step." },
  look: { button: "Just look around", title: "looking around", hint: "Click through any GoGuardian or HallPass screens. Nothing is made or ended." },
};

const ROLE_CHOICES = {
  fixed: "Same every time",
  student: "The student",
  destination: "The destination",
  final: "The step that finishes it",
};

let mode = { name: "idle" }; // idle | watching { goal, info } | review { goal, lane, steps, roles, screens, edges }
let getSettings = () => ({});
let timer = null;

const send = (msg) => chrome.runtime.sendMessage(msg).catch(() => null);

export async function initWatch(settingsGetter) {
  getSettings = settingsGetter;
  const info = await send({ type: "watch-info" });
  if (info?.active) {
    mode = { name: "watching", goal: info.goal, info };
    poll();
  }
  renderWatch();
}

function poll() {
  clearInterval(timer);
  timer = setInterval(async () => {
    if (mode.name !== "watching") return clearInterval(timer);
    const info = await send({ type: "watch-info" });
    if (!info?.active) return;
    mode = { ...mode, info };
    renderWatch();
  }, 1000);
}

async function start(goal) {
  await send({ type: "watch-begin", goal });
  mode = { name: "watching", goal, info: { steps: 0, screens: 0, pages: [] } };
  poll();
  renderWatch();
}

async function stop(keep) {
  clearInterval(timer);
  const got = await send({ type: "watch-end" });
  const goal = mode.goal;
  mode = { name: "idle" };
  if (!keep || !got?.ok) return renderWatch();
  const settings = getSettings();
  const events = got.events ?? [];
  if (goal === "look") {
    await saveMap(got);
    toast(`Saved what the helper saw: ${Object.keys(got.screens ?? {}).length} screens.`);
    return renderWatch();
  }
  const demo = demonstrationOf(events);
  if (!demo) {
    await saveMap(got);
    toast("No steps were seen on a HallPass page. Start again and click through while it's watching.");
    return renderWatch();
  }
  mode = { name: "review", goal, lane: demo.lane, steps: demo.steps, roles: guessRoles(demo.steps, { goal, lane: demo.lane, roster: settings.roster, destinations: settings.destinations }), screens: got.screens, edges: got.edges };
  renderWatch();
}

async function saveMap({ screens, edges }) {
  const { siteMap } = getSettings();
  await saveSettings({ siteMap: mergeSiteMap(siteMap, { screens, edges }) });
}

function keepWords(settings) {
  return [settings.school, settings.teacherName, settings.origin, ...(settings.destinations ?? [])];
}

async function save() {
  const blocking = problems(mode).find((p) => p.blocking);
  if (blocking) return toast(blocking.text);
  const settings = getSettings();
  const { goal, lane, steps, roles, screens, edges } = mode;
  const route = buildRoute({ goal, steps, roles, keep: keepWords(settings), roster: settings.roster });
  const key = goal === "make" ? "make" : "endVia";
  const { learned, status } = addLearned(settings.learned, { goal: key, lane, route, base: BUILTIN_MACROS[key][lane] });
  const chosen = chosenLane(settings);
  await saveSettings({ learned, siteMap: mergeSiteMap(settings.siteMap, { screens, edges }) });
  mode = { name: "idle" };
  const name = METHODS.find((m) => m.kind === lane).short;
  const verb = goal === "make" ? "making a pass" : "ending a pass";
  if (status === "known") toast(`The helper already knew this way of ${verb}. It kept what it saw of the screens.`);
  else toast(`Learned another way of ${verb} (${name}). ${lane === chosen ? "It tries the ways it knows by looking at the screen." : `It's used when "${name}" is the chosen way.`}`);
  renderWatch();
}

// --- views ---

function idleView() {
  const settings = getSettings();
  const made = Object.values(settings.macros?.make ?? {}).reduce((n, m) => n + routesOf(m).length, 0);
  const ended = Object.values(settings.macros?.endVia ?? {}).reduce((n, m) => n + routesOf(m).length, 0);
  const screens = Object.keys(settings.siteMap?.screens ?? {}).length;
  return [
    h("h2", {}, "Show the helper around"),
    h(
      "p",
      { class: "hint" },
      "Click through HallPass and the GoGuardian pages like you normally would. Do a job more than one way (pass box open, closed, a student lower in the list) and the helper learns each way.",
    ),
    h("p", { class: "hint" }, `It knows ${made} way${made === 1 ? "" : "s"} to make a pass and ${ended} to end one (${learnedCount(settings.learned)} learned from watching), and has seen ${screens} screen${screens === 1 ? "" : "s"}.`),
    h(
      "div",
      { class: "row wrap" },
      h("button", { class: "primary", type: "button", onclick: () => start("make") }, GOALS.make.button),
      h("button", { type: "button", onclick: () => start("end") }, GOALS.end.button),
      h("button", { type: "button", onclick: () => start("look") }, GOALS.look.button),
    ),
    h(
      "div",
      { class: "row wrap" },
      h("button", { class: "link", type: "button", onclick: copyLearned }, "Copy what the helper has learned"),
      learnedCount(settings.learned) || screens ? h("button", { class: "link", type: "button", onclick: forget }, "Forget what I showed it") : null,
    ),
  ];
}

async function copyLearned() {
  const settings = getSettings();
  await navigator.clipboard.writeText(learnedReport(settings, { version: chrome.runtime.getManifest().version_name }));
  toast("Copied. Student and staff names are hidden. Paste it into your chat with Claude.");
}

async function forget() {
  await saveSettings({ learned: {}, siteMap: { screens: {}, edges: {} } });
  toast("Forgot what you showed the helper. The built-in ways stay.");
}

function watchingView() {
  const { goal, info } = mode;
  const pages = (info.pages ?? []).map((k) => ({ hallpass: "the HallPass website", home: "the GoGuardian home screen", create: "the Create Pass window" })[k]).filter(Boolean);
  return [
    h("h2", {}, `Watching: ${GOALS[goal].title}`),
    h("p", { class: "hint" }, GOALS[goal].hint),
    h("p", { class: "hint" }, "Use any page. If the Create Pass window opens, use it too. The queue waits until you're done."),
    h("p", { class: "recording" }, `${info.steps} step${info.steps === 1 ? "" : "s"} · ${info.screens} screen${info.screens === 1 ? "" : "s"} seen`, pages.length ? ` · on ${pages.join(", ")}` : ""),
    info.full ? h("p", { class: "problem" }, "That's a lot of clicks. Press Done soon.") : null,
    h(
      "div",
      { class: "row" },
      h("button", { class: "primary", type: "button", onclick: () => stop(true) }, "Done"),
      h("button", { type: "button", onclick: () => stop(false) }, "Cancel"),
    ),
  ];
}

function reviewView() {
  const { goal, lane, steps, roles } = mode;
  const settings = getSettings();
  const issues = problems(mode);
  const odd = wordsToCheck(steps, roles, { keep: keepWords(settings), roster: settings.roster });
  const choices = Object.entries(ROLE_CHOICES);
  return [
    h("h2", {}, `Check what it saw: ${GOALS[goal].title}`),
    h("p", { class: "hint" }, `This looks like the "${METHODS.find((m) => m.kind === lane).short}" way. Fix any step that looks wrong, and take out steps that were just exploring.`),
    h(
      "ol",
      { class: "steps" },
      steps.map((step, i) =>
        h(
          "li",
          {},
          h("div", { class: "step-label" }, HPH.stepLabel(step), step.appears?.length ? h("span", { class: "muted" }, ` · then ${step.appears.map((a) => a.name).join(", ")} showed up`) : null),
          odd.includes(i) ? h("div", { class: "problem" }, "This has words that aren't usual button words. If it's a name, set it to The student.") : null,
          h(
            "div",
            { class: "row" },
            h(
              "select",
              {
                "aria-label": `What step ${i + 1} is`,
                onchange: (e) => {
                  mode.roles[i] = e.target.value;
                  renderWatch();
                },
              },
              choices.map(([role, label]) => {
                const option = new Option(label, role);
                option.selected = roles[i] === role;
                return option;
              }),
            ),
            h(
              "button",
              {
                class: "link remove",
                type: "button",
                title: "Take this step out",
                "aria-label": `Take step ${i + 1} out`,
                onclick: () => {
                  mode.steps = steps.filter((_, j) => j !== i);
                  mode.roles = roles.filter((_, j) => j !== i);
                  renderWatch();
                },
              },
              "×",
            ),
          ),
        ),
      ),
    ),
    issues.length ? h("ul", { class: "warnings" }, issues.map((p) => h("li", {}, p.text))) : null,
    h(
      "div",
      { class: "row" },
      h("button", { class: "primary", type: "button", onclick: save }, "Save this way"),
      h("button", { class: "link", type: "button", onclick: () => ((mode = { name: "idle" }), renderWatch()) }, "Throw it away"),
    ),
  ];
}

export function renderWatch() {
  const view = mode.name === "watching" ? watchingView() : mode.name === "review" ? reviewView() : idleView();
  $("teach").hidden = false;
  $("teach").replaceChildren(...view.filter(Boolean));
  $("teach").dataset.mode = mode.name;
  renderGuide(getSettings(), mode.name === "watching");
}
