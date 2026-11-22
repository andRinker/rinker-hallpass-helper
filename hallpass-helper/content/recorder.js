// Name-free Multi-State Flight Recorder for GoGuardian pages.
// Observes clicks and visible UI transitions strictly read-only, scrubbing every frame locally via
// HPH.captureSnapshot + HPH.diagnosePage before sending to background session storage.
(() => {
  const HPH = (globalThis.HallPassHelper ??= {});

  let recording = null; // { settings, session, observer, timer, lastFingerprint, pendingTrigger }

  const SETTLE_MS = 450;

  function send(msg) {
    try {
      chrome.runtime.sendMessage(msg).catch(() => {});
    } catch {
      // Extension reloaded underneath the page; stop quietly.
      HPH.stopRecording();
    }
  }

  function buildFrame(trigger) {
    if (!recording) return null;
    const { settings, session } = recording;
    const snap = HPH.captureSnapshot({
      roster: settings.roster,
      forbidden: settings.forbidden,
      isPopup: settings.isPopup,
      session,
    });
    const diag = HPH.diagnosePage({
      macros: settings.macros,
      lane: settings.lane,
      roster: settings.roster,
      forbidden: settings.forbidden,
      outPasses: settings.outPasses,
      queue: settings.queue,
      destinations: settings.destinations,
      isPopup: settings.isPopup,
    });
    const fingerprint = HPH.screenFingerprint();
    const clean = !!(snap.audit?.clean && diag.audit?.clean);
    const leaks = [...new Set([...(snap.audit?.leaks ?? []), ...(diag.audit?.leaks ?? [])])];
    return {
      at: Date.now(),
      trigger: trigger || "Screen changed",
      fingerprint,
      meta: snap.meta,
      html: snap.html,
      diagnoseReport: diag.report,
      audit: {
        ...snap.audit,
        clean,
        leaks,
      },
    };
  }

  function captureNow(trigger, force = false) {
    if (!recording) return;
    clearTimeout(recording.timer);
    recording.timer = null;
    const fp = HPH.screenFingerprint();
    if (!force && fp === recording.lastFingerprint) return;
    recording.lastFingerprint = fp;
    const frame = buildFrame(trigger ?? recording.pendingTrigger ?? "Screen changed");
    recording.pendingTrigger = null;
    if (frame) send({ type: "record-frame", frame });
  }

  function scheduleCapture(trigger) {
    if (!recording) return;
    if (trigger) recording.pendingTrigger = trigger;
    clearTimeout(recording.timer);
    recording.timer = setTimeout(() => captureNow(recording?.pendingTrigger ?? "Screen changed", false), SETTLE_MS);
  }

  function scrubTrigger(action, el) {
    if (!recording || !(el instanceof Element)) return action;
    const { settings, session } = recording;
    const scrubber = HPH.createScrubber({ roster: settings.roster, forbidden: settings.forbidden, session });
    const name = HPH.accessibleName(el) || el.tagName.toLowerCase();
    const safe = scrubber.scrubText(name, { trackAudit: false }).slice(0, 50);
    return `${HPH.busy ? "Helper " : ""}${action} "${safe}"`;
  }

  function onClick(e) {
    if (!recording || !(e.target instanceof Element) || e.target.closest("[data-hph-ui]")) return;
    const { el } = HPH.clickableRoot(e.target);
    scheduleCapture(scrubTrigger("Click", el));
  }

  function onChange(e) {
    if (!recording || !(e.target instanceof Element) || e.target.closest("[data-hph-ui]")) return;
    scheduleCapture(scrubTrigger("Change", e.target));
  }

  function onMutations(mutations) {
    if (!recording) return;
    const meaningful = mutations.some((m) => {
      const target = m.target instanceof Element ? m.target : m.target?.parentElement;
      return target && !target.closest("[data-hph-ui]");
    });
    if (meaningful) scheduleCapture();
  }

  HPH.startRecording = (settings = {}) => {
    if (recording) HPH.stopRecording();
    const session = HPH.createScrubSession();
    const observer = new MutationObserver(onMutations);
    recording = {
      settings,
      session,
      observer,
      timer: null,
      lastFingerprint: "",
      pendingTrigger: null,
    };
    document.addEventListener("click", onClick, true);
    document.addEventListener("change", onChange, true);
    if (document.body) {
      observer.observe(document.body, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ["open", "hidden", "aria-expanded", "aria-checked", "aria-selected", "data-state"],
      });
    }
    // Immediately capture the opening screen of this tab.
    captureNow(settings.isPopup ? "Pop-up window opened" : "Started recording", true);
  };

  HPH.stopRecording = () => {
    if (!recording) return;
    // Flush one final frame if the screen settled differently since the last capture.
    captureNow(recording.pendingTrigger ?? "Finished recording", false);
    clearTimeout(recording.timer);
    recording.observer.disconnect();
    document.removeEventListener("click", onClick, true);
    document.removeEventListener("change", onChange, true);
    // Discard in-memory synthetic name mapping immediately.
    recording = null;
  };

  HPH.isRecording = () => !!recording;

  // Automatically join an active Flight Recorder session if a new GoGuardian tab or Create Pass pop-up opens.
  try {
    chrome.runtime
      .sendMessage({ type: "record-hello" })
      .then((reply) => reply?.active && HPH.startRecording(reply.settings))
      .catch(() => {});
  } catch {
    // no extension context
  }
})();
