// Testing & troubleshooting tools in the side panel:
//  1. Read-only self-check (dry run) — tests selectors and screen state without clicking anything.
//  2. Scrubbed DOM snapshot — captures allowlist-scrubbed HTML with a one-screen word audit and local preview.
//  3. Page outline — compact text outline of open GoGuardian pages.
import { allGoGuardianTabs, hostOf } from "../lib/tabs.js";
import { $, h, toast } from "./shared.js";

let snapshots = [];
let selectedSnapshot = 0;

function hideAllBoxes() {
  $("outlineBox").hidden = true;
  $("diagnoseBox").hidden = true;
  $("snapshotBox").hidden = true;
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

// --- 1. Page outline (existing behavior preserved) ---

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
  hideAllBoxes();
  $("outlineText").value = text;
  $("outlineBox").hidden = false;
}

// --- 2. Read-only self-check (dry run) ---

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

  hideAllBoxes();
  const badge = $("diagnoseBadge");
  badge.dataset.clean = allClean ? "yes" : "no";
  badge.textContent = allClean
    ? `Read-only check complete (${parts.filter((p) => p.report).length} page${parts.filter((p) => p.report).length === 1 ? "" : "s"}). Nothing was clicked. Privacy check passed (0 leaks).`
    : `Warning: privacy check flagged ${leaks.join(", ")}. Review carefully before sharing.`;
  $("diagnoseText").value = text;
  $("diagnoseBox").hidden = false;
}

// --- 3. Scrubbed DOM snapshot + word audit ---

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
  $("snapshotWords").replaceChildren(
    ...(audit.keptWords.length
      ? audit.keptWords.map((w) => h("span", { class: "word-pill" }, w))
      : [h("span", { class: "hint" }, "No text words kept.")]),
  );
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

  hideAllBoxes();
  renderSelectedSnapshot();
  $("snapshotBox").hidden = false;
}

export function initTools() {
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
    if (!item) return;
    const url = URL.createObjectURL(new Blob([item.result.html], { type: "text/html;charset=utf-8" }));
    chrome.tabs.create({ url });
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  });

  $("downloadSnapshot").addEventListener("click", () => {
    const item = snapshots[selectedSnapshot];
    if (!item) return;
    const url = URL.createObjectURL(new Blob([item.result.html], { type: "text/html;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = item.result.filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    toast(`Saved ${item.result.filename}.`);
  });

  $("copySnapshot").addEventListener("click", async () => {
    const item = snapshots[selectedSnapshot];
    if (!item) return;
    await navigator.clipboard.writeText(item.result.html);
    toast("Copied scrubbed HTML snapshot.");
  });
}
