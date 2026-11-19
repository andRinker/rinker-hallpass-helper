// The setup guide in the side panel: which GoGuardian pages the helper can see, and the next thing
// to do. Pure, so it can be tested without a browser.

import { chosenLane } from "./methods.js";

export const PAGES = [
  { key: "hallpass", label: "HallPass website", how: "Way 1: open campus.goguardian.com in a browser tab." },
  { key: "home", label: "GoGuardian home screen", how: "Way 2: open teacher.goguardian.com/classrooms/active in a browser tab." },
  { key: "create", label: "Create Pass window", how: "Way 2: it opens when you click Create Pass on the home screen." },
];

// The pages each way needs open ahead of time. The Create Pass window isn't one: the helper opens it
// from the home screen when it makes a pass, so it's never required. The way not chosen is asleep and
// none of its pages are needed.
const NEEDED = { hallpass: ["hallpass"], create: ["home"] };

// pages: { hallpass, home, create }, each "closed" | "stale" | "ready".

export function guide({ settings, pages }) {
  const { macros = {}, destinations = [], school = "", teacherName = "", queue = [], outPasses = [] } = settings;
  const lane = chosenLane(settings);
  const needed = PAGES.filter((p) => NEEDED[lane].includes(p.key));
  const seen = needed.filter((p) => pages[p.key] !== "closed");
  const stale = seen.filter((p) => pages[p.key] === "stale");

  const steps = [
    {
      id: "open",
      title: "Open the page where you make passes",
      done: seen.length > 0 && stale.length === 0,
      lines: [
        "You're making passes through the switch's chosen way, so only these pages are needed:",
        ...needed.map((p) => `${p.label}: ${p.how}`),
        "To use the other way instead, change the switch under the status line. The way you don't pick sleeps and its pages aren't needed.",
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
    lane,
    pages: PAGES.map((p) => ({ ...p, state: needed.includes(p) ? pages[p.key] : p.key === "create" && lane === "create" ? pages[p.key] : "off" })),
  };
}
