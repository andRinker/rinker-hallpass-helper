// The setup guide in the side panel: which GoGuardian pages the helper can see, and the next thing
// to do. Pure, so it can be tested without a browser.
import { METHODS, endMethods, makeMethods } from "./methods.js";

export const PAGES = [
  { key: "hallpass", label: "HallPass website", how: "Way 1: open hallpass.goguardian.com/home in a browser tab." },
  { key: "home", label: "GoGuardian home screen", how: "Way 2: open teacher.goguardian.com/classrooms/active in a browser tab." },
  { key: "create", label: "Create Pass window", how: "Way 2: it opens when you click Create Pass on the home screen." },
];

// pages: { hallpass, home, create }, each "closed" | "stale" | "ready".
const open = (pages) => PAGES.filter((p) => pages[p.key] !== "closed");

export function guide({ settings, pages, teaching = false }) {
  const { macros = {}, destinations = [], school = "", teacherName = "", queue = [], outPasses = [] } = settings;
  const seen = open(pages);
  const stale = seen.filter((p) => pages[p.key] === "stale");
  const taught = makeMethods(macros);
  const untaught = METHODS.filter((m) => !taught[m.kind]);

  const steps = [
    {
      id: "open",
      title: "Open the page where you make passes",
      done: seen.length > 0 && stale.length === 0,
      lines: [
        "A pass can be made two ways, over three pages. The helper works with either way:",
        ...PAGES.map((p) => `${p.label}: ${p.how}`),
        "Teach the helper each way you make passes. It then uses whichever taught page is open.",
        ...stale.map((p) => `Reload the ${p.label}. The helper can't see it yet.`),
      ],
    },
    {
      id: "settings",
      title: "Fill in Settings",
      done: destinations.length > 0 && Boolean(school || teacherName),
      lines: [
        "Click Settings at the top.",
        "Type your school, your name, your room and your destinations exactly as GoGuardian shows them.",
        "Add your class lists too if you'd like name suggestions.",
      ],
    },
    {
      id: "make",
      title: "Teach it to make a pass",
      done: Object.keys(taught).length > 0,
      lines: teaching
        ? [
            "The helper is watching. Make one real pass on the page named at the top of the Teach card, the way you always do.",
            "Go all the way through clicking Create.",
            "Then click Done below, check the guesses and Save.",
          ]
        : [
            "The Teach card below has one button for each way a pass is made. Each button names the page it watches.",
            ...untaught.map((m) => `Teach: ${m.short} — ${m.use}`),
            "Open that page first, click its Teach button, then make one real pass all the way through Create. You can end it right after.",
            "Click Done, check the guesses and Save. Then do the next way you use, if any.",
          ],
    },
    {
      id: "end",
      title: "Teach it to end a pass",
      done: Object.keys(endMethods(macros)).length > 0,
      lines: teaching
        ? ["The helper is watching. End a pass the way you always do, including any \"Are you sure?\" step.", "Then click Done."]
        : [
            "The Teach card has an end-a-pass button for each way: on the HallPass website, or from the home screen → pop-up. Use the one you normally use.",
            "End a pass that's out, the way you always do, including any \"Are you sure?\" step. From the home screen, part 1 is the button that opens the small window.",
            "Click Done, then Save. Teach the other way too if you use it.",
          ],
    },
    {
      id: "send",
      title: "Send a student",
      done: queue.length > 0 || outPasses.length > 0,
      lines: ["Type a student's name in the Queue box and press Enter.", "The helper makes the pass for you and ends it when time is up."],
    },
  ];

  const current = steps.findIndex((s) => !s.done);
  return {
    steps: steps.map((s, i) => ({ ...s, active: i === current })),
    current,
    doneCount: steps.filter((s) => s.done).length,
    complete: current === -1,
    // The home screen counts as taught once the helper knows how to click Create Pass there.
    pages: PAGES.map((p) => ({ ...p, state: pages[p.key], taught: Boolean(p.key === "home" ? taught.create?.opener : taught[p.key]) })),
  };
}
