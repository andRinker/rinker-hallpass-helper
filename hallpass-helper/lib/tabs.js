// Passes get made on HallPass itself and on GoGuardian's home screen, so the helper works in any
// GoGuardian tab. Taught steps remember which site and window they were taught in, and go back there.

export const HALLPASS_HOST = "hallpass.goguardian.com";
export const GOGUARDIAN_TABS = "https://*.goguardian.com/*";

const MARKETING_HOST = "www.goguardian.com";

export const hostOf = (url) => {
  try {
    return new URL(url).host;
  } catch {
    return "";
  }
};

// Where taught steps run: a site, and whether that was a pop-up window (such as the Create Pass
// window on the GoGuardian home screen, which lives on the HallPass site). Steps taught before the
// helper knew about other sites or pop-ups were all taught in a normal HallPass tab.
export const taughtPlace = (macro) => (macro ? { host: macro.host ?? HALLPASS_HOST, popup: !!macro.popup } : null);

export const capitalize = (text) => text.charAt(0).toUpperCase() + text.slice(1);

// What to call a place in messages.
export const siteName = (place) => {
  if (place?.kind) return { create: "the Create Pass window", hallpass: "HallPass", home: "GoGuardian" }[place.kind];
  return place?.popup ? "the Create Pass window" : !place?.host || place.host === HALLPASS_HOST ? "HallPass" : "GoGuardian";
};

export const appTabs = (tabs) =>
  tabs.filter((t) => hostOf(t.url).endsWith("goguardian.com") && hostOf(t.url) !== MARKETING_HOST);

// The most recently used GoGuardian tab. With a place, only a tab that fits it counts, so taught
// steps are never tried on a site or window they weren't taught in. `preferPopup` (used when
// teaching) takes an open pop-up over a normal tab. `popupWindowIds` are the ids of pop-up windows.
export function pickTab(tabs, place, popupWindowIds = new Set()) {
  const isPopup = (t) => popupWindowIds.has(t.windowId);
  const recent = appTabs(tabs).sort((a, b) => (b.lastAccessed ?? 0) - (a.lastAccessed ?? 0));
  if (!place) return recent[0] ?? null;
  // A place with a kind names one of the three pages (see pageKind), and on the same site if it has a host.
  if (place.kind) {
    return recent.find((t) => pageKind(t, popupWindowIds) === place.kind && (!place.host || hostOf(t.url) === place.host)) ?? null;
  }
  const fits = recent.filter(
    (t) => (!place.host || hostOf(t.url) === place.host) && (place.popup === undefined || isPopup(t) === place.popup),
  );
  return (place.preferPopup && fits.find(isPopup)) || fits[0] || null;
}

// Which of GoGuardian's pages a tab is: the Create Pass window (any pop-up), HallPass itself, or the
// home screen (any other GoGuardian page in a normal window).
export function pageKind(tab, popupIds = new Set()) {
  if (popupIds.has(tab.windowId)) return "create";
  return hostOf(tab.url) === HALLPASS_HOST ? "hallpass" : "home";
}

// Every open GoGuardian tab, including ones in pop-up windows (such as the Create Pass window).
export async function allGoGuardianTabs() {
  return appTabs(await chrome.tabs.query({ url: GOGUARDIAN_TABS }));
}

export async function popupWindowIds() {
  const windows = await chrome.windows.getAll().catch(() => []);
  return new Set(windows.filter((w) => w.type === "popup").map((w) => w.id));
}

export async function isPopupTab(tab) {
  return (await popupWindowIds()).has(tab.windowId);
}

export async function goGuardianTab(place) {
  return pickTab(await chrome.tabs.query({ url: GOGUARDIAN_TABS }), place, await popupWindowIds());
}
