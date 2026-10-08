// A name-free outline of the HallPass page that's safe to send home: page structure,
// buttons and labels, with any text that isn't a UI word or the teacher's own setting shaped
// into "Xxxxx Xxxx".
(() => {
  const HPH = (globalThis.HallPassHelper ??= {});

  const SKIP = new Set(["script", "style", "noscript", "template", "svg", "meta", "link", "iframe", "head"]);
  const SHOWN_TAGS = new Set(
    "h1 h2 h3 h4 h5 h6 button a input select textarea label li ul ol table tr dialog form nav header main aside section article img".split(" "),
  );
  const MAX_LINES = 1500;

  function ownText(el) {
    return [...el.childNodes]
      .filter((n) => n.nodeType === Node.TEXT_NODE)
      .map((n) => n.textContent)
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function lineFor(el, R) {
    const tag = el.tagName.toLowerCase();
    const explicitRole = el.getAttribute("role");
    const testid = el.getAttribute("data-testid") ?? el.getAttribute("data-test") ?? el.getAttribute("data-cy");
    const aria = el.getAttribute("aria-label");
    const pointer = getComputedStyle(el).cursor === "pointer" && getComputedStyle(el.parentElement ?? el).cursor !== "pointer";
    const text = ownText(el);
    if (!SHOWN_TAGS.has(tag) && !explicitRole && !testid && !aria && !pointer && !text) return null;

    const role = HPH.roleOf(el);
    const named = ["button", "link", "option", "menuitem", "tab", "checkbox", "radio", "heading"].includes(role) || /^h\d$/.test(tag) || aria;
    const name = named ? HPH.accessibleName(el) : text;
    const parts = [tag];
    if (explicitRole) parts.push(`[role=${explicitRole}]`);
    if (testid) parts.push(`{${R(testid.replace(/\d+/g, "#"))}}`);
    const classes = HPH.classesOf(el);
    if (classes.length) parts.push(`.${classes.map(R).join(".")}`);
    if (name) parts.push(`"${R(name)}"`);
    if (el.matches("input, textarea")) {
      if (el.type && el.type !== "text") parts.push(`type=${el.type}`);
      const placeholder = el.getAttribute("placeholder");
      if (placeholder) parts.push(`placeholder="${R(placeholder)}"`);
      if (el.value) parts.push(`value="${HPH.shapeOf(el.value)}"`);
    }
    if (el.matches("select")) {
      parts.push(`selected="${R(el.selectedOptions[0]?.text ?? "")}"`, `(${el.options.length} options)`);
    }
    if (pointer && !["button", "link", "option"].includes(role)) parts.push("(clickable)");
    if (el.disabled || el.getAttribute("aria-disabled") === "true") parts.push("(disabled)");
    return parts.join(" ");
  }

  function build(el, R) {
    const tag = el.tagName.toLowerCase();
    if (SKIP.has(tag) || el.hasAttribute("data-hph-ui") || !HPH.visible(el)) return [];
    const children = tag === "select" ? [] : [...el.children].flatMap((c) => build(c, R));
    const line = lineFor(el, R);
    return line ? [{ line, children }] : children;
  }

  const signature = (node) => node.line.replace(/"[^"]*"/g, '"…"') + "(" + node.children.map(signature).join(",") + ")";

  function render(nodes, depth, out) {
    for (let i = 0; i < nodes.length && out.length < MAX_LINES; ) {
      const sig = signature(nodes[i]);
      let run = 1;
      while (i + run < nodes.length && signature(nodes[i + run]) === sig) run++;
      const shown = run >= 4 ? 3 : run;
      for (let k = 0; k < shown; k++) {
        out.push(`${"  ".repeat(depth)}${nodes[i + k].line}`);
        render(nodes[i + k].children, depth + 1, out);
      }
      if (run > shown) out.push(`${"  ".repeat(depth)}… and ${run - shown} more like this`);
      i += run;
    }
  }

  function macroLines(macros, R) {
    const out = [];
    for (const [kind, macro] of Object.entries(macros ?? {})) {
      out.push(`Taught "${kind}" steps:`);
      macro.steps.forEach((step, i) => {
        const t = step.target;
        out.push(`  ${i + 1}. [${step.role}] ${R(HPH.stepLabel(step))}`);
        const bits = [`role=${t.role}`, `tag=${t.tag}`];
        if (t.testid) bits.push(`testid=${R(t.testid)}`);
        if (t.classes?.length) bits.push(`classes=${t.classes.map(R).join(".")}`);
        if (t.context) bits.push(`context="${R(t.context)}"`);
        if (t.pointer) bits.push("pointer");
        out.push(`     ${bits.join(" ")}`);
      });
    }
    return out;
  }

  HPH.pageOutline = ({ keep = [], roster = [], macros = {} } = {}) => {
    const R = (text) => HPH.redact(text, { keep, roster });
    const out = [
      "HallPass Helper page outline (student and staff names are hidden)",
      `Page: ${R(location.pathname.replace(/\d+/g, "#"))}`,
      `Window: ${innerWidth}x${innerHeight}`,
      ...macroLines(macros, R),
      "",
    ];
    const body = [];
    render(build(document.body, R), 0, body);
    out.push(...body);
    if (body.length >= MAX_LINES) out.push("… (outline cut off here)");
    return out.join("\n");
  };
})();
