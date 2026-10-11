// Replaying a taught macro for a particular student and destination.
(() => {
  const HPH = (globalThis.HallPassHelper ??= {});
  HPH.busy = false;

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  async function waitFor(desc, params, timeout = 5000) {
    const until = Date.now() + timeout;
    for (;;) {
      const els = HPH.findTargets(desc, params);
      if (els.length || Date.now() > until) return els;
      await sleep(150);
    }
  }

  function realClick(el) {
    el.scrollIntoView({ block: "center", inline: "center" });
    const r = el.getBoundingClientRect();
    const at = { bubbles: true, cancelable: true, composed: true, view: window, clientX: r.x + r.width / 2, clientY: r.y + r.height / 2 };
    const pointer = { ...at, pointerId: 1, pointerType: "mouse", isPrimary: true };
    el.dispatchEvent(new PointerEvent("pointerover", pointer));
    el.dispatchEvent(new MouseEvent("mouseover", at));
    el.dispatchEvent(new PointerEvent("pointerdown", pointer));
    el.dispatchEvent(new MouseEvent("mousedown", { ...at, buttons: 1 }));
    if (typeof el.focus === "function") el.focus({ preventScroll: true });
    el.dispatchEvent(new PointerEvent("pointerup", pointer));
    el.dispatchEvent(new MouseEvent("mouseup", at));
    el.dispatchEvent(new MouseEvent("click", at));
  }

  // Uses the built-in value setter so React-style inputs notice the change.
  function setValue(el, value) {
    if (el.isContentEditable) {
      el.textContent = value;
      return;
    }
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, "value").set.call(el, value);
  }

  // Types one character at a time, for search boxes that react as you type.
  async function typeInto(el, text) {
    el.focus();
    setValue(el, "");
    el.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "deleteContentBackward" }));
    for (let i = 1; i <= text.length; i++) {
      setValue(el, text.slice(0, i));
      el.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: text[i - 1] }));
      await sleep(25);
    }
    el.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function selectOption(el, text) {
    if (!el.matches("select")) return false;
    const option = [...el.options].find((o) => HPH.normalize(o.text) === HPH.normalize(text));
    if (!option) return false;
    el.value = option.value;
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  }

  function pressKey(el, key) {
    for (const type of ["keydown", "keypress", "keyup"]) {
      el.dispatchEvent(new KeyboardEvent(type, { key, code: key, keyCode: 13, which: 13, bubbles: true, cancelable: true }));
    }
  }

  function valueFor(step, { student, destination }) {
    if (step.value === "{student}") return `${student.first} ${student.last}`.trim();
    if (step.value === "{destination}") return destination ?? "";
    return step.value ?? "";
  }

  // --- highlights ---

  let highlights = [];

  HPH.highlight = (els, text) => {
    HPH.clearHighlights();
    for (const el of els) {
      const prev = { outline: el.style.outline, outlineOffset: el.style.outlineOffset };
      el.style.outline = "3px solid #2f6fdb";
      el.style.outlineOffset = "2px";
      // Badge goes to the right of the element, or below it when there's no room.
      const r = el.getBoundingClientRect();
      const roomRight = r.right + 240 < innerWidth;
      const badge = document.createElement("div");
      badge.dataset.hphUi = "";
      badge.textContent = text;
      Object.assign(badge.style, {
        position: "absolute",
        top: `${(roomRight ? r.top + r.height / 2 - 13 : r.bottom + 6) + scrollY}px`,
        left: `${(roomRight ? r.right + 10 : r.left) + scrollX}px`,
        zIndex: 2147483647,
        background: "#2f6fdb",
        color: "#fff",
        font: "600 13px/1.2 system-ui, sans-serif",
        padding: "5px 9px",
        borderRadius: "6px",
        pointerEvents: "none",
      });
      document.body.append(badge);
      highlights.push({ el, prev, badge });
    }
    els[0]?.scrollIntoView({ block: "center" });
  };

  HPH.clearHighlights = () => {
    for (const { el, prev, badge } of highlights) {
      Object.assign(el.style, prev);
      badge.remove();
    }
    highlights = [];
  };

  // --- the replay itself ---

  // Runs every step, including the final button. Resolves { ok: true }, or
  // { ok: false, reason: "stuck" | "ambiguous" | "busy", step, label } without clicking anything further.
  HPH.runMacro = async (macro, params) => {
    if (HPH.busy) return { ok: false, reason: "busy" };
    HPH.busy = true;
    HPH.clearHighlights();
    const fail = (reason, i) => ({ ok: false, reason, step: i + 1, label: HPH.stepLabel(macro.steps[i]) });
    try {
      let searchBox = null;
      for (let i = 0; i < macro.steps.length; i++) {
        const step = macro.steps[i];
        const studentClick = step.role === "student" && step.action === "click";

        let els = await waitFor(step.target, params, studentClick && searchBox ? 2500 : 5000);
        // The search box may only match first or last names; try each on its own.
        if (!els.length && studentClick && searchBox) {
          for (const alt of [params.student.last, params.student.first]) {
            if (!alt) continue;
            await typeInto(searchBox, alt);
            els = await waitFor(step.target, params, 2500);
            if (els.length) break;
          }
        }
        if (!els.length) return fail("stuck", i);
        if (els.length > 1 && step.role === "student") {
          HPH.highlight(els, "Which one?");
          return fail("ambiguous", i);
        }
        const el = HPH.pick(els, step.target);

        if (step.action === "click") realClick(el);
        else if (step.action === "type") {
          await typeInto(el, valueFor(step, params));
          if (step.role === "student") searchBox = el;
        } else if (step.action === "select") {
          if (!selectOption(el, valueFor(step, params))) return fail("stuck", i);
        } else if (step.action === "key") pressKey(el, step.key);
        await sleep(150);
      }
      return { ok: true };
    } finally {
      HPH.busy = false;
    }
  };
})();
