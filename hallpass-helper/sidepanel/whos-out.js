// Who's Out: passes made through the helper, with timers and a Back button.
import { saveSettings } from "../lib/storage.js";
import { taughtHost } from "../lib/tabs.js";
import { $, askHallPass, h, stuckMessage, toast } from "./shared.js";

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
  const result = await askHallPass({ type: "end-pass", id: pass.id }, taughtHost(getSettings().macros.end));
  ending.delete(pass.id);
  renderWhosOut();
  if (!result) return;
  if (result.ok) toast(`${pass.label} is back.`);
  else toast(`${stuckMessage(result.failed?.[0] ?? result)} If you ended it yourself, use × to clear it.`);
}

export function renderWhosOut() {
  const { outPasses = [], overdueMinutes = 10 } = getSettings();
  const now = Date.now();
  const rows = [...outPasses]
    .sort((a, b) => a.startedAt - b.startedAt)
    .map((pass) => {
      const minutes = Math.floor((now - pass.startedAt) / 60000);
      const busy = ending.has(pass.id);
      return h(
        "div",
        { class: `out-row${minutes >= overdueMinutes ? " overdue" : ""}` },
        h("div", { class: "who" }, h("strong", {}, pass.label), pass.destination ? h("span", { class: "muted" }, pass.destination) : null),
        h("span", { class: "timer" }, `${minutes} min`),
        h("button", { class: "primary", type: "button", disabled: busy, onclick: () => back(pass) }, busy ? "Ending…" : "Back"),
        h("button", { class: "link remove", type: "button", title: "Remove from this list", "aria-label": `Remove ${pass.label} from this list`, onclick: () => remove(pass) }, "×"),
      );
    });
  $("outList").replaceChildren(...rows);
  $("outEmpty").hidden = rows.length > 0;
  $("outCount").textContent = rows.length ? `(${rows.length})` : "";
}
