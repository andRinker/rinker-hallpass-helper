// Describing a page element in a way that survives re-renders, and finding it again later.
(() => {
  const HPH = (globalThis.HallPassHelper ??= {});

  const ROLE_SELECTORS = {
    button: "button, input[type=button], input[type=submit], [role=button]",
    link: "a[href], [role=link]",
    option: "option, [role=option]",
    menuitem: "[role=menuitem], [role=menuitemradio], [role=menuitemcheckbox]",
    tab: "[role=tab]",
    checkbox: "input[type=checkbox], [role=checkbox], [role=switch]",
    radio: "input[type=radio], [role=radio]",
    combobox: "select, [role=combobox], [role=listbox]",
    textbox:
      'input:not([type]), input[type=text], input[type=search], input[type=email], input[type=number], input[type=tel], textarea, [contenteditable=""], [contenteditable=true], [role=textbox], [role=searchbox]',
    listitem: "li, [role=listitem], [role=row], tr",
  };
  const ROLE_ALIASES = { searchbox: "textbox", switch: "checkbox", row: "listitem", menuitemradio: "menuitem", menuitemcheckbox: "menuitem", listbox: "combobox" };
  const CLICKABLE = ["button", "link", "option", "menuitem", "tab", "checkbox", "radio", "combobox"]
    .map((r) => ROLE_SELECTORS[r])
    .concat("label", "summary")
    .join(", ");
  const ITEM = "li, [role=listitem], [role=row], tr, article";

  const clean = (text, max = 100) =>
    String(text ?? "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, max);

  HPH.roleOf = (el) => {
    const explicit = el.getAttribute("role")?.trim().split(/\s+/)[0];
    if (explicit) return ROLE_ALIASES[explicit] ?? explicit;
    for (const [role, selector] of Object.entries(ROLE_SELECTORS)) if (el.matches(selector)) return role;
    return "generic";
  };

  HPH.visible = (el) =>
    el.isConnected && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== "hidden";

  const isPointer = (el) => !!el && el !== document.body && getComputedStyle(el).cursor === "pointer";

  const ariaName = (el) => {
    const aria = clean(el.getAttribute("aria-label"));
    if (aria) return aria;
    const by = el.getAttribute("aria-labelledby");
    return by ? clean(by.split(/\s+/).map((id) => document.getElementById(id)?.innerText ?? "").join(" ")) : "";
  };

  HPH.accessibleName = (el) => {
    const aria = ariaName(el);
    if (aria) return aria;
    if (el.matches("input, select, textarea")) {
      const label = (el.id && document.querySelector(`label[for="${CSS.escape(el.id)}"]`)) || el.closest("label");
      if (label && clean(label.innerText)) return clean(label.innerText);
      return clean(el.getAttribute("placeholder") || el.getAttribute("title") || el.getAttribute("name"));
    }
    return clean(el.innerText) || clean(el.getAttribute("title") || el.querySelector("img[alt]")?.alt);
  };

  // Ids and test ids that look hand-written (no digits, no framework prefixes) are worth keeping.
  const stable = (value) =>
    value && value.length < 60 && !/\d|^:|^(radix|mui|react|headlessui|ember)[-_:]/i.test(value) ? value : undefined;

  HPH.classesOf = (el) =>
    [...el.classList]
      .filter((c) => /^[A-Za-z][A-Za-z_-]{2,40}$/.test(c) && !/^(sc|css|jss|emotion|chakra)-/i.test(c))
      .filter((c) => !/^[a-z]+[A-Z][a-z]*[A-Z]/.test(c)) // styled-components style hashes like "bdVaJa"
      .slice(0, 4);

  // The element a click "means": the button/option it's inside, or for clickable divs,
  // the outermost element of the pointer-cursor area (cursor is inherited, so that's the card itself).
  HPH.clickableRoot = (target) => {
    const hit = target.closest(CLICKABLE);
    if (hit) return { el: hit, pointer: false };
    if (!isPointer(target)) return { el: target, pointer: false };
    let root = target;
    for (let i = 0; i < 10 && isPointer(root.parentElement); i++) root = root.parentElement;
    return { el: root, pointer: true };
  };

  // Short text of the list item / card / labeled area around an element.
  HPH.contextOf = (el) => {
    let node = el.parentElement;
    for (let i = 0; node && node !== document.body && i < 10; i++, node = node.parentElement) {
      if (node.matches(ITEM) || (isPointer(node) && !isPointer(node.parentElement))) return clean(node.innerText, 120);
      const label = ariaName(node);
      if (label) return label;
    }
    return "";
  };

  HPH.describe = (el, pointer = false) => {
    const desc = {
      role: HPH.roleOf(el),
      name: HPH.accessibleName(el),
      tag: el.tagName.toLowerCase(),
      type: el.getAttribute("type") ?? undefined,
      testid: stable(el.getAttribute("data-testid") ?? el.getAttribute("data-test") ?? el.getAttribute("data-cy")),
      id: stable(el.id),
      classes: HPH.classesOf(el),
      context: HPH.contextOf(el),
      pointer,
    };
    desc.index = Math.max(0, HPH.findTargets(desc, {}).indexOf(el));
    return desc;
  };

  // Returns { test, hint }: `test` checks an accessible name, `hint` is a word that must be in the
  // element's text, used to skip most of the page cheaply before the slower check.
  function nameTest(name, params) {
    const norm = HPH.normalize;
    if (name === "{student}") {
      const student = params.student;
      return { test: (text) => !!student && HPH.nameMatches(text, student), hint: HPH.tokens(student?.last)[0] };
    }
    if (name === "{destination}") {
      const dest = norm(params.destination);
      const test = (text) => !!dest && (norm(text) === dest || (norm(text).includes(dest) && text.length < dest.length + 30));
      return { test, hint: HPH.tokens(dest)[0] };
    }
    if (!name) return { test: () => true };
    return { test: (text) => norm(text) === norm(name), hint: HPH.tokens(name)[0] };
  }

  function looseTest(name) {
    const n = HPH.normalize(name);
    if (n.length < 3 || n.includes("{")) return null;
    const test = (text) => {
      const t = HPH.normalize(text);
      return t.length >= 3 && (t.includes(n) || n.includes(t));
    };
    return { test, hint: HPH.tokens(n)[0] };
  }

  function candidates(desc, { test, hint }) {
    const selector = desc.role === "generic" ? desc.tag : (ROLE_SELECTORS[desc.role] ?? `[role="${desc.role}"]`);
    const quick = (el) => !hint || el.hasAttribute("aria-label") || el.hasAttribute("aria-labelledby") || el.matches("input, select, textarea") || el.textContent.toLowerCase().includes(hint);
    let els = [...document.querySelectorAll(selector)].filter(
      (el) => quick(el) && !el.closest("[data-hph-ui]") && HPH.roleOf(el) === desc.role && test(HPH.accessibleName(el)) && HPH.visible(el),
    );
    if (desc.pointer) {
      els = [...new Set(els.filter(isPointer).map((el) => HPH.clickableRoot(el).el))].filter((el) => test(HPH.accessibleName(el)));
    }
    return els;
  }

  function score(el, desc) {
    let s = 0;
    if (desc.testid && el.getAttribute("data-testid") === desc.testid) s += 8;
    if (desc.id && el.id === desc.id) s += 6;
    if (el.tagName.toLowerCase() === desc.tag) s += 2;
    const classes = new Set(HPH.classesOf(el));
    s += (desc.classes ?? []).filter((c) => classes.has(c)).length;
    if (desc.context && !desc.context.includes("{") && HPH.normalize(HPH.contextOf(el)) === HPH.normalize(desc.context)) s += 3;
    return s;
  }

  // Best-matching elements for a saved descriptor; more than one means a tie.
  HPH.findTargets = (desc, params = {}) => {
    let els = candidates(desc, nameTest(desc.name, params));
    const loose = !els.length && looseTest(desc.name);
    if (loose) els = candidates(desc, loose);
    if (desc.context?.includes("{student}") && params.student) {
      els = els.filter((el) => HPH.nameMatches(HPH.contextOf(el), params.student));
    }
    if (!els.length) return [];
    const scored = els.map((el) => ({ el, s: score(el, desc) }));
    const best = Math.max(...scored.map((x) => x.s));
    return scored.filter((x) => x.s === best).map((x) => x.el);
  };

  HPH.pick = (els, desc) => els[desc.index] ?? els[0];
})();
