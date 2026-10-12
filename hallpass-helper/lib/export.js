// "Copy taught setup": everything the helper was taught, as text to paste to Claude so the steps can be
// built into the stable version. Page steps only: names are shaped like the page outline does.
import { chosenLane, endMethods, makeMethods } from "./methods.js";

const PLACEHOLDER = /(\{student\}|\{destination\})/;
const digitsHidden = (text) => (typeof text === "string" ? text.replace(/\d+/g, "#") : text);

export function taughtSetup(settings, redact, version = "") {
  const keep = [settings.school, settings.teacherName, settings.origin, ...(settings.destinations ?? [])];
  const roster = settings.roster ?? [];
  const clean = (text) =>
    typeof text !== "string"
      ? text
      : text
          .split(PLACEHOLDER)
          .map((part) => (PLACEHOLDER.test(part) ? part : redact(part, { keep, roster })))
          .join("");

  const step = (s) => ({
    action: s.action,
    role: s.role,
    ...(s.key ? { key: s.key } : {}),
    ...(s.value !== undefined ? { value: clean(s.value) } : {}),
    target: {
      ...s.target,
      name: clean(s.target?.name),
      context: clean(s.target?.context),
      testid: digitsHidden(s.target?.testid),
      id: digitsHidden(s.target?.id),
    },
  });
  const macro = (m) => ({
    kind: m.kind,
    host: m.host,
    popup: Boolean(m.popup),
    steps: m.steps.map(step),
    ...(m.opener ? { opener: { host: m.opener.host, steps: m.opener.steps.map(step) } } : {}),
  });
  const each = (all) => Object.fromEntries(Object.entries(all).map(([kind, m]) => [kind, macro({ ...m, kind: m.kind ?? kind })]));

  return JSON.stringify(
    {
      format: "hallpass-helper-taught-setup/1",
      helperVersion: version,
      lane: chosenLane(settings),
      makePass: each(makeMethods(settings.macros)),
      endPass: each(endMethods(settings.macros)),
    },
    null,
    1,
  );
}
