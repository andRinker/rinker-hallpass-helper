// Replays every frame of an exported scrubbed session or failure bundle (.json) in Chromium
// with the real unpacked HallPass Helper extension, verifying zero console errors and printing
// the read-only self-check (dry run) report for every captured GoGuardian screen.
// Usage: npm run test:bundle -- path/to/hallpass-session.json
import { chromium } from "playwright";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const bundlePath = process.argv[2];
if (!bundlePath) {
  console.error("Usage: npm run test:bundle -- <path-to-bundle.json>");
  process.exit(2);
}

const here = path.dirname(fileURLToPath(import.meta.url));
const extDir = path.resolve(here, "..");
const bundle = JSON.parse(readFileSync(path.resolve(bundlePath), "utf8"));

if (bundle?.format !== "hallpass-helper-bundle" || !Array.isArray(bundle.frames) || !bundle.frames.length) {
  console.error("FAIL: file is not a valid hallpass-helper-bundle with frames");
  process.exit(1);
}

const ctx = await chromium.launchPersistentContext("", {
  channel: "chromium",
  executablePath: process.env.CHROMIUM_PATH,
  headless: true,
  args: [`--disable-extensions-except=${extDir}`, `--load-extension=${extDir}`],
  viewport: { width: 1200, height: 800 },
});

const errors = [];
try {
  let currentHtml = "";
  await ctx.route("https://*.goguardian.com/**", (route) =>
    route.fulfill({ contentType: "text/html; charset=utf-8", body: currentHtml }),
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

  console.log(`Bundle: ${bundle.kind ?? "session"} · ${bundle.frames.length} frame(s) · clean=${bundle.summary?.clean}`);
  for (let idx = 0; idx < bundle.frames.length; idx++) {
    const frame = bundle.frames[idx];
    const rawHost = frame.meta?.host ?? "campus.goguardian.com";
    const host = /\.goguardian\.com$/i.test(rawHost) ? rawHost : "campus.goguardian.com";
    const rawPath = frame.meta?.path ?? "/";
    const snapPath = rawPath.startsWith("/") ? rawPath : "/";
    const isPopup = !!frame.meta?.isPopup;
    const url = `https://${host}${snapPath}`;
    currentHtml = frame.html ?? "";

    await page.goto(url, { waitUntil: "domcontentloaded" });
    let diag = null;
    for (let t = 0; t < 40; t++) {
      diag = await sw.evaluate(async ({ targetUrl, popup }) => {
        const tabs = await chrome.tabs.query({ url: "https://*.goguardian.com/*" });
        const tab = tabs.find((x) => x.url === targetUrl) ?? tabs[0];
        if (!tab) return null;
        return chrome.tabs.sendMessage(tab.id, { type: "diagnose", isPopup: popup }).catch(() => null);
      }, { targetUrl: url, popup: isPopup });
      if (diag?.ok) break;
      await new Promise((r) => setTimeout(r, 120));
    }

    if (!diag?.ok) {
      console.error(`FAIL: frame ${idx + 1} did not respond to diagnose`);
      process.exit(1);
    }

    console.log(`\n===== Frame ${idx + 1} of ${bundle.frames.length}: ${frame.trigger || "(no trigger)"} =====`);
    console.log(diag.report);
  }

  if (errors.length) {
    console.error("\nConsole errors:\n" + errors.join("\n"));
    process.exit(1);
  }
} finally {
  await ctx.close();
}
