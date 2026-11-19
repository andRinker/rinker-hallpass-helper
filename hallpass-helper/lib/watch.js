// Watch mode, the parts that need no browser: gathering what the content scripts report, turning one
// demonstration into a route, folding routes into what the helper already knows, and keeping a map of the
// screens it has seen. Used by the background (gathering) and the side panel (review and saving).
import "../content/core.js";

const HPH = globalThis.HallPassHelper;

export const MAX_EVENTS = 400;
export const MAX_ALTERNATES = 6;
const MAX_SCREENS = 80;
const MAX_EDGES = 240;

export const emptyWatch = () => ({ active: false, goal: null, startedAt: 0, events: [], screens: {}, edges: {}, full: false });

// --- gathering (background) ---

// `msg` is what a content script sent; `page` is { kind, host } for the tab it came from.
export function applyEvent(state, msg, page) {
  if (!state?.active) return state;
  if (msg.ev === "step") {
    if (state.events.length >= MAX_EVENTS) return { ...state, full: true };
    const next = { uid: msg.uid, page, step: msg.step };
    const last = state.events.at(-1);
    // Typing again in the same box replaces the earlier typing, as it does everywhere else.
    if (msg.step.action === "type" && last?.page.kind === page.kind && last.step.action === "type" && HPH.sameTarget(last.step.target, msg.step.target)) {
      return { ...state, events: [...state.events.slice(0, -1), next] };
    }
    return { ...state, events: [...state.events, next] };
  }
  if (msg.ev === "appears") {
    return { ...state, events: state.events.map((e) => (e.uid === msg.uid ? { ...e, appears: msg.appears } : e)) };
  }
  if (msg.ev === "screen") {
    const key = `${page.kind}|${msg.id}`;
    const known = state.screens[key];
    const names = new Map((known?.landmarks ?? []).map((l) => [`${l.role}|${l.name}`, l]));
    for (const l of msg.landmarks ?? []) names.set(`${l.role}|${l.name}`, l);
    if (!known && Object.keys(state.screens).length >= MAX_SCREENS) return state;
    return {
      ...state,
      screens: {
        ...state.screens,
        [key]: { kind: page.kind, host: page.host, path: msg.path, landmarks: [...names.values()].slice(0, 80), seen: (known?.seen ?? 0) + 1 },
      },
    };
  }
  if (msg.ev === "edge") {
    const key = `${page.kind}|${msg.from}>${msg.via}>${msg.to}`;
    const known = state.edges[key];
    if (!known && Object.keys(state.edges).length >= MAX_EDGES) return state;
    return { ...state, edges: { ...state.edges, [key]: { kind: page.kind, from: msg.from, to: msg.to, via: msg.via, count: (known?.count ?? 0) + 1 } } };
  }
  return state;
}

// --- one demonstration -> one route ---

const toStep = (e) => ({ ...e.step, ...(e.appears?.length ? { appears: e.appears } : {}) });

// Which way the teacher just did it, and the steps in order. null when nothing useful happened.
// The Create Pass window means the home screen -> window way; otherwise it's the HallPass website.
export function demonstrationOf(events) {
  const inWindow = events.some((e) => e.page.kind === "create");
  const lane = inWindow ? "create" : events.some((e) => e.page.kind === "hallpass") ? "hallpass" : null;
  if (!lane) return null;
  const steps = events.filter((e) => e.page.kind === lane).map(toStep);
  return steps.length ? { lane, steps } : null;
}

const ENDING = /\b(end|finish|return|done|confirm)\b/i;

// First guess at what each step is. For ending a pass, the "final" step is the last click that ends it.
export function guessRoles(steps, { goal, lane, roster = [], destinations = [] }) {
  if (goal === "make") return HPH.guessRoles(steps, "create", { roster, destinations });
  // Ending from the home screen picks the student there, so the window part has no student step.
  const roles = HPH.guessRoles(steps, lane === "create" ? "other" : "end", { roster, destinations });
  for (let i = steps.length - 1; i >= 0; i--) {
    if (steps[i].action === "click" && roles[i] === "fixed" && ENDING.test(steps[i].target.name) && !/close|cancel/i.test(steps[i].target.name)) {
      roles[i] = "final";
      break;
    }
  }
  return roles;
}

// [{ text, blocking }]: blocking problems stop Save, the rest are warnings.
export function problems({ goal, lane, roles }) {
  const list = [];
  if (!roles.length) list.push({ text: "There are no steps left.", blocking: true });
  if (goal === "make" && !roles.includes("student")) list.push({ text: "Mark the step where you picked the student.", blocking: true });
  if (roles.filter((r) => r === "final").length > 1) list.push({ text: "Only one step can be the final button.", blocking: true });
  if (!roles.includes("final")) {
    list.push({ text: goal === "make" ? "Mark the final button (Create or Submit)." : "Mark the step that ends the pass (usually End Pass).", blocking: true });
  }
  if (goal === "end" && lane === "hallpass" && !roles.includes("student") && !roles.includes("final")) list.push({ text: "Mark the step where you picked the student.", blocking: true });
  return list;
}

// Steps whose wording isn't ordinary button words, so a name may have slipped in. Shown as a warning.
export function wordsToCheck(steps, roles, { keep = [], roster = [] } = {}) {
  const odd = [];
  steps.forEach((step, i) => {
    if (roles[i] !== "fixed") return;
    const text = step.action === "click" ? step.target.name : step.value;
    if (text && HPH.redact(text, { keep, roster }) !== String(text).replace(/\s+/g, " ").trim()) odd.push(i);
  });
  return odd;
}

// The finished route: names swapped for {student} and {destination}, and what appeared after each click turned
// into `done` for the plain "fixed" clicks that come before the student is picked (the only steps that may be skipped).
const PLACEHOLDER = /(\{student\}|\{destination\})/;

export function buildRoute({ goal, steps, roles, keep = [], roster = [] }) {
  const scrubbed = HPH.scrubSteps(steps, roles);
  // Context is only used to tell look-alike controls apart, so it keeps just the common words and the placeholders.
  const clean = (text) =>
    typeof text !== "string" ? text : text.split(PLACEHOLDER).map((part) => (PLACEHOLDER.test(part) ? part : HPH.redact(part, { keep, roster }))).join("");
  let committed = false;
  let specific = false; // true once the route has picked the student or destination
  return scrubbed.map((step, i) => {
    const { appears, uid, ...rest } = step;
    const out = { ...rest, target: { ...rest.target, context: clean(step.target.context) } };
    const afterCommit = committed;
    if (roles[i] === "final") {
      committed = true;
      if (goal === "end") out.commit = true;
    }
    // Only the steps that open things up before anyone is picked may be skipped. What shows after a student is
    // picked could belong to a different student, so those steps always run.
    const opening = !specific;
    if (roles[i] === "student" || roles[i] === "destination") specific = true;
    if (afterCommit) out.optional = true;
    else if (opening && roles[i] === "fixed" && step.action === "click" && appears?.length) out.done = appears;
    return out;
  });
}

// --- folding routes into what the helper knows ---

const core = (steps) => {
  const list = steps.filter((s) => !s.peek);
  const end = list.findIndex((s) => s.commit || s.role === "final");
  return (end >= 0 ? list.slice(0, end + 1) : list).map((s) => [s.action, s.commit ? "final" : s.role, s.target.role, s.target.tag, HPH.normalize(s.target.name), s.value ?? ""].join("|")).join(">");
};
export const routeSignature = core;

// The routes a macro already has: its main one and its alternates.
export const routesOf = (macro) => (macro ? [macro.steps, ...(macro.alternates ?? []).map((a) => a.steps)].filter(Boolean) : []);

// Adds `route` to the learned list for this goal ("make" or "endVia") and way, unless the helper already knows
// it (built in or learned before). Returns { learned, status: "added" | "known" }.
export function addLearned(learned = {}, { goal, lane, route, base, now = Date.now() }) {
  const known = [...routesOf(base), ...(learned[goal]?.[lane] ?? []).map((r) => r.steps)];
  const sig = routeSignature(route);
  if (known.some((steps) => routeSignature(steps) === sig)) return { learned, status: "known" };
  const list = [...(learned[goal]?.[lane] ?? []), { steps: route, learnedAt: now }].slice(-MAX_ALTERNATES);
  return { learned: { ...learned, [goal]: { ...learned[goal], [lane]: list } }, status: "added" };
}

// The built-in macros plus everything learned: each learned route becomes one more way at the end of its macro.
export function withLearned(builtin, learned = {}) {
  const out = {};
  for (const [key, value] of Object.entries(builtin)) {
    if (key !== "make" && key !== "endVia") {
      out[key] = value;
      continue;
    }
    out[key] = Object.fromEntries(
      Object.entries(value).map(([lane, macro]) => {
        const extra = (learned[key]?.[lane] ?? []).map((r) => ({ steps: r.steps, learnedAt: r.learnedAt }));
        return [lane, extra.length ? { ...macro, alternates: [...(macro.alternates ?? []), ...extra] } : macro];
      }),
    );
  }
  // `create` and `end` are the "most recently taught" copies other code looks at.
  if (builtin.create) out.create = out.make?.[builtin.create.kind] ?? builtin.create;
  if (builtin.end) out.end = out.endVia?.[builtin.end.kind] ?? builtin.end;
  return out;
}

export const learnedCount = (learned = {}) =>
  ["make", "endVia"].reduce((n, goal) => n + Object.values(learned[goal] ?? {}).reduce((m, list) => m + list.length, 0), 0);

// --- the map of screens ---

export function mergeSiteMap(siteMap = { screens: {}, edges: {} }, { screens = {}, edges = {} }, now = Date.now()) {
  const next = { screens: { ...siteMap.screens }, edges: { ...siteMap.edges } };
  for (const [key, s] of Object.entries(screens)) {
    const known = next.screens[key];
    const names = new Map((known?.landmarks ?? []).map((l) => [`${l.role}|${l.name}`, l]));
    for (const l of s.landmarks ?? []) names.set(`${l.role}|${l.name}`, l);
    if (!known && Object.keys(next.screens).length >= MAX_SCREENS) continue;
    next.screens[key] = { kind: s.kind, host: s.host, path: s.path, landmarks: [...names.values()].slice(0, 80), seen: (known?.seen ?? 0) + s.seen, last: now };
  }
  for (const [key, e] of Object.entries(edges)) {
    const known = next.edges[key];
    if (!known && Object.keys(next.edges).length >= MAX_EDGES) continue;
    next.edges[key] = { ...e, count: (known?.count ?? 0) + e.count };
  }
  return next;
}

const PAGE_NAMES = { hallpass: "HallPass website", home: "GoGuardian home screen", create: "Create Pass window" };
export const pageName = (kind) => PAGE_NAMES[kind] ?? kind;

// "What the helper has learned", as text to paste into a chat. Only common words and the teacher's own
// settings come through as they are; everything else is shaped like "Xxxxx".
export function learnedReport(settings, { version = "", now = Date.now() } = {}) {
  const keep = [settings.school, settings.teacherName, settings.origin, ...(settings.destinations ?? [])];
  const roster = settings.roster ?? [];
  const R = (text) => (typeof text === "string" ? HPH.redact(text, { keep, roster }) : text);
  const label = (step) => `${step.optional ? "(maybe) " : ""}${step.peek ? "(peek) " : ""}[${step.role}] ${R(HPH.stepLabel(step))}${step.commit ? " <- ends it" : ""}${step.done?.length ? `  (skipped when ${step.done.map((d) => (Array.isArray(d) ? d.map((x) => R(x.name)).join(" / ") : R(d.name))).join(", ")} is showing)` : ""}`;
  const routes = (macro) => routesOf(macro).map((steps, i) => ({ way: i + 1, steps: steps.map(label) }));
  const macros = settings.macros ?? {};
  const map = settings.siteMap ?? { screens: {}, edges: {} };
  return JSON.stringify(
    {
      format: "hallpass-helper-learned/1",
      helperVersion: version,
      lane: settings.lane || "(first available)",
      makeRoutes: Object.fromEntries(Object.entries(macros.make ?? {}).map(([lane, m]) => [lane, routes(m)])),
      endRoutes: Object.fromEntries(Object.entries(macros.endVia ?? {}).map(([lane, m]) => [lane, routes(m)])),
      screensSeen: Object.entries(map.screens).map(([key, s]) => ({
        page: pageName(s.kind),
        path: s.path,
        seenTimes: s.seen,
        controls: s.landmarks.map((l) => `${l.role}: ${R(l.name)}`),
      })),
      howScreensLinked: Object.values(map.edges).map((e) => `${pageName(e.kind)}: clicking "${R(e.via)}" (${e.count}x) changed the screen`),
      lastRun: settings.lastRun ? { ...settings.lastRun, label: R(settings.lastRun.label), notes: (settings.lastRun.notes ?? []).map(R), minutesAgo: Math.round((now - settings.lastRun.at) / 60000) } : null,
    },
    null,
    1,
  );
}
