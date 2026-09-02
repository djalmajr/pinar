// Pure state for multi-page capture batches. No chrome APIs here so the
// transitions stay testable without a browser.

// Two distinct decisions: whether the user allows remote history at all, and
// whether this particular capture has something to persist.
export function planCapturePersistence({ enableHistory, hasShot, includeScreenshot, storageMode }) {
  const historyAllowed = storageMode !== "cloud" || enableHistory !== false;
  return {
    historyAllowed,
    persist: historyAllowed && Boolean(hasShot),
    warnScreenshotMissing: Boolean(includeScreenshot) && !hasShot,
  };
}

export function openBatch({ id, label, startedAt } = {}) {
  return {
    id,
    items: [],
    label: label || "",
    startedAt: startedAt || new Date().toISOString(),
  };
}

function withItems(batch, items) {
  return { ...batch, items };
}

function indexOfCapture(batch, captureId) {
  return batch.items.findIndex((item) => item.captureId === captureId);
}

export function addCapture(batch, capture) {
  if (!batch) return null;
  if (!capture?.captureId) throw new Error("A batch item needs a captureId");
  const entry = {
    addedAt: capture.addedAt || new Date().toISOString(),
    captureId: capture.captureId,
    status: "saved",
    title: capture.title || "",
    url: capture.url || "",
  };
  const existing = indexOfCapture(batch, capture.captureId);
  // Re-capturing the same page replaces the entry instead of duplicating it,
  // so a retry after a failure settles on one item per captureId.
  if (existing >= 0) {
    const items = [...batch.items];
    items[existing] = { ...items[existing], ...entry };
    return withItems(batch, items);
  }
  return withItems(batch, [...batch.items, entry]);
}

export function markFailed(batch, captureId, reason) {
  if (!batch) return null;
  const existing = indexOfCapture(batch, captureId);
  const entry = {
    addedAt: new Date().toISOString(),
    captureId,
    reason: reason || "unknown",
    status: "pending",
    title: "",
    url: "",
  };
  if (existing < 0) return withItems(batch, [...batch.items, entry]);
  const items = [...batch.items];
  items[existing] = { ...items[existing], reason: entry.reason, status: "pending" };
  return withItems(batch, items);
}

export function savedCount(batch) {
  return batch ? batch.items.filter((item) => item.status === "saved").length : 0;
}

export function pendingCount(batch) {
  return batch ? batch.items.filter((item) => item.status === "pending").length : 0;
}

export function batchSummary(batch) {
  if (!batch) return null;
  return {
    id: batch.id,
    label: batch.label,
    pending: pendingCount(batch),
    saved: savedCount(batch),
    startedAt: batch.startedAt,
    total: batch.items.length,
  };
}

export function copyOnFinishBatchMode(value) {
  return value === "off" || value === "link" || value === "prompt" ? value : "prompt";
}

// A batch has no page of its own - it is a filter inside the workspace - so
// both shapes address the markdown bundle. "link" hands over the URL for the
// agent to fetch; "prompt" hands over the body of that same URL.
export function batchHandoffUrl(base, batchId) {
  const root = String(base || "").replace(/\/+$/, "");
  if (!root || !batchId) return "";
  return `${root}/b/${batchId}.md`;
}

export function finishedBatchToastKey(copied) {
  if (copied === "link") return "batch_copied_link";
  if (copied === "prompt") return "batch_copied_prompt";
  return "batch_finished";
}

export async function copyFinishedBatch({
  mode,
  base,
  batchId,
  fetchText,
  writeClipboard,
}) {
  const copyMode = copyOnFinishBatchMode(mode);
  if (copyMode === "off") return { copied: null };
  const url = batchHandoffUrl(base, batchId);
  if (!url) return { copied: null };
  const text = copyMode === "prompt" ? await fetchText(url) : url;
  if (!text) return { copied: null };
  await writeClipboard(text);
  return { copied: copyMode };
}
