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
  args: [`--disable-extensions-except=${extDir}`, `--load-extension=${extDir}`, "--disable-popup-blocking"],
  viewport: { width: 1100, height: 800 },
});
const errors = [];
const watch = (page, name) => {
  page.on("console", (m) => m.type() === "error" && errors.push(`${name}: ${m.text()}`));
  page.on("pageerror", (e) => errors.push(`${name}: ${e.message}`));
};

const fixture = JSON.parse(readFileSync(new URL("./fixture-macros.json", import.meta.url), "utf8"));

try {
  await ctx.route("https://*.goguardian.com/**", (route) =>
    route.fulfill({ contentType: "text/html", body: mockHtml }),
  );
  // The GoGuardian home screen has a Create Pass button that opens the Create Pass window.
  await ctx.route("https://teacher.goguardian.com/classrooms/active", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: `<!doctype html><title>Home</title><button id="openCreate">Create a new hall pass</button><script>document.getElementById("openCreate").onclick = () => window.open("https://hallpass.goguardian.com/window/passes/create", "createpass", "popup,width=520,height=760");</script>`,
    }),
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
  await until(async () => (await storage("macros")).macros.make?.create, "the built-in steps to be installed");
  const builtIn = (await storage("macros")).macros;
  check(
  builtIn.make.hallpass.steps.length === 10 &&
    builtIn.make.create.steps.length === 10 &&
    builtIn.endVia.hallpass.steps.length === 2 &&
    builtIn.endVia.hallpass.alternates?.length === 1 &&
    builtIn.endVia.create.opener,
  "built in: both ways of making and ending are installed on their own, with a way for an open pass box and a closed one",
);
  // Steps recorded on the mock pages stand in for the real built-in ones; macrosOverride keeps the build from replacing them.
  await sw.evaluate((macros) => chrome.storage.local.set({ macros, macrosOverride: true }), fixture);

  const hp = await ctx.newPage();
  watch(hp, "hallpass");
  await hp.goto("https://campus.goguardian.com/");
  const panel = await ctx.newPage();
  watch(panel, "panel");
  await panel.setViewportSize({ width: 380, height: 900 });
  await panel.goto(`${base}/sidepanel/sidepanel.html`);
  await panel.waitForSelector('#hallpass[data-state="ready"]');
  const panelText = (sel) => panel.textContent(sel);
  const toast = async (re) => until(async () => re.test((await panelText("#toast")) ?? ""), `toast ${re}`);
  const clearToast = () => panel.evaluate(() => (document.querySelector("#toast").textContent = ""));

  // --- The setup guide says what's open and what to do first ---
  const guideText = () => panelText("#guide");
  await until(async () => /HallPass website\s*✓ Helper can see it/.test((await guideText()) ?? ""), "guide lists HallPass as seen");
  const guideNow = (await guideText()) ?? "";
  check(
    /Create Pass window\s*Asleep/.test(guideNow) && /Setup: 2 of 3 done/.test(guideNow),
    "guide: shows the pages it can see and the next step",
    guideNow.replace(/\s+/g, " ").slice(0, 300),
  );

  check(await panel.locator("#teach").isVisible(), "Watch card: shown");
  check((await panel.getByRole("button", { name: /^Teach/ }).count()) === 0, "no Teach buttons: the steps are built in");
  check(
    (await panel.getByRole("button", { name: /Watch me make a pass|Watch me end a pass|Just look around/ }).count()) === 3,
    "Watch card: three things to show the helper",
  );

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
  check(/Site: campus\.goguardian\.com/.test(outline), "outline: names the site");
  if (shotsDir) {
    await panel.screenshot({ path: `${shotsDir}/panel.png`, fullPage: true });
    console.log(outline.split("\n").slice(0, 60).join("\n"));
  }
  await hp.click("button.cancel");


  // --- Page states: the helper looks at the screen first ---
  // Steps recorded on the mock stand in for the built-in ones, but the ways are laid out the same:
  // a way for "the pass box is already open" and a way for "it's closed".
  await sw.evaluate(() => chrome.storage.local.set({ queuePaused: true, queue: [], outPasses: [], queueProblem: "" }));
  const hpTab = (msg) =>
    sw.evaluate(async (m) => {
      const [t] = await chrome.tabs.query({ url: "https://campus.goguardian.com/*" });
      return chrome.tabs.sendMessage(t.id, m);
    }, msg);
  const setMacros = (macros) => sw.evaluate((m) => chrome.storage.local.set({ macros: m }), macros);
  const people = { miller: { first: "Jordan", last: "Miller" }, lee: { first: "Ava", last: "Lee" }, cho: { first: "Sam", last: "Cho" } };
  const seed = (list) =>
    hp.evaluate((rows) => {
      window.__mock.passes = rows.map(([student, expanded], i) => ({ id: 100 + i, student, dest: "Nurse", expanded }));
      renderActive();
      document.querySelector("#dialogs").innerHTML = "";
    }, list);
  const left = () => hp.evaluate(() => window.__mock.passes.map((p) => p.student.last).join());
  const endAva = () => hpTab({ type: "end-pass", method: "hallpass", student: { first: "Ava", last: "Lee" } });

  const endHallpass = fixture.endVia.hallpass;
  const [pickStudent, endButton, confirmEnd] = endHallpass.steps;
  const final = { ...confirmEnd, role: "final" };
  const boxOpen = [{ ...endButton, role: "fixed", target: { ...endButton.target, context: "", near: "{student}" } }, final];
  const boxClosed = [pickStudent, endButton, final];
  const asWays = (main, ...alternates) => ({ ...fixture, endVia: { ...fixture.endVia, hallpass: { ...endHallpass, steps: main, alternates: alternates.map((steps) => ({ steps })) } } });

  // The student is third in the list and the box is closed: the way for a closed box is used, and only Ava's pass ends.
  await setMacros(asWays(boxOpen, boxClosed));
  await seed([[people.miller, false], [people.cho, false], [people.lee, false]]);
  let ended = await endAva();
  check(ended?.ok && (await left()) === "Miller,Cho", "states: student third in the list, box closed: only that student's pass ended", `${JSON.stringify(ended)} left: ${await left()}`);
  check(ended?.route === 2 && ended?.routes === 2, "states: the way for a closed box was picked by looking at the screen", JSON.stringify(ended));

  // The pass box is already open (and another student's is too): the way for an open box is used, nothing else is clicked first.
  await seed([[people.miller, true], [people.lee, true], [people.cho, false]]);
  ended = await endAva();
  check(ended?.ok && ended.route === 1 && (await left()) === "Miller,Cho", "states: pass box already open: ended straight away, other boxes left alone", `${JSON.stringify(ended)} left: ${await left()}`);

  // Someone else's pass box is open and the student's is closed: that End Pass button is not theirs, so the helper opens theirs.
  await seed([[people.miller, true], [people.lee, false]]);
  ended = await endAva();
  check(ended?.ok && ended.route === 2 && (await left()) === "Miller", "states: another student's open box is never mistaken for the student's", `${JSON.stringify(ended)} left: ${await left()}`);

  // A pop-up in the way: the list only comes back once it's dismissed.
  await seed([[people.lee, false]]);
  await hp.evaluate(() => {
    const keep = window.__mock.passes;
    document.querySelector("#active").innerHTML = "";
    document.querySelector("#dialogs").innerHTML = `<div role="dialog" aria-label="What's new"><p>Something new!</p><button type="button" id="tip">Got it</button></div>`;
    document.querySelector("#tip").addEventListener("click", () => {
      document.querySelector("#dialogs").innerHTML = "";
      renderActive();
    });
    window.__mock.passes = keep;
  });
  ended = await endAva();
  check(ended?.ok && (await left()) === "" && ended.notes?.some((n) => /pop-up/.test(n)), "states: a pop-up in the way was closed and the pass ended", `${JSON.stringify(ended)} left: ${await left()}`);

  // The main way gets stuck partway: the helper clears up and moves on to the other way.
  await seed([[people.lee, false], [people.miller, false]]);
  const broken = [pickStudent, { ...endButton, target: { ...endButton.target, name: "Archive It", context: "" } }, final];
  await setMacros(asWays(broken, boxClosed));
  ended = await endAva();
  check(ended?.ok && (await left()) === "Miller" && ended.route === 2, "states: the first way got stuck, the next way finished the job", `${JSON.stringify(ended)} left: ${await left()}`);

  // A stuck run says where, and nothing past the final button is ever done twice.
  await seed([[people.lee, false]]);
  await setMacros(asWays(broken));
  ended = await endAva();
  check(!ended?.ok && ended.reason === "stuck" && ended.step === 2 && (await left()) === "Lee", "states: with no way left, it stops and says which step", JSON.stringify(ended));

  // A long list that only draws the rows on screen: the helper scrolls to find the student.
  await hp.evaluate(() => {
    const box = document.createElement("div");
    box.id = "long";
    box.style.cssText = "height:120px;overflow:auto;border:1px solid #999";
    const tall = document.createElement("div");
    tall.style.height = "4000px";
    box.append(tall);
    box.addEventListener("scroll", () => {
      if (box.scrollTop < 1500 || box.querySelector("button")) return;
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = "Sam Cho";
      b.style.cssText = "position:absolute;top:1700px";
      b.addEventListener("click", () => (window.__clicked = "Cho"));
      tall.style.position = "relative";
      tall.append(b);
    });
    document.body.append(box);
  });
  await setMacros({ ...fixture, endVia: { ...fixture.endVia, hallpass: { ...endHallpass, steps: [{ action: "click", role: "student", target: { role: "button", name: "{student}", tag: "button", classes: [], context: "", index: 0, pointer: false } }], alternates: [] } } });
  const found = await hpTab({ type: "end-pass", method: "hallpass", student: people.cho });
  check(found?.ok && (await hp.evaluate(() => window.__clicked)) === "Cho", "states: a student further down a long list is found by scrolling", JSON.stringify(found));
  await hp.evaluate(() => document.querySelector("#long")?.remove());

  // A form that's already open: New Pass is not clicked again (that would wipe it), and the pass still goes through.
  const makeHp = fixture.make.hallpass;
  const opened = { role: "textbox", name: "Search students", tag: "input", classes: [], context: "", index: 0, pointer: false };
  const withDone = { ...fixture, make: { ...fixture.make, hallpass: { ...makeHp, steps: makeHp.steps.map((st, i) => (i === 0 ? { ...st, done: [opened] } : st)) } } };
  await setMacros(withDone);
  await seed([]);
  await hp.click("#newPass");
  await hp.selectOption('select[aria-label="Teacher"]', { label: "Mr. Okafor" });
  const made = await hpTab({ type: "make-pass", method: "hallpass", student: people.lee, destination: "Library" });
  check(made?.ok && made.notes?.some((n) => /already done/.test(n)) && (await mockPasses()).join() === "Lee:Library", "states: form already open: New Pass skipped, pass made", JSON.stringify(made));
  await hp.evaluate(() => {
    window.__mock.passes = [];
    renderActive();
  });

  // The queue is back to normal for the lane test below.
  await setMacros(fixture);
  await sw.evaluate(() => chrome.storage.local.set({ queuePaused: false, queue: [], outPasses: [] }));

  // --- Home screen -> Create Pass window lane: the helper clicks Create Pass itself and makes the pass in the window ---
  const home2 = await ctx.newPage();
  watch(home2, "home2");
  await home2.goto("https://teacher.goguardian.com/classrooms/active");
  await home2.bringToFront();
  await ctx.serviceWorkers()[0].evaluate(() => chrome.storage.local.set({ outPasses: [], queue: [] }));
  check(await panel.getByLabel("Use HallPass website").isChecked(), "lane: starts on the first way");
  await panel.getByLabel("Use Home screen → Create Pass window").check();
  await until(async () => /^\s*GoGuardian is open/.test((await panelText("#hallpass")) ?? ""), "status says the home screen can open the window");
  const hpBefore = (await mockPasses(hp)).length;
  await panel.fill("#addName", "ava lee");
  await panel.press("#addName", "Enter");
  const popup2 = await until(async () => ctx.pages().find((p) => p.url().includes("/window/passes/create")), "the helper opened the Create Pass window", 30000);
  watch(popup2, "popup");
  await until(async () => (await mockPasses(popup2)).includes("Lee:Nurse"), "Ava sent in the window the helper opened", 30000);
  check((await mockPasses(hp)).length === hpBefore, "lane: nothing was made on the HallPass website");

  // The lane switch: with HallPass chosen, the status talks only about the HallPass website.
  await panel.getByLabel("Use HallPass website").check();
  await until(async () => /^\s*HallPass is open/.test((await panelText("#hallpass")) ?? ""), "status follows the lane switch");

  check(errors.length === 0, "no console errors", errors.join("\n     "));
} catch (err) {
  failures++;
  console.log(`FAIL ${err.message}`);
  if (process.env.E2E_DEBUG) console.log(await ctx.serviceWorkers()[0]?.evaluate(() => chrome.storage.local.get(["queue", "outPasses", "queuePaused", "queueProblem"])).then(JSON.stringify).catch(String));
  for (const p of ctx.pages()) console.log("PAGE", p.url(), await p.evaluate(() => JSON.stringify(window.__mock?.passes?.map((x) => x.student.last))).catch(String));
  if (errors.length) console.log(`     console errors:\n     ${errors.join("\n     ")}`);
} finally {
  await ctx.close();
}

console.log(failures ? `\n${failures} check(s) failed` : "\nAll checks passed");
process.exit(failures ? 1 : 0);
