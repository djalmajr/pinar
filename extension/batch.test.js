import assert from "node:assert/strict";
import test, { describe } from "node:test";
import {
  addCapture,
  batchDestination,
  batchSummary,
  markFailed,
  openBatch,
  pendingCount,
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
