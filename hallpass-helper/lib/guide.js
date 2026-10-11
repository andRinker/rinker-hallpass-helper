// The setup guide in the side panel: which GoGuardian pages the helper can see, and the next thing
// to do. Pure, so it can be tested without a browser.

export const PAGES = [
  { key: "hallpass", label: "HallPass website", how: "Open HallPass in a browser tab." },
  { key: "home", label: "GoGuardian home screen", how: "Open GoGuardian in a browser tab." },
  { key: "create", label: "Create Pass window", how: "Click Create Pass on the GoGuardian home screen." },
];

// pages: { hallpass, home, create }, each "closed" | "stale" | "ready".
const open = (pages) => PAGES.filter((p) => pages[p.key] !== "closed");

export function guide({ settings, pages, teaching = false }) {
  const { macros = {}, destinations = [], school = "", teacherName = "", queue = [], outPasses = [] } = settings;
  const seen = open(pages);
  const stale = seen.filter((p) => pages[p.key] === "stale");

  const steps = [
    {
      id: "open",
      title: "Open the page where you make passes",
      done: seen.length > 0 && stale.length === 0,
      lines: [
        "GoGuardian has three places to make a pass. The helper works in any of them:",
        ...PAGES.map((p) => `${p.label}: ${p.how}`),
        "Use the one you normally use. You only teach the helper in that one.",
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
      done: Boolean(macros.create),
      lines: teaching
        ? [
            "The helper is watching. Make one real pass in GoGuardian now, the way you always do.",
            "Go all the way through clicking Create.",
            "Then click Done below, check the guesses and Save.",
          ]
        : [
            "Click Teach: make a pass below.",
            "Make one real pass the way you always do, all the way through clicking Create. It makes a real pass, and you can end it right after.",
            "Click Done, check the guesses and Save.",
            ...(pages.create === "closed" && pages.home !== "closed"
              ? ["To teach in the Create Pass window, click Create Pass on the home screen first so the window is open."]
              : []),
          ],
    },
    {
      id: "end",
      title: "Teach it to end a pass",
      done: Boolean(macros.end),
      lines: teaching
        ? ["The helper is watching. End a pass the way you always do, including any \"Are you sure?\" step.", "Then click Done."]
        : [
            "Click Teach: end a pass below.",
            "End a pass that's out, the way you always do, including any \"Are you sure?\" step.",
            "Click Done, then Save.",
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
