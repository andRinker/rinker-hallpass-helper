# HallPass Helper

A Chrome extension that makes GoGuardian Hall Pass fair and steady for a classroom. It isn't made by or affiliated with GoGuardian.

All settings, student names, and taught steps stay in your own browser (`chrome.storage.local`). Nothing is sent anywhere.

## How it works

The helper does two things:

1. **Your queue, sent at a steady pace.** Type students into the queue in the side panel, in the order they asked. The helper makes each one's pass in HallPass, Create included, but only when fewer than your limit (1 by default) of your students are out. So HallPass's waitline never fills up with your whole room.
2. **Passes end on time.** Each pass the helper made is ended in HallPass after 7 minutes (you can change it), and the next student in the queue goes.

The helper doesn't come knowing HallPass's screens. **You teach it once**: make one pass while it watches, then end one, and it repeats those steps for every student.

- **Queue.** Type a name and press Enter, or tap one of the names it suggests from your class lists. Names that aren't on your list are used as typed. Pick the destination first (it remembers the last one). **↑** moves someone up; **×** takes them out of line.
- **Pause / Resume.** Pause holds the line (passes that are out still end on time). If the helper can't make a pass, for example two students in HallPass have the same name, it pauses by itself and says why. Sort it out in HallPass, take that student out of the queue if needed, then **Resume**.
- **Out now.** Who's out, with a timer. **Back** ends the pass in HallPass right away and sends the next student. **×** only clears the row, for a pass you already ended in HallPass yourself. If a pass couldn't be ended on time, the row turns red and says why.
- **Works on GoGuardian's home screen too.** Teach it wherever you usually make passes: HallPass itself or the GoGuardian home screen. It remembers where you taught it and goes back to that tab, even if both are open.
- **HallPass has to stay open.** The helper works in your open HallPass tab. While it makes or ends a pass, it brings that tab forward for a moment and then switches back. To keep that out of sight (say, on a projector), give HallPass its own Chrome window.
- **Name-free page outline.** If the helper gets stuck, use **Copy HallPass page outline for Claude**. It produces a text outline of the HallPass screen with student and staff names turned into "Xxxxx". Look it over, then send it to yourself.

## At school: setting it up

1. **Get the files:** on the repo's GitHub page, click **Code → Download ZIP**. You can do this at school, or at home and then email or Drive the .zip to your school account. There's no student data in it.
2. **Unzip it:** right-click the .zip and choose **Extract All**. Chrome can't load an extension from inside a .zip.
3. **Load it:** go to `chrome://extensions`, turn on **Developer mode** (top right), and click **Load unpacked**. Open the extracted folder and keep going until you reach the folder named **`hallpass-helper`**: the one with `manifest.json` directly inside it. Choose that folder.
   - On Windows the path usually looks like `Downloads\rinker-hallpass-helper-master\rinker-hallpass-helper-master\hallpass-helper`.
   - If Chrome says **"Manifest file is missing or unreadable"**, you chose a folder above `hallpass-helper`. Go one level deeper.
4. Pin the extension, click its icon to open the side panel, and click **Settings**. Fill in:
   - your school, name, room and destinations, exactly as HallPass shows them
   - how many of your students can be out at once (1) and when passes end (7 minutes)
   - your class lists, so names are suggested as you type (optional)
5. Open HallPass, or the GoGuardian home screen if that's where you make passes. In the side panel, click **Teach: make a pass**, make one real pass all the way through Create, then click **Done**. Check the guesses and **Save**.
6. Click **Teach: end a pass**, end that same pass in HallPass, then **Done** → **Save**.
7. Type a student into the queue and watch the helper make the pass.
8. Stuck somewhere? Click **Copy HallPass page outline for Claude**, check the preview, and email it to yourself to paste into the chat.

Updating later: replace the folder with the new download, then click the reload arrow on the extension in `chrome://extensions`. Reload any open GoGuardian tabs afterward.

## Not built yet

- **Telling a pass that's waiting in HallPass's own line from one that's out.** The 7 minutes start when the helper clicks Create. That needs a page outline of HallPass's waiting screen first.
- **Noticing passes you end in HallPass by hand.** Use **Back** in the side panel instead, or **×** afterward, so the next student goes.

## Development

Plain JavaScript, no build step.

```sh
cd hallpass-helper
npm test           # logic tests (Node)
npm install        # once, for the browser test
npm run test:e2e   # loads the extension in Chromium against e2e/mock-hallpass.html
```

`e2e/run.mjs` serves the mock page at `hallpass.goguardian.com` (and at `teacher.goguardian.com` as a stand-in home screen), then:
- teaches the helper to make and end a pass
- queues four students and checks only one is in HallPass at a time
- clicks Back, and fast-forwards a pass past 7 minutes, checking the next student goes each time
- checks a same-name student pauses the queue, and that Pause and Resume work
- checks passes go to the HallPass tab with the home screen in front
- checks that the outline has no names

Set `E2E_SHOTS=/some/dir` to save screenshots.

| File | What it does |
|---|---|
| `lib/names.js` | Reads pasted rosters, makes short student labels, searches names |
| `lib/queue.js` | The queue: name suggestions, who goes next, which passes are due to end |
| `lib/storage.js` | Saved settings and their defaults |
| `lib/tabs.js` | Finds the GoGuardian tab to work in (HallPass or the home screen) |
| `content/core.js` | Plain-data helpers: guessing step roles, removing names, matching names, the outline's name filter |
| `content/describe.js` | Describes a clicked element so it can be found again after HallPass redraws |
| `content/recorder.js` | Teach mode: records clicks, typing and choices |
| `content/replay.js` | Repeats taught steps for a student, Create included |
| `content/outline.js` | The name-free page outline |
| `content/hallpass.js` | Answers the side panel and background inside HallPass or the home screen |
| `background.js` | Sends the next student when a spot opens, ends passes on time, notices |
| `sidepanel/` | Side panel: queue, Teach card, Out now, outline |
| `options/` | Settings page |
