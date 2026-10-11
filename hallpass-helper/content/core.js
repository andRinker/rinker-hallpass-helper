// Plain-data helpers for teaching, replaying and the name-free outline.
// Loaded as a classic script by the HallPass content scripts and the side panel,
// and imported by the Node tests, so: no DOM and no import/export.
(() => {
  const HPH = (globalThis.HallPassHelper ??= {});

  // Words that are safe to show in the outline. Deliberately leaves out words that
  // double as names (Hall, Page, Mark, Will, May, Grace, ...).
  const UI_WORDS = new Set(
    `a about active add again all am an and any approval approve approved are as at available away
    back badge bathroom be button by cancel cancelled canceled capacity card cell chip choose clear close
    comment confirm container counselor create created current dashboard date default delete deny denied
    destination destinations details dialog done dropdown duration edit end ended ending error expired
    field filter for form from full go grade help hide history home icon in input issue item kiosk
    label left less library limit list loading locker log logout menu min mins minute minutes modal
    more my name new next no none not notes now nurse of office ok on one open option or origin out
    overtime override panel pass passes pending per period pin please pm profile queue reason
    reject rejected remaining remove report reports request requested requests restroom return
    returned room round row save schedule scheduled school search see select send settings show
    sign site sort staff start started status student students submit sure tab table teacher
    teachers the this time to today travel trip try type unavailable view waiting want water way
    with you your 6th 7th 8th 9th 10th 11th 12th 1st 2nd 3rd 4th 5th
    action actions bar box class classes click clock collapse collapsed content count day dest disabled
    dismiss drawer empty expand expanded footer grid group header hour hours info inner it link lunch
    nav outer overlay picker popover primary result results root sec seconds secondary selected
    sidebar success text timer title toggle tooltip total value warning week wrapper yes
    also ascending auto can currently descending either getting history learn managing notifications range
    recent recurring release rooms there understanding upcoming user users where`.split(/\s+/),
  );
  HPH.UI_WORDS = UI_WORDS;

  const normalize = (text) =>
    String(text ?? "")
      .toLowerCase()
      .replace(/\s+/g, " ")
      .trim();
  const tokens = (text) => normalize(text).split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  HPH.normalize = normalize;
  HPH.tokens = tokens;

  // True when the text has every part of the student's first and last name,
  // in either order ("Jordan Miller", "Miller, Jordan", "Jordan Miller · Grade 7").
  HPH.nameMatches = (text, student) => {
    const have = new Set(tokens(text));
    const need = tokens(`${student.first} ${student.last}`);
    return need.length > 0 && need.every((t) => have.has(t));
  };

  HPH.mentionsStudent = (text, roster) => roster.find((s) => s.last && HPH.nameMatches(text, s)) ?? null;

  // Typed search text that starts a roster student's first name, last name or full name.
  HPH.startsStudent = (value, roster) => {
    const v = normalize(value);
    if (v.length < 2) return false;
    return roster.some((s) =>
      [s.first, s.last, `${s.first} ${s.last}`, `${s.last}, ${s.first}`].some((n) => n && normalize(n).startsWith(v)),
    );
  };

  HPH.matchDestination = (text, destinations) => {
    const t = normalize(text);
    if (!t) return null;
    return destinations.find((d) => normalize(d) === t) ?? destinations.find((d) => t.includes(normalize(d))) ?? null;
  };

  const FINAL_WORDS = /\b(create|submit|send|start|issue|request|save)\b/i;
  const SEARCHY_FIELD = /student|search|name/i;

  // First guess at what each recorded step is: "fixed", "student", "destination" or "final".
  HPH.guessRoles = (steps, kind, { roster = [], destinations = [] } = {}) => {
    const roles = steps.map((step, i) => {
      const text = step.action === "click" ? step.target.name : step.value;
      if (step.action === "type") {
        if (HPH.startsStudent(step.value, roster) || SEARCHY_FIELD.test(step.target.name)) return "student";
      }
      if (step.action === "click" && HPH.mentionsStudent(step.target.name, roster)) return "student";
      if (step.action === "click" && steps[i - 1]?.action === "type" && !HPH.matchDestination(text, destinations)) {
        // Clicking a search result right after typing a search.
        const prev = steps[i - 1];
        if (HPH.startsStudent(prev.value, roster) || SEARCHY_FIELD.test(prev.target.name)) return "student";
      }
      if (HPH.matchDestination(text, destinations)) return "destination";
      return "fixed";
    });
    if (kind === "end" && !roles.includes("student")) {
      const firstClick = steps.findIndex((s) => s.action === "click");
      if (firstClick >= 0) roles[firstClick] = "student";
    }
    if (kind === "create") {
      for (let i = steps.length - 1; i >= 0; i--) {
        if (steps[i].action === "click" && roles[i] === "fixed" && FINAL_WORDS.test(steps[i].target.name)) {
          roles[i] = "final";
          break;
        }
      }
    }
    return roles;
  };

  // Attach roles and swap the teaching run's student and destination for placeholders,
  // so no real names are saved.
  HPH.scrubSteps = (steps, roles) => {
    const nameWords = new Set();
    steps.forEach((step, i) => {
      if (roles[i] !== "student") return;
      const text = step.action === "click" ? step.target.name : step.value;
      for (const t of tokens(text)) if (!UI_WORDS.has(t) && !/^\d+$/.test(t)) nameWords.add(t);
    });
    const scrub = (text) => {
      if (typeof text !== "string" || !nameWords.size) return text;
      return text
        .replace(/[\p{L}\p{N}'’-]+/gu, (w) => {
          const parts = tokens(w);
          return parts.length && parts.every((t) => nameWords.has(t)) ? "{student}" : w;
        })
        .replace(/\{student\}(?:[\s,]*\{student\})+/g, "{student}");
    };
    return steps.map((step, i) => {
      const role = roles[i];
      const target = { ...step.target, name: scrub(step.target.name), context: scrub(step.target.context) };
      let value = scrub(step.value);
      if (role === "student") {
        if (step.action === "click") target.name = "{student}";
        else value = "{student}";
      }
      if (role === "destination") {
        if (step.action === "click") target.name = "{destination}";
        else value = "{destination}";
      }
      return { ...step, target, ...(value !== undefined && { value }), role };
    });
  };

  const quote = (text) => `"${String(text ?? "").slice(0, 60)}"`;
  HPH.stepLabel = (step) => {
    const where = step.target.name || step.target.tag;
    if (step.action === "type") return `Type ${quote(step.value)} in ${quote(where)}`;
    if (step.action === "select") return `Choose ${quote(step.value)} in ${quote(where)}`;
    if (step.action === "key") return `Press ${step.key} in ${quote(where)}`;
    return `Click ${quote(where)}`;
  };

  HPH.sameTarget = (a, b) =>
    ["role", "name", "tag", "testid", "id", "index"].every((k) => (a?.[k] ?? null) === (b?.[k] ?? null));

  // Typing into the same field again replaces the earlier typing step.
  HPH.addStep = (steps, step) => {
    const last = steps[steps.length - 1];
    if (step.action === "type" && last?.action === "type" && HPH.sameTarget(last.target, step.target)) {
      return [...steps.slice(0, -1), step];
    }
    return [...steps, step];
  };

  // Letters become X/x and digits become 9, so the outline keeps its shape without the words.
  HPH.shapeOf = (text) =>
    String(text).replace(/\p{Lu}/gu, "X").replace(/\p{Ll}/gu, "x").replace(/\p{N}/gu, "9");

  // Keep the teacher's own settings and common UI words; shape everything else.
  // Roster names are always shaped, even when they're also UI words.
  HPH.redact = (text, { keep = [], roster = [] } = {}) => {
    const t = String(text ?? "").replace(/\s+/g, " ").trim();
    if (!t) return t;
    const rosterWords = new Set(roster.flatMap((s) => tokens(`${s.first} ${s.last}`)));
    const mentionsRoster = tokens(t).some((w) => rosterWords.has(w));
    if (!mentionsRoster && keep.some((k) => k && normalize(k) === normalize(t))) return t;
    const keepWords = new Set(keep.flatMap(tokens));
    return t.replace(/[\p{L}\p{N}]+/gu, (w) => {
      const lw = w.toLowerCase();
      if (rosterWords.has(lw)) return HPH.shapeOf(w);
      if (UI_WORDS.has(lw) || keepWords.has(lw)) return w;
      return HPH.shapeOf(w);
    });
  };
})();
