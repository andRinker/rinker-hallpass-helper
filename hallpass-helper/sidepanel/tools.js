// Testing & Diagnostics drawer in the side panel:
//  Primary:
//   - Multi-frame Scrubbed Flight Recorder (record session -> 1 unified Privacy Audit -> download .json bundle)
//   - Automatic Failure Capture card (review & download last stuck moment)
//  Secondary (under More tools):
//   - Read-only self-check (dry run)
//   - Single scrubbed DOM snapshot
//   - Page outline
import { allGoGuardianTabs, hostOf } from "../lib/tabs.js";
import { saveSettings } from "../lib/storage.js";
import { chosenLane } from "../lib/methods.js";
import { exportBundle, removeFrame, summarizeBundle } from "../lib/bundle.js";
import { $, h, toast } from "./shared.js";

let getSettings = () => ({});
let snapshots = [];
let selectedSnapshot = 0;

let recordMode = "idle"; // idle | recording | review
let recordFrames = [];
let recordDropped = 0;
let recordTimer = null;

const sendBg = (msg) => chrome.runtime.sendMessage(msg).catch(() => null);

function hideLegacyBoxes() {
  $("outlineBox").hidden = true;
  $("diagnoseBox").hidden = true;
  $("snapshotBox").hidden = true;
}

function previewHtmlInTab(html) {
  const url = URL.createObjectURL(new Blob([html], { type: "text/html;charset=utf-8" }));
  chrome.tabs.create({ url });
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

function downloadBlob(content, type, filename) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

function renderWordPills(container, words) {
  container.replaceChildren(
    ...(words?.length
      ? words.map((w) => h("span", { class: "word-pill" }, w))
      : [h("span", { class: "hint" }, "No text words kept.")]),
  );
}

async function tabLabel(tab) {
  const win = await chrome.windows.get(tab.windowId).catch(() => null);
  const isPopup = win?.type === "popup";
  const kind = isPopup ? "pop-up window" : "browser window";
  return {
    isPopup,
    head: `${hostOf(tab.url)} (${kind}${tab.active ? ", showing" : ", in the background"})`,
  };
}

// --- Flight Recorder (multi-frame scrubbed session bundle) ---

function updateDrawerBadge() {
  const badge = $("testingBadge");
  const failure = getSettings()?.lastFailureCapture;
  if (recordMode === "recording") {
    badge.textContent = `Recording (${recordFrames.length})`;
    badge.dataset.kind = "recording";
    badge.hidden = false;
  } else if (recordMode === "review" && recordFrames.length) {
    badge.textContent = `${recordFrames.length} screen${recordFrames.length === 1 ? "" : "s"} ready`;
    badge.dataset.kind = "ready";
    badge.hidden = false;
  } else if (failure?.frame) {
    badge.textContent = "1 stuck moment saved";
    badge.dataset.kind = "alert";
    badge.hidden = false;
  } else {
    badge.hidden = true;
  }
}

function renderRecorder() {
  $("recordIdle").hidden = recordMode !== "idle";
  $("recordActive").hidden = recordMode !== "recording";
  $("recordReview").hidden = recordMode !== "review";

  if (recordMode === "review") {
    const summary = summarizeBundle(recordFrames);
    const s = summary.stats;
    const status = $("bundleStatus");
    status.dataset.clean = summary.clean ? "yes" : "no";
    status.textContent = summary.clean
      ? `Privacy check passed — 0 student, staff, school, or email leaks across ${s.frames} screen${s.frames === 1 ? "" : "s"}.`
      : `Privacy check flagged: ${summary.leaks.join(", ")}. Review or remove flagged screens before sharing.`;

    const replaced = s.rosterHits + s.forbiddenHits + s.unknownReplacements;
    const synNote = summary.syntheticNames.length
      ? ` (${summary.syntheticNames.slice(0, 4).join(", ")}${summary.syntheticNames.length > 4 ? ", …" : ""})`
      : "";
    const dropNote = recordDropped ? ` · ${recordDropped} extra screen(s) skipped after cap` : "";
    $("bundleStats").textContent =
      `Stripped ${s.scriptsStripped} script(s), ${s.imagesStripped} image(s), ${s.hiddenSkipped} hidden node(s) · Scrubbed ${replaced} non-UI text item(s)${synNote}${dropNote}.`;

    $("bundleWordsSummary").textContent = `Inspect every kept word across all screens (${summary.keptWords.length} unique UI words)`;
    renderWordPills($("bundleWords"), summary.keptWords);

    $("bundleFrames").replaceChildren(
      ...recordFrames.map((frame, i) =>
        h(
          "li",
          { class: "frame-row" },
          h(
            "div",
            { class: "frame-info" },
            h("strong", {}, `${i + 1}. ${frame.trigger || "Screen captured"}`),
            h("span", { class: "hint" }, `${frame.meta?.host ?? "goguardian"}${frame.meta?.isPopup ? " (pop-up)" : ""} · ${frame.audit?.clean ? "clean" : "flagged"}`),
          ),
          h("button", { class: "link", type: "button", onclick: () => previewHtmlInTab(frame.html) }, "Preview"),
          h(
            "button",
            {
              class: "link remove",
              type: "button",
              title: "Remove this screen",
              "aria-label": `Remove screen ${i + 1}`,
              onclick: () => {
                recordFrames = removeFrame(recordFrames, i);
                if (!recordFrames.length) {
                  recordMode = "idle";
                  sendBg({ type: "record-clear" });
                }
                renderRecorder();
              },
            },
            "×",
          ),
        ),
      ),
    );
  }
  updateDrawerBadge();
}

function pollRecording() {
  clearInterval(recordTimer);
  recordTimer = setInterval(async () => {
    if (recordMode !== "recording") return clearInterval(recordTimer);
    const info = await sendBg({ type: "record-info" });
    if (!info?.active) return;
    recordFrames = new Array(info.count);
    recordDropped = info.dropped ?? 0;
    const pages = info.pages?.length ? ` · on ${info.pages.join(", ")}` : "";
    $("recordStatus").textContent = `Recording… ${info.count} screen${info.count === 1 ? "" : "s"} captured${pages}`;
    updateDrawerBadge();
  }, 800);
}

async function startRecording() {
  const tabs = await allGoGuardianTabs();
  if (!tabs.length) {
    toast("Open HallPass or GoGuardian first.");
    return;
  }
  await sendBg({ type: "record-begin" });
  recordMode = "recording";
  recordFrames = [];
  recordDropped = 0;
  $("recordStatus").textContent = "Recording… 0 screens captured. Use GoGuardian normally, then click Stop.";
  pollRecording();
  renderRecorder();
}

async function stopRecording(keep) {
  clearInterval(recordTimer);
  const res = await sendBg({ type: "record-end" });
  if (!keep) {
    await sendBg({ type: "record-clear" });
    recordMode = "idle";
    recordFrames = [];
    recordDropped = 0;
    renderRecorder();
    return;
  }
  const frames = res?.frames ?? [];
  recordDropped = res?.dropped ?? 0;
  if (!frames.length) {
    await sendBg({ type: "record-clear" });
    recordMode = "idle";
    recordFrames = [];
    toast("No GoGuardian screens were captured. Reload your GoGuardian tab and try again.");
    renderRecorder();
    return;
  }
  recordFrames = frames;
  recordMode = "review";
  renderRecorder();
}

function currentBundleJson() {
  const s = getSettings();
  const version = chrome.runtime.getManifest().version_name ?? chrome.runtime.getManifest().version;
  return JSON.stringify(exportBundle({ frames: recordFrames, helperVersion: version, lane: chosenLane(s), kind: "session" }), null, 2);
}

// --- Automatic Failure Capture card ---

export function renderFailureCapture() {
  const cap = getSettings()?.lastFailureCapture;
  const has = !!cap?.frame?.html;
  $("failureCard").hidden = !has;
  $("reviewFailureLink").hidden = !has;
  if (!has) {
    updateDrawerBadge();
    return;
  }
  const minutes = Math.max(0, Math.round((Date.now() - cap.at) / 60000));
  const when = minutes < 1 ? "just now" : `${minutes} min ago`;
  const what = cap.goal === "make" ? "making a pass" : "ending a pass";
  $("failureSummary").textContent = `Captured automatically while ${what} (${cap.reason}${cap.step ? ` at step ${cap.step}` : ""}), ${when}.`;

  const a = cap.frame.audit;
  const banner = $("failureAuditBanner");
  banner.dataset.clean = a?.clean ? "yes" : "no";
  banner.textContent = a?.clean
    ? "Privacy check passed — 0 student, staff, school, or email leaks found."
    : `Privacy check flagged: ${(a?.leaks ?? []).join(", ")}.`;

  $("failureWordsSummary").textContent = `Inspect every kept word (${a?.keptWords?.length ?? 0} unique UI words)`;
  renderWordPills($("failureWords"), a?.keptWords ?? []);
  updateDrawerBadge();
}

// --- Legacy / single-page tools (under More tools) ---

async function showOutline() {
  const tabs = await allGoGuardianTabs();
  const parts = [];
  for (const tab of tabs) {
    const result = await chrome.tabs.sendMessage(tab.id, { type: "outline" }).catch(() => null);
    const { head } = await tabLabel(tab);
    parts.push({ head, text: result?.ok ? result.text : null });
  }
  if (!parts.some((p) => p.text)) {
    toast(tabs.length ? "Reload your GoGuardian tabs first." : "Open HallPass first.");
    return;
  }
  const text =
    parts.length === 1
      ? parts[0].text
      : parts.map((p, i) => `===== Page ${i + 1} of ${parts.length}: ${p.head} =====\n${p.text ?? "(the helper can't read this page. Reload it.)"}`).join("\n\n");
  hideLegacyBoxes();
  $("outlineText").value = text;
  $("outlineBox").hidden = false;
}

async function runDiagnose() {
  const tabs = await allGoGuardianTabs();
  const parts = [];
  let allClean = true;
  const leaks = [];
  for (const tab of tabs) {
    const { head, isPopup } = await tabLabel(tab);
    const result = await chrome.tabs.sendMessage(tab.id, { type: "diagnose", isPopup }).catch(() => null);
    if (result?.ok) {
      if (!result.audit?.clean) {
        allClean = false;
        leaks.push(...(result.audit?.leaks ?? []));
      }
      parts.push({ head, report: result.report, summary: result.summary });
    } else {
      parts.push({ head, report: null });
    }
  }
  if (!parts.some((p) => p.report)) {
    toast(tabs.length ? "Reload your GoGuardian tabs first." : "Open HallPass first.");
    return;
  }

  const text =
    parts.length === 1
      ? parts[0].report
      : parts.map((p, i) => `===== Page ${i + 1} of ${parts.length}: ${p.head} =====\n${p.report ?? "(the helper can't read this page. Reload it.)"}`).join("\n\n");

  hideLegacyBoxes();
  const badge = $("diagnoseBadge");
  badge.dataset.clean = allClean ? "yes" : "no";
  badge.textContent = allClean
    ? `Read-only check complete (${parts.filter((p) => p.report).length} page${parts.filter((p) => p.report).length === 1 ? "" : "s"}). Nothing was clicked. Privacy check passed (0 leaks).`
    : `Warning: privacy check flagged ${leaks.join(", ")}. Review carefully before sharing.`;
  $("diagnoseText").value = text;
  $("diagnoseBox").hidden = false;
}

function renderSelectedSnapshot() {
  const item = snapshots[selectedSnapshot];
  if (!item) return;
  const { audit, html } = item.result;
  const s = audit.stats;

  const status = $("snapshotStatus");
  status.dataset.clean = audit.clean ? "yes" : "no";
  status.textContent = audit.clean
    ? "Privacy check passed — 0 student, staff, school, or email leaks found."
    : `Privacy check flagged: ${audit.leaks.join(", ")}. Do not share until resolved.`;

  const replaced = (s.rosterHits ?? 0) + (s.forbiddenHits ?? 0) + (s.unknownReplacements ?? 0);
  const synNote = audit.syntheticNames.length ? ` (mapped to ${audit.syntheticNames.slice(0, 4).join(", ")}${audit.syntheticNames.length > 4 ? ", …" : ""})` : "";
  $("snapshotStats").textContent =
    `Kept ${s.elementsKept} visible elements · Stripped ${s.scriptsStripped} script(s), ${s.imagesStripped} image(s), ${s.hiddenSkipped} hidden node(s) · Scrubbed ${replaced} non-UI text item(s)${synNote}.`;

  $("snapshotWordsSummary").textContent = `Inspect every kept word (${audit.keptWords.length} unique UI words)`;
  renderWordPills($("snapshotWords"), audit.keptWords);
  $("snapshotHtml").value = html;
}

async function captureSnapshots() {
  const tabs = (await allGoGuardianTabs()).sort((a, b) => Number(b.active) - Number(a.active));
  const captured = [];
  for (const tab of tabs) {
    const { head, isPopup } = await tabLabel(tab);
    const result = await chrome.tabs.sendMessage(tab.id, { type: "snapshot", isPopup }).catch(() => null);
    if (result?.ok) captured.push({ head, result });
  }
  if (!captured.length) {
    toast(tabs.length ? "Reload your GoGuardian tabs first." : "Open HallPass first.");
    return;
  }

  snapshots = captured;
  selectedSnapshot = 0;

  const picker = $("snapshotPicker");
  picker.replaceChildren(...snapshots.map((item, i) => h("option", { value: String(i) }, item.head)));
  picker.hidden = snapshots.length < 2;

  hideLegacyBoxes();
  renderSelectedSnapshot();
  $("snapshotBox").hidden = false;
}

export async function initTools(settingsGetter) {
  getSettings = settingsGetter;

  // Restore in-progress or unreviewed recording if the side panel was closed and reopened.
  const info = await sendBg({ type: "record-info" });
  if (info?.active) {
    recordMode = "recording";
    recordFrames = new Array(info.count ?? 0);
    recordDropped = info.dropped ?? 0;
    $("recordStatus").textContent = `Recording… ${info.count ?? 0} screen${info.count === 1 ? "" : "s"} captured`;
    $("testingDrawer").open = true;
    pollRecording();
  } else if (info?.frames?.length) {
    recordMode = "review";
    recordFrames = info.frames;
    recordDropped = info.dropped ?? 0;
  }
  renderRecorder();
  renderFailureCapture();

  // Flight Recorder buttons
  $("recordButton").addEventListener("click", startRecording);
  $("stopRecordButton").addEventListener("click", () => stopRecording(true));
  $("cancelRecordButton").addEventListener("click", () => stopRecording(false));
  $("downloadBundle").addEventListener("click", () => {
    const date = new Date().toISOString().slice(0, 10);
    const name = `hallpass-session-${date}.json`;
    downloadBlob(currentBundleJson(), "application/json;charset=utf-8", name);
    toast(`Saved ${name}.`);
  });
  $("copyBundle").addEventListener("click", async () => {
    await navigator.clipboard.writeText(currentBundleJson());
    toast("Copied scrubbed session bundle JSON.");
  });
  $("discardBundle").addEventListener("click", async () => {
    await sendBg({ type: "record-clear" });
    recordMode = "idle";
    recordFrames = [];
    recordDropped = 0;
    renderRecorder();
  });

  // Automatic Failure Capture buttons
  $("reviewFailureLink").addEventListener("click", () => {
    $("testingDrawer").open = true;
    $("failureCard").scrollIntoView({ behavior: "smooth", block: "nearest" });
  });
  $("previewFailure").addEventListener("click", () => {
    const html = getSettings()?.lastFailureCapture?.frame?.html;
    if (html) previewHtmlInTab(html);
  });
  $("downloadFailure").addEventListener("click", () => {
    const cap = getSettings()?.lastFailureCapture;
    if (!cap?.frame) return;
    const version = chrome.runtime.getManifest().version_name ?? chrome.runtime.getManifest().version;
    const json = JSON.stringify(
      exportBundle({ frames: [cap.frame], helperVersion: version, lane: cap.lane, kind: "failure" }),
      null,
      2,
    );
    const name = `hallpass-failure-${cap.goal}-${new Date(cap.at).toISOString().slice(0, 10)}.json`;
    downloadBlob(json, "application/json;charset=utf-8", name);
    toast(`Saved ${name}.`);
  });
  $("clearFailure").addEventListener("click", async () => {
    await saveSettings({ lastFailureCapture: null });
    toast("Cleared saved failure capture.");
  });

  // Legacy / single-page buttons
  $("outlineButton").addEventListener("click", showOutline);
  $("closeOutline").addEventListener("click", () => ($("outlineBox").hidden = true));
  $("copyOutline").addEventListener("click", async () => {
    await navigator.clipboard.writeText($("outlineText").value);
    toast("Copied outline to clipboard.");
  });

  $("diagnoseButton").addEventListener("click", runDiagnose);
  $("closeDiagnose").addEventListener("click", () => ($("diagnoseBox").hidden = true));
  $("copyDiagnose").addEventListener("click", async () => {
    await navigator.clipboard.writeText($("diagnoseText").value);
    toast("Copied read-only self-check report.");
  });

  $("snapshotButton").addEventListener("click", captureSnapshots);
  $("closeSnapshot").addEventListener("click", () => ($("snapshotBox").hidden = true));
  $("snapshotPicker").addEventListener("change", (e) => {
    selectedSnapshot = Number(e.target.value) || 0;
    renderSelectedSnapshot();
  });
  $("previewSnapshot").addEventListener("click", () => {
    const item = snapshots[selectedSnapshot];
    if (item) previewHtmlInTab(item.result.html);
  });
  $("downloadSnapshot").addEventListener("click", () => {
    const item = snapshots[selectedSnapshot];
    if (!item) return;
    downloadBlob(item.result.html, "text/html;charset=utf-8", item.result.filename);
    toast(`Saved ${item.result.filename}.`);
  });
  $("copySnapshot").addEventListener("click", async () => {
    const item = snapshots[selectedSnapshot];
    if (!item) return;
    await navigator.clipboard.writeText(item.result.html);
    toast("Copied scrubbed HTML snapshot.");
  });
}
