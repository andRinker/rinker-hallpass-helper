// Runs the real HallPass Helper extension in Chromium against any exported scrubbed DOM snapshot (.html)
// and prints the extension's read-only self-check (dry-run) report.
// Usage: npm run test:snapshot -- path/to/hallpass-snapshot.html
import { chromium } from "playwright";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const snapPath = process.argv[2];
if (!snapPath) {
  console.error("Usage: npm run test:snapshot -- <path-to-scrubbed-snapshot.html>");
  process.exit(2);
}

const here = path.dirname(fileURLToPath(import.meta.url));
const extDir = path.resolve(here, "..");
const html = readFileSync(path.resolve(snapPath), "utf8");

// Read snapshot metadata embedded by content/snapshot.js.
const metaOf = (name, fallback = "") => {
  const m = html.match(new RegExp(`<meta\\s+name="${name}"\\s+content="([^"]*)"`, "i"));
  return m ? m[1] : fallback;
};

const rawHost = metaOf("hph-site", "campus.goguardian.com");
const host = /\.goguardian\.com$/i.test(rawHost) ? rawHost : "campus.goguardian.com";
const snapUrlPath = metaOf("hph-path", "/").startsWith("/") ? metaOf("hph-path", "/") : "/";
const isPopup = metaOf("hph-popup", "false") === "true";
const url = `https://${host}${snapUrlPath}`;

const ctx = await chromium.launchPersistentContext("", {
  channel: "chromium",
  executablePath: process.env.CHROMIUM_PATH,
  headless: true,
  args: [`--disable-extensions-except=${extDir}`, `--load-extension=${extDir}`],
  viewport: { width: 1200, height: 800 },
});

const errors = [];
try {
  await ctx.route("https://*.goguardian.com/**", (route) =>
    route.fulfill({ contentType: "text/html; charset=utf-8", body: html }),
  );

  const ours = (w) => w.url().endsWith("/background.js");
  const sw = ctx.serviceWorkers().find(ours) ?? (await ctx.waitForEvent("serviceworker", { predicate: ours }));
  for (let i = 0; i < 60; i++) {
    const ready = await sw.evaluate(async () => {
      if (!globalThis.chrome?.storage) return false;
      const { macros } = await chrome.storage.local.get({ macros: {} });
      return !!macros?.make?.hallpass;
    });
    if (ready) break;
    await new Promise((r) => setTimeout(r, 100));
  }

  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  await page.goto(url, { waitUntil: "domcontentloaded" });

  // Wait for content script ping, then run the read-only diagnose handler.
  let result = null;
  for (let i = 0; i < 40; i++) {
    result = await sw.evaluate(async ({ targetUrl, popup }) => {
      const tabs = await chrome.tabs.query({ url: "https://*.goguardian.com/*" });
      const tab = tabs.find((t) => t.url === targetUrl) ?? tabs[0];
      if (!tab) return null;
      return chrome.tabs.sendMessage(tab.id, { type: "diagnose", isPopup: popup }).catch(() => null);
    }, { targetUrl: url, popup: isPopup });
    if (result?.ok) break;
    await new Promise((r) => setTimeout(r, 150));
  }

  if (!result?.ok) {
    console.error("FAIL: extension did not reply to diagnose on snapshot");
    process.exit(1);
  }

  console.log(result.report);
  if (errors.length) {
    console.error("\nConsole errors:\n" + errors.join("\n"));
    process.exit(1);
  }
} finally {
  await ctx.close();
}
