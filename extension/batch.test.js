import assert from "node:assert/strict";
import test, { describe } from "node:test";
import {
  addCapture,
  batchDestination,
  batchSummary,
  markFailed,
  openBatch,
  pendingCount,
  planCapturePersistence,
  savedCount,
} from "./batch.js";

const destination = { collectionId: "col_1", projectId: "proj_1" };

describe("capture batch", () => {
  test("locks the destination when the batch opens", () => {
    const batch = openBatch(destination, "2026-09-01T10:00:00Z");
    assert.deepEqual(batchDestination(batch), destination);
    assert.equal(batch.items.length, 0);
    assert.equal(batch.startedAt, "2026-09-01T10:00:00Z");
  });

  test("refuses to open without a collection", () => {
    assert.throws(() => openBatch({ projectId: "proj_1" }), /collection destination/);
  });

  test("accumulates one item per page", () => {
    let batch = openBatch(destination);
    batch = addCapture(batch, { captureId: "cap_a", url: "https://a.test" });
    batch = addCapture(batch, { captureId: "cap_b", url: "https://b.test" });
    assert.equal(savedCount(batch), 2);
    assert.deepEqual(batch.items.map((item) => item.captureId), ["cap_a", "cap_b"]);
  });

  test("is idempotent for a repeated captureId", () => {
    let batch = openBatch(destination);
    batch = addCapture(batch, { captureId: "cap_a", url: "https://a.test" });
    batch = addCapture(batch, { captureId: "cap_a", url: "https://a.test?v=2" });
    assert.equal(batch.items.length, 1);
    assert.equal(batch.items[0].url, "https://a.test?v=2");
  });

  test("keeps a failed item pending without dropping the batch", () => {
    let batch = openBatch(destination);
    batch = addCapture(batch, { captureId: "cap_a" });
    batch = markFailed(batch, "cap_b", "upload_failed");
    assert.equal(savedCount(batch), 1);
    assert.equal(pendingCount(batch), 1);
    assert.equal(batch.items[1].reason, "upload_failed");
  });

  test("promotes a pending item once the retry succeeds", () => {
    let batch = openBatch(destination);
    batch = markFailed(batch, "cap_a", "upload_failed");
    batch = addCapture(batch, { captureId: "cap_a", url: "https://a.test" });
    assert.equal(batch.items.length, 1);
    assert.equal(savedCount(batch), 1);
    assert.equal(pendingCount(batch), 0);
  });

  test("summarizes saved, pending and total", () => {
    let batch = openBatch(destination);
    batch = addCapture(batch, { captureId: "cap_a" });
    batch = markFailed(batch, "cap_b", "quota");
    assert.deepEqual(batchSummary(batch), {
      collectionId: "col_1",
      pending: 1,
      projectId: "proj_1",
      saved: 1,
      startedAt: batch.startedAt,
      total: 2,
    });
  });

  test("treats a missing batch as inert", () => {
    assert.equal(addCapture(null, { captureId: "cap_a" }), null);
    assert.equal(markFailed(null, "cap_a"), null);
    assert.equal(batchSummary(null), null);
    assert.equal(batchDestination(null), null);
    assert.equal(savedCount(null), 0);
  });
});

describe("capture persistence plan", () => {
  const plan = (overrides) => planCapturePersistence({
    enableHistory: true,
    hasShot: true,
    includeScreenshot: true,
    storageMode: "local",
    ...overrides,
  });

  test("always persists local captures, even with history declined", () => {
    assert.deepEqual(plan({ enableHistory: false, storageMode: "local" }), {
      historyAllowed: true,
      persist: true,
      warnScreenshotMissing: false,
    });
  });

  test("persists remote captures while history is enabled", () => {
    assert.equal(plan({ storageMode: "cloud" }).persist, true);
    assert.equal(plan({ storageMode: "cloud" }).historyAllowed, true);
  });

  test("declines remote persistence without pretending the helper failed", () => {
    const declined = plan({ enableHistory: false, storageMode: "cloud" });
    assert.equal(declined.persist, false);
    assert.equal(declined.historyAllowed, false);
    // A deliberate opt-out must not surface as a missing screenshot either.
    assert.equal(declined.warnScreenshotMissing, false);
  });

  test("warns about a missing screenshot only when one was expected", () => {
    assert.equal(plan({ hasShot: false }).warnScreenshotMissing, true);
    assert.equal(plan({ hasShot: false, includeScreenshot: false }).warnScreenshotMissing, false);
  });

  test("keeps history allowed when there is nothing to save, so the viewer warning still fires", () => {
    const noShot = plan({ hasShot: false });
    assert.equal(noShot.persist, false);
    assert.equal(noShot.historyAllowed, true);
  });

  test("covers the whole storage and history matrix", () => {
    const matrix = [];
    for (const storageMode of ["local", "cloud"]) {
      for (const enableHistory of [true, false]) {
        for (const hasShot of [true, false]) {
          const result = planCapturePersistence({ enableHistory, hasShot, includeScreenshot: true, storageMode });
          matrix.push(`${storageMode}/${enableHistory}/${hasShot}=${result.persist}`);
        }
      }
    }
    assert.deepEqual(matrix, [
      "local/true/true=true",
      "local/true/false=false",
      "local/false/true=true",
      "local/false/false=false",
      "cloud/true/true=true",
      "cloud/true/false=false",
      "cloud/false/true=false",
      "cloud/false/false=false",
    ]);
  });
});

describe("batch destination", () => {
  test("nests the batch inside the collection the user configured", () => {
    const destination = { collectionId: "studio_1", projectId: "proj_1" };
    const batch = openBatch({ collectionId: "batch_1", projectId: destination.projectId }, "2026-09-01T10:00:00.000Z");
    // The batch owns a distinct collection, but it belongs to the configured project.
    assert.notEqual(batch.collectionId, destination.collectionId);
    assert.equal(batch.projectId, destination.projectId);
  });

  test("keeps items addressed by captureId so a retry replaces instead of duplicating", () => {
    const batch = openBatch({ collectionId: "c1", projectId: "p1" }, "2026-09-01T10:00:00.000Z");
    const once = addCapture(batch, { captureId: "cap_1", title: "A", url: "https://a" });
    const twice = addCapture(once, { captureId: "cap_1", title: "A", url: "https://a" });
    assert.equal(twice.items.length, 1);
    assert.equal(savedCount(twice), 1);
  });
});
