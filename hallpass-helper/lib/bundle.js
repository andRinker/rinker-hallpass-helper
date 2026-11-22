// Pure logic for the multi-frame Scrubbed Flight Recorder bundle.
// Manages session frames, consecutive deduplication, caps, unified privacy audits, and JSON export.

export const MAX_BUNDLE_FRAMES = 60;

export const emptyRecording = () => ({
  active: false,
  startedAt: 0,
  frames: [],
  dropped: 0,
});

// Appends a scrubbed frame to the recording, skipping consecutive identical screens on the same page
// and enforcing MAX_BUNDLE_FRAMES so bundles stay compact and easy to audit.
export function addFrame(recording, frame) {
  const base = recording ?? emptyRecording();
  if (!base.active || !frame?.html) return base;
  const frames = base.frames ?? [];
  const prev = frames[frames.length - 1];
  if (
    prev &&
    prev.meta?.host === frame.meta?.host &&
    Boolean(prev.meta?.isPopup) === Boolean(frame.meta?.isPopup) &&
    prev.fingerprint &&
    prev.fingerprint === frame.fingerprint
  ) {
    return base;
  }
  if (frames.length >= MAX_BUNDLE_FRAMES) {
    return { ...base, dropped: (base.dropped ?? 0) + 1 };
  }
  return { ...base, frames: [...frames, frame] };
}

export function removeFrame(frames, index) {
  return (frames ?? []).filter((_f, i) => i !== index);
}

// Combines every frame's Privacy Audit into a single one-screen audit for the teacher:
// all unique kept English UI words, all synthetic names used, totals stripped, and overall clean flag.
export function summarizeBundle(frames) {
  const list = frames ?? [];
  const keptWords = new Set();
  const syntheticNames = new Set();
  const leaks = new Set();
  const stats = {
    frames: list.length,
    elementsKept: 0,
    hiddenSkipped: 0,
    scriptsStripped: 0,
    imagesStripped: 0,
    rosterHits: 0,
    forbiddenHits: 0,
    unknownReplacements: 0,
    emailsStripped: 0,
  };
  let allClean = list.length > 0;
  for (const frame of list) {
    const a = frame?.audit;
    if (!a?.clean) allClean = false;
    for (const w of a?.keptWords ?? []) keptWords.add(w);
    for (const n of a?.syntheticNames ?? []) syntheticNames.add(n);
    for (const l of a?.leaks ?? []) leaks.add(l);
    const s = a?.stats ?? {};
    stats.elementsKept += s.elementsKept ?? 0;
    stats.hiddenSkipped += s.hiddenSkipped ?? 0;
    stats.scriptsStripped += s.scriptsStripped ?? 0;
    stats.imagesStripped += s.imagesStripped ?? 0;
    stats.rosterHits += s.rosterHits ?? 0;
    stats.forbiddenHits += s.forbiddenHits ?? 0;
    stats.unknownReplacements += s.unknownReplacements ?? 0;
    stats.emailsStripped += s.emailsStripped ?? 0;
  }
  return {
    clean: allClean && leaks.size === 0,
    leaks: [...leaks],
    keptWords: [...keptWords].sort(),
    syntheticNames: [...syntheticNames],
    stats,
  };
}

export function exportBundle({ frames = [], helperVersion = "", lane = "", kind = "session" } = {}) {
  const summary = summarizeBundle(frames);
  return {
    format: "hallpass-helper-bundle",
    version: 1,
    kind,
    helperVersion,
    lane: lane || "",
    capturedAt: new Date().toISOString().slice(0, 10),
    summary,
    frames: frames.map((f, i) => ({
      index: i + 1,
      trigger: f.trigger ?? "",
      meta: f.meta ?? {},
      diagnoseReport: f.diagnoseReport ?? "",
      audit: {
        clean: !!f.audit?.clean,
        leaks: f.audit?.leaks ?? [],
        keptWords: f.audit?.keptWords ?? [],
        syntheticNames: f.audit?.syntheticNames ?? [],
        stats: f.audit?.stats ?? {},
      },
      html: f.html ?? "",
    })),
  };
}
