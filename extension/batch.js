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

export function openBatch(destination, startedAt) {
  if (!destination?.collectionId) throw new Error("A batch needs a collection destination");
  return {
    collectionId: destination.collectionId,
    items: [],
    projectId: destination.projectId || "",
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
    collectionId: batch.collectionId,
    pending: pendingCount(batch),
    projectId: batch.projectId,
    saved: savedCount(batch),
    startedAt: batch.startedAt,
    total: batch.items.length,
  };
}

export function batchDestination(batch) {
  return batch ? { collectionId: batch.collectionId, projectId: batch.projectId } : null;
}
