# HallPass Helper

A Chrome extension that makes GoGuardian Hall Pass less painful for teachers. It isn't made by or affiliated with GoGuardian.

All settings, student names, and taught steps stay in your own browser (`chrome.storage.local`). Nothing is sent anywhere.

## How it works

The helper doesn't come knowing HallPass's screens. **You teach it once**: make one pass while it watches, and it repeats those steps for any student you tap.

- **Teach it once.** In the side panel, click **Teach: make a pass**, then make one pass in HallPass the way you always do. The helper shows the steps it saw and guesses which one is the student, which is the destination, and which is the final Create button. You fix any wrong guesses and save. The teaching student's name is swapped for a placeholder before anything is saved.
- **One-tap passes.** Tap a student (this period's class shows first) and pick a destination. The helper clicks through HallPass for you:
  - It **stops at the Create button** and outlines it, so you always make the last click.
  - If the student search doesn't take full names, it retries with just the last name, then just the first.
  - If two students have the same name, it highlights both and lets you pick.
- **Who's Out.** Passes you make through the helper are listed with live timers. They turn red after the number of minutes you set, and you get a desktop notice. **Back** ends the pass in HallPass once you've also taught **Teach: end a pass**. **×** just clears the row.
- **End at the bell.** With your bell schedules entered and "End my open passes when the bell rings" turned on, the helper ends everyone still out at each bell and tells you who it was.
- **Name-free page outline.** If the helper gets stuck, use **Copy HallPass page outline for Claude**. It produces a text outline of the HallPass screen with student and staff names turned into "Xxxxx". Look it over, then send it to yourself.

## At school: setting it up

1. **At home:** download this `hallpass-helper` folder (on GitHub: Code → Download ZIP, then unzip it). Email or Drive it to your school account. There's no student data in it.
2. **At school:** go to `chrome://extensions`, turn on **Developer mode** (top right), click **Load unpacked**, and choose the `hallpass-helper` folder.
3. Pin the extension, click its icon to open the side panel, and click **Settings**. Fill in:
   - your school, name, room and destinations, exactly as HallPass shows them
   - your class lists (with a "Period 3" line above each class)
   - your bell schedules
4. Open HallPass. In the side panel, click **Teach: make a pass**, make one real pass all the way through Create, then click **Done**. Check the guesses and **Save**.
5. Click **Teach: end a pass**, end that same pass in HallPass, then **Done** → **Save**.
6. Tap a student and watch it fill in. Click **Create** yourself.
7. Stuck somewhere? Click **Copy HallPass page outline for Claude**, check the preview, and email it to yourself to paste into the chat.

Updating later: replace the folder with the new download, then click the reload arrow on the extension in `chrome://extensions`.

## Not built yet

- **"Send when a spot opens"** for passes stuck waiting on bathroom or hallway capacity. That needs a page outline of the waiting screen first.

## Development

Plain JavaScript, no build step.

```sh
cd hallpass-helper
npm test           # logic tests (Node)
npm install        # once, for the browser test
npm run test:e2e   # loads the extension in Chromium against e2e/mock-hallpass.html
```

`e2e/run.mjs` serves the mock page at `hallpass.goguardian.com`, then:
- teaches the helper to make and end a pass
- runs one-tap passes, including a same-name student
- clicks Back
- simulates a bell
- checks that the outline has no names

Set `E2E_SHOTS=/some/dir` to save screenshots.

| File | What it does |
|---|---|
| `lib/bells.js` | Reads bell schedules, finds the current period and the next bell |
| `lib/names.js` | Reads pasted rosters, makes short student labels, searches names |
| `lib/storage.js` | Saved settings and their defaults |
| `content/core.js` | Plain-data helpers: guessing step roles, removing names, matching names, the outline's name filter |
| `content/describe.js` | Describes a clicked element so it can be found again after HallPass redraws |
| `content/recorder.js` | Teach mode: records clicks, typing and choices |
| `content/replay.js` | Repeats taught steps for a student, stops at the final button |
| `content/outline.js` | The name-free page outline |
| `content/hallpass.js` | Answers the side panel and background inside the HallPass tab |
| `background.js` | Bell alarms, overdue alarms, notices |
| `sidepanel/` | Side panel: students, Teach card, Who's Out, outline |
| `options/` | Settings page |
