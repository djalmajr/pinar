import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test, { describe } from "node:test";
import {
  addCapture,
  batchHandoffUrl,
  batchSummary,
  copyFinishedBatch,
  finishedBatchToastKey,
  markFailed,
  openBatch,
  pendingCount,
  planCapturePersistence,
  savedCount,
} from "./batch.js";

const opened = { id: "11111111-1111-4111-8111-111111111111", label: "Batch · 01/09/2026, 14:11" };

describe("capture batch", () => {
  test("opens with an id, label and startedAt", () => {
    const batch = openBatch({ ...opened, startedAt: "2026-09-01T10:00:00Z" });
    assert.equal(batch.id, opened.id);
    assert.equal(batch.label, opened.label);
    assert.equal(batch.items.length, 0);
    assert.equal(batch.startedAt, "2026-09-01T10:00:00Z");
  });

  test("carries no collection destination", () => {
    const batch = openBatch(opened);
    assert.equal("collectionId" in batch, false);
    assert.equal("projectId" in batch, false);
    assert.deepEqual(Object.keys(batch).sort(), ["id", "items", "label", "startedAt"]);
  });

  test("accumulates one item per page", () => {
    let batch = openBatch(opened);
    batch = addCapture(batch, { captureId: "cap_a", url: "https://a.test" });
    batch = addCapture(batch, { captureId: "cap_b", url: "https://b.test" });
    assert.equal(savedCount(batch), 2);
    assert.deepEqual(batch.items.map((item) => item.captureId), ["cap_a", "cap_b"]);
  });

  test("is idempotent for a repeated captureId", () => {
    let batch = openBatch(opened);
    batch = addCapture(batch, { captureId: "cap_a", url: "https://a.test" });
    batch = addCapture(batch, { captureId: "cap_a", url: "https://a.test?v=2" });
    assert.equal(batch.items.length, 1);
    assert.equal(batch.items[0].url, "https://a.test?v=2");
  });

  test("keeps a failed item pending without dropping the batch", () => {
    let batch = openBatch(opened);
    batch = addCapture(batch, { captureId: "cap_a" });
    batch = markFailed(batch, "cap_b", "upload_failed");
    assert.equal(savedCount(batch), 1);
    assert.equal(pendingCount(batch), 1);
    assert.equal(batch.items[1].reason, "upload_failed");
  });

  test("promotes a pending item once the retry succeeds", () => {
    let batch = openBatch(opened);
    batch = markFailed(batch, "cap_a", "upload_failed");
    batch = addCapture(batch, { captureId: "cap_a", url: "https://a.test" });
    assert.equal(batch.items.length, 1);
    assert.equal(savedCount(batch), 1);
    assert.equal(pendingCount(batch), 0);
  });

  test("summarizes saved, pending and total", () => {
    let batch = openBatch(opened);
    batch = addCapture(batch, { captureId: "cap_a" });
    batch = markFailed(batch, "cap_b", "quota");
    assert.deepEqual(batchSummary(batch), {
      id: opened.id,
      label: opened.label,
      pending: 1,
      saved: 1,
      startedAt: batch.startedAt,
      total: 2,
    });
  });

  test("treats a missing batch as inert", () => {
    assert.equal(addCapture(null, { captureId: "cap_a" }), null);
    assert.equal(markFailed(null, "cap_a"), null);
    assert.equal(batchSummary(null), null);
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

describe("batch identity", () => {
  test("keeps items addressed by captureId so a retry replaces instead of duplicating", () => {
    const batch = openBatch({ id: "batch_1", label: "Lote · 01/09/2026, 14:11", startedAt: "2026-09-01T10:00:00.000Z" });
    const once = addCapture(batch, { captureId: "cap_1", title: "A", url: "https://a" });
    const twice = addCapture(once, { captureId: "cap_1", title: "A", url: "https://a" });
    assert.equal(twice.items.length, 1);
    assert.equal(savedCount(twice), 1);
  });
});

describe("copy on finish batch", () => {
  const base = "http://127.0.0.1:17373";
  const batchId = opened.id;

  test("off performs no clipboard write", async () => {
    const writes = [];
    const fetches = [];
    const result = await copyFinishedBatch({
      base,
      batchId,
      fetchText: async (url) => {
        fetches.push(url);
        return "nope";
      },
      mode: "off",
      writeClipboard: async (text) => {
        writes.push(text);
      },
    });
    assert.equal(result.copied, null);
    assert.deepEqual(writes, []);
    assert.deepEqual(fetches, []);
  });

  test("link copies a URL", async () => {
    const writes = [];
    const result = await copyFinishedBatch({
      base: `${base}/`,
      batchId,
      fetchText: async () => {
        throw new Error("should not fetch");
      },
      mode: "link",
      writeClipboard: async (text) => {
        writes.push(text);
      },
    });
    assert.equal(result.copied, "link");
    assert.deepEqual(writes, [`${base}/b/${batchId}.md`]);
  });

  test("prompt copies the fetched markdown body", async () => {
    const writes = [];
    const result = await copyFinishedBatch({
      base,
      batchId,
      fetchText: async (url) => {
        assert.equal(url, `${base}/b/${batchId}.md`);
        return "# Batch prompt\n";
      },
      mode: "prompt",
      writeClipboard: async (text) => {
        writes.push(text);
      },
    });
    assert.equal(result.copied, "prompt");
    assert.deepEqual(writes, ["# Batch prompt\n"]);
  });

  test("unknown mode defaults to prompt", async () => {
    const writes = [];
    const result = await copyFinishedBatch({
      base,
      batchId,
      fetchText: async () => "body",
      mode: "surprise",
      writeClipboard: async (text) => {
        writes.push(text);
      },
    });
    assert.equal(result.copied, "prompt");
    assert.deepEqual(writes, ["body"]);
    assert.equal(batchHandoffUrl(base, batchId), `${base}/b/${batchId}.md`);
    assert.equal(finishedBatchToastKey("link"), "batch_copied_link");
    assert.equal(finishedBatchToastKey("prompt"), "batch_copied_prompt");
    assert.equal(finishedBatchToastKey(null), "batch_finished");
  });

  test("finishBatch copies through the offscreen clipboard after closing the batch", () => {
    const backgroundSrc = readFileSync(new URL("./background.js", import.meta.url), "utf8");
    const contentSrc = readFileSync(new URL("./content.js", import.meta.url), "utf8");
    const finish = backgroundSrc.slice(
      backgroundSrc.indexOf("async function finishBatch()"),
      backgroundSrc.indexOf("async function toggleBatch()"),
    );
    assert.match(finish, /writeBatch\(null\)/);
    assert.match(finish, /copyFinishedBatch/);
    assert.match(finish, /writeClipboardPlain/);
    assert.ok(finish.indexOf("writeBatch(null)") < finish.indexOf("copyFinishedBatch"));
    assert.ok(finish.indexOf("copyFinishedBatch") < finish.indexOf("syncBatchSurfaces"));
    assert.match(backgroundSrc, /async function writeClipboardPlain\(text\)/);
    assert.match(backgroundSrc, /type: "clipboard:write"/);
    assert.match(backgroundSrc, /ensureOffscreen\(\)/);
    assert.match(backgroundSrc, /copyOnFinishBatch: "prompt"/);
    assert.match(contentSrc, /if \(next\?\.toast\) flashStatus\(next\.toast, "ok"\)/);
  });
});
