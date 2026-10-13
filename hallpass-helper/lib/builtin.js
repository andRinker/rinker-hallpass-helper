// The steps for making and ending a pass, built in. They came from teaching the helper on the real pages
// (taught setup of 2026-10-13), so nobody has to teach anything. Names and destinations are placeholders.
// If GoGuardian changes a page, the helper stops and says which step it couldn't find.
import { HALLPASS_HOST } from "./tabs.js";

const HOME_HOST = "teacher.goguardian.com";

const BUTTON = ["inline-flex", "items-center", "justify-center", "whitespace-nowrap"];
const COMBO = ["inline-flex", "items-center", "whitespace-nowrap", "rounded-md"];
const INPUT = ["flex", "w-full", "rounded-md", "bg-transparent"];
const OPTION = ["relative", "flex", "cursor-default", "select-none"];
const RADIO = ["aspect-square", "rounded-full", "border", "border-primary"];

const step = (action, role, target, value) => ({
  action,
  role,
  ...(value ? { value } : {}),
  target: { classes: [], context: "", index: 0, pointer: false, ...target },
});

// The part of making a pass that's the same in both places: the Request Pass form.
const requestPass = [
  step("click", "fixed", { classes: COMBO, context: "Request Pass", name: "Select student", role: "combobox", tag: "button", type: "button" }),
  step("type", "student", { classes: INPUT, name: "Select student", role: "combobox", tag: "input", type: "text" }, "{student}"),
  step("click", "student", { classes: OPTION, name: "{student}", role: "option", tag: "div" }),
  step("click", "fixed", { classes: COMBO, context: "Request Pass", name: "Select destination room", role: "combobox", tag: "button", type: "button" }),
  step("click", "destination", { classes: OPTION, name: "{destination}", role: "option", tag: "div" }),
  step("click", "final", { classes: BUTTON, context: "Request Pass", name: "Submit", role: "button", tag: "button", type: "submit" }),
  step("click", "fixed", { classes: BUTTON, context: "Pass Details", name: "Close", role: "button", tag: "button" }),
];

const hallpassSite = (kind, steps) => ({ kind, host: HALLPASS_HOST, popup: false, steps });
const popup = (steps, opener) => ({ kind: "create", host: HALLPASS_HOST, popup: true, steps, opener: { host: HOME_HOST, steps: [opener] } });

const makeHallpass = hallpassSite("hallpass", [
  step("click", "fixed", { classes: BUTTON, name: "New Pass", role: "button", tag: "button" }),
  ...requestPass,
]);

// Home screen -> Create Pass button opens the window, which first asks which site.
const makeWindow = popup(
  [
    step("click", "fixed", { classes: RADIO, context: "Choose a site", name: "", role: "radio", tag: "button", type: "button" }),
    step("click", "fixed", { classes: BUTTON, context: "Choose a site", name: "Select", role: "button", tag: "button", type: "submit" }),
    ...requestPass,
  ],
  // The button reads "Create a new ... pass"; * matches the word in between.
  step("click", "fixed", { name: "Create a new * pass", role: "button", tag: "button" }),
);

// On the HallPass site, ending a pass is one click on the student's button.
const endHallpass = hallpassSite("hallpass", [step("click", "student", { classes: BUTTON, name: "{student}", role: "button", tag: "button" })]);

// On the home screen, the student's button opens the window, where the pass is ended.
const endWindow = popup(
  [
    step("click", "fixed", { classes: BUTTON, context: "Pass Details", name: "End Pass", role: "button", tag: "button", type: "submit" }),
    step("click", "fixed", { classes: BUTTON, context: "Pass Details", name: "Close", role: "button", tag: "button" }),
  ],
  step("click", "student", { name: "{student}", role: "button", tag: "button" }),
);

// `create` and `end` are the "most recently taught" copies other code looks at.
export const BUILTIN_MACROS = {
  make: { hallpass: makeHallpass, create: makeWindow },
  endVia: { hallpass: endHallpass, create: endWindow },
  create: makeHallpass,
  end: endHallpass,
};

// Puts the built-in steps where every part of the extension reads them. Skipped when the browser tests
// bring their own steps (macrosOverride).
export async function installBuiltin() {
  const { macros, macrosOverride } = await chrome.storage.local.get({ macros: {}, macrosOverride: false });
  if (macrosOverride) return;
  if (JSON.stringify(macros) !== JSON.stringify(BUILTIN_MACROS)) await chrome.storage.local.set({ macros: BUILTIN_MACROS });
}
