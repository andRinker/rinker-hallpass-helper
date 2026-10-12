// The ways a pass gets made on GoGuardian. The helper learns each one separately by watching the
// teacher do it once, and uses whichever taught page is open.
import { HALLPASS_HOST } from "./tabs.js";

// `kind` matches the page kinds in tabs.js (pageKind).
export const METHODS = [
  {
    kind: "hallpass",
    name: "HallPass website",
    use: "You make passes on the HallPass website itself (hallpass.goguardian.com), in a normal browser tab.",
    closed: "Open the HallPass website in a browser tab first.",
    steps: [
      "Look at your HallPass tab. Make one real pass there, the way you always do, for any student.",
      "Go all the way through clicking Create.",
    ],
  },
  {
    kind: "create",
    name: "Create Pass window",
    use: "You click Create Pass on the GoGuardian home screen and a small window opens.",
    closed: "Click Create Pass on the GoGuardian home screen first, so the Create Pass window is open.",
    steps: [
      "Look at the small Create Pass window. Make one real pass in it, the way you always do, for any student.",
      "Go all the way through clicking Create.",
    ],
  },
  {
    kind: "home",
    name: "GoGuardian home screen",
    use: "You make a pass right on the GoGuardian home screen itself, not in the small Create Pass window.",
    closed: "Open the GoGuardian home screen in a browser tab first.",
    steps: [
      "Look at the GoGuardian home screen tab. Make one real pass right on that page, the way you always do, for any student.",
      "Go all the way through clicking Create.",
    ],
  },
];

export const method = (kind) => METHODS.find((m) => m.kind === kind);

// When more than one taught page is open, the helper tries them in this order.
export const SEND_ORDER = ["create", "hallpass", "home"];

// Steps taught before the helper knew about several ways were saved as a single "create" with the
// site and window they were taught in.
export const kindOfMacro = (macro) =>
  macro.kind ?? (macro.popup ? "create" : (macro.host ?? HALLPASS_HOST) === HALLPASS_HOST ? "hallpass" : "home");

// Every taught way to make a pass, as { kind: steps }.
export function makeMethods(macros) {
  const taught = { ...(macros?.make ?? {}) };
  if (macros?.create) taught[kindOfMacro(macros.create)] ??= macros.create;
  return taught;
}

// Where steps taught for `kind` run. The Create Pass window can be on any GoGuardian address; the
// home screen has to be the same site it was taught on, so steps never run on a page they weren't taught on.
export const methodPlace = (kind, macro) => ({
  kind,
  host: kind === "hallpass" ? HALLPASS_HOST : kind === "home" ? macro?.host : undefined,
});
