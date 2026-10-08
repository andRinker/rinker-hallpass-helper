import { HALLPASS_URL } from "../lib/storage.js";

export const $ = (id) => document.getElementById(id);

// Tiny element builder: h("button", { class: "primary", onclick }, "Save")
export function h(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value === undefined || value === false) continue;
    if (key.startsWith("on")) node.addEventListener(key.slice(2), value);
    else if (key === "class") node.className = value;
    else node.setAttribute(key, value === true ? "" : value);
  }
  node.append(...children.flat().filter((c) => c !== null && c !== undefined && c !== false));
  return node;
}

export async function hallpassTab() {
  const [tab] = await chrome.tabs.query({ url: `${HALLPASS_URL}*` });
  if (!tab) return { state: "closed" };
  const pong = await chrome.tabs.sendMessage(tab.id, { type: "ping" }).catch(() => null);
  return { state: pong?.ok ? "ready" : "stale", tab };
}

// Brings the HallPass tab forward and sends it a message. Background tabs run timers slowly,
// so anything that clicks through HallPass should happen with the tab showing.
export async function askHallPass(message) {
  const { state, tab } = await hallpassTab();
  if (state !== "ready") {
    toast(state === "closed" ? "Open HallPass first." : "Reload your HallPass tab first.");
    return null;
  }
  await chrome.tabs.update(tab.id, { active: true });
  return chrome.tabs.sendMessage(tab.id, message).catch(() => ({ ok: false, reason: "no-reply" }));
}

export function stuckMessage(result) {
  switch (result?.reason) {
    case "busy":
      return "Still working on the last one…";
    case "ambiguous":
      return "More than one student matches. Pick the right one in HallPass.";
    case "stuck":
      return `Got stuck at step ${result.step} (${result.label}). Try re-teaching, or copy the page outline for Claude.`;
    default:
      return "Something went wrong in HallPass. Check the HallPass tab.";
  }
}

let toastTimer;
export function toast(message) {
  $("toast").textContent = message;
  $("toast").hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => ($("toast").hidden = true), 6000);
}
