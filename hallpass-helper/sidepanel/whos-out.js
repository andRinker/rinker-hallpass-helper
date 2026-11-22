// Out now: passes the helper made, with timers, a Back/Cancel button, and a × for passes ended elsewhere.
import { saveSettings } from "../lib/storage.js";
import { endsAt, isWaitingPass } from "../lib/queue.js";
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
  const waiting = isWaitingPass(pass);
  if (!waiting && !getSettings().macros.end) {
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
  if (result?.ok) toast(waiting ? `${pass.label}'s waiting pass was cancelled.` : `${pass.label} is back.`);
  else toast(waiting ? "Couldn't cancel the waiting pass in HallPass. Use × to clear it." : "Couldn't end it in HallPass. If you ended it yourself, use × to clear it.");
}

export function renderWhosOut() {
  const { outPasses = [], autoEndMinutes = 7 } = getSettings();
  const now = Date.now();
  const sortKey = (p) => p.startedAt ?? p.queuedInHallPassAt ?? 0;
  const rows = [...outPasses]
    .sort((a, b) => sortKey(a) - sortKey(b))
    .map((pass) => {
      const waiting = isWaitingPass(pass);
      const busy = ending.has(pass.id);
      let timer;
      let sub;
      if (waiting) {
        const waited = Math.max(0, Math.floor((now - (pass.queuedInHallPassAt ?? now)) / 60000));
        timer = `Waiting ${waited}m · timer held`;
        const badge = `Waiting in HallPass${pass.etaText ? ` (${pass.etaText})` : ""}`;
        sub = h(
          "span",
          { class: "waiting-tag" },
          pass.destination ? `${pass.destination} · ${badge}` : badge,
        );
      } else {
        const minutes = Math.floor((now - pass.startedAt) / 60000);
        const left = Math.max(0, Math.ceil((endsAt(pass, autoEndMinutes) - now) / 60000));
        timer = pass.endFailed ? `${minutes} min` : `${minutes} min · ends in ${left}`;
        sub = pass.endFailed
          ? h("span", { class: "problem" }, `Not ended in HallPass. ${pass.endFailed}`)
          : pass.destination
            ? h("span", { class: "muted" }, pass.destination)
            : null;
      }
      const rowClass = `out-row${pass.endFailed ? " overdue" : waiting ? " waiting" : ""}`;
      const actionLabel = waiting ? (busy ? "Cancelling…" : "Cancel") : busy ? "Ending…" : "Back";
      return h(
        "div",
        { class: rowClass },
        h("div", { class: "who" }, h("strong", {}, pass.label), sub),
        h("span", { class: "timer" }, timer),
        h("button", { class: waiting ? "" : "primary", type: "button", disabled: busy, onclick: () => back(pass) }, actionLabel),
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
