// The ways a pass gets made on GoGuardian. The helper learns each one separately by watching the
// teacher do it once, and uses whichever taught page is open.
import { HALLPASS_HOST } from "./tabs.js";

// There are two ways a pass is made. `kind` matches the page kinds in tabs.js (pageKind): the
// second way starts on the GoGuardian home screen but the pass itself is made in the pop-up it opens.
export const METHODS = [
  {
    kind: "hallpass",
    name: "HallPass website",
    short: "HallPass website",
    where: "hallpass.goguardian.com/home",
    use: "You make passes on the HallPass website (hallpass.goguardian.com/home), in a normal browser tab.",
    closed: "Open the HallPass website (hallpass.goguardian.com/home) in a browser tab first.",
    steps: [
      "Stay on your HallPass tab. Make one real pass there, the way you always do, for any student.",
      "Go all the way through clicking Create.",
    ],
    end: {
      label: "on the HallPass website",
      steps: ["Stay on your HallPass tab. End a pass that's out, the way you always do, including any \"Are you sure?\" step."],
    },
  },
  {
    kind: "create",
    name: "GoGuardian home screen → Create Pass window",
    short: "Home screen → Create Pass window",
    where: "teacher.goguardian.com/classrooms/active, then the window it opens",
    use: "You click Create Pass on the GoGuardian home screen (teacher.goguardian.com/classrooms/active) and a small window opens where you make the pass.",
    closed: "Open the GoGuardian home screen (teacher.goguardian.com/classrooms/active) first, with the Create Pass window closed.",
    steps: [
      "Part 1, on the GoGuardian home screen: click Create Pass, just as you always do.",
      "Part 2 starts by itself when the small Create Pass window opens: make one real pass in that window, for any student, all the way through clicking Create.",
    ],
    end: {
      label: "from the home screen → pop-up",
      steps: [
        "Part 1, on the GoGuardian home screen: click the button that ends a pass (the one that opens the small window), just as you always do. Pick a pass that's out.",
        "Part 2 starts by itself when the small window opens: finish ending the pass in that window, including any \"Are you sure?\" step.",
      ],
    },
  },
];

export const method = (kind) => METHODS.find((m) => m.kind === kind);

// When more than one taught page is open, the helper tries them in this order.
export const SEND_ORDER = ["create", "hallpass"];
// Ending: the HallPass website needs no extra window, so it goes first.
export const END_ORDER = ["hallpass", "create"];

// Steps taught before the helper knew about several ways were saved as a single "create" with the
// site and window they were taught in.
export const kindOfMacro = (macro) => macro.kind ?? (macro.popup ? "create" : "hallpass");

// Every taught way to make a pass, as { kind: steps }.
export function makeMethods(macros) {
  const taught = { ...(macros?.make ?? {}) };
  if (macros?.create) taught[kindOfMacro(macros.create)] ??= macros.create;
  delete taught.home; // dropped: the home screen only opens the Create Pass window
  return taught;
}

// Every taught way to end a pass, as { kind: steps }. The single `end` from before is sorted by where it was taught.
export function endMethods(macros) {
  const taught = { ...(macros?.endVia ?? {}) };
  if (macros?.end) taught[kindOfMacro(macros.end)] ??= macros.end;
  return taught;
}

// Where steps taught for `kind` run. The Create Pass window can be on any GoGuardian address. Steps
// taught on HallPass run on the site they were taught on (the HallPass website, unless taught elsewhere).
export const methodPlace = (kind, macro) => ({
  kind: kind === "hallpass" ? "hallpass" : kind,
  host: kind === "hallpass" ? macro?.host ?? HALLPASS_HOST : undefined,
});

// The home screen page whose Create Pass button opens the window, if the helper was taught to click it.
export const openerPlace = (macro) => (macro?.opener ? { kind: "home", host: macro.opener.host } : null);
