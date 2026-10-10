// Out now: passes the helper made, with timers, a Back button, and a × for passes ended elsewhere.
import { saveSettings } from "../lib/storage.js";
import { endsAt } from "../lib/queue.js";
import { $, h, toast } from "./shared.js";

let getSettings = () => ({});
const ending = new Set();

export function initWhosOut(settingsGetter) {
  getSettings = settingsGetter;
}

async function remove(pass) {
  const { outPasses } = getSettings();
  await saveSettings({ outPasses: outPasses.filter((p) => p.id !== pass.id) });
}

async function back(pass) {
  if (!getSettings().macros.end) {
    await remove(pass);
    toast("Cleared from this list. Teach the helper how you end a pass so Back ends it in HallPass too.");
    return;
  }
  ending.add(pass.id);
  renderWhosOut();
  // The background does the clicking, so it never collides with the queue sending someone.
  const result = await chrome.runtime.sendMessage({ type: "end-now", id: pass.id }).catch(() => null);
  ending.delete(pass.id);
  renderWhosOut();
  if (result?.ok) toast(`${pass.label} is back.`);
  else toast("Couldn't end it in HallPass. If you ended it yourself, use × to clear it.");
}

export function renderWhosOut() {
  const { outPasses = [], autoEndMinutes = 7 } = getSettings();
  const now = Date.now();
  const rows = [...outPasses]
    .sort((a, b) => a.startedAt - b.startedAt)
    .map((pass) => {
      const minutes = Math.floor((now - pass.startedAt) / 60000);
      const left = Math.max(0, Math.ceil((endsAt(pass, autoEndMinutes) - now) / 60000));
      const busy = ending.has(pass.id);
      const timer = pass.endFailed ? `${minutes} min` : `${minutes} min · ends in ${left}`;
      return h(
        "div",
        { class: `out-row${pass.endFailed ? " overdue" : ""}` },
        h(
          "div",
          { class: "who" },
          h("strong", {}, pass.label),
          pass.endFailed
            ? h("span", { class: "problem" }, `Not ended in HallPass. ${pass.endFailed}`)
            : pass.destination
              ? h("span", { class: "muted" }, pass.destination)
              : null,
        ),
        h("span", { class: "timer" }, timer),
        h("button", { class: "primary", type: "button", disabled: busy, onclick: () => back(pass) }, busy ? "Ending…" : "Back"),
        h(
          "button",
          {
            class: "link remove",
            type: "button",
            title: "Clear from this list (when you ended it in HallPass yourself)",
            "aria-label": `Clear ${pass.label} from this list`,
            onclick: () => remove(pass),
          },
          "×",
        ),
      );
    });
  $("outList").replaceChildren(...rows);
  $("outEmpty").hidden = rows.length > 0;
  $("outCount").textContent = rows.length ? `(${rows.length})` : "";
}
