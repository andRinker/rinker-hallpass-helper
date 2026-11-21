// Watch mode: while the teacher clicks around GoGuardian and HallPass, the helper writes down what happens.
//  - every click, typing and choice, as steps (names and all, but only held in memory until the teacher reviews them);
//  - what showed up on screen after each click, using only common button words and the teacher's own settings;
//  - which screens it has been on and how one led to the next, with every other word shaped like "Xxxxx".
// Everything is sent to the background, which keeps it for the side panel. Nothing leaves the browser.
(() => {
  const HPH = (globalThis.HallPassHelper ??= {});
  let watching = null; // { goal, keep, roster }

  const isTextField = (el) =>
    el.matches('textarea, [contenteditable=""], [contenteditable="true"], [role=textbox], [role=searchbox]') ||
    (el.matches("input") && !/^(checkbox|radio|button|submit|reset|image|file|range|color)$/i.test(el.type));

  const ignored = (el) => !watching || HPH.busy || !(el instanceof Element) || el.closest("[data-hph-ui]");
  const send = (msg) => {
    try {
      chrome.runtime.sendMessage({ type: "watch-event", ...msg }).catch(() => {});
    } catch {
      // The extension was reloaded under this page; the next reload picks watching back up.
    }
  };

  // --- what's on screen ---

  const LANDMARKS =
    'button, [role=button], a[href], [role=tab], [role=menuitem], [role=combobox], select, input:not([type=hidden]), textarea, [role=textbox], [role=checkbox], [role=radio], [role=switch], h1, h2, h3, [role=heading], [role=dialog], [role=alertdialog]';
  const PRIORITY = { dialog: 0, alertdialog: 0, heading: 1, combobox: 2, textbox: 2, button: 3 };

  // Every visible, named control and heading on the page: Map of "role|name" -> { role, name, safe, ... }.
  // `safe` means the name is only common UI words and the teacher's own settings, so it can be written down as is.
  function marks() {
    const out = new Map();
    for (const el of document.querySelectorAll(LANDMARKS)) {
      if (el.closest("[data-hph-ui]") || !HPH.visible(el)) continue;
      const heading = /^h[1-3]$/i.test(el.tagName) || el.getAttribute("role") === "heading";
      const role = heading ? "heading" : HPH.roleOf(el);
      const name = HPH.accessibleName(el).replace(/\s+/g, " ").trim();
      if (!name || name.length > 60) continue;
      const key = `${role}|${name}`;
      if (out.has(key)) continue;
      const safe = HPH.redact(name, watching ?? {}) === name;
      out.set(key, {
        role: heading ? "generic" : role, // headings are found by their tag
        shown: heading ? "heading" : role,
        name,
        safe,
        tag: el.tagName.toLowerCase(),
        type: el.getAttribute("type") ?? undefined,
        classes: HPH.classesOf(el),
      });
    }
    return out;
  }

  // The page's headings and dialog names say which screen this is; everything else on it can change.
  const screenId = (m = marks()) => {
    const names = [...m.values()].filter((x) => x.shown === "heading" || x.shown === "dialog" || x.shown === "alertdialog");
    return `${HPH.pathShape(location.pathname)}|${names.map((x) => (x.safe ? x.name : HPH.shapeOf(x.name))).sort().join(";")}`;
  };

  let lastScreen = null;
  let lastControls = "";
  // Reported when the screen changes, or when more controls show up on it (a pass box opening, say).
  function sendScreen(m = marks()) {
    const id = screenId(m);
    const controls = [...m.keys()].sort().join("\n");
    if (id === lastScreen && controls === lastControls) return id;
    lastScreen = id;
    lastControls = controls;
    const list = [...m.values()]
      .sort((a, b) => (PRIORITY[a.shown] ?? 4) - (PRIORITY[b.shown] ?? 4))
      .slice(0, 60)
      .map((x) => ({ role: x.shown, name: x.safe ? x.name : HPH.redact(x.name, watching ?? {}) }));
    send({ ev: "screen", id, path: HPH.pathShape(location.pathname), landmarks: list });
    return id;
  }

  // What showed up after a click, as things the helper can look for later. Only safe names qualify. The picture
  // is taken when the next press starts (or after a moment), so each click only gets credit for its own results.
  let pendingAfter = []; // [{ uid, before, via, timer }]

  function finishAppears(p) {
    clearTimeout(p.timer);
    pendingAfter = pendingAfter.filter((x) => x !== p);
    if (!watching) return;
    const after = marks();
    const appears = [...after.entries()]
      .filter(([key, x]) => x.safe && !p.before.has(key))
      .map(([, x]) => ({ role: x.role, name: x.name, tag: x.tag, type: x.type, classes: x.classes, context: "", index: 0, pointer: false, shown: x.shown }))
      .sort((a, b) => (PRIORITY[a.shown] ?? 4) - (PRIORITY[b.shown] ?? 4))
      .slice(0, 4)
      .map(({ shown, ...desc }) => desc);
    if (appears.length) send({ ev: "appears", uid: p.uid, appears });
    const to = sendScreen(after);
    if (to !== p.via.from) send({ ev: "edge", from: p.via.from, to, via: p.via.label });
  }

  const finishAllAppears = () => [...pendingAfter].forEach(finishAppears);

  function learnAppears(uid, before, via) {
    const p = { uid, before, via };
    p.timer = setTimeout(() => finishAppears(p), 800);
    pendingAfter.push(p);
  }

  // --- steps ---

  let seq = 0;
  const newId = () => `${Date.now().toString(36)}-${(seq++).toString(36)}`;

  // Typing is sent once the teacher pauses, not for every letter.
  let typing = null; // { step, timer }
  function flushTyping() {
    if (!typing) return;
    clearTimeout(typing.timer);
    const { step } = typing;
    typing = null;
    send({ ev: "step", uid: newId(), step });
  }

  function push(step, before, from) {
    if (!watching) return;
    if (step.action === "type") {
      if (typing && !HPH.sameTarget(typing.step.target, step.target)) flushTyping();
      clearTimeout(typing?.timer);
      typing = { step, timer: setTimeout(flushTyping, 500) };
      return;
    }
    flushTyping();
    const uid = newId();
    send({ ev: "step", uid, step });
    if (step.action === "click") {
      const label = step.target.role === "listitem" ? "an item" : HPH.redact(step.target.name || step.target.tag, watching);
      learnAppears(uid, before ?? marks(), { from: from ?? lastScreen, label });
    }
  }

  // Many dropdowns (HallPass's among them) pick an option on mouse release and close at once,
  // so the click never arrives. Each press is described as it starts, and kept even when no click follows.
  let press = null; // { el, target, done, before, from }
  const PRESS_WAIT_MS = 400;

  // A press still waiting for its click goes in first, so steps stay in the order they happened.
  function flushPress() {
    if (!press || press.done) return;
    press.done = true;
    push({ action: "click", target: press.target }, press.before, press.from);
  }

  function onPointerDown(e) {
    flushPress();
    finishAllAppears();
    const t = e.target;
    if (e.button !== 0 || ignored(t) || isTextField(t) || t.closest("select")) return;
    const { el, pointer } = HPH.clickableRoot(t);
    const before = marks();
    press = { el, target: HPH.describe(el, pointer), done: false, before, from: lastScreen ?? screenId(before) };
  }

  function onPointerUp() {
    const p = press;
    if (!p) return;
    setTimeout(() => {
      if (press === p && watching) flushPress();
    }, PRESS_WAIT_MS);
  }

  function onClick(e) {
    const t = e.target;
    if (ignored(t) || isTextField(t) || t.closest("select")) return;
    const { el, pointer } = HPH.clickableRoot(t);
    // The press may already be in: pressing elsewhere blurs a search box, and its change event flushes it.
    if (press?.el === el) {
      flushPress();
      press = null;
      return;
    }
    // Pressed on one thing and released on another: the press already counts, so skip this click.
    if (press && !press.done) return;
    push({ action: "click", target: HPH.describe(el, pointer) });
  }

  function onInput(e) {
    if (watching) flushPress();
    const t = e.target;
    if (ignored(t) || !isTextField(t)) return;
    const value = t.matches("input, textarea") ? t.value : t.innerText;
    push({ action: "type", target: HPH.describe(t), value });
  }

  function onChange(e) {
    if (watching) flushPress();
    const t = e.target;
    if (ignored(t) || !t.matches("select")) return;
    push({ action: "select", target: HPH.describe(t), value: t.selectedOptions[0]?.text.trim() ?? "" });
  }

  function onKeydown(e) {
    if (watching) flushPress();
    const t = e.target;
    if (e.key !== "Enter" || ignored(t) || !isTextField(t)) return;
    flushTyping();
    push({ action: "key", key: "Enter", target: HPH.describe(t) });
  }

  const LISTENERS = [
    ["pointerdown", onPointerDown],
    ["pointerup", onPointerUp],
    ["click", onClick],
    ["input", onInput],
    ["change", onChange],
    ["keydown", onKeydown],
  ];

  function listen(on) {
    for (const [type, fn] of LISTENERS) {
      (on ? document.addEventListener : document.removeEventListener).call(document, type, fn, true);
    }
  }

  // `settings` is { goal, keep, roster }: the teacher's own words (kept as they are) and the class list (always hidden).
  HPH.startWatching = (settings) => {
    if (watching) listen(false);
    watching = { goal: settings.goal, keep: settings.keep ?? [], roster: settings.roster ?? [] };
    press = null;
    typing = null;
    pendingAfter = [];
    lastScreen = null;
    lastControls = "";
    listen(true);
    sendScreen();
  };

  HPH.stopWatching = () => {
    if (watching) {
      flushPress();
      flushTyping();
      finishAllAppears();
    }
    press = null;
    watching = null;
    listen(false);
  };

  HPH.isWatching = () => !!watching;

  // A page opened (or reloaded) while the teacher is showing the helper around joins in.
  try {
    chrome.runtime
      .sendMessage({ type: "watch-hello" })
      .then((reply) => reply?.active && HPH.startWatching(reply))
      .catch(() => {});
  } catch {
    // no extension context
  }
})();
