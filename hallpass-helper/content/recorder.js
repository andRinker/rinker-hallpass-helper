// Teach mode: watch the teacher make (or end) one pass and keep the steps.
// The recording survives a page reload in the same tab via sessionStorage.
(() => {
  const HPH = (globalThis.HallPassHelper ??= {});
  const KEY = "hph-recording";
  let recording = null; // { kind, steps }

  const isTextField = (el) =>
    el.matches('textarea, [contenteditable=""], [contenteditable="true"], [role=textbox], [role=searchbox]') ||
    (el.matches("input") && !/^(checkbox|radio|button|submit|reset|image|file|range|color)$/i.test(el.type));

  const ignored = (el) => !recording || HPH.busy || !(el instanceof Element) || el.closest("[data-hph-ui]");

  function push(step) {
    recording.steps = HPH.addStep(recording.steps, step);
    sessionStorage.setItem(KEY, JSON.stringify(recording));
    chrome.runtime
      .sendMessage({ type: "teach-progress", count: recording.steps.length, last: HPH.stepLabel(step) })
      .catch(() => {});
  }

  // Many dropdowns (HallPass's among them) pick an option on mouse release and close at once,
  // so the click never arrives. Each press is described as it starts, and kept even when no click follows.
  let press = null; // { el, target, done }
  const PRESS_WAIT_MS = 400;

  // A press still waiting for its click goes in first, so steps stay in the order they happened.
  function flushPress() {
    if (!press || press.done) return;
    press.done = true;
    push({ action: "click", target: press.target });
  }

  function onPointerDown(e) {
    flushPress();
    const t = e.target;
    if (e.button !== 0 || ignored(t) || isTextField(t) || t.closest("select")) return;
    const { el, pointer } = HPH.clickableRoot(t);
    press = { el, target: HPH.describe(el, pointer), done: false };
  }

  function onPointerUp() {
    const p = press;
    if (!p) return;
    setTimeout(() => {
      if (press === p && recording) flushPress();
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
    if (recording) flushPress();
    const t = e.target;
    if (ignored(t) || !isTextField(t)) return;
    const value = t.matches("input, textarea") ? t.value : t.innerText;
    push({ action: "type", target: HPH.describe(t), value });
  }

  function onChange(e) {
    if (recording) flushPress();
    const t = e.target;
    if (ignored(t) || !t.matches("select")) return;
    push({ action: "select", target: HPH.describe(t), value: t.selectedOptions[0]?.text.trim() ?? "" });
  }

  function onKeydown(e) {
    if (recording) flushPress();
    const t = e.target;
    if (e.key !== "Enter" || ignored(t) || !isTextField(t)) return;
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

  HPH.startRecording = (kind) => {
    if (recording) listen(false);
    recording = { kind, steps: [] };
    press = null;
    sessionStorage.setItem(KEY, JSON.stringify(recording));
    listen(true);
  };

  HPH.stopRecording = () => {
    if (recording) flushPress();
    press = null;
    const done = recording ?? { kind: null, steps: [] };
    recording = null;
    sessionStorage.removeItem(KEY);
    listen(false);
    return done;
  };

  HPH.recordingStatus = () =>
    recording ? { recording: true, kind: recording.kind, count: recording.steps.length } : { recording: false };

  try {
    const saved = JSON.parse(sessionStorage.getItem(KEY) ?? "null");
    if (saved?.kind) {
      recording = saved;
      listen(true);
    }
  } catch {
    sessionStorage.removeItem(KEY);
  }
})();
