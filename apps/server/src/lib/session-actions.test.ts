import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { Session } from "@pinar/shared";
import { batchPromptRevision, createBatchPromptCache } from "./session-actions";

function capture(comment: string, extra: Partial<Session> = {}): Session {
  return {
    createdAt: "2026-09-25T00:00:00.000Z",
    id: "capture",
    page: { title: "Page", url: "https://example.test" },
    pins: [{ comment, coords: { x: 0, y: 0 }, number: 1, type: "point" }],
    ...extra,
  };
}

describe("batch prompt preparation", () => {
  test("opening and copying share one request until the prompt content changes", async () => {
    let calls = 0;
    const fetchText = async () => {
      calls += 1;
      await new Promise((resolve) => setTimeout(resolve, 20));
      return "aggregated prompt";
    };
    const cache = createBatchPromptCache(fetchText);
    const revision = batchPromptRevision([capture("Rotate the key")], []);
    const opened = cache.prepare("batch-preview", revision);
    const clicked = cache.prepare("batch-preview", revision);
    assert.equal(cache.prepared("batch-preview", revision), undefined);
    assert.equal(await opened, "aggregated prompt");
    assert.equal(await clicked, "aggregated prompt");
    assert.equal(await cache.prepare("batch-preview", revision), "aggregated prompt");
    assert.equal(calls, 1);

    const edited = batchPromptRevision([capture("Rotate the key", {
      pins: [{
        comment: "Rotate the key",
        coords: { x: 0, y: 0 },
        evidence: { text: "cropped" } as Session["pins"][number]["evidence"],
        number: 1,
        type: "point",
      }],
    })], [{ pinId: "pin-1", status: "accepted" }]);
    assert.notEqual(edited, revision);
    assert.equal(await cache.prepare("batch-preview", edited), "aggregated prompt");
    assert.equal(calls, 2);
  });

  test("a failed preparation stays retryable and is not treated as copied text", async () => {
    let calls = 0;
    const fetchText = async () => {
      calls += 1;
      if (calls === 1) throw new Error("unavailable");
      return "aggregated prompt";
    };
    const cache = createBatchPromptCache(fetchText);
    const revision = batchPromptRevision([capture("Rotate the key")], []);
    await assert.rejects(() => cache.prepare("batch-preview", revision));
    assert.equal(cache.prepared("batch-preview", revision), undefined);
    assert.equal(await cache.prepare("batch-preview", revision), "aggregated prompt");
    assert.equal(calls, 2);
  });

  test("an older request cannot replace a newer revision or another viewer cache", async () => {
    const resolvers = new Map<string, (text: string) => void>();
    const fetchText = (batchId: string) => new Promise<string>((resolve) => {
      resolvers.set(batchId, resolve);
    });
    const cache = createBatchPromptCache(fetchText);
    const oldRequest = cache.prepare("old-batch", "revision-1");
    const newRequest = cache.prepare("new-batch", "revision-2");
    resolvers.get("old-batch")?.("old prompt");
    assert.equal(await oldRequest, "old prompt");
    assert.equal(cache.prepared("new-batch", "revision-2"), undefined);
    resolvers.get("new-batch")?.("new prompt");
    assert.equal(await newRequest, "new prompt");
    assert.equal(cache.prepared("new-batch", "revision-2"), "new prompt");
    assert.equal(cache.prepared("old-batch", "revision-1"), undefined);
    assert.equal(createBatchPromptCache(fetchText).prepared("new-batch", "revision-2"), undefined);
  });
});
