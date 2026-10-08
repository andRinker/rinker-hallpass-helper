// End-to-end check: loads the real extension in Chromium against e2e/mock-hallpass.html served at
// hallpass.goguardian.com, teaches it to make and end a pass, then uses it like a teacher would.
// Run with: npm run test:e2e   (needs the `playwright` package and its Chromium)
import { chromium } from "playwright";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const extDir = path.resolve(here, "..");
const mockHtml = readFileSync(path.join(here, "mock-hallpass.html"), "utf8");
const shotsDir = process.env.E2E_SHOTS;

let failures = 0;
function check(ok, what, detail = "") {
  console.log(`${ok ? "ok  " : "FAIL"} ${what}${!ok && detail ? `\n     ${detail}` : ""}`);
  if (!ok) failures++;
}
const until = async (fn, what, ms = 15000) => {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw new Error(`Timed out waiting for: ${what}`);
    await new Promise((r) => setTimeout(r, 100));
  }
};

const ctx = await chromium.launchPersistentContext("", {
  channel: "chromium",
  executablePath: process.env.CHROMIUM_PATH,
  headless: true,
  args: [`--disable-extensions-except=${extDir}`, `--load-extension=${extDir}`],
  viewport: { width: 1100, height: 800 },
});
const errors = [];
const watch = (page, name) => {
  page.on("console", (m) => m.type() === "error" && errors.push(`${name}: ${m.text()}`));
  page.on("pageerror", (e) => errors.push(`${name}: ${e.message}`));
};

try {
  await ctx.route("https://hallpass.goguardian.com/**", (route) =>
    route.fulfill({ contentType: "text/html", body: mockHtml }),
  );
  const ours = (w) => w.url().endsWith("/background.js");
  const sw = ctx.serviceWorkers().find(ours) ?? (await ctx.waitForEvent("serviceworker", { predicate: ours }));
  // The worker can show up a moment before Chrome attaches the extension APIs to it.
  await until(() => sw.evaluate(() => !!globalThis.chrome?.storage && !!chrome.notifications), "extension APIs");
  const base = `chrome-extension://${new URL(sw.url()).host}`;
  const storage = (keys = null) => sw.evaluate((k) => chrome.storage.local.get(k), keys);

  // Record notifications instead of only showing them.
  await sw.evaluate(() => {
    self.__notes = [];
    const create = chrome.notifications.create.bind(chrome.notifications);
    chrome.notifications.create = (opts, ...rest) => {
      self.__notes.push(opts);
      return create(opts, ...rest);
    };
  });
  await sw.evaluate(() =>
    chrome.storage.local.set({
      school: "Middle School South",
      teacherName: "Ms. Rivera",
      origin: "Room 112",
      destinations: ["6th Grade Bathroom", "Nurse", "Library"],
      rosterText: "",
      roster: [
        { first: "Jordan", last: "Miller", period: null },
        { first: "Jordan", last: "Martinez", period: null },
        { first: "Jordan", last: "Moore", period: null },
        { first: "Ava", last: "Lee", period: null },
        { first: "Sam", last: "Cho", period: null },
      ],
      endAtBell: true,
      overdueMinutes: 10,
    }),
  );

  const hp = await ctx.newPage();
  watch(hp, "hallpass");
  await hp.goto("https://hallpass.goguardian.com/");
  const panel = await ctx.newPage();
  watch(panel, "panel");
  await panel.setViewportSize({ width: 380, height: 900 });
  await panel.goto(`${base}/sidepanel/sidepanel.html`);
  await panel.waitForSelector('#hallpass[data-state="ready"]');
  const panelText = (sel) => panel.textContent(sel);
  const toast = async (re) => until(async () => re.test((await panelText("#toast")) ?? ""), `toast ${re}`);
  const clearToast = () => panel.evaluate(() => (document.querySelector("#toast").textContent = ""));

  // --- Teach: make a pass ---
  await panel.getByRole("button", { name: "Teach: make a pass" }).click();
  await panel.waitForSelector('#teach[data-mode="recording"]');
  await hp.click("#newPass");
  await hp.click('[role=combobox][aria-label="Site"]');
  await hp.click('[role=option]:text("Middle School South")');
  await hp.locator(".student-search").pressSequentially("jor", { delay: 60 });
  await hp.click('.results [role=option]:has-text("Jordan Miller")');
  await hp.selectOption('select[aria-label="Teacher"]', { label: "Ms. Rivera" });
  await hp.click('.chip:text("6th Grade Bathroom")');
  await hp.click('button:text("Create Pass")');
  await until(async () => /8 steps/.test(await panelText("#teach")), "8 recorded steps");
  await panel.getByRole("button", { name: "Done" }).click();
  await panel.waitForSelector('#teach[data-mode="review"]');
  const roles = await panel.$$eval("#teach .steps select", (els) => els.map((e) => e.value));
  check(
    JSON.stringify(roles) === JSON.stringify(["fixed", "fixed", "fixed", "student", "student", "fixed", "destination", "final"]),
    "teach: guessed the student, destination and final steps",
    JSON.stringify(roles),
  );
  if (shotsDir) await panel.screenshot({ path: `${shotsDir}/review.png`, fullPage: true });
  await panel.getByRole("button", { name: "Save" }).click();
  const { macros } = await storage("macros");
  check(macros.create?.steps.length === 8, "teach: create steps saved");
  check(!/jordan|miller/i.test(JSON.stringify(macros.create)), "teach: no student name saved in the steps");

  // --- Teach: end a pass (end the real pass made while teaching) ---
  await panel.getByRole("button", { name: "Teach: end a pass" }).click();
  await panel.waitForSelector('#teach[data-mode="recording"]');
  await hp.click('.card .name:text("Jordan Miller")');
  await hp.click('.card.expanded button:text("End Pass")');
  await hp.click('button:text("Yes, end it")');
  await until(async () => /3 steps/.test(await panelText("#teach")), "3 recorded steps");
  await panel.getByRole("button", { name: "Done" }).click();
  const endRoles = await panel.$$eval("#teach .steps select", (els) => els.map((e) => e.value));
  check(JSON.stringify(endRoles) === JSON.stringify(["student", "fixed", "fixed"]), "teach end: guessed roles", JSON.stringify(endRoles));
  await panel.getByRole("button", { name: "Save" }).click();
  await until(async () => /Knows how to make and end/.test(await panelText("#teach")), "taught both");

  // --- One-tap pass with a different student and destination ---
  await panel.click('#destinations button:text("Nurse")');
  await clearToast();
  await panel.click('#students button:text("Jordan Ma.")');
  await toast(/click "Create Pass"/);
  const form = await hp.evaluate(() => {
    const f = window.__mock.form;
    return f && { site: f.site, student: `${f.student?.first} ${f.student?.last}`, teacher: f.teacher, dest: f.dest };
  });
  check(
    JSON.stringify(form) ===
      JSON.stringify({ site: "Middle School South", student: "Jordan Martinez", teacher: "r", dest: "Nurse" }),
    "replay: filled the form for Jordan Martinez (search fell back to last name)",
    JSON.stringify(form),
  );
  const outlined = await hp.$eval("button.create", (b) => b.style.outline);
  check(/solid/.test(outlined), "replay: stopped at Create Pass and outlined it");
  if (shotsDir) await hp.screenshot({ path: `${shotsDir}/stopped-at-create.png` });
  await hp.click("button.create");
  await until(async () => (await storage("outPasses")).outPasses.length === 1, "pass added to Who's Out");
  await until(async () => /Jordan Ma\./.test(await panelText("#outList")), "Who's Out shows Jordan Ma.");
  check(true, "who's out: pass appears after clicking Create");

  // --- Same name twice in the school: stop and let the teacher pick ---
  await clearToast();
  await panel.click('#students button:text("Sam C.")');
  await toast(/More than one student matches/);
  const badges = await hp.$$eval("[data-hph-ui]", (els) => els.map((e) => e.textContent));
  check(badges.length === 2 && badges.every((t) => t === "Which one?"), "replay: two Sam Chos highlighted", JSON.stringify(badges));
  await hp.click("button.cancel");

  // --- Back ends it in HallPass ---
  await clearToast();
  await panel.getByRole("button", { name: "Back" }).click();
  await toast(/Jordan Ma\. is back/);
  const afterBack = await hp.evaluate(() => window.__mock.passes.map((p) => p.student.last));
  check(!afterBack.includes("Martinez"), "back: pass ended in HallPass", JSON.stringify(afterBack));
  check((await storage("outPasses")).outPasses.length === 0, "back: removed from Who's Out");

  // --- Two more passes; open one card so two End buttons are visible during the bell ---
  for (const [chip, dest] of [["Ava L.", "Library"], ["Jordan Mo.", "Nurse"]]) {
    await panel.click(`#destinations button:text("${dest}")`);
    await clearToast();
    await panel.click(`#students button:text("${chip}")`);
    await toast(/click "Create Pass"/);
    await hp.click("button.create");
  }
  await until(async () => (await storage("outPasses")).outPasses.length === 2, "two passes out");
  const alarms = await sw.evaluate(() => chrome.alarms.getAll());
  check(alarms.filter((a) => a.name.startsWith("overdue:")).length === 2, "overdue: an alarm per pass", JSON.stringify(alarms));
  await hp.click('.card .name:text("Jordan Moore")');

  // --- Name-free outline, with the search showing a student who isn't on the roster ---
  await hp.click("#newPass");
  await hp.locator(".student-search").pressSequentially("h", { delay: 50 });
  await hp.waitForSelector('.results [role=option]:has-text("Hunter Hall")');
  await panel.click("#outlineButton");
  await panel.waitForSelector("#outlineBox:not([hidden])");
  const outline = await panel.inputValue("#outlineText");
  const leaked = ["Jordan", "Miller", "Martinez", "Moore", "Ava", "Lee", "Sam", "Cho", "Hunter", "Okafor"].filter((n) =>
    new RegExp(`\\b${n}\\b`, "i").test(outline),
  );
  check(leaked.length === 0, "outline: no student or staff names", `leaked: ${leaked.join(", ")}`);
  check(/New Pass/.test(outline) && /Search students/.test(outline) && /Active Passes/.test(outline), "outline: keeps the UI words");
  if (shotsDir) {
    await panel.screenshot({ path: `${shotsDir}/panel.png`, fullPage: true });
    console.log(outline.split("\n").slice(0, 60).join("\n"));
  }
  await hp.click("button.cancel");

  // --- Bell: ends both passes and says who ---
  await sw.evaluate(() => chrome.alarms.create("bell", { when: Date.now() + 200 }));
  await until(async () => (await storage("outPasses")).outPasses.length === 0, "bell ended every pass", 30000);
  const left = await hp.evaluate(() => window.__mock.passes.length);
  check(left === 0, "bell: passes ended in HallPass", `${left} still open`);
  const notes = await sw.evaluate(() => self.__notes);
  const bellNote = notes.find((n) => n.title === "Ended at the bell");
  check(!!bellNote && /Ava L\./.test(bellNote.message) && /Jordan Mo\./.test(bellNote.message), "bell: notice lists who was out", JSON.stringify(notes));

  check(errors.length === 0, "no console errors", errors.join("\n     "));
} catch (err) {
  failures++;
  console.log(`FAIL ${err.message}`);
  if (errors.length) console.log(`     console errors:\n     ${errors.join("\n     ")}`);
} finally {
  await ctx.close();
}

console.log(failures ? `\n${failures} check(s) failed` : "\nAll checks passed");
process.exit(failures ? 1 : 0);
