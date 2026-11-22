// Read-only self-check (dry run) for open GoGuardian pages.
// Never clicks, types, scrolls, dispatches events, or modifies the page or storage.
// Produces a strictly allowlist-scrubbed diagnostic report so selectors and screen states can be verified safely.
(() => {
  const HPH = (globalThis.HallPassHelper ??= {});

  const DISMISS_RE = /^(close|cancel|dismiss|got it|not now|no thanks|maybe later|skip)\b|^[×✕x]$/i;
  const STATUS_WORDS = ["active", "waiting", "pending", "queue", "out", "overtime", "expired", "ended", "returned", "limit", "capacity", "full"];

  const seenNow = (cond, params) =>
    Array.isArray(cond) ? cond.some((d) => seenNow(d, params)) : HPH.findTargets(cond, params, { exactTag: true }).length > 0;
  const allSeen = (conds, params) => !!conds?.length && conds.every((c) => seenNow(c, params));

  function findStepNow(step, params) {
    let els = HPH.findTargets(step.target, params);
    if (!els.length && step.action === "type") {
      const alt = { combobox: "textbox", textbox: "combobox" }[step.target.role];
      if (alt) els = HPH.findTargets({ ...step.target, role: alt }, params);
    }
    return els;
  }

  function describeMatch(el, scrubber) {
    const tag = el.tagName.toLowerCase();
    const role = HPH.roleOf(el);
    const classes = scrubber.scrubClasses(el.classList).slice(0, 4);
    const cls = classes.length ? `.${classes.join(".")}` : "";
    return `${tag}[role=${role}]${cls}`;
  }

  function sameSite(macroHost, pageHost) {
    if (!macroHost) return true;
    const norm = (h) => String(h ?? "").toLowerCase().replace(/^hallpass\.goguardian\.com$/, "campus.goguardian.com");
    return norm(macroHost) === norm(pageHost);
  }

  function applicableMacros(macros, host, isPopup) {
    const list = [];
    const checkMacro = (name, macro) => {
      if (!macro) return;
      if (macro.steps?.length && sameSite(macro.host, host) && Boolean(macro.popup) === Boolean(isPopup)) {
        list.push({ name, macro });
      }
      if (macro.opener?.steps?.length && sameSite(macro.opener.host, host) && !isPopup) {
        list.push({ name: `${name} (opener on home screen)`, macro: macro.opener });
      }
    };
    for (const [how, m] of Object.entries(macros?.make ?? {})) checkMacro(`make via ${how}`, m);
    for (const [how, m] of Object.entries(macros?.endVia ?? {})) checkMacro(`end via ${how}`, m);
    return list;
  }

  function pickProbe({ outPasses = [], queue = [], roster = [], destinations = [] }) {
    let student = null;
    let studentSource = "none";
    if (outPasses[0]?.student) {
      student = outPasses[0].student;
      studentSource = "currently out student (name hidden)";
    } else if (queue[0]?.student) {
      student = queue[0].student;
      studentSource = "first queued student (name hidden)";
    } else if (roster[0]) {
      student = roster[0];
      studentSource = "first roster student (name hidden)";
    } else {
      student = { first: "Student", last: "Alpha" };
      studentSource = "synthetic probe (Student Alpha)";
    }
    const destination = destinations[0] || "Bathroom";
    return { student, destination, studentSource };
  }

  HPH.diagnosePage = ({ macros = {}, lane = "", roster = [], forbidden = [], outPasses = [], queue = [], destinations = [], isPopup = false } = {}) => {
    const scrubber = HPH.createScrubber({ roster, forbidden });
    const scrub = (t) => scrubber.scrubText(t);

    const safeHost = /\.goguardian\.com$/i.test(location.host) ? location.host : "goguardian.invalid";
    const safePath = scrubber.scrubText(HPH.pathShape(location.pathname), { trackAudit: false });
    const version = chrome.runtime.getManifest().version_name ?? chrome.runtime.getManifest().version;

    // 1. Open dialogs / modals
    const dialogs = [...document.querySelectorAll('[role=dialog], [role=alertdialog], [aria-modal=true], dialog[open]')]
      .filter((el) => HPH.visible(el) && !el.closest("[data-hph-ui]"))
      .map((el) => {
        const label = scrub(HPH.accessibleName(el) || el.querySelector("h1,h2,h3,h4")?.innerText || "(unlabeled dialog)");
        const dismiss = [...el.querySelectorAll("button, [role=button], a[href], [aria-label]")].find(
          (b) => HPH.visible(b) && DISMISS_RE.test(HPH.accessibleName(b)),
        );
        return { label, hasDismiss: !!dismiss, dismissLabel: dismiss ? scrub(HPH.accessibleName(dismiss)) : null };
      });

    // 2. Visible headings
    const headings = [...document.querySelectorAll("h1, h2, h3, [role=heading]")]
      .filter((el) => HPH.visible(el) && !el.closest("[data-hph-ui]"))
      .map((el) => scrub(HPH.accessibleName(el) || el.innerText))
      .filter(Boolean)
      .slice(0, 10);

    // 3. Status / queue indicator words (read-only counts of allowlisted UI terms)
    const statusCounts = {};
    const textEls = [...document.querySelectorAll("h1,h2,h3,h4,button,[role=button],[role=tab],[role=status],span,p,li,td,th")]
      .filter((el) => HPH.visible(el) && !el.closest("[data-hph-ui]") && el.children.length <= 2);
    for (const el of textEls) {
      const toks = new Set(HPH.tokens(el.innerText));
      for (const w of STATUS_WORDS) {
        if (toks.has(w)) statusCounts[w] = (statusCounts[w] ?? 0) + 1;
      }
    }

    // 4. Scrollable containers
    const scrollAreas = [...document.querySelectorAll("*")]
      .filter((el) => el !== document.body && el !== document.documentElement && !el.closest("[data-hph-ui]"))
      .filter((el) => HPH.visible(el) && el.scrollHeight > el.clientHeight + 40 && /(auto|scroll)/.test(getComputedStyle(el).overflowY))
      .slice(0, 6)
      .map((el) => ({ desc: describeMatch(el, scrubber), scrollHeight: Math.round(el.scrollHeight), clientHeight: Math.round(el.clientHeight) }));

    // 5. Embedded iframes (hosts only)
    const iframes = [...document.querySelectorAll("iframe")]
      .filter((f) => HPH.visible(f))
      .map((f) => {
        try {
          return new URL(f.src, location.href).host || "(blank)";
        } catch {
          return "(unknown)";
        }
      });

    // 5b. Real GoGuardian signals: live alerts/toasts, Table vs Grid view, active filters, dismissible banners
    const alerts = [...document.querySelectorAll('[role=alert], [aria-live=polite], [aria-live=assertive]')]
      .filter((el) => HPH.visible(el) && !el.closest("[data-hph-ui]"))
      .map((el) => scrub((el.innerText || "").replace(/\s+/g, " ").trim()))
      .filter(Boolean)
      .slice(0, 6);

    const viewRadio = [...document.querySelectorAll('[role=radio][aria-checked=true]')]
      .filter((el) => HPH.visible(el) && !el.closest("[data-hph-ui]"))
      .map((el) => scrub(HPH.accessibleName(el)))
      .filter(Boolean);

    const activeFilters = [];
    for (const inp of document.querySelectorAll('input[type=search], input[aria-label*="Search" i]')) {
      if (!inp.closest("[data-hph-ui]") && HPH.visible(inp) && inp.value.trim()) {
        activeFilters.push(`${scrub(HPH.accessibleName(inp) || "search")}="${scrub(inp.value)}"`);
      }
    }
    const statusFilter = [...document.querySelectorAll('[role=combobox][aria-label*="Status" i]')].find(
      (el) => HPH.visible(el) && !el.closest("[data-hph-ui]"),
    );
    if (statusFilter) {
      const txt = scrub((statusFilter.innerText || "").replace(/\s+/g, " ").trim());
      if (txt) activeFilters.push(`Status filter="${txt}"`);
    }

    const dismissibleBanners = [...document.querySelectorAll('button[aria-label="Dismiss" i], [role=button][aria-label="Dismiss" i]')]
      .filter((el) => HPH.visible(el) && !el.closest("[data-hph-ui]") && !el.closest("[role=dialog], [role=alertdialog]")).length;

    // 6. Dry-run macro step checks (strictly read-only)
    const probe = pickProbe({ outPasses, queue, roster, destinations });
    const params = { student: probe.student, destination: probe.destination };
    const macroList = applicableMacros(macros, location.host, isPopup);
    const macroResults = [];

    for (const { name, macro } of macroList) {
      const routes = [macro.steps, ...(macro.alternates ?? []).map((a) => a.steps)].filter((r) => r?.length);
      const routeResults = routes.map((steps, idx) => {
        const stepResults = steps.map((step, i) => {
          const done = step.done?.length ? allSeen(step.done, params) : false;
          const els = findStepNow(step, params);
          const pickIdx = (step.target?.index ?? 0) < els.length ? (step.target?.index ?? 0) : 0;
          const pausesOnTie = step.role === "student" || !!step.optional;
          const status = done
            ? "SKIP (already done)"
            : els.length === 1
              ? "READY (1 match)"
              : els.length > 1
                ? pausesOnTie
                  ? `AMBIGUOUS (${els.length} matches — would pause)`
                  : `READY (${els.length} matches, picks #${pickIdx + 1})`
                : "not on screen (0)";
          return {
            index: i + 1,
            role: step.role,
            label: scrub(HPH.stepLabel(step)),
            optional: !!step.optional,
            peek: !!step.peek,
            done,
            count: els.length,
            status,
            matched: els[pickIdx] ? describeMatch(els[pickIdx], scrubber) : null,
          };
        });
        const firstRequired = stepResults.find((s) => !s.optional && !s.peek);
        const readyNow = !!firstRequired && (firstRequired.done || firstRequired.count > 0);
        const requiredCount = stepResults.filter((s) => !s.optional && !s.peek).length;
        return { route: idx + 1, readyNow, requiredCount, steps: stepResults };
      });
      macroResults.push({ name, routes: routeResults });
    }

    // 7. Format clean plain-text report
    const lines = [
      "HallPass Helper — Read-Only Self-Check (no clicks, no changes, names hidden)",
      `Helper version: ${version}`,
      `Site: ${safeHost}${isPopup ? " (pop-up window)" : ""}`,
      `Page: ${safePath}`,
      `Viewport: ${innerWidth}x${innerHeight}`,
      `Chosen lane: ${lane || "(default)"}`,
      `Probe student: ${probe.studentSource}`,
      ...(iframes.length ? [`Embedded frames: ${iframes.join(", ")}`] : []),
      "",
      "Screen state right now:",
      `  Headings: ${headings.length ? headings.join(" | ") : "(none visible)"}`,
      `  Open dialogs/modals: ${dialogs.length ? dialogs.map((d) => `"${d.label}"${d.hasDismiss ? ` [dismiss: "${d.dismissLabel}"]` : ""}`).join("; ") : "none"}`,
      ...(alerts.length ? [`  Alerts/toasts: ${alerts.join(" | ")}`] : []),
      ...(viewRadio.length ? [`  Selected view/radio: ${viewRadio.join(", ")}`] : []),
      ...(activeFilters.length ? [`  Filters: ${activeFilters.join("; ")}`] : []),
      ...(dismissibleBanners ? [`  Dismissible banners: ${dismissibleBanners}`] : []),
      `  Scrollable lists: ${scrollAreas.length ? scrollAreas.map((a) => `${a.desc} (${a.clientHeight}px / ${a.scrollHeight}px)`).join("; ") : "none"}`,
      `  Status words seen: ${Object.keys(statusCounts).length ? Object.entries(statusCounts).map(([w, n]) => `${w}(${n})`).join(", ") : "none"}`,
    ];

    if (!macroResults.length) {
      lines.push("", "Macro dry-run: no built-in or learned steps target this page/window type.");
    } else {
      lines.push("", "Macro dry-run (read-only selector check):");
      for (const m of macroResults) {
        lines.push(`  [${m.name}]`);
        for (const r of m.routes) {
          const tag = m.routes.length > 1 ? `Way ${r.route} of ${m.routes.length}` : "Route 1";
          lines.push(`    ${tag} (${r.readyNow ? "would run first right now" : "waiting / not on initial step"}):`);
          for (const s of r.steps) {
            const flags = [s.optional && "optional", s.peek && "peek"].filter(Boolean).join(", ");
            const matchNote = s.matched ? ` -> ${s.matched}` : "";
            lines.push(`      ${s.index}. [${s.role}] ${s.label}${flags ? ` (${flags})` : ""}: ${s.status}${matchNote}`);
          }
        }
      }
    }

    const report = lines.join("\n");
    const check = HPH.verifyClean(report, { roster, forbidden });

    // Summary stats for the side panel banner
    const readyRoutes = macroResults.reduce((acc, m) => acc + m.routes.filter((r) => r.readyNow).length, 0);
    const totalMacros = macroResults.length;

    return {
      ok: true,
      report,
      summary: {
        host: safeHost,
        isPopup,
        dialogs: dialogs.length,
        alerts: alerts.length,
        readyRoutes,
        totalMacros,
      },
      data: { headings, dialogs, alerts, viewRadio, activeFilters, dismissibleBanners, statusCounts, scrollAreas, iframes, macroResults },
      audit: {
        clean: check.clean,
        leaks: check.leaks,
        ...scrubber.audit(),
      },
    };
  };
})();
