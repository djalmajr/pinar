import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { encodeVector, PIN_EMBEDDING_DIMENSIONS } from "../assistant/retrieval/embeddings";
import type { PinIndexEntry } from "../assistant/retrieval/types";
import { FILING_CENTROID_SESSIONS, FILING_EXAMPLE_TITLES, type FilingCollection, type FilingRecentSession } from "./candidates";
import { FILING_NONE_OPTION } from "./choose";
import { fileCapture, type FilingEngineChoice, type FilingSource } from "./runtime";

const BASE_URL = "http://127.0.0.1:9/v1";
const CAPTURE = { captureId: "cap_1", page: { title: "Payment declined", url: "https://example.test/pay" }, pins: [{ comment: "Card", number: 1 }] };
const DECISIONS: FilingEngineChoice = {
  endpoint: { baseUrl: BASE_URL, kind: "openai-compatible", model: "chat", thinkingControl: false },
  kind: "decisions",
};
const SIMILARITY: FilingEngineChoice = { embedding: { baseUrl: BASE_URL, model: "embed" }, kind: "similarity" };
const COLLECTIONS: FilingCollection[] = [
  { collectionId: "col_a", collectionName: "Checkout", projectName: "Shop" },
  { collectionId: "col_b", collectionName: "Onboarding", projectName: "Shop" },
];

const never = <T>() => new Promise<T>(() => {});

function vector(...leading: number[]): number[] {
  const values = new Array<number>(PIN_EMBEDDING_DIMENSIONS).fill(0);
  leading.forEach((value, index) => {
    values[index] = value;
  });
  return values;
}

function entry(sessionId: string, values: number[], model = "embed"): PinIndexEntry {
  return {
    caption: null, docHash: sessionId, docText: sessionId, model, number: 1, ocr: null, pinId: `pin_${sessionId}`,
    sessionId, truncated: false, updatedAt: "2026-10-01T00:00:00.000Z", vector: encodeVector(values),
  };
}

function source(overrides: Partial<FilingSource> = {}): FilingSource & { reads: string[] } {
  const reads: string[] = [];
  return {
    async batchSession(batchId, excludeId) {
      reads.push(`batch:${batchId}:${excludeId}`);
      return null;
    },
    async collections() {
      reads.push("collections");
      return COLLECTIONS;
    },
    async entriesFor(ids) {
      reads.push(`entries:${ids.join(",")}`);
      return [];
    },
    async recentSessions(input) {
      reads.push(`recent:${input.perCollection}:${input.excludeId}`);
      return [];
    },
    reads,
    ...overrides,
  };
}

// A normalized decision: the rest of the mass goes to the none option.
function decisionsFetch(choice: string, probability: number) {
  const probabilities = { [choice]: probability, [FILING_NONE_OPTION]: 1 - probability };
  return (async () => Response.json({ decisions: [{ choice, id: "collection", probabilities }] })) as unknown as typeof fetch;
}

// An engine detection that counts its calls.
function countedEngine(engine: FilingEngineChoice | null | (() => Promise<FilingEngineChoice | null>)) {
  const counter = { calls: 0, engine: async () => {
    counter.calls += 1;
    return typeof engine === "function" ? engine() : engine;
  } };
  return counter;
}

describe("fileCapture", () => {
  test("the batch rule comes before the detection: the batch's collection and mark, no engine", async () => {
    for (const filedBy of ["auto", null] as const) {
      const seen = source({
        async batchSession(batchId, excludeId) {
          seen.reads.push(`batch:${batchId}:${excludeId}`);
          return { collectionId: "col_b", filedBy };
        },
      });
      const detection = countedEngine(DECISIONS);
      let fetched = 0;
      const outcome = await fileCapture({
        batchId: "batch_1",
        capture: CAPTURE,
        engine: detection.engine,
        fetch: (async () => {
          fetched += 1;
          return new Response("no", { status: 500 });
        }) as unknown as typeof fetch,
        source: seen,
      });
      assert.deepEqual(outcome, { filedBy, filing: { collectionId: "col_b", confidence: 0, engine: "none", reason: "chosen" }, followedBatch: true }, String(filedBy));
      assert.deepEqual(seen.reads, ["batch:batch_1:cap_1", "collections"]);
      assert.equal(detection.calls, 0, "the engine is never detected");
      assert.equal(fetched, 0);
    }
  });

  test("an existing batch is followed with the endpoint down (no engine, or a detection that fails)", async () => {
    for (const down of [null, () => Promise.reject(new Error("endpoint down"))]) {
      const detection = countedEngine(down);
      const outcome = await fileCapture({
        batchId: "batch_1",
        capture: CAPTURE,
        engine: detection.engine,
        source: source({ batchSession: async () => ({ collectionId: "col_a", filedBy: "auto" }) }),
      });
      assert.deepEqual(outcome, { filedBy: "auto", filing: { collectionId: "col_a", confidence: 0, engine: "none", reason: "chosen" }, followedBatch: true });
      assert.equal(detection.calls, 0);
    }
  });

  test("a batch collection that is not a candidate (the Inbox) keeps the capture in the Inbox, unmarked", async () => {
    const outcome = await fileCapture({
      batchId: "batch_1",
      capture: CAPTURE,
      engine: async () => DECISIONS,
      source: source({ batchSession: async () => ({ collectionId: "col_inbox", filedBy: "auto" }) }),
    });
    assert.deepEqual(outcome, { filedBy: null, filing: { collectionId: null, confidence: 0, engine: "none", reason: "chosen" }, followedBatch: true });
  });

  test("a batch without another session is decided by the engine, with the examples of decisions", async () => {
    const seen = source();
    const outcome = await fileCapture({
      batchId: "batch_1",
      capture: CAPTURE,
      engine: async () => DECISIONS,
      fetch: decisionsFetch("Shop / Checkout", 0.9),
      source: seen,
    });
    assert.deepEqual(outcome, { filedBy: "auto", filing: { collectionId: "col_a", confidence: 0.9, engine: "decisions", reason: "chosen" } });
    assert.deepEqual(seen.reads, ["batch:batch_1:cap_1", "collections", `recent:${FILING_EXAMPLE_TITLES}:cap_1`]);
  });

  test("below the threshold: the Inbox, unmarked", async () => {
    const outcome = await fileCapture({
      batchId: null,
      capture: CAPTURE,
      engine: async () => DECISIONS,
      fetch: decisionsFetch("Shop / Checkout", 0.5),
      source: source(),
    });
    assert.deepEqual(outcome, { filedBy: null, filing: { collectionId: null, confidence: 0.5, engine: "decisions", reason: "low_confidence" } });
  });

  test("without an engine: the Inbox with reason error, after the batch lookup only", async () => {
    const seen = source();
    const inbox = { filedBy: null, filing: { collectionId: null, confidence: 0, engine: "none", reason: "error" } };
    assert.deepEqual(await fileCapture({ batchId: "batch_1", capture: CAPTURE, engine: async () => null, source: seen }), inbox);
    assert.deepEqual(seen.reads, ["batch:batch_1:cap_1"]);
    assert.deepEqual(await fileCapture({ batchId: null, capture: CAPTURE, engine: async () => Promise.reject(new Error("x")), source: seen }), inbox);
    assert.deepEqual(seen.reads, ["batch:batch_1:cap_1"], "without a batch nothing is read");
  });

  test("the budget covers every step: a step that never settles gives the Inbox with reason timeout", async () => {
    const steps: Array<{ engine?: () => Promise<FilingEngineChoice | null>; expected: string; name: string; overrides: Partial<FilingSource> }> = [
      { expected: "none", name: "batch lookup", overrides: { batchSession: never } },
      { expected: "none", name: "collections of the batch rule", overrides: {
        batchSession: async () => ({ collectionId: "col_a", filedBy: null }),
        collections: never,
      } },
      { engine: never, expected: "none", name: "detection", overrides: {} },
      { expected: "none", name: "collections", overrides: { collections: never } },
      { expected: "similarity", name: "recent sessions", overrides: { recentSessions: never } },
      { expected: "similarity", name: "centroid entries", overrides: {
        entriesFor: never,
        recentSessions: async () => [{ collectionId: "col_a", createdAt: "2026-10-01T00:00:00.000Z", id: "s1", title: "A" }],
      } },
    ];
    for (const step of steps) {
      const startedAt = Date.now();
      const outcome = await fileCapture({
        batchId: "batch_1",
        capture: CAPTURE,
        engine: step.engine ?? (async () => SIMILARITY),
        fetch: (async () => Response.json({ data: [{ embedding: vector(1), index: 0 }] })) as unknown as typeof fetch,
        source: source(step.overrides),
        timeoutMs: 80,
      });
      const elapsed = Date.now() - startedAt;
      assert.deepEqual(outcome, { filedBy: null, filing: { collectionId: null, confidence: 0, engine: step.expected, reason: "timeout" } }, step.name);
      assert.ok(elapsed < 500, `${step.name}: ${elapsed} ms`);
    }
  });

  test("similarity reads up to 50 sessions per collection and only the current model's vectors", async () => {
    const sessions: FilingRecentSession[] = [
      { collectionId: "col_a", createdAt: "2026-10-02T00:00:00.000Z", id: "a1", title: "A1" },
      { collectionId: "col_b", createdAt: "2026-10-01T00:00:00.000Z", id: "b1", title: "B1" },
    ];
    const vectors: Record<string, PinIndexEntry[]> = {
      a1: [entry("a1", vector(1, 0)), entry("a1", vector(0, 1), "old-embed")],
      b1: [entry("b1", vector(0, 1))],
    };
    const seen = source({
      async entriesFor(ids) {
        seen.reads.push(`entries:${ids.join(",")}`);
        return ids.flatMap((id) => vectors[id] ?? []);
      },
      async recentSessions(input) {
        seen.reads.push(`recent:${input.perCollection}:${input.excludeId}`);
        return sessions;
      },
    });
    const { filedBy, filing: choice } = await fileCapture({
      batchId: null,
      capture: CAPTURE,
      engine: async () => SIMILARITY,
      fetch: (async () => Response.json({ data: [{ embedding: vector(1, 0.02), index: 0 }] })) as unknown as typeof fetch,
      source: seen,
    });
    assert.equal(choice.collectionId, "col_a");
    assert.equal(choice.reason, "chosen");
    assert.ok(choice.confidence > 0.99);
    assert.equal(filedBy, "auto");
    assert.equal(FILING_CENTROID_SESSIONS, 50);
    assert.deepEqual(seen.reads.filter((read) => read.startsWith("recent")), [`recent:${FILING_CENTROID_SESSIONS}:cap_1`]);
    assert.deepEqual(seen.reads.filter((read) => read.startsWith("entries")).sort(), ["entries:a1", "entries:b1"]);
  });

  test("a centroid made only of another model's vectors leaves the collection out", async () => {
    const outcome = await fileCapture({
      batchId: null,
      capture: CAPTURE,
      engine: async () => SIMILARITY,
      fetch: (async () => Response.json({ data: [{ embedding: vector(1, 0), index: 0 }] })) as unknown as typeof fetch,
      source: source({
        entriesFor: async (ids) => ids.map((id) => entry(id, vector(1, 0), "old-embed")),
        recentSessions: async () => [{ collectionId: "col_a", createdAt: "2026-10-01T00:00:00.000Z", id: "a1", title: "A1" }],
      }),
    });
    assert.deepEqual(outcome, { filedBy: null, filing: { collectionId: null, confidence: 0, engine: "similarity", reason: "low_confidence" } });
  });
});
