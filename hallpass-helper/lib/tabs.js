// Passes get made on HallPass itself and on GoGuardian's home screen, so the helper works in any
// GoGuardian tab. Taught steps remember which site they were taught on, and go back to that site.

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

// Steps taught before the helper knew about other sites were all taught on HallPass.
export const taughtHost = (macro) => (macro ? (macro.host ?? HALLPASS_HOST) : null);

// What to call a site in messages: HallPass itself, or GoGuardian for its home screen.
export const siteName = (host) => (!host || host === HALLPASS_HOST ? "HallPass" : "GoGuardian");

// The most recently used GoGuardian tab. With `host`, only a tab on that site counts, so taught
// steps are never tried on a site they weren't taught on.
export function pickTab(tabs, host) {
  const recent = tabs
    .filter((t) => hostOf(t.url).endsWith("goguardian.com") && hostOf(t.url) !== MARKETING_HOST)
    .sort((a, b) => (b.lastAccessed ?? 0) - (a.lastAccessed ?? 0));
  return (host ? recent.find((t) => hostOf(t.url) === host) : recent[0]) ?? null;
}

export async function goGuardianTab(host) {
  return pickTab(await chrome.tabs.query({ url: GOGUARDIAN_TABS }), host);
}
