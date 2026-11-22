// Captures an allowlist-scrubbed, standalone HTML snapshot of a GoGuardian page for offline Playwright testing.
// Runs 100% locally in the teacher's browser. Strips scripts, avatars, hidden nodes, raw URLs, IDs and all
// non-UI text, then verifies zero student/school/teacher leaks before returning the HTML + word audit.
(() => {
  const HPH = (globalThis.HallPassHelper ??= {});

  const DROP_TAGS = new Set([
    "script", "noscript", "template", "iframe", "object", "embed", "style", "link", "meta", "base",
    "canvas", "video", "audio", "source", "track", "map", "area", "head",
  ]);
  const VOID_TAGS = new Set(["br", "col", "hr", "img", "input", "wbr"]);
  const SAFE_ENUM_ATTRS = new Set([
    "role", "type", "disabled", "open", "checked", "selected", "tabindex", "name",
    "aria-expanded", "aria-selected", "aria-checked", "aria-disabled", "aria-modal",
    "aria-haspopup", "aria-hidden", "aria-current", "aria-live", "aria-invalid", "aria-required",
    "data-state", "data-orientation", "data-side", "data-disabled", "data-highlighted", "data-selected",
  ]);
  const SAFE_ENUM_VALUE = /^[a-z0-9_ -]{1,32}$/i;
  const TEXT_ATTRS = ["aria-label", "placeholder", "title"];
  const TESTID_ATTRS = ["data-testid", "data-test", "data-cy"];
  const REF_ATTRS = ["for", "aria-labelledby", "aria-describedby", "aria-controls", "aria-owns", "aria-activedescendant"];
  const MAX_ELEMENTS = 8000;

  const escText = (s) =>
    String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");

  const escAttr = (s) => escText(s).replace(/"/g, "&quot;");

  // Minimal self-contained styling so dialogs, buttons, options, inputs and scrollable areas
  // render visibly and cleanly in both the teacher's local Preview tab and Playwright Chromium.
  const SNAPSHOT_CSS = `
    * { box-sizing: border-box; }
    body { font: 14px/1.45 system-ui, -apple-system, sans-serif; color: #1d1d1b; background: #f7f7f5; margin: 16px; }
    .hph-banner { background: #eef3fc; border: 1px solid #b9cef5; color: #1d3b72; padding: 8px 12px; border-radius: 6px; margin-bottom: 14px; font-size: 12.5px; }
    button, [role="button"] { display: inline-flex; align-items: center; gap: 4px; padding: 4px 10px; margin: 2px; border: 1px solid #bbb; border-radius: 6px; background: #fff; color: #1d1d1b; font: inherit; cursor: pointer; }
    button[disabled], [aria-disabled="true"] { opacity: 0.55; }
    [role="dialog"], [role="alertdialog"], dialog[open] { display: block; border: 2px solid #444; border-radius: 8px; background: #fff; padding: 12px; margin: 10px 0; max-width: 680px; }
    [role="listbox"], [role="menu"] { border: 1px solid #ccc; border-radius: 6px; background: #fff; padding: 4px; margin: 4px 0; }
    [role="option"], [role="menuitem"] { display: block; padding: 4px 8px; }
    input, select, textarea { font: inherit; padding: 5px 8px; border: 1px solid #bbb; border-radius: 5px; background: #fff; }
    ul, ol { padding-left: 20px; }
    li, [role="listitem"], [role="row"], tr { margin: 4px 0; }
    table { border-collapse: collapse; width: 100%; }
    td, th { border: 1px solid #ddd; padding: 6px 8px; text-align: left; }
    .hph-scrubbed-img { display: inline-block; width: 20px; height: 20px; border-radius: 50%; background: #ddd; vertical-align: middle; }
  `.trim();

  // Lightweight name-free fingerprint of visible headings, dialogs, alerts, and key controls so the
  // multi-frame Flight Recorder only captures when the visible GoGuardian screen actually changes.
  HPH.screenFingerprint = () => {
    const parts = [HPH.pathShape(location.pathname)];
    const sel = '[role=dialog], [role=alertdialog], [aria-modal=true], dialog[open], [role=alert], [aria-live], h1, h2, h3, [role=heading], [role=option], [role=radio][aria-checked=true], button';
    const seen = [];
    for (const el of document.querySelectorAll(sel)) {
      if (el.closest("[data-hph-ui]") || !HPH.visible(el)) continue;
      const tag = el.tagName.toLowerCase();
      const role = HPH.roleOf(el);
      const name = HPH.accessibleName(el).slice(0, 40);
      const safe = HPH.redact(name);
      seen.push(`${tag}:${role}:${safe}`);
      if (seen.length >= 80) break;
    }
    parts.push(String(seen.length), seen.join("|"));
    return parts.join("##");
  };

  HPH.captureSnapshot = ({ roster = [], forbidden = [], isPopup = false, session = null } = {}) => {
    const scrubber = HPH.createScrubber({ roster, forbidden, session });
    const stats = {
      elementsKept: 0,
      hiddenSkipped: 0,
      scriptsStripped: 0,
      imagesStripped: 0,
      attrsStripped: 0,
      truncated: false,
    };

    // Remap DOM ids deterministically ("hph-id-1", ...) so aria-labelledby / label[for] still work without leaking raw ids.
    const idMap = new Map();
    const mapId = (raw) => {
      if (!raw) return null;
      if (!idMap.has(raw)) idMap.set(raw, `hph-id-${idMap.size + 1}`);
      return idMap.get(raw);
    };

    // Pre-collect referenced ids so we only emit synthetic ids where needed (smaller, cleaner HTML).
    const referencedIds = new Set();
    for (const el of document.body.querySelectorAll("[for], [aria-labelledby], [aria-describedby], [aria-controls], [aria-owns], [aria-activedescendant]")) {
      if (el.closest("[data-hph-ui]")) continue;
      for (const attr of REF_ATTRS) {
        const val = el.getAttribute(attr);
        if (val) for (const tok of val.trim().split(/\s+/)) if (tok) referencedIds.add(tok);
      }
    }

    function isPointerStyle(el) {
      if (el.matches("button, a, input, select, textarea, label, summary")) return false;
      const own = getComputedStyle(el).cursor === "pointer";
      const parent = el.parentElement && el.parentElement !== document.body && getComputedStyle(el.parentElement).cursor === "pointer";
      return own && !parent;
    }

    function isScrollableBox(el) {
      if (el === document.body || el === document.documentElement) return false;
      return el.scrollHeight > el.clientHeight + 40 && /(auto|scroll)/.test(getComputedStyle(el).overflowY);
    }

    function serializeNode(node, insideSelect = false) {
      if (node.nodeType === Node.TEXT_NODE) {
        const raw = node.textContent ?? "";
        if (!raw.trim()) return raw.includes("\n") ? "\n" : " ";
        return escText(scrubber.scrubText(raw));
      }
      if (node.nodeType !== Node.ELEMENT_NODE) return "";

      const el = node;
      const tag = el.tagName.toLowerCase();

      if (el.hasAttribute("data-hph-ui")) return "";
      if (DROP_TAGS.has(tag)) {
        if (tag === "script") stats.scriptsStripped++;
        return "";
      }

      const allowInvisible = insideSelect && (tag === "option" || tag === "optgroup");
      if (!allowInvisible && !HPH.visible(el)) {
        stats.hiddenSkipped++;
        return "";
      }

      if (stats.elementsKept >= MAX_ELEMENTS) {
        stats.truncated = true;
        return "";
      }

      // Replace images/avatars with a harmless placeholder span (never keep src or srcset).
      if (tag === "img") {
        stats.imagesStripped++;
        stats.elementsKept++;
        const alt = el.getAttribute("alt");
        const label = alt ? scrubber.scrubText(alt) : "";
        return label
          ? `<span role="img" class="hph-scrubbed-img" aria-label="${escAttr(label)}"></span>`
          : `<span class="hph-scrubbed-img" aria-hidden="true"></span>`;
      }

      // Replace SVGs with an empty decorative stub so icon paths/titles never bloat or leak text.
      if (tag === "svg") {
        stats.elementsKept++;
        return `<svg aria-hidden="true" width="16" height="16"></svg>`;
      }

      stats.elementsKept++;
      const attrs = [];
      let keptAttrCount = 0;

      // Synthetic id only if referenced by another element's aria-* or label[for].
      if (el.id && referencedIds.has(el.id)) {
        attrs.push(`id="${mapId(el.id)}"`);
        keptAttrCount++;
      }

      // Safe enumerated structural/ARIA attributes.
      for (const attr of SAFE_ENUM_ATTRS) {
        if (!el.hasAttribute(attr)) continue;
        if (attr === "name" && !el.matches("input, select, textarea, button")) continue;
        const val = el.getAttribute(attr);
        if (val === "" || attr === "disabled" || attr === "open" || attr === "checked" || attr === "selected") {
          attrs.push(attr);
          keptAttrCount++;
        } else if (SAFE_ENUM_VALUE.test(val)) {
          // For `name`, scrub through allowlist so custom form names never leak.
          const outVal = attr === "name" ? scrubber.scrubText(val, { trackAudit: false }) : val;
          attrs.push(`${attr}="${escAttr(outVal)}"`);
          keptAttrCount++;
        }
      }

      // Live form state for checkboxes, radios, options, inputs.
      if (tag === "input") {
        const type = (el.getAttribute("type") ?? "text").toLowerCase();
        if ((type === "checkbox" || type === "radio") && el.checked && !attrs.includes("checked")) attrs.push("checked");
        if (type !== "password" && type !== "hidden" && el.value) {
          attrs.push(`value="${escAttr(scrubber.scrubText(el.value))}"`);
        }
      }
      if (tag === "option" && el.selected && !attrs.includes("selected")) attrs.push("selected");

      // Neutralized links (preserve clickable link semantics without exposing real URLs).
      if (tag === "a" && el.hasAttribute("href")) {
        attrs.push('href="#"');
        keptAttrCount++;
      }

      // Scrubbed human-readable attributes.
      for (const attr of TEXT_ATTRS) {
        const val = el.getAttribute(attr);
        if (val) {
          attrs.push(`${attr}="${escAttr(scrubber.scrubText(val))}"`);
          keptAttrCount++;
        }
      }

      // Scrubbed hand-written testids (only short ones without numbers or framework prefixes).
      for (const attr of TESTID_ATTRS) {
        const val = el.getAttribute(attr);
        if (val && val.length < 50 && !/\d|^:|^(radix|mui|react|headlessui|ember)[-_:]/i.test(val)) {
          attrs.push(`${attr}="${escAttr(scrubber.scrubText(val, { trackAudit: false }))}"`);
          keptAttrCount++;
        }
      }

      // Remapped ARIA / label reference attributes.
      for (const attr of REF_ATTRS) {
        const val = el.getAttribute(attr);
        if (!val) continue;
        const mapped = val.trim().split(/\s+/).filter(Boolean).map(mapId).join(" ");
        if (mapped) {
          attrs.push(`${attr}="${mapped}"`);
          keptAttrCount++;
        }
      }

      // Safe CSS utility/semantic classes (preserves Tailwind & role-matching classes without hashes).
      // Drop bare `hidden` when the element is actually visible (e.g. Tailwind's `hidden md:flex` where `md:flex` was stripped).
      const displayVisible = getComputedStyle(el).display !== "none";
      const classes = scrubber.scrubClasses(el.classList).filter((c) => !(displayVisible && c === "hidden"));
      if (classes.length) {
        attrs.push(`class="${escAttr(classes.join(" "))}"`);
        keptAttrCount++;
      }

      // Preserve only the two computed-style behaviors HallPass Helper inspects: pointer cursor and scrollable areas.
      const inlineStyles = [];
      if (isPointerStyle(el)) inlineStyles.push("cursor:pointer");
      if (isScrollableBox(el)) inlineStyles.push("overflow-y:auto;max-height:240px");
      if (inlineStyles.length) attrs.push(`style="${inlineStyles.join(";")}"`);

      stats.attrsStripped += Math.max(0, el.attributes.length - keptAttrCount);

      const openTag = attrs.length ? `<${tag} ${attrs.join(" ")}>` : `<${tag}>`;
      if (VOID_TAGS.has(tag)) return openTag;

      if (tag === "textarea") {
        return `${openTag}${escText(scrubber.scrubText(el.value))}</textarea>`;
      }

      const nextInsideSelect = insideSelect || tag === "select";
      let inner = "";
      for (const child of el.childNodes) inner += serializeNode(child, nextInsideSelect);
      return `${openTag}${inner}</${tag}>`;
    }

    // Count scripts in <head> too so the teacher sees everything stripped.
    stats.scriptsStripped += document.head.querySelectorAll("script").length;

    let bodyInner = "";
    for (const child of document.body.childNodes) bodyInner += serializeNode(child, false);

    const safeHost = /\.goguardian\.com$/i.test(location.host) ? location.host : "goguardian.invalid";
    const safePath = scrubber.scrubText(HPH.pathShape(location.pathname), { trackAudit: false });
    const viewport = `${innerWidth}x${innerHeight}`;
    const version = chrome.runtime.getManifest().version_name ?? chrome.runtime.getManifest().version;

    const html = [
      "<!doctype html>",
      '<html lang="en">',
      "  <head>",
      '    <meta charset="utf-8" />',
      '    <meta name="hph-snapshot-version" content="1" />',
      `    <meta name="hph-site" content="${escAttr(safeHost)}" />`,
      `    <meta name="hph-path" content="${escAttr(safePath)}" />`,
      `    <meta name="hph-popup" content="${isPopup ? "true" : "false"}" />`,
      `    <meta name="hph-viewport" content="${escAttr(viewport)}" />`,
      `    <meta name="hph-helper-version" content="${escAttr(version)}" />`,
      "    <title>Scrubbed HallPass Snapshot</title>",
      `    <style>${SNAPSHOT_CSS}</style>`,
      "  </head>",
      "  <body>",
      '    <div class="hph-banner" data-hph-ui="">Scrubbed DOM snapshot — scripts, avatars, and real names removed locally.</div>',
      bodyInner,
      "  </body>",
      "</html>",
      "",
    ].join("\n");

    const scrubAudit = scrubber.audit();
    const check = HPH.verifyClean(html, { roster, forbidden });
    const slug = isPopup ? "popup" : safeHost.split(".")[0] || "page";

    return {
      ok: true,
      html,
      filename: `hallpass-snapshot-${slug}.html`,
      meta: { host: safeHost, path: safePath, isPopup, viewport },
      audit: {
        clean: check.clean,
        leaks: check.leaks,
        keptWords: scrubAudit.keptWords,
        syntheticNames: scrubAudit.syntheticNames,
        stats: { ...stats, ...scrubAudit.stats },
      },
    };
  };
})();
