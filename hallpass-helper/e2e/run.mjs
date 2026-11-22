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

  // --- Watch mode: show the helper one way of ending a pass, and it learns it as another way ---
  await setMacros(fixture);
  await seed([[people.lee, false], [people.cho, false]]);
  await panel.bringToFront();
  if (shotsDir) await panel.screenshot({ path: `${shotsDir}/watch-idle.png`, fullPage: true });
  await panel.getByRole("button", { name: "Watch me end a pass" }).click();
  await until(async () => /Watching: ending a pass/.test((await panelText("#teach")) ?? ""), "the Watch card says it's watching");
  await hp.bringToFront();
  const pause = (ms) => new Promise((r) => setTimeout(r, ms));
  await hp.click('.card:has-text("Ava Lee")');
  await pause(300);
  await hp.click('.card:has-text("Ava Lee") .end');
  await pause(300);
  await hp.click('button.yes');
  await until(async () => (await left()) === "Cho", "the demonstration ended Ava's pass");
  await pause(1500); // let the page report what showed up after each click
  if (process.env.E2E_DEBUG) console.log(JSON.stringify(await sw.evaluate(() => chrome.storage.session.get("watch"))).slice(0, 3000));
  await panel.bringToFront();
  await until(async () => /3 steps/.test((await panelText("#teach")) ?? ""), "the card counts the steps", 8000);
  check(/[1-9]\d* screens? seen/.test((await panelText("#teach")) ?? ""), "watch: the screens it saw are counted", (await panelText("#teach")) ?? "");
  const queueWhileWatching = await storage(["queue", "outPasses"]);
  check(queueWhileWatching.queue?.length === 0, "watch: nothing was queued or sent while watching");
  await panel.getByRole("button", { name: "Done" }).click();
  await until(async () => /Check what it saw: ending a pass/.test((await panelText("#teach")) ?? ""), "the review card");
  if (shotsDir) await panel.screenshot({ path: `${shotsDir}/watch-review.png`, fullPage: true });
  const roleOf = (n) => panel.locator(`select[aria-label="What step ${n} is"]`).inputValue();
  check(
    (await roleOf(1)) === "student" && (await roleOf(3)) === "final",
    "watch: it guessed the student step and the step that finishes it",
    `${await roleOf(1)} / ${await roleOf(2)} / ${await roleOf(3)}`,
  );
  await panel.getByRole("button", { name: "Save this way" }).click();
  await until(async () => (await storage("learned")).learned?.endVia?.hallpass?.length === 1, "the new way was saved");
  const saved = await storage(["learned", "siteMap"]);
  const savedText = JSON.stringify(saved);
  check(!/\b(Ava|Lee|Cho)\b/.test(savedText), "watch: no student names were saved", savedText.slice(0, 400));
  const route = saved.learned.endVia.hallpass[0].steps;
  check(route[0].target.name === "{student}" && route[2].role === "final" && route[2].commit === true, "watch: the saved way has the student as a placeholder and says which step finishes it", JSON.stringify(route.map((x) => [x.role, x.target.name])));
  if (process.env.E2E_DEBUG) console.log(JSON.stringify(saved.siteMap).slice(0, 1500));
  check(Object.keys(saved.siteMap.screens).length >= 1 && Object.values(saved.siteMap.screens).some((sc) => sc.landmarks.some((l) => l.name === "End Pass")), "watch: the map of screens knows the pass box has an End Pass button");
  check(!JSON.stringify(saved.siteMap).match(/\b(Ava|Lee|Cho)\b/), "watch: the map of screens has no names");

  // The learned way works on its own, for another student, with the built-in way broken.
  await setMacros({ ...fixture, endVia: { ...fixture.endVia, hallpass: { ...endHallpass, steps: broken, alternates: [{ steps: route }] } } });
  await seed([[people.miller, false], [people.cho, false]]);
  const viaLearned = await hpTab({ type: "end-pass", method: "hallpass", student: people.cho });
  check(viaLearned?.ok && viaLearned.route === 2 && (await left()) === "Miller", "watch: the learned way ended another student's pass", `${JSON.stringify(viaLearned)} left: ${await left()}`);

  // A look around saves only the map; forgetting empties it.
  await panel.getByRole("button", { name: "Just look around" }).click();
  await hp.bringToFront();
  await hp.click("#newPass");
  await hp.click("button.cancel");
  await panel.bringToFront();
  await panel.getByRole("button", { name: "Done" }).click();
  await until(async () => /Forget what I showed it/.test((await panelText("#teach")) ?? ""), "back to the start");
  const copied = await panel.evaluate(async () => {
    const { learnedReport } = await import("../lib/watch.js");
    const settings = await chrome.storage.local.get(null);
    return learnedReport(settings, { version: "test" });
  });
  check(!/\b(Ava|Lee|Cho|Jordan|Miller)\b/.test(copied) && /End Pass/.test(copied), "watch: the report to paste into a chat has no names", copied.slice(0, 300));
  await panel.getByRole("button", { name: "Forget what I showed it" }).click();
  await until(async () => Object.keys((await storage("learned")).learned ?? {}).length === 0, "learned ways forgotten");
  check(true, "watch: forgetting clears what was learned");
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

  // --- The built-in steps, on a page shaped like the real HallPass ---
  // (Search-box dropdowns, a Request Pass dialog, a Pass Details panel.) Checks every state the built-in
  // steps are meant to cope with, not just a clean start.
  const builtinHtml = readFileSync(path.join(here, "mock-builtin.html"), "utf8");
  await ctx.route("https://campus.goguardian.com/builtin", (route) => route.fulfill({ contentType: "text/html", body: builtinHtml }));
  const bp = await ctx.newPage();
  watch(bp, "builtin");
  await bp.goto("https://campus.goguardian.com/builtin");
  await panel.bringToFront();
  const builtinMacros = await panel.evaluate(async () => (await import("../lib/builtin.js")).BUILTIN_MACROS);
  await setMacros(builtinMacros);
  await sw.evaluate(() => chrome.storage.local.set({ queuePaused: true, queue: [], outPasses: [] }));
  await bp.bringToFront();
  const bTab = (msg) =>
    sw.evaluate(async (m) => {
      const [t] = await chrome.tabs.query({ url: "https://campus.goguardian.com/builtin" });
      return chrome.tabs.sendMessage(t.id, m);
    }, msg);
  const bState = () => bp.evaluate(() => window.__mock.passes.map((p) => `${p.student}:${p.dest}`).join());
  const bReset = (passes = []) =>
    bp.evaluate((rows) => {
      window.__mock.passes = rows.map(([student, dest]) => ({ student, dest }));
      window.__mock.log = [];
      document.querySelector("#host").innerHTML = "";
      renderList();
    }, passes);
  const bMake = (name = "Ava Lee", destination = "Nurse") => {
    const [first, last] = name.split(" ");
    return bTab({ type: "make-pass", method: "hallpass", student: { first, last }, destination });
  };
  const bEnd = (name = "Ava Lee") => {
    const [first, last] = name.split(" ");
    return bTab({ type: "end-pass", method: "hallpass", student: { first, last } });
  };

  let r = await bMake();
  check(r?.ok && (await bState()) === "Ava Lee:Nurse", "built-in make: from a clean page", JSON.stringify(r));
  await bReset();
  await bp.click("#newPass");
  r = await bMake();
  check(r?.ok && (await bState()) === "Ava Lee:Nurse" && r.notes?.some((n) => /New Pass/.test(n)), "built-in make: form already open, New Pass is not clicked again", JSON.stringify(r));
  await bReset();
  await bp.click("#newPass");
  await bp.click('[aria-label="Request Pass"] .stu button');
  await bp.locator('[aria-label="Request Pass"] .stu input').pressSequentially("ava");
  await bp.click('[role=option]:has-text("Ava Lee")');
  r = await bMake();
  check(r?.ok && (await bState()) === "Ava Lee:Nurse" && (r.notes ?? []).filter((n) => /Skipped/.test(n)).length >= 4, "built-in make: student already picked in the open form, picked steps skipped", JSON.stringify(r));
  await bReset([["Jordan Miller", "Library"]]);
  await bp.click('#list button');
  r = await bMake();
  check(r?.ok && (await bState()) === "Jordan Miller:Library,Ava Lee:Nurse", "built-in make: a Pass Details panel left open is closed first", JSON.stringify(r));
  await bReset([["Jordan Miller", "Library"]]);
  r = await bMake("Ava Lee", "Library");
  check(r?.ok && (await bState()) === "Jordan Miller:Library,Ava Lee:Library", "built-in make: another destination, with other passes already out", JSON.stringify(r));

  await bReset([["Jordan Miller", "Library"], ["Sam Cho", "Nurse"], ["Ava Lee", "Nurse"]]);
  r = await bEnd();
  check(r?.ok && (await bState()) === "Jordan Miller:Library,Sam Cho:Nurse", "built-in end: pass box closed, student third in the list", JSON.stringify(r));
  await bReset([["Jordan Miller", "Library"], ["Ava Lee", "Nurse"]]);
  await bp.click("#list li:nth-child(2) button");
  r = await bEnd();
  check(r?.ok && r.route === 1 && (await bState()) === "Jordan Miller:Library", "built-in end: pass box already open, End Pass clicked straight away", JSON.stringify(r));
  await bReset([["Jordan Miller", "Library"], ["Ava Lee", "Nurse"]]);
  await bp.click("#list li:nth-child(1) button");
  r = await bEnd();
  check(r?.ok && (await bState()) === "Jordan Miller:Library", "built-in end: another student's pass box is open, so theirs isn't ended by mistake", JSON.stringify(r));
  check(!(await bp.evaluate(() => window.__mock.log.join())).includes("ended Jordan"), "built-in end: the other student's pass was left alone");
  // Read-only self-check (dry run) and scrubbed DOM snapshot exporter against the built-in mock page.
  await bReset([["Jordan Miller", "Library"], ["Ava Lee", "Nurse"]]);
  await bp.click("#list li:nth-child(2) button");
  // Inject a fake student avatar image and a hidden PII node to prove the snapshot strips both.
  await bp.evaluate(() => {
    const img = document.createElement("img");
    img.src = "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' width='20' height='20' data-user='jordan-miller-99182'></svg>";
    img.alt = "Jordan Miller photo";
    document.body.append(img);
    const hidden = document.createElement("div");
    hidden.style.display = "none";
    hidden.textContent = "Secret Hidden Student Marcus Vance secret@school.edu";
    document.body.append(hidden);
    const status = document.createElement("span");
    status.textContent = "Waiting in queue";
    document.body.append(status);
  });
  const logBefore = await bp.evaluate(() => JSON.stringify(window.__mock.log));
  const passesBefore = await bState();

  // Feature #2: Read-only self-check (dry run) from the side panel.
  await panel.click("#diagnoseButton");
  await panel.locator("#diagnoseBox").waitFor({ state: "visible" });
  const diagBadge = await panel.locator("#diagnoseBadge").textContent();
  const diagText = await panel.locator("#diagnoseText").inputValue();
  check(
    diagBadge.includes("Privacy check passed") && diagText.includes("Read-Only Self-Check") && diagText.includes("waiting("),
    "dry-run self-check: reports screen state and status indicators with clean privacy check",
    `${diagBadge}\n${diagText.slice(0, 300)}`,
  );
  check(
    diagText.includes("READY (1 match)") && diagText.includes("[make via hallpass]"),
    "dry-run self-check: evaluates built-in macro selectors read-only",
    diagText.slice(0, 500),
  );
  check(
    !/\b(Jordan|Miller|Ava|Lee|Rivera|Marcus|Vance)\b|Middle School South|secret@school\.edu/i.test(diagText),
    "dry-run self-check: contains no student, teacher, school, or email data",
    diagText,
  );
  check(
    (await bp.evaluate(() => JSON.stringify(window.__mock.log))) === logBefore && (await bState()) === passesBefore,
    "dry-run self-check: strictly read-only (nothing clicked or modified)",
  );
  await panel.click("#closeDiagnose");

  // Feature #1: Scrubbed DOM snapshot + word audit from the side panel.
  await panel.click("#snapshotButton");
  await panel.locator("#snapshotBox").waitFor({ state: "visible" });
  // Pick the campus.goguardian.com browser window (mock-builtin.html) when multiple tabs are open.
  const pickerOpts = await panel.locator("#snapshotPicker option").allTextContents();
  const builtinIdx = pickerOpts.findIndex((t) => t.includes("campus.goguardian.com (browser window"));
  if (builtinIdx >= 0) await panel.selectOption("#snapshotPicker", String(builtinIdx));
  const snapStatus = await panel.locator("#snapshotStatus").textContent();
  const snapHtml = await panel.locator("#snapshotHtml").inputValue();
  const auditWords = await panel.locator("#snapshotWords .word-pill").allTextContents();
  check(
    snapStatus.includes("Privacy check passed") && auditWords.includes("pass") && !auditWords.some((w) => /jordan|miller|ava|lee|marcus|vance/i.test(w)),
    "scrubbed snapshot: privacy audit passes and word list contains only UI words",
    `${snapStatus} | words=${auditWords.join(",")}`,
  );
  check(
    !/\b(Jordan|Miller|Ava|Lee|Rivera|Marcus|Vance|99182)\b|Middle School South|secret@school\.edu|<script/i.test(snapHtml),
    "scrubbed snapshot: strips scripts, avatars, hidden PII, and all student/school/teacher names",
  );
  check(
    snapHtml.includes("New Pass") && snapHtml.includes("End Pass") && snapHtml.includes("Student Alpha"),
    "scrubbed snapshot: preserves real DOM controls and maps students to synthetic Student Alpha/Bravo",
  );
  await panel.click("#closeSnapshot");

  // Round-trip proof: load the exported scrubbed HTML snapshot back into Chromium and verify the extension diagnoses it cleanly.
  await ctx.route("https://campus.goguardian.com/scrubbed-roundtrip", (route) =>
    route.fulfill({ contentType: "text/html; charset=utf-8", body: snapHtml }),
  );
  const sp = await ctx.newPage();
  watch(sp, "snapshot-roundtrip");
  await sp.goto("https://campus.goguardian.com/scrubbed-roundtrip");
  await until(async () => {
    const res = await sw.evaluate(async () => {
      const [t] = await chrome.tabs.query({ url: "https://campus.goguardian.com/scrubbed-roundtrip" });
      return t ? chrome.tabs.sendMessage(t.id, { type: "ping" }).catch(() => null) : null;
    });
    return res?.ok;
  }, "snapshot roundtrip content script ready");
  const rtDiag = await sw.evaluate(async () => {
    const [t] = await chrome.tabs.query({ url: "https://campus.goguardian.com/scrubbed-roundtrip" });
    return chrome.tabs.sendMessage(t.id, { type: "diagnose", isPopup: false });
  });
  check(
    rtDiag?.ok && rtDiag.audit?.clean && rtDiag.report.includes("READY (1 match)") && rtDiag.report.includes("Pass Details"),
    "scrubbed snapshot round-trip: real extension loads and diagnoses the exported HTML cleanly in Chromium",
    rtDiag?.report?.slice(0, 400),
  );
  await sp.close();

  await setMacros(fixture);
  await bp.close();

  // The "try the other way" switch: with it on, a way that gets stuck before anything is made hands over to the other one.
  const brokenMake = { ...fixture.make.hallpass, steps: fixture.make.hallpass.steps.map((st, i) => (i === 0 ? { ...st, target: { ...st.target, name: "No Such Button" } } : st)) };
  await setMacros({ ...fixture, make: { ...fixture.make, hallpass: brokenMake } });
  await sw.evaluate(() => chrome.storage.local.set({ outPasses: [], queue: [], queuePaused: false, queueProblem: "" }));
  check(!(await panel.getByLabel("If this way gets stuck, try the other way").isChecked()), "fallback: off unless you turn it on");
  await panel.getByLabel("If this way gets stuck, try the other way").check();
  const hpBefore2 = (await mockPasses(hp)).length;
  await panel.fill("#addName", "priya shah");
  await panel.press("#addName", "Enter");
  await until(async () => (await mockPasses(popup2)).includes("Shah:Nurse"), "Priya sent the other way after the chosen way got stuck", 90000);
  check((await mockPasses(hp)).length === hpBefore2 && (await storage("queuePaused")).queuePaused === false, "fallback: the chosen way got stuck, the other way made the pass, nothing paused");
  await until(async () => (await storage("lastRun")).lastRun?.ok === true, "the last try is saved", 20000).catch(() => {});
  const run = (await storage("lastRun")).lastRun;
  check(run?.goal === "make" && run.ok === true && run.lane === "create", "last try: remembers which way finished the job", JSON.stringify(run));

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
