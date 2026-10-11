import { goGuardianTab, hostOf, siteName } from "../lib/tabs.js";

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

// `host` is the site the steps were taught on (HallPass or GoGuardian's home screen), when it matters.
// `name` is what to call that site in messages.
export async function hallpassTab(host) {
  const tab = await goGuardianTab(host);
  if (!tab) return { state: "closed", name: siteName(host) };
  const pong = await chrome.tabs.sendMessage(tab.id, { type: "ping" }).catch(() => null);
  return { state: pong?.ok ? "ready" : "stale", tab, name: siteName(hostOf(tab.url)) };
}

// Sends a message to the GoGuardian tab the teacher used last, bringing it forward.
export async function askHallPass(message, host) {
  const { state, tab, name } = await hallpassTab(host);
  if (state !== "ready") {
    toast(state === "closed" ? `Open ${name} first.` : `Reload your ${name} tab first.`);
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
