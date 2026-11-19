// The steps for making and ending a pass, built in. They came from teaching the helper on the real pages
// (taught setup of 2026-10-13), so nobody has to teach anything. Names and destinations are placeholders.
// If GoGuardian changes a page, the helper stops and says which step it couldn't find.
import { HALLPASS_HOST } from "./tabs.js";
import { withLearned } from "./watch.js";

const HOME_HOST = "teacher.goguardian.com";

const BUTTON = ["inline-flex", "items-center", "justify-center", "whitespace-nowrap"];
const COMBO = ["inline-flex", "items-center", "whitespace-nowrap", "rounded-md"];
const INPUT = ["flex", "w-full", "rounded-md", "bg-transparent"];
const OPTION = ["relative", "flex", "cursor-default", "select-none"];
const RADIO = ["aspect-square", "rounded-full", "border", "border-primary"];

const step = (action, role, target, value, extra = {}) => ({
  action,
  role,
  ...(value ? { value } : {}),
  ...extra,
  target: { classes: [], context: "", index: 0, pointer: false, ...target },
});

// What each screen looks like, so the helper can tell where it is before it clicks. A step's `done` lists
// what is already on screen when the step has nothing left to do (a list inside it means "any of these").
const seen = (target) => ({ classes: [], context: "", index: 0, pointer: false, ...target });
const SELECT_STUDENT = seen({ classes: COMBO, context: "Request Pass", name: "Select student", role: "combobox", tag: "button", type: "button" });
const STUDENT_BOX = seen({ classes: INPUT, name: "Select student", role: "combobox", tag: "input", type: "text" });
const STUDENT_PICKED = seen({ classes: COMBO, context: "Request Pass", name: "{student}", role: "combobox", tag: "button", type: "button" });
const SELECT_DESTINATION = seen({ classes: COMBO, context: "Request Pass", name: "Select destination room", role: "combobox", tag: "button", type: "button" });
const DESTINATION_BOX = seen({ classes: INPUT, name: "Select destination room", role: "combobox", tag: "input", type: "text" });
const DESTINATION_PICKED = seen({ classes: COMBO, context: "Request Pass", name: "{destination}", role: "combobox", tag: "button", type: "button" });
const SUBMIT = seen({ classes: BUTTON, context: "Request Pass", name: "Submit", role: "button", tag: "button", type: "submit" });
const FORM_OPEN = [SELECT_STUDENT, STUDENT_PICKED, SELECT_DESTINATION, DESTINATION_PICKED];

// The part of making a pass that's the same in both places: the Request Pass form. Every step says what it
// looks like when it's already done, so a form that's already open, or already part-filled, carries on from there.
const requestPass = [
  step("click", "fixed", SELECT_STUDENT, undefined, { done: [[STUDENT_BOX, STUDENT_PICKED]] }),
  step("type", "student", STUDENT_BOX, "{student}", { done: [STUDENT_PICKED] }),
  step("click", "student", { classes: OPTION, name: "{student}", role: "option", tag: "div" }, undefined, { done: [STUDENT_PICKED] }),
  step("click", "fixed", SELECT_DESTINATION, undefined, { done: [[DESTINATION_BOX, DESTINATION_PICKED]] }),
  // The destination list is a search box too: nothing shows until the name is typed.
  step("type", "destination", DESTINATION_BOX, "{destination}", { done: [DESTINATION_PICKED] }),
  step("click", "destination", { classes: OPTION, name: "{destination}", role: "option", tag: "div" }, undefined, { done: [DESTINATION_PICKED] }),
  step("click", "final", SUBMIT),
  step("click", "fixed", { classes: BUTTON, context: "Pass Details", name: "Close", role: "button", tag: "button" }, undefined, { optional: true }),
];

const hallpassSite = (kind, steps, alternates) => ({ kind, host: HALLPASS_HOST, popup: false, steps, ...(alternates ? { alternates } : {}) });
const popup = (steps, opener) => ({ kind: "create", host: HALLPASS_HOST, popup: true, steps, opener: { host: HOME_HOST, steps: [opener] } });

const makeHallpass = hallpassSite("hallpass", [
  // A Pass Details panel left open from the last pass is closed first, if it's there.
  step("click", "fixed", { classes: BUTTON, context: "Pass Details", name: "Close", role: "button", tag: "button" }, undefined, { peek: true }),
  step("click", "fixed", { classes: BUTTON, name: "New Pass", role: "button", tag: "button" }, undefined, { done: [FORM_OPEN] }),
  ...requestPass,
]);

// Home screen -> Create Pass button opens the window, which first asks which site (unless it's skipped).
const makeWindow = popup(
  [
    step("click", "fixed", { classes: RADIO, context: "Choose a site", name: "", role: "radio", tag: "button", type: "button" }, undefined, { done: [FORM_OPEN] }),
    step("click", "fixed", { classes: BUTTON, context: "Choose a site", name: "Select", role: "button", tag: "button", type: "submit" }, undefined, { done: [FORM_OPEN] }),
    ...requestPass,
  ],
  // The button reads "Create a new ... pass"; * matches the word in between.
  step("click", "fixed", { name: "Create a new * pass", role: "button", tag: "button" }),
);

// Ending a pass on the HallPass site has two ways, and the helper looks at the screen to pick one:
//  - the student's pass box is already open, so its End Pass button is right there: click it;
//  - the box is closed: one click on the student's button, then End Pass (and Close) when they show up.
// (Clicking the student's button while the box is open would close it again, which is why it's looked at first.)
const END_PASS = { classes: BUTTON, name: "End Pass", role: "button", tag: "button" };
const CLOSE = { classes: BUTTON, name: "Close", role: "button", tag: "button" };
const optional = (st) => ({ ...st, optional: true });
const endHallpass = hallpassSite(
  "hallpass",
  [step("click", "final", { ...END_PASS, near: "{student}" }), optional(step("click", "fixed", CLOSE))],
  [
    {
      steps: [
        step("click", "student", { classes: BUTTON, name: "{student}", role: "button", tag: "button" }),
        optional(step("click", "fixed", END_PASS, undefined, { commit: true })),
        optional(step("click", "fixed", CLOSE)),
      ],
    },
  ],
);

// On the home screen, the student's button opens the window, where the pass is ended.
const endWindow = popup(
  [
    step("click", "final", { classes: BUTTON, context: "Pass Details", name: "End Pass", role: "button", tag: "button", type: "submit" }),
    optional(step("click", "fixed", { classes: BUTTON, context: "Pass Details", name: "Close", role: "button", tag: "button" })),
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

// Puts the built-in steps, plus any other ways learned in Watch mode (`learned`), where every part of the
// extension reads them. Skipped when the browser tests bring their own steps (macrosOverride).
export async function installBuiltin() {
  const { macros, macrosOverride, learned } = await chrome.storage.local.get({ macros: {}, macrosOverride: false, learned: {} });
  if (macrosOverride) return;
  const want = withLearned(BUILTIN_MACROS, learned);
  if (JSON.stringify(macros) !== JSON.stringify(want)) await chrome.storage.local.set({ macros: want });
}
