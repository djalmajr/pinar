import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { AgentExecution, Session } from "@pinar/shared";
import { batchHandoffRevision, batchPromptRevision, copyPromptIfCurrentRevision, createBatchPromptCache, sessionPromptRevision } from "./session-actions";

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

  test("does not write or report a single-page prompt after navigation changes the revision", async () => {
    let resolveFetch!: (text: string) => void;
    let currentRevision = "capture-old\nrevision-1";
    let writes = 0;
    const fetched = new Promise<string>((resolve) => { resolveFetch = resolve; });
    const copy = copyPromptIfCurrentRevision(
      () => fetched,
      "capture-old\nrevision-1",
      () => currentRevision,
      async () => { writes += 1; },
    );

    currentRevision = "capture-new\nrevision-2";
    resolveFetch("old session prompt");

    assert.equal(await copy, "stale");
    assert.equal(writes, 0);
  });

  test("does not copy a stale single-page prompt after review and execution state changes", async () => {
    const delivery = { copyViewerContent: true, handoffMode: "full" as const, includeScreenshot: true, language: "en" as const };
    const source = capture("Fix the key");
    const openRevision = sessionPromptRevision(source, [{ pinId: "pin-1", status: "open" }], [], delivery, "capture");
    let currentRevision = openRevision;
    let resolveFetch!: (text: string) => void;
    let writes = 0;
    const fetched = new Promise<string>((resolve) => { resolveFetch = resolve; });
    const copy = copyPromptIfCurrentRevision(
      () => fetched,
      openRevision,
      () => currentRevision,
      async () => { writes += 1; },
    );

    currentRevision = sessionPromptRevision(source, [{ pinId: "pin-1", status: "accepted" }], [{
      agent: "codex",
      captureId: source.id,
      createdAt: "2026-09-25T00:00:00.000Z",
      id: "execution-1",
      idempotencyKey: "execution_1",
      results: [{
        createdAt: "2026-09-25T00:00:00.000Z",
        files: [],
        pinId: "pin-1",
        status: "changed",
        summary: "Changed the key",
      }],
    }], delivery, "capture");
    resolveFetch("open session prompt");

    assert.notEqual(currentRevision, openRevision);
    assert.equal(await copy, "stale");
    assert.equal(writes, 0);
  });

  test("does not report copied when navigation changes during clipboard writing", async () => {
    let currentRevision = "capture-old\nrevision-1";
    const result = await copyPromptIfCurrentRevision(
      async () => "old session prompt",
      "capture-old\nrevision-1",
      () => currentRevision,
      async () => {
        currentRevision = "capture-new\nrevision-2";
      },
    );

    assert.equal(result, "stale");
  });

  test("does not copy a stale batch prompt after navigation changes batches", async () => {
    const delivery = { copyViewerContent: true, handoffMode: "full" as const, includeScreenshot: true, language: "en" as const };
    const source = capture("Fix the key");
    const batchARevision = batchHandoffRevision("batch-a", source, [], [], delivery, "capture-a");
    let currentRevision = batchARevision;
    let resolveFetch!: (text: string) => void;
    let writes = 0;
    const fetched = new Promise<string>((resolve) => { resolveFetch = resolve; });
    const copy = copyPromptIfCurrentRevision(
      () => fetched,
      batchARevision,
      () => currentRevision,
      async () => { writes += 1; },
    );

    currentRevision = batchHandoffRevision("batch-b", capture("Fix the other key", { id: "capture-b" }), [], [], delivery, "capture-b");
    resolveFetch("batch A prompt");

    assert.notEqual(currentRevision, batchARevision);
    assert.equal(await copy, "stale");
    assert.equal(writes, 0);
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

  test("re-fetches when delivery preferences or stored agent results change", async () => {
    let calls = 0;
    const cache = createBatchPromptCache(async () => {
      calls += 1;
      return `prompt-${calls}`;
    });
    const executions: AgentExecution[] = [{
      agent: "codex",
      captureId: "capture",
      createdAt: "2026-09-25T00:00:00.000Z",
      id: "execution-1",
      idempotencyKey: "execution_1",
      results: [{
        createdAt: "2026-09-25T00:00:00.000Z",
        files: [],
        pinId: "pin-1",
        status: "changed",
        summary: "Changed the pin",
      }],
    }];
    const base = batchPromptRevision([capture("Rotate the key")], [], [], {
      copyViewerContent: false,
      handoffMode: "compact",
      includeScreenshot: true,
      language: "en",
    });
    assert.equal(await cache.prepare("batch-preview", base), "prompt-1");
    const full = batchPromptRevision([capture("Rotate the key")], [], [], {
      copyViewerContent: true,
      handoffMode: "full",
      includeScreenshot: false,
      language: "pt",
    });
    assert.notEqual(full, base);
    assert.equal(await cache.prepare("batch-preview", full), "prompt-2");
    const withExecution = batchPromptRevision([capture("Rotate the key")], [], executions, {
      copyViewerContent: true,
      handoffMode: "full",
      includeScreenshot: false,
      language: "pt",
    });
    assert.notEqual(withExecution, full);
    assert.equal(await cache.prepare("batch-preview", withExecution), "prompt-3");
    assert.equal(calls, 3);
  });

  test("passes the current viewer-content intent to every batch preparation request", async () => {
    const intents: Array<boolean | undefined> = [];
    const cache = createBatchPromptCache(async (_batchId, includeViewerContent) => {
      intents.push(includeViewerContent);
      return includeViewerContent ? "full prompt" : "compact prompt";
    });
    const compactRevision = batchPromptRevision([capture("Compact")], [], [], { copyViewerContent: false });
    const fullRevision = batchPromptRevision([capture("Full")], [], [], { copyViewerContent: true });
    assert.equal(await cache.prepare("batch-preview", compactRevision, false), "compact prompt");
    assert.equal(await cache.prepare("batch-preview", fullRevision, true), "full prompt");
    assert.deepEqual(intents, [false, true]);
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
