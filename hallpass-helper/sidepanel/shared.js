import { goGuardianTab, siteName } from "../lib/tabs.js";

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

// `place` is where the steps were taught: { host, popup } (see taughtPlace), when it matters.
// `name` is what to call that place in messages.
export async function hallpassTab(place) {
  const tab = await goGuardianTab(place);
  if (!tab) return { state: "closed", name: siteName(place) };
  const pong = await chrome.tabs.sendMessage(tab.id, { type: "ping" }).catch(() => null);
  return { state: pong?.ok ? "ready" : "stale", tab, name: siteName(place) };
}

// Sends a message to the GoGuardian tab the teacher used last, bringing it forward.
export async function askHallPass(message, place) {
  const { state, tab, name } = await hallpassTab(place);
  if (state !== "ready") {
    toast(state === "closed" ? `Open ${name} first.` : `Reload ${name} first.`);
    return null;
  }
  await chrome.tabs.update(tab.id, { active: true });
  return chrome.tabs.sendMessage(tab.id, message).catch(() => ({ ok: false, reason: "no-reply" }));
}

let toastTimer;
export function toast(message) {
  $("toast").textContent = message;
  $("toast").hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => ($("toast").hidden = true), 6000);
}
