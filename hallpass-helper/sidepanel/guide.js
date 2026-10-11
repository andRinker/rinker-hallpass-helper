// The setup guide card: shows which GoGuardian pages the helper can see and the next step to do.
import { guide } from "../lib/guide.js";
import { allGoGuardianTabs, pageKind, popupWindowIds } from "../lib/tabs.js";
import { $, h } from "./shared.js";

const PAGE_STATE = { ready: "✓ Helper can see it", stale: "Reload it so the helper can see it", closed: "Not open" };
let expanded = null; // null: follow the setup progress. true/false: the teacher chose.

async function scanPages() {
  const pages = { hallpass: "closed", home: "closed", create: "closed" };
  const popups = await popupWindowIds();
  for (const tab of await allGoGuardianTabs()) {
    const kind = pageKind(tab, popups);
    const pong = await chrome.tabs.sendMessage(tab.id, { type: "ping" }).catch(() => null);
    if (pong?.ok) pages[kind] = "ready";
    else if (pages[kind] === "closed") pages[kind] = "stale";
  }
  return pages;
}

let latest = 0;

export async function renderGuide(settings, teaching) {
  if (!settings) return;
  const ticket = ++latest;
  const g = guide({ settings, pages: await scanPages(), teaching });
  if (ticket !== latest) return; // a newer render started while this one was looking at the pages
  const open = expanded ?? !g.complete;

  const body = h(
    "div",
    { class: "guide-body" },
    h("h3", {}, "Pages the helper can see"),
    h(
      "ul",
      { class: "guide-pages" },
      g.pages.map((p) => h("li", { "data-state": p.state }, h("strong", {}, p.label), h("span", {}, PAGE_STATE[p.state]))),
    ),
    h("h3", {}, g.complete ? "All set up" : `Setup: ${g.doneCount} of ${g.steps.length} done`),
    h(
      "ol",
      { class: "guide-steps" },
      g.steps.map((s) =>
        h(
          "li",
          { class: s.done ? "done" : s.active ? "active" : "later" },
          h("div", { class: "guide-title" }, `${s.done ? "✓ " : ""}${s.title}`),
          s.active ? h("ul", {}, s.lines.map((line) => h("li", {}, line))) : null,
        ),
      ),
    ),
    h(
      "div",
      { class: "guide-stuck" },
      h("h3", {}, "Stuck? Send Claude what the helper sees"),
      h(
        "ol",
        {},
        h("li", {}, "Open the page that's giving trouble. For the Create Pass window, click Create Pass first so it's open."),
        h("li", {}, "Click Copy outline of open GoGuardian pages at the bottom of this panel."),
        h("li", {}, "Look it over (names are hidden), click Copy, and paste it into your chat with Claude."),
      ),
    ),
  );

  const details = h(
    "details",
    { class: "guide-card", open: open ? true : undefined },
    h("summary", {}, g.complete ? "Help and setup guide" : `Getting set up (${g.doneCount} of ${g.steps.length})`),
    body,
  );
  // The click lands before the panel flips, so the teacher's choice is the opposite of how it is now.
  details.querySelector("summary").addEventListener("click", () => (expanded = !details.open));
  $("guide").replaceChildren(details);
}
