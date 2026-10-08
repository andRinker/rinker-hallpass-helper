# HallPass Helper

A Chrome extension that makes GoGuardian Hall Pass less painful for teachers. It isn't made by or affiliated with GoGuardian.

All settings and student names stay in your own browser (`chrome.storage.local`). Nothing is sent anywhere.

## What works today

- **Settings page:** enter your school, name, room, favorite destinations, class lists, and bell schedules once.
  - Paste class lists as "First Last" or "Last, First", with a "Period 3" line above each class.
  - Bell schedules take lines like `Period 1 8:00-8:50`. You can have several, such as Regular, Early release, or A/B days, and choose which one runs each weekday.
- **Side panel:** click the toolbar icon to open it. It stays beside any tab.
  - Today's schedule, the current period, and a countdown to the next bell. You can switch today's schedule here.
  - The current period's students as one-tap buttons. Kids who share a first name are told apart ("Jordan Mi." / "Jordan Ma.").
  - A search box that finds any student on your roster.
  - Whether HallPass is open in Chrome, with a button to open it as a pinned tab.
- **Bell alarm:** the extension sets an alarm for each bell. When "End my open passes when the bell rings" is on, it tries to end your passes at each bell and sends you a notice.

## Not hooked up yet

Anything that clicks inside HallPass itself still needs screenshots or saved copies of the real HallPass screens to know which buttons to press:

- filling in the new-pass form
- one-tap passes
- the "Who's out" list and its Back buttons
- actually ending passes at the bell
- "Send when a spot opens"

All of that goes in `content/hallpass.js`, in the `adapter` object. For now each of those actions reports "not-wired" and the side panel says so.

## Install (for teachers)

1. Download this folder (`hallpass-helper`).
2. In Chrome, go to `chrome://extensions` and turn on **Developer mode** (top right).
3. Click **Load unpacked** and pick the `hallpass-helper` folder.
4. Pin the extension and click its icon to open the side panel. Click **Settings** to set it up.

## Development

There's no build step: it's plain JavaScript modules. To run the logic tests:

```sh
cd hallpass-helper
npm test
```

| File | What it does |
|---|---|
| `lib/bells.js` | Reads bell schedules, finds the current period and the next bell |
| `lib/names.js` | Reads pasted rosters, makes short labels for students, searches names |
| `lib/storage.js` | Saved settings and their defaults |
| `background.js` | Bell alarms and notices |
| `content/hallpass.js` | Runs inside HallPass; the only file that knows HallPass's page layout |
| `sidepanel/`, `options/` | The side panel and the settings page |
