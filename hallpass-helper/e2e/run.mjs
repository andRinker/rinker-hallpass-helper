// End-to-end check: loads the real extension in Chromium against e2e/mock-hallpass.html served at
// hallpass.goguardian.com (and at teacher.goguardian.com, standing in for GoGuardian's home screen),
// teaches it to make and end a pass, then runs a queue like a teacher would.
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
  await ctx.route("https://*.goguardian.com/**", (route) =>
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
      maxOut: 1,
      autoEndMinutes: 7,
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
  await panel.waitForSelector('#teach[data-mode="review"]');
  const endRoles = await panel.$$eval("#teach .steps select", (els) => els.map((e) => e.value));
  check(JSON.stringify(endRoles) === JSON.stringify(["student", "fixed", "fixed"]), "teach end: guessed roles", JSON.stringify(endRoles));
  await panel.getByRole("button", { name: "Save" }).click();
  await until(async () => /Knows how to make and end/.test(await panelText("#teach")), "taught both");

  // --- Queue: typed name + Enter, then a tapped suggestion; only one goes at a time ---
  const mockPasses = (page = hp) => page.evaluate(() => window.__mock.passes.map((p) => `${p.student.last}:${p.dest}`));
  const status = () => panelText("#queueStatus");
  await panel.click('#destinations button:text("Nurse")');
  await panel.fill("#addName", "jordan ma");
  await panel.press("#addName", "Enter");
  await panel.click('#destinations button:text("Library")');
  await panel.fill("#addName", "av");
  await panel.click('#suggestions button:text("Ava L.")');
  await panel.click('#destinations button:text("Nurse")');
  await panel.fill("#addName", "moore");
  await panel.press("#addName", "Enter");
  await until(async () => (await mockPasses()).includes("Martinez:Nurse"), "first student sent to HallPass");
  check(true, "queue: first student made it into HallPass, Create included (search fell back to last name)");
  await until(async () => (await storage("outPasses")).outPasses?.length === 1, "first student in Out now");
  await until(async () => /Ava L\. goes next, when Jordan Ma\. is back/.test(await status()), "status names who's next");
  check(true, "queue: status says who goes next and what it's waiting on");
  const queued = (await storage("queue")).queue.map((e) => e.label);
  check(JSON.stringify(queued) === JSON.stringify(["Ava L.", "Jordan Mo."]), "queue: the rest wait their turn", JSON.stringify(queued));
  check(JSON.stringify(await mockPasses()) === JSON.stringify(["Martinez:Nurse"]), "queue: HallPass only has one of mine", JSON.stringify(await mockPasses()));
  await until(
    async () => (await sw.evaluate(() => chrome.alarms.getAll())).some((a) => a.name.startsWith("end:")),
    "an end alarm for the pass",
  );
  check(true, "auto-end: an alarm is set for the pass");
  if (shotsDir) await panel.screenshot({ path: `${shotsDir}/queue.png`, fullPage: true });

  // --- Same name twice: Ava stays in line; the duplicate is turned away ---
  await clearToast();
  await panel.fill("#addName", "ava lee");
  await panel.press("#addName", "Enter");
  await toast(/already in the queue/);

  // --- Back ends it in HallPass, and the next student goes right away ---
  await clearToast();
  await panel.getByRole("button", { name: "Back" }).click();
  await toast(/Jordan Ma\. is back/);
  await until(async () => (await mockPasses()).join() === "Lee:Library", "Martinez ended, Ava sent");
  check(true, "back: pass ended in HallPass and the next student was sent");

  // --- Time's up: the pass ends by itself and the next one goes ---
  // Waits until the helper has recorded `label` as out, so backdating doesn't race its own save.
  const outIs = (label) =>
    until(async () => (await storage("outPasses")).outPasses?.map((p) => p.label).join() === label, `${label} out`);
  const backdate = (minutes) =>
    sw.evaluate(async (m) => {
      const { outPasses } = await chrome.storage.local.get("outPasses");
      await chrome.storage.local.set({ outPasses: outPasses.map((p) => ({ ...p, startedAt: Date.now() - m * 60000 })) });
    }, minutes);
  await outIs("Ava L.");
  await backdate(8);
  await until(async () => (await mockPasses()).join() === "Moore:Nurse", "Ava ended at 7 minutes, Jordan Mo. sent", 30000);
  check(true, "auto-end: ended after 7 minutes and sent the next student");
  const notes = await sw.evaluate(() => self.__notes);
  check(notes.some((n) => n.title === "Pass ended" && /Ava L\.'s pass ended at 7 minutes/.test(n.message)), "auto-end: notice says who", JSON.stringify(notes));

  // --- A student the helper can't pick for sure: the queue pauses and says why ---
  await panel.fill("#addName", "sam");
  await panel.press("#addName", "Enter");
  await panel.fill("#addName", "Priya Shah");
  await panel.press("#addName", "Enter");
  await outIs("Jordan Mo.");
  await backdate(8);
  await until(async () => /Sam C\. wasn't sent\. More than one student/.test(await status()), "queue paused on two Sam Chos", 30000);
  check((await storage("queuePaused")).queuePaused === true, "ambiguous: queue paused");
  const badges = await hp.$$eval("[data-hph-ui]", (els) => els.map((e) => e.textContent));
  check(badges.length === 2 && badges.every((t) => t === "Which one?"), "ambiguous: both Sam Chos highlighted", JSON.stringify(badges));
  check((await mockPasses()).length === 0, "ambiguous: nothing created", JSON.stringify(await mockPasses()));
  await hp.click("button.cancel");

  // --- Take Sam out, resume, and Priya (typed, not on the roster) goes, even with another GoGuardian tab in front ---
  const home = await ctx.newPage();
  watch(home, "home");
  await home.goto("https://teacher.goguardian.com/");
  await home.bringToFront();
  await panel.getByRole("button", { name: "Take Sam C. out of the queue" }).click();
  await panel.getByRole("button", { name: "Resume" }).click();
  await until(async () => (await mockPasses()).join() === "Shah:Nurse", "Priya sent after resuming");
  check(true, "resume: the next student was sent");
  check((await mockPasses(home)).length === 0, "tabs: steps taught on HallPass run in the HallPass tab, not the home screen");
  await home.close();

  // --- Pause holds the line ---
  await panel.getByRole("button", { name: "Pause" }).click();
  await panel.fill("#addName", "jordan mi");
  await panel.press("#addName", "Enter");
  await outIs("Priya Shah");
  await backdate(8);
  await until(async () => (await mockPasses()).length === 0, "Priya ended at 7 minutes while paused", 30000);
  await new Promise((r) => setTimeout(r, 1500));
  check((await mockPasses()).length === 0 && (await storage("queue")).queue?.length === 1, "pause: no one sent while paused");
  await panel.getByRole("button", { name: "Resume" }).click();
  await until(async () => (await mockPasses()).join() === "Miller:Nurse", "Jordan Mi. sent after resuming");
  check(true, "pause: resuming sends the next student");

  // --- Name-free outline, with the search showing a student who isn't on the roster ---
  await hp.bringToFront();
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
  check(/Site: hallpass\.goguardian\.com/.test(outline), "outline: names the site");
  if (shotsDir) {
    await panel.screenshot({ path: `${shotsDir}/panel.png`, fullPage: true });
    console.log(outline.split("\n").slice(0, 60).join("\n"));
  }
  await hp.click("button.cancel");

  check(errors.length === 0, "no console errors", errors.join("\n     "));
} catch (err) {
  failures++;
  console.log(`FAIL ${err.message}`);
  if (process.env.E2E_DEBUG) console.log(await ctx.serviceWorkers()[0]?.evaluate(() => chrome.storage.local.get(["queue", "outPasses", "queuePaused", "queueProblem"])).then(JSON.stringify).catch(String));
  if (errors.length) console.log(`     console errors:\n     ${errors.join("\n     ")}`);
} finally {
  await ctx.close();
}

console.log(failures ? `\n${failures} check(s) failed` : "\nAll checks passed");
process.exit(failures ? 1 : 0);
