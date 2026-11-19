// Replaying a taught macro for a particular student and destination.
(() => {
  const HPH = (globalThis.HallPassHelper ??= {});
  HPH.busy = false;

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // A long list (or one that only draws the rows on screen) may not have the student's row yet, so once
  // half the wait is gone the helper scrolls through the page's scrolling areas looking for it.
  async function scrollSearch(desc, params) {
    const areas = [document.scrollingElement, ...document.querySelectorAll("*")]
      .filter((el) => el && !el.closest?.("[data-hph-ui]") && el.scrollHeight > el.clientHeight + 40)
      .filter((el) => el === document.scrollingElement || (/(auto|scroll)/.test(getComputedStyle(el).overflowY) && HPH.visible(el)))
      .slice(0, 6);
    for (const area of areas) {
      const start = area.scrollTop;
      for (let i = 0; i < 40; i++) {
        const before = area.scrollTop;
        area.scrollTop = before + area.clientHeight * 0.8;
        await sleep(80);
        const els = HPH.findTargets(desc, params);
        if (els.length) return els;
        if (area.scrollTop === before) break;
      }
      area.scrollTop = start;
    }
    return [];
  }

  async function waitFor(desc, params, timeout = 5000) {
    const until = Date.now() + timeout;
    let scrolled = timeout < 2000;
    for (;;) {
      let els = HPH.findTargets(desc, params);
      if (els.length) return els;
      if (!scrolled && Date.now() > until - timeout / 2) {
        scrolled = true;
        els = await scrollSearch(desc, params);
        if (els.length) return els;
      }
      if (Date.now() >= until) return [];
      await sleep(150);
    }
  }

  // A search box might be announced as a combobox or a plain text box, so a typing step tries both.
  async function waitForStep(step, params, timeout) {
    if (step.action !== "type") return waitFor(step.target, params, timeout);
    const until = Date.now() + timeout;
    const alt = { combobox: "textbox", textbox: "combobox" }[step.target.role];
    for (;;) {
      let els = HPH.findTargets(step.target, params);
      if (!els.length && alt) els = HPH.findTargets({ ...step.target, role: alt }, params);
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
    const keyCode = key === "Escape" ? 27 : 13;
    for (const type of ["keydown", "keypress", "keyup"]) {
      el.dispatchEvent(new KeyboardEvent(type, { key, code: key, keyCode, which: keyCode, bubbles: true, cancelable: true }));
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

  // --- looking at the screen ---

  // `done` is a list of things that must all be on screen; an entry that is itself a list means "any of these".
  const seenNow = (cond, params) => (Array.isArray(cond) ? cond.some((d) => seenNow(d, params)) : HPH.findTargets(cond, params).length > 0);
  const allSeen = (conds, params) => !!conds?.length && conds.every((c) => seenNow(c, params));

  async function waitUntil(test, timeout) {
    const until = Date.now() + timeout;
    for (;;) {
      if (test()) return true;
      if (Date.now() > until) return false;
      await sleep(150);
    }
  }

  const isCommit = (step) => step.commit === true || step.role === "final";

  const DISMISS = /^(close|dismiss|got it|not now|no thanks|maybe later|skip)\b|^[×✕x]$/i;
  const DISMISS_OR_CANCEL = /^(close|cancel|dismiss|got it|not now|no thanks|maybe later|skip)\b|^[×✕x]$/i;

  // Clears pop-ups that are in the way: dialogs the flow doesn't need. Uses the dialog's own Close (or Cancel)
  // button, or the Escape key. In the Create Pass window nothing named Close or Cancel is touched, because
  // that would close the window itself. Returns how many it cleared.
  HPH.clearObstacles = async ({ popup = false } = {}) => {
    const layers = [...document.querySelectorAll('[role=dialog], [role=alertdialog], [aria-modal=true], dialog[open]')].filter(
      (el) => HPH.visible(el) && !el.closest("[data-hph-ui]"),
    );
    let cleared = 0;
    for (const layer of layers.reverse()) {
      const word = popup ? DISMISS : DISMISS_OR_CANCEL;
      const button = [...layer.querySelectorAll('button, [role=button], a[href], [aria-label]')].find(
        (b) => HPH.visible(b) && word.test(HPH.accessibleName(b)),
      );
      if (button) realClick(button);
      else if (!popup) pressKey(layer, "Escape");
      else continue;
      await sleep(350);
      if (!layer.isConnected || !HPH.visible(layer)) cleared++;
    }
    return cleared;
  };

  // --- the replay itself ---

  // Runs the steps of one route. Resolves { ok: true } or { ok: false, reason, step, label, committed }.
  // `ctx.committed` turns true once the final button (or the step that ends the pass) is clicked. From then
  // on the helper only tidies up, and a missing Close button is no problem. It never repeats the final click.
  async function runSteps(steps, params, ctx) {
    const fail = (reason, i) => ({ ok: false, reason, step: i + 1, label: HPH.stepLabel(steps[i]), committed: ctx.committed });
    let searchBox = null;
    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];
      const cleanup = ctx.committed;
      const studentClick = step.role === "student" && step.action === "click";

      // Already where this step would take us (the pass box is open, the student is picked)? Skip it.
      if (!cleanup && !isCommit(step) && allSeen(step.done, params)) {
        ctx.notes.push(`Skipped "${HPH.stepLabel(step)}": it was already done.`);
        continue;
      }
      // A peek step only acts when its button is on screen right now, with no waiting.
      const timeout = step.peek ? 0 : step.optional || cleanup ? 2500 : studentClick && searchBox ? 2500 : 5000;

      let els = await waitForStep(step, params, timeout);
      // The search box may only match first or last names; try each on its own.
      if (!els.length && studentClick && searchBox) {
        for (const alt of [params.student.last, params.student.first]) {
          if (!alt) continue;
          await typeInto(searchBox, alt);
          els = await waitFor(step.target, params, 2500);
          if (els.length) break;
        }
      }
      // Something in the way (a leftover dialog)? Clear it and look again before giving up.
      if (!els.length && !step.optional && !step.peek && !cleanup && (await HPH.clearObstacles({ popup: ctx.popup }))) {
        ctx.notes.push("Closed a pop-up that was in the way.");
        els = await waitForStep(step, params, 3000);
      }
      // Optional steps (a button that only shows up sometimes) are skipped when absent. If several match
      // before the final button, the helper can't tell which is meant, so it stops rather than guess.
      if (!els.length && (step.optional || step.peek || cleanup)) continue;
      if (els.length > 1 && cleanup) continue;
      if (els.length > 1 && step.optional) return fail("ambiguous", i);
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
      if (isCommit(step)) ctx.committed = true;
      await sleep(150);

      // Did the click do what it did when the helper learned it? If not, it may not have landed: once more.
      if (step.action === "click" && step.done?.length && !isCommit(step) && !cleanup) {
        if (!(await waitUntil(() => allSeen(step.done, params), 2500))) {
          const again = HPH.findTargets(step.target, params);
          if (again.length === 1 && !allSeen(step.done, params)) {
            realClick(HPH.pick(again, step.target));
            if (!(await waitUntil(() => allSeen(step.done, params), 2500))) {
              ctx.notes.push(`Couldn't confirm "${HPH.stepLabel(step)}" worked.`);
            }
          }
        }
      }
    }
    return { ok: true };
  }

  const required = (route) => route.filter((s) => !s.optional && !s.peek);

  // Several routes can reach the same goal (for example "end the pass" when its box is already open, or
  // when it isn't). Picks the order to try them in by looking at the screen: routes whose first real step
  // can be done right now go first, shortest first (a shorter route starts further along), then the rest.
  async function routeOrder(routes, params) {
    const all = routes.map((_, i) => i);
    if (routes.length < 2) return all;
    const ready = (i) => {
      const first = required(routes[i])[0];
      return !!first && (allSeen(first.done, params) || HPH.findTargets(first.target, params).length > 0);
    };
    const deadline = Date.now() + 4000;
    let now = all.filter(ready);
    while (!now.length && Date.now() < deadline) {
      await sleep(200);
      now = all.filter(ready);
    }
    now.sort((a, b) => required(routes[a]).length - required(routes[b]).length || a - b);
    return [...now, ...all.filter((i) => !now.includes(i))];
  }

  // Runs every step of a macro, including the final button. A macro is a main route plus optional
  // `alternates`, other routes to the same goal. Resolves { ok: true, route, routes, notes }, or
  // { ok: false, reason: "stuck" | "ambiguous" | "busy", step, label, notes } without clicking anything further.
  // A route that gets stuck before its final button is tried again after clearing pop-ups, then the next one is.
  HPH.runMacro = async (macro, params) => {
    if (HPH.busy) return { ok: false, reason: "busy" };
    HPH.busy = true;
    HPH.clearHighlights();
    const notes = [];
    try {
      const routes = [macro.steps, ...(macro.alternates ?? []).map((a) => a.steps)].filter((r) => r?.length);
      const popup = !!macro.popup;
      let last = null;
      for (const index of await routeOrder(routes, params)) {
        for (let attempt = 0; attempt < 2; attempt++) {
          const ctx = { committed: false, notes, popup };
          const result = await runSteps(routes[index], params, ctx);
          if (result.ok) {
            if (routes.length > 1) notes.push(`Used way ${index + 1} of ${routes.length}.`);
            return { ok: true, route: index + 1, routes: routes.length, notes };
          }
          // Past the final button the pass is made (or ended); only tidying up was left.
          if (result.committed) return { ok: true, route: index + 1, routes: routes.length, notes };
          if (result.reason === "ambiguous") return { ...result, notes };
          last = result;
          // Not made yet: clear whatever is open and try again from the top, then move to the next way.
          const cleared = await HPH.clearObstacles({ popup });
          if (cleared) notes.push("Closed a pop-up that was in the way.");
          notes.push(`Way ${index + 1} got stuck at step ${result.step} ("${result.label}")${attempt === 0 ? ", trying it again" : ""}.`);
        }
      }
      return { ...last, routes: routes.length, notes };
    } finally {
      HPH.busy = false;
    }
  };
})();
