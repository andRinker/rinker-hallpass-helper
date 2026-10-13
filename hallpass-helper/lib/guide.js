// The setup guide in the side panel: which GoGuardian pages the helper can see, and the next thing
// to do. Pure, so it can be tested without a browser.

export const PAGES = [
  { key: "hallpass", label: "HallPass website", how: "Way 1: open hallpass.goguardian.com/home in a browser tab." },
  { key: "home", label: "GoGuardian home screen", how: "Way 2: open teacher.goguardian.com/classrooms/active in a browser tab." },
  { key: "create", label: "Create Pass window", how: "Way 2: it opens when you click Create Pass on the home screen." },
];

// pages: { hallpass, home, create }, each "closed" | "stale" | "ready".
const open = (pages) => PAGES.filter((p) => pages[p.key] !== "closed");

export function guide({ settings, pages }) {
  const { macros = {}, destinations = [], school = "", teacherName = "", queue = [], outPasses = [] } = settings;
  const seen = open(pages);
  const stale = seen.filter((p) => pages[p.key] === "stale");

  const steps = [
    {
      id: "open",
      title: "Open the page where you make passes",
      done: seen.length > 0 && stale.length === 0,
      lines: [
        "A pass can be made two ways, over three pages. The helper knows both:",
        ...PAGES.map((p) => `${p.label}: ${p.how}`),
        "Use the switch under the status line to pick the way you make passes. The helper uses only that way.",
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
    pages: PAGES.map((p) => ({ ...p, state: pages[p.key] })),
  };
}
