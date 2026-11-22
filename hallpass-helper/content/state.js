// Read-only inspector for real GoGuardian HallPass screen state (campus.goguardian.com) and mock pages.
// Detects Pass Details blockers (hard "requires action" vs auto-clearing "at capacity"), reads active
// and waiting passes under "My passes", and notifies background.js when visible pass states change.
(() => {
  const HPH = (globalThis.HallPassHelper ??= {});

  const clean = (text, max = 200) =>
    String(text ?? "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, max);

  // Joins visible text nodes with spaces so adjacent inline <span>s (e.g. "<span>Name</span><span>Room</span>")
  // never concatenate into one token regardless of CSS layout.
  function textWithSpaces(root, max = 300) {
    if (!root) return "";
    const parts = [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      const parent = node.parentElement;
      if (parent && parent.closest("[data-hph-ui]")) continue;
      const t = node.textContent?.trim();
      if (t) parts.push(t);
    }
    return clean(parts.join(" "), max);
  }

  const HARD_BLOCKER_RE =
    /\b(pass limit|reached.*limit|daily limit|weekly limit|already has|restricted|conflict|cooldown|cannot|not allowed|blocked)\b/i;
  const HARD_GROUP_RE = /requires your action|won'?t clear automatically/i;
  const AUTO_BLOCKER_RE = /\b(at capacity|capacity|room.*full|destination.*full|waitline|waitlist)\b/i;
  const AUTO_GROUP_RE = /will clear automatically|resolve at the time|override now/i;
  const ETA_RE = /(?:<|≤|~)?\s*\d+\s*(?:m|min|mins|minute|minutes|x)\b/i;

  function findDialogByTitle(titleRe) {
    const dialogs = [...document.querySelectorAll('[role=dialog], [role=alertdialog], [aria-modal=true], dialog[open]')].filter(
      (el) => HPH.visible(el) && !el.closest("[data-hph-ui]"),
    );
    for (const d of dialogs) {
      const name = HPH.accessibleName(d);
      if (titleRe.test(name)) return d;
      const heading = d.querySelector("h1, h2, h3, [role=heading]");
      if (heading && titleRe.test(clean(heading.textContent))) return d;
    }
    return null;
  }

  function dialogButtons(dialog) {
    return [...dialog.querySelectorAll("button, [role=button]")].filter((b) => HPH.visible(b) && !b.closest("[data-hph-ui]"));
  }

  // Inspects a currently visible Pass Details dialog (returns null if closed).
  HPH.readPassDetails = () => {
    const dialog = findDialogByTitle(/^pass details$/i);
    if (!dialog) return null;

    const buttons = dialogButtons(dialog);
    const findBtn = (re) => buttons.find((b) => re.test(HPH.accessibleName(b))) ?? null;
    const overrideBtn = findBtn(/^override blockers$/i);
    const rejectBtn = findBtn(/^reject pass$/i);
    const endBtn = findBtn(/^end pass$/i);
    const closeBtn = findBtn(/^close$/i);

    // Student name button/heading near the top of Pass Details.
    const studentHeading =
      dialog.querySelector("h2:not(.sr-only) button, h2:not(.sr-only), .who") ??
      dialog.querySelector("button[aria-haspopup=dialog]");
    const studentText = clean(studentHeading?.innerText ?? studentHeading?.textContent ?? "");

    // Look for the "Pass has blockers" section and classify each fieldset/item into hard vs auto-clearing.
    const hardBlockers = [];
    const autoBlockers = [];
    let etaText = null;

    const blockerSection = [...dialog.querySelectorAll("section, form")].find((el) =>
      /pass has blockers/i.test(el.textContent ?? ""),
    );
    const fieldsets = blockerSection ? [...blockerSection.querySelectorAll("fieldset")] : [];

    for (const fs of fieldsets) {
      const legend = clean(fs.querySelector("legend")?.textContent ?? "");
      const descId = fs.getAttribute("aria-describedby");
      const descText = clean((descId ? document.getElementById(descId)?.textContent : fs.querySelector("p")?.textContent) ?? "");
      const groupHint = `${legend} ${descText}`;
      const groupIsHard = HARD_GROUP_RE.test(groupHint);
      const groupIsAuto = AUTO_GROUP_RE.test(groupHint);

      const items = [...fs.querySelectorAll("li")];
      const rows = items.length ? items : [fs];
      for (const row of rows) {
        const labelEl = row.querySelector("label");
        const label = clean(labelEl?.textContent ?? row.textContent ?? "");
        if (!label) continue;

        // Check for an ETA pill (e.g. "< 5m") sitting beside an auto-clearing blocker.
        const etaCandidate = [...row.querySelectorAll("button, span")]
          .map((el) => clean(el.textContent))
          .find((t) => t.length <= 12 && ETA_RE.test(t));
        if (etaCandidate && !etaText) etaText = etaCandidate;

        // Classification priority: explicit hard keywords/group beat auto-clearing; capacity/ETA/auto-group -> auto.
        if (HARD_BLOCKER_RE.test(label) || (groupIsHard && !AUTO_BLOCKER_RE.test(label))) {
          hardBlockers.push(label);
        } else if (AUTO_BLOCKER_RE.test(label) || groupIsAuto || !!etaCandidate) {
          autoBlockers.push(label);
        } else {
          // Unknown blocker defaults safely to hard (requires action) so we never silently wait forever.
          hardBlockers.push(label);
        }
      }
    }

    // Fallback: blocker section present without <fieldset> tags.
    if (blockerSection && !hardBlockers.length && !autoBlockers.length) {
      const txt = clean(blockerSection.textContent, 300);
      if (HARD_BLOCKER_RE.test(txt)) hardBlockers.push(txt);
      else if (AUTO_BLOCKER_RE.test(txt)) autoBlockers.push(txt);
      else hardBlockers.push("Pass has blockers");
    }

    const hasBlockers = hardBlockers.length > 0 || autoBlockers.length > 0 || !!overrideBtn;
    const dialogText = clean(dialog.innerText ?? dialog.textContent ?? "", 500);
    let status = "unknown";
    if (hasBlockers || /\bwaiting for approval\b/i.test(dialogText)) status = "waiting";
    else if (endBtn || /\bactive\b/i.test(dialogText)) status = "active";
    else if (/\bended\b|\brejected\b/i.test(dialogText)) status = "ended";

    return {
      open: true,
      studentText,
      status,
      hasBlockers,
      hardBlockers,
      autoBlockers,
      etaText,
      canOverride: !!overrideBtn,
      canReject: !!rejectBtn,
      canEnd: !!endBtn,
      _els: { dialog, overrideBtn, rejectBtn, endBtn, closeBtn },
    };
  };

  function sectionCardsAfter(headingEl, defaultStatus) {
    // Walk up 1-2 levels to find the container holding the heading + sibling card grid or <ul>.
    let container = headingEl.parentElement;
    if (container && !container.querySelector(".grid, ul, ol")) container = container.parentElement;
    if (!container) return { found: false, cards: [] };

    const listRoot =
      container.querySelector(":scope > .grid") ??
      container.querySelector(".grid") ??
      container.querySelector(":scope > ul, :scope > ol") ??
      (headingEl.nextElementSibling?.matches("ul, ol, .grid") ? headingEl.nextElementSibling : null);

    // Real campus.goguardian.com shows "No active passes" when the active grid is empty.
    const emptyState = [...container.querySelectorAll("h2, h3, h4, p, div")].some(
      (el) => HPH.visible(el) && el.children.length === 0 && /^no active passes$/i.test(clean(el.textContent)),
    );

    if (!listRoot || !HPH.visible(listRoot)) {
      return { found: emptyState, cards: [] };
    }

    const cards = [];
    for (const child of listRoot.children) {
      if (!HPH.visible(child) || child.closest("[data-hph-ui]")) continue;
      const text = textWithSpaces(child, 300);
      if (!text || /^no active passes$/i.test(text)) continue;
      const btns = [...child.querySelectorAll("button, [role=button]")].filter((b) => HPH.visible(b));
      const hasEnd = btns.some((b) => /^end pass$/i.test(HPH.accessibleName(b)));
      const hasReject = btns.some((b) => /^reject(?:\s+pass)?$/i.test(HPH.accessibleName(b)));
      const hasShowBlockers = btns.some((b) => /^show blockers$/i.test(HPH.accessibleName(b)));
      const status =
        hasReject || hasShowBlockers || /\bwaiting for approval\b/i.test(text)
          ? "waiting"
          : hasEnd || /\bactive\b/i.test(text) || defaultStatus === "active"
            ? "active"
            : defaultStatus;
      cards.push({ status, text, hasEnd, hasReject, hasShowBlockers, el: child });
    }
    return { found: true, cards };
  }

  // Reads the visible "My passes" cards (Active passes + Pass waiting for approval) on campus.goguardian.com
  // and mock HallPass pages. Strictly read-only. Only reports `supported: true` when the real card container
  // or empty-state heading is confirmed present, so layout changes never cause false missing-pass clears.
  HPH.readMyPasses = () => {
    const headings = [...document.querySelectorAll("h2, h3, [role=heading]")].filter(
      (el) => HPH.visible(el) && !el.closest("[data-hph-ui]") && !el.closest("[role=dialog], [role=alertdialog]"),
    );

    const activeHeading = headings.find((h) => /^active passes$/i.test(clean(h.textContent)));
    const waitingHeading = headings.find((h) => /\bpass(?:es)?\s+waiting for approval\b/i.test(clean(h.textContent)));

    if (!activeHeading && !waitingHeading) {
      return { supported: false, requestsCollapsed: false, filtered: false, cards: [] };
    }

    const waitingSec = waitingHeading ? sectionCardsAfter(waitingHeading, "waiting") : { found: false, cards: [] };
    const activeSec = activeHeading ? sectionCardsAfter(activeHeading, "active") : { found: false, cards: [] };
    const supported = activeSec.found || waitingSec.found;
    if (!supported) {
      return { supported: false, requestsCollapsed: false, filtered: false, cards: [] };
    }

    const requestsCollapsed = [...document.querySelectorAll("button, [role=button]")].some(
      (b) => HPH.visible(b) && !b.closest("[data-hph-ui]") && /^show requests$/i.test(HPH.accessibleName(b)),
    );

    // Never treat a student as missing if the teacher has typed into a search filter on the page.
    const filtered = [...document.querySelectorAll('input[type=search], input[aria-label*="Search" i]')].some(
      (inp) => !inp.closest("[data-hph-ui]") && !inp.closest("[role=dialog]") && HPH.visible(inp) && inp.value.trim().length > 0,
    );

    return {
      supported: true,
      requestsCollapsed,
      filtered,
      cards: [...waitingSec.cards, ...activeSec.cards],
    };
  };

  HPH.findStudentPass = (student) => {
    const snap = HPH.readMyPasses();
    if (!snap.supported) return { supported: false, requestsCollapsed: false, filtered: false, status: "unknown" };
    const matches = snap.cards.filter((c) => HPH.nameMatches(c.text, student));
    const active = matches.find((c) => c.status === "active");
    const waiting = matches.find((c) => c.status === "waiting");
    const status = active ? "active" : waiting ? "waiting" : "missing";
    return {
      supported: true,
      requestsCollapsed: snap.requestsCollapsed,
      filtered: snap.filtered,
      status,
      card: active ?? waiting ?? null,
    };
  };

  // Cancels/rejects a student's waiting pass either from an already-open Pass Details dialog
  // or directly via the Reject button on their "Waiting for Approval" card.
  HPH.rejectWaitingPass = async (student) => {
    const click = HPH.realClick ?? ((el) => el.click());
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

    const details = HPH.readPassDetails();
    if (details?.open && details.canReject && HPH.nameMatches(details.studentText, student)) {
      click(details._els.rejectBtn);
      await sleep(400);
      const after = HPH.readPassDetails();
      if (after?.open && after._els.closeBtn) click(after._els.closeBtn);
      return { ok: true, via: "pass-details" };
    }

    const found = HPH.findStudentPass(student);
    if (found.supported && found.status === "missing" && !found.requestsCollapsed && !found.filtered) {
      return { ok: true, via: "already-gone" };
    }
    if (found.card && found.status === "waiting") {
      const rejectBtn = [...found.card.el.querySelectorAll("button, [role=button]")].find(
        (b) => HPH.visible(b) && /^reject(?:\s+pass)?$/i.test(HPH.accessibleName(b)),
      );
      if (rejectBtn) {
        click(rejectBtn);
        await sleep(400);
        return { ok: true, via: "waiting-card" };
      }
    }
    return { ok: false, reason: "stuck" };
  };

  // Lightweight live observer: pings background.js (with zero student names) when Active/Waiting pass counts
  // or statuses change on campus.goguardian.com so waiting passes start their 7-minute timer immediately
  // when promoted to Active and manually ended passes clear right away.
  if (typeof document !== "undefined" && typeof MutationObserver !== "undefined" && globalThis.chrome?.runtime?.sendMessage) {
    let lastSig = "";
    let timer = null;

    const passSignature = () => {
      const snap = HPH.readMyPasses();
      if (!snap.supported) return "";
      const active = snap.cards.filter((c) => c.status === "active").length;
      const waiting = snap.cards.filter((c) => c.status === "waiting").length;
      return `${active}:${waiting}:${snap.requestsCollapsed ? 1 : 0}:${snap.filtered ? 1 : 0}`;
    };

    const schedulePing = () => {
      if (HPH.busy) return;
      clearTimeout(timer);
      timer = setTimeout(() => {
        if (HPH.busy) return;
        const sig = passSignature();
        if (!sig || sig === lastSig) return;
        lastSig = sig;
        try {
          chrome.runtime.sendMessage({ type: "hallpass-state-changed" }).catch(() => {});
        } catch {
          // Extension reloaded; ignore.
        }
      }, 1200);
    };

    const startObserver = () => {
      if (!document.body) return;
      lastSig = passSignature();
      const obs = new MutationObserver((mutations) => {
        if (HPH.busy) return;
        const relevant = mutations.some((m) => {
          const target = m.target instanceof Element ? m.target : m.target?.parentElement;
          return target && !target.closest("[data-hph-ui]");
        });
        if (relevant) schedulePing();
      });
      obs.observe(document.body, { childList: true, subtree: true });
    };

    if (document.body) startObserver();
    else document.addEventListener("DOMContentLoaded", startObserver, { once: true });
  }
})();
