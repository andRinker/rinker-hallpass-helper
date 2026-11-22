// Strict allowlist scrubbing and privacy verification for DOM snapshots and dry-run diagnostics.
// Loaded as a classic script after content/core.js (and imported by Node tests), so: no DOM and no import/export.
(() => {
  const HPH = (globalThis.HallPassHelper ??= {});

  // NATO phonetic surnames make synthetic names unmistakably fake to a teacher auditing a snapshot,
  // while remaining valid two-word names ("Student Alpha") so nameMatches and search fallbacks work.
  const PHONETIC = [
    "Alpha", "Bravo", "Charlie", "Delta", "Echo", "Foxtrot", "Golf", "Hotel", "India", "Juliet",
    "Kilo", "Lima", "Mike", "November", "Oscar", "Papa", "Quebec", "Romeo", "Sierra", "Tango",
    "Uniform", "Victor", "Whiskey", "Xray", "Yankee", "Zulu",
  ];

  // Safe Tailwind / CSS utility word tokens that commonly appear in class names.
  const SAFE_CLASS_RE = /^[a-z][a-z0-9_-]{1,35}$/;
  const HASHY_CLASS_RE = /^(sc|css|jss|emotion|chakra|tw)-|^[a-z]+[A-Z][a-z]*[A-Z]|[0-9]{5,}/;

  const EMAIL_RE = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g;
  const UUID_RE = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;
  const URL_RE = /\bhttps?:\/\/[^\s"'<>]+/gi;
  const LONG_TOKEN_RE = /\b(?=[A-Za-z0-9_-]{16,}\b)(?=[A-Za-z_-]*\d)[A-Za-z0-9_-]+\b/g;
  const CLOCK_TIME_RE = /\b(?:1[0-2]|0?[1-9]):[0-5]\d(?:\s?[ap]\.?m\.?)?\b/gi;
  const LONG_NUMBER_RE = /\b\d{3,}\b/g;

  const SYNTHETIC_PREFIXES = new Set(["student", "demo", "sample"]);
  const PHONETIC_LOWER = new Set(PHONETIC.map((w) => w.toLowerCase()));

  function escapeRe(str) {
    return String(str).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  function syntheticLabel(prefix, index) {
    const base = PHONETIC[index % PHONETIC.length];
    const cycle = Math.floor(index / PHONETIC.length);
    return `${prefix} ${cycle ? `${base}${cycle + 1}` : base}`;
  }

  // Holds temporary in-memory synthetic label maps across frames of a single recording session.
  // Never persisted; discarded as soon as recording stops.
  HPH.createScrubSession = () => ({ studentMap: new Map(), demoMap: new Map() });

  // Creates a stateful, allowlist-only scrubber for a single capture (or shared across frames via `session`).
  // The mapping from real values to synthetic labels lives only in memory during capture and is never saved.
  HPH.createScrubber = ({ roster = [], forbidden = [], session = null } = {}) => {
    const uiWords = HPH.UI_WORDS;
    const rosterEntries = [];
    const rosterSingleTokens = new Set();

    for (const s of roster) {
      const first = String(s?.first ?? "").trim();
      const last = String(s?.last ?? "").trim();
      const full = `${first} ${last}`.trim();
      if (!full) continue;
      const key = HPH.normalize(full);
      const parts = HPH.tokens(full);
      rosterEntries.push({ first, last, full, key, parts });
      for (const p of parts) {
        if (p.length >= 2 && !uiWords.has(p)) rosterSingleTokens.add(p);
      }
    }

    // Sort longest first so "Jordan Martinez" matches before "Jordan".
    rosterEntries.sort((a, b) => b.full.length - a.full.length);

    // Forbidden settings (school, teacher name, room/origin) are scrubbed even if partially composed of common words.
    const forbiddenEntries = [];
    const forbiddenSingleTokens = new Set();
    for (const item of forbidden) {
      const raw = String(item?.value ?? item ?? "").trim();
      const replacement = item?.replacement ?? "Sample";
      if (!raw || raw.length < 2) continue;
      const norm = HPH.normalize(raw);
      if (uiWords.has(norm)) continue;
      forbiddenEntries.push({ raw, norm, replacement });
      for (const t of HPH.tokens(raw)) {
        if (t.length >= 2 && !uiWords.has(t) && !/^\d+$/.test(t)) forbiddenSingleTokens.add(t);
      }
    }
    forbiddenEntries.sort((a, b) => b.raw.length - a.raw.length);

    const studentMap = session?.studentMap ?? new Map();
    const demoMap = session?.demoMap ?? new Map();
    const keptWords = new Set();
    const syntheticUsed = new Set();
    const stats = {
      rosterHits: 0,
      forbiddenHits: 0,
      unknownReplacements: 0,
      emailsStripped: 0,
      urlsStripped: 0,
      idsStripped: 0,
    };

    function mapStudent(key) {
      if (!studentMap.has(key)) studentMap.set(key, syntheticLabel("Student", studentMap.size));
      const label = studentMap.get(key);
      syntheticUsed.add(label);
      stats.rosterHits++;
      return label;
    }

    function mapDemo(key) {
      if (!demoMap.has(key)) demoMap.set(key, syntheticLabel("Demo", demoMap.size));
      const label = demoMap.get(key);
      syntheticUsed.add(label);
      stats.unknownReplacements++;
      return label;
    }

    // Build regexes for full roster names ("First Last" and "Last, First") so names containing
    // UI words (e.g. "Jordan Close") are still caught as a whole without breaking the "Close" button.
    const rosterFullPatterns = rosterEntries
      .filter((r) => r.first && r.last)
      .flatMap((r) => [
        { re: new RegExp(`\\b${escapeRe(r.first)}\\s+${escapeRe(r.last)}\\b`, "gi"), key: r.key },
        { re: new RegExp(`\\b${escapeRe(r.last)}\\s*,\\s*${escapeRe(r.first)}\\b`, "gi"), key: r.key },
      ]);

    const forbiddenPatterns = forbiddenEntries.map((f) => ({
      re: new RegExp(`\\b${escapeRe(f.raw)}\\b`, "gi"),
      replacement: f.replacement,
    }));

    function scrubText(input, { trackAudit = true } = {}) {
      let text = String(input ?? "");
      if (!text.trim()) return text;

      // Placeholder tokens protect already-inserted synthetic strings during subsequent passes.
      const protectedSpans = [];
      const protect = (value) => {
        const idx = protectedSpans.length;
        protectedSpans.push(value);
        return `\uE000${idx}\uE001`;
      };

      // 1. Strip emails, URLs, UUIDs, long ID tokens first.
      text = text.replace(EMAIL_RE, () => {
        stats.emailsStripped++;
        return protect("redacted@example.invalid");
      });
      text = text.replace(URL_RE, () => {
        stats.urlsStripped++;
        return protect("https://redacted.invalid");
      });
      text = text.replace(UUID_RE, () => {
        stats.idsStripped++;
        return protect("id-redacted");
      });
      text = text.replace(LONG_TOKEN_RE, () => {
        stats.idsStripped++;
        return protect("id-redacted");
      });

      // 2. Replace full roster names ("First Last" / "Last, First") with deterministic synthetic student names.
      for (const { re, key } of rosterFullPatterns) {
        text = text.replace(re, () => protect(mapStudent(key)));
      }

      // 3. Replace forbidden settings (school, teacher name, origin room).
      for (const { re, replacement } of forbiddenPatterns) {
        text = text.replace(re, () => {
          stats.forbiddenHits++;
          return protect(replacement);
        });
      }

      // 4. Normalize exact clock times and 3+ digit numbers (student IDs, room numbers).
      text = text.replace(CLOCK_TIME_RE, (m) => {
        const hasAmPm = /[ap]\.?m\.?/i.test(m);
        return protect(hasAmPm ? "12:00 PM" : "05:00");
      });
      text = text.replace(LONG_NUMBER_RE, () => {
        stats.idsStripped++;
        return protect("999");
      });

      // 5. Catch multi-word capitalized unknown sequences (e.g., students not on this teacher's roster
      //    or other staff names) and map them deterministically to "Demo Alpha", "Demo Bravo", etc.
      text = text.replace(/\b[\p{Lu}][\p{L}'’-]+(?:\s+[\p{Lu}][\p{L}'’-]+)+\b/gu, (match) => {
        const words = match.split(/\s+/);
        const allAllowed = words.every((w) => {
          const lw = w.toLowerCase();
          return uiWords.has(lw) && !rosterSingleTokens.has(lw) && !forbiddenSingleTokens.has(lw);
        });
        if (allAllowed) return match;
        // If only a subset are unknown (e.g. "Pass for Jordan"), leave to token pass unless every word is non-UI or roster.
        const anyKnownUiLead = uiWords.has(words[0].toLowerCase()) && !rosterSingleTokens.has(words[0].toLowerCase());
        if (anyKnownUiLead) return match;
        return protect(mapDemo(HPH.normalize(match)));
      });

      // 6. Strict allowlist token pass: every remaining word MUST be in UI_WORDS (and not a roster/forbidden token)
      //    or a short 1-2 digit number. Anything else is replaced.
      text = text.replace(/[\p{L}\p{N}'’-]+/gu, (word) => {
        if (/^\d{1,2}$/.test(word)) return word;
        // Preserve compact durations like "7m", "5min", "30s"
        if (/^\d{1,2}(?:m|s|hr|hrs|min|mins|sec|secs)$/i.test(word)) return word;
        const lw = word.toLowerCase();
        if (rosterSingleTokens.has(lw)) {
          // Map single matching roster word to its student if unambiguous, else synthetic Demo.
          const owners = rosterEntries.filter((r) => r.parts.includes(lw));
          if (owners.length === 1) return protect(mapStudent(owners[0].key));
          return protect(mapDemo(`roster:${lw}`));
        }
        if (forbiddenSingleTokens.has(lw)) {
          stats.forbiddenHits++;
          return protect("Sample");
        }
        if (uiWords.has(lw)) {
          if (trackAudit) keptWords.add(lw);
          return word;
        }
        stats.unknownReplacements++;
        return HPH.shapeOf(word);
      });

      // Restore protected synthetic spans.
      text = text.replace(/\uE000(\d+)\uE001/g, (_m, i) => protectedSpans[Number(i)]);
      return text;
    }

    function scrubClasses(classList) {
      const out = [];
      for (const raw of classList ?? []) {
        const c = String(raw ?? "").trim();
        if (!c || c.length > 35 || HASHY_CLASS_RE.test(c)) continue;
        if (!SAFE_CLASS_RE.test(c)) continue;
        const parts = c.split(/[-_]+/).filter(Boolean);
        if (parts.some((p) => rosterSingleTokens.has(p) || forbiddenSingleTokens.has(p))) continue;
        out.push(c);
      }
      return out.slice(0, 12);
    }

    function audit() {
      return {
        keptWords: [...keptWords].sort(),
        syntheticNames: [...syntheticUsed],
        stats: { ...stats },
      };
    }

    return { scrubText, scrubClasses, audit };
  };

  // Extracts visible text and human-readable attribute values from HTML (or returns plain text as-is)
  // so single-word leak checks don't false-positive on HTML tag names (like <li>) or static CSS rules.
  function contentTextOf(output) {
    const str = String(output ?? "");
    if (!/<[a-z][\s\S]*>/i.test(str)) return str;
    const noStyle = str.replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ").replace(/<!--[\s\S]*?-->/g, " ");
    const attrs = [];
    noStyle.replace(/\b(?:aria-label|placeholder|title|alt|value|data-testid|data-test|data-cy)\s*=\s*"([^"]*)"/gi, (_m, v) => {
      attrs.push(v);
      return "";
    });
    const textOnly = noStyle.replace(/<[^>]+>/g, " ");
    return `${textOnly} ${attrs.join(" ")}`;
  }

  // Belt-and-suspenders check run on the final serialized HTML or diagnostic text before showing it to the teacher.
  // Verifies zero roster names, zero forbidden school/teacher strings, and zero email addresses remain.
  HPH.verifyClean = (output, { roster = [], forbidden = [] } = {}) => {
    const text = String(output ?? "");
    const lower = text.toLowerCase();
    const content = contentTextOf(text);
    const contentLower = content.toLowerCase();
    const leaks = [];
    const uiWords = HPH.UI_WORDS;

    // 1. Check entire raw output for email addresses (ignoring our explicit placeholder).
    const emails = text.match(EMAIL_RE) ?? [];
    for (const e of emails) {
      if (e.toLowerCase() !== "redacted@example.invalid") leaks.push(`email (${HPH.shapeOf(e)})`);
    }

    // 2. Check full roster names across the entire raw output, and non-UI individual roster tokens in content.
    const contentTokens = new Set(HPH.tokens(content));
    for (const s of roster) {
      const first = String(s?.first ?? "").trim();
      const last = String(s?.last ?? "").trim();
      if (first && last) {
        const fwd = new RegExp(`\\b${escapeRe(first)}\\s+${escapeRe(last)}\\b`, "i");
        const rev = new RegExp(`\\b${escapeRe(last)}\\s*,\\s*${escapeRe(first)}\\b`, "i");
        if (fwd.test(text) || rev.test(text)) {
          leaks.push(`roster name (${HPH.shapeOf(`${first} ${last}`)})`);
          continue;
        }
      }
      for (const t of HPH.tokens(`${first} ${last}`)) {
        if (t.length < 2 || uiWords.has(t) || SYNTHETIC_PREFIXES.has(t) || PHONETIC_LOWER.has(t)) continue;
        if (contentTokens.has(t)) leaks.push(`roster word (${HPH.shapeOf(t)})`);
      }
    }

    // 3. Check forbidden school/teacher/origin phrases (raw output for multi-word, content for single words).
    for (const item of forbidden) {
      const raw = String(item?.value ?? item ?? "").trim();
      if (raw.length < 3) continue;
      const norm = HPH.normalize(raw);
      if (uiWords.has(norm)) continue;
      const re = new RegExp(`\\b${escapeRe(raw)}\\b`, "i");
      const target = raw.includes(" ") ? lower : contentLower;
      if (re.test(target)) leaks.push(`setting (${HPH.shapeOf(raw)})`);
    }

    return { clean: leaks.length === 0, leaks: [...new Set(leaks)] };
  };
})();
