import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { AssistantEndpoint } from "../assistant/models";
import { PIN_EMBEDDING_DIMENSIONS, type EmbeddingEndpoint } from "../assistant/retrieval/embeddings";
import { chooseCollection, FILING_NONE_OPTION, filingSimilarityThresholds, type FilingCandidate, type FilingEngine } from "./choose";

const endpoint: AssistantEndpoint = {
  apiKey: "decisions-key",
  baseUrl: "https://appliance.example/v1",
  kind: "appliance",
  model: "qwen3.8-27b",
  thinkingControl: true,
};
const embedding: EmbeddingEndpoint = { baseUrl: "https://appliance.example/v1", model: "embeddinggemma-300m" };
const text = "Page: Cart\nURL: https://shop.example/cart\nPin #1: Button overlaps the total";

// Records every request and centroid lookup; decisions answers None of these.
function recorder() {
  const requests: Array<{ body: Record<string, unknown>; url: string }> = [];
  const centroids: string[] = [];
  const fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    requests.push({ body, url: String(input) });
    if (String(input).endsWith("/embeddings")) {
      return Response.json({ data: [{ embedding: [1, ...new Array<number>(PIN_EMBEDDING_DIMENSIONS - 1).fill(0)], index: 0 }] });
    }
    return Response.json({ decisions: [{ choice: FILING_NONE_OPTION, id: "collection", probabilities: { [FILING_NONE_OPTION]: 1 } }] });
  }) as typeof fetch;
  const engines: Record<FilingEngine["kind"], FilingEngine> = {
    decisions: { endpoint, kind: "decisions" },
    similarity: {
      centroid: async (collectionId) => {
        centroids.push(collectionId);
        return null;
      },
      embedding,
      kind: "similarity",
    },
  };
  return { centroids, engines, fetch, requests };
}

function candidate(label: string, lastUsedAt: string | null = null): FilingCandidate {
  return { collectionId: `id:${label}`, examples: [], label, lastUsedAt };
}

describe("chooseCollection candidates", () => {
  for (const kind of ["decisions", "similarity"] as const) {
    test(`no candidates answers no_candidates without a request (${kind})`, async () => {
      const fake = recorder();
      assert.deepEqual(await chooseCollection({ candidates: [], engine: fake.engines[kind], fetch: fake.fetch, text }), {
        collectionId: null,
        confidence: 0,
        engine: "none",
        reason: "no_candidates",
      });
      assert.equal(fake.requests.length, 0);
      assert.equal(fake.centroids.length, 0);
    });

    const invalid: Array<[string, FilingCandidate[]]> = [
      ["a repeated label", [candidate("Pinar / Bugs"), candidate("Pinar / Ideas"), candidate("Pinar / Bugs")]],
      ["a label over 200 characters", [candidate("x".repeat(201))]],
      ["an empty label", [candidate("Pinar / Bugs"), candidate("  ")]],
      ["the None of these label", [candidate(FILING_NONE_OPTION)]],
    ];
    for (const [name, candidates] of invalid) {
      test(`${name} throws before any request (${kind})`, async () => {
        const fake = recorder();
        await assert.rejects(chooseCollection({ candidates, engine: fake.engines[kind], fetch: fake.fetch, text }), /invalid filing candidates/);
        assert.equal(fake.requests.length, 0);
        assert.equal(fake.centroids.length, 0);
      });
    }
  }

  test("a 200-character label is accepted", async () => {
    const fake = recorder();
    const choice = await chooseCollection({ candidates: [candidate("x".repeat(200))], engine: fake.engines.decisions, fetch: fake.fetch, text });
    assert.equal(choice.reason, "low_confidence");
    assert.equal(fake.requests.length, 1);
  });
});

describe("chooseCollection cut to 19 candidates", () => {
  // 25 collections in an order unrelated to recency: collection i was last
  // used on day (7i mod 25) + 1 of September, a permutation of 1..25. Labels
  // run backwards, so a tie broken by label differs from one kept in the
  // caller's order.
  const day = (index: number) => ((7 * index) % 25) + 1;
  const label = (index: number) => `Pinar / Collection ${String(24 - index).padStart(2, "0")}`;
  const lastUsedAt = (index: number): string | null => {
    if (index === 3) return null; // day 22, but never used
    if (index === 22) return "2026-09-06T12:00:00.000Z"; // day 5, now tied with index 15 on day 6
    return `2026-09-${String(day(index)).padStart(2, "0")}T12:00:00.000Z`;
  };
  const candidates = Array.from({ length: 25 }, (_, index) => candidate(label(index), lastUsedAt(index)));

  test("decisions gets the 19 most recently used, ties by label, in the caller's order", async () => {
    // Mutation captured: skipping the cut sends all 25 labels (the appliance takes 20 options).
    // Mutation captured: dropping the label tie-break keeps index 15 ("Collection 09") over index 22 ("Collection 02").
    const fake = recorder();
    await chooseCollection({ candidates, engine: fake.engines.decisions, fetch: fake.fetch, text });
    // Out: days 1 to 4 (indexes 0, 18, 11, 4), never used (3), and the loser of the day-6 tie (15).
    const dropped = new Set([0, 3, 4, 11, 15, 18]);
    const expected = candidates.filter((_, index) => !dropped.has(index)).map((kept) => kept.label);
    assert.equal(expected.length, 19);
    assert.ok(expected.includes(label(22)));
    const questions = fake.requests[0]!.body["questions"] as Array<{ options: string[] }>;
    assert.deepEqual(questions[0]!.options, [...expected, FILING_NONE_OPTION]);
  });

  test("similarity has no cap and looks up all 25", async () => {
    const fake = recorder();
    await chooseCollection({ candidates, engine: fake.engines.similarity, fetch: fake.fetch, text });
    assert.deepEqual(fake.centroids, candidates.map((kept) => kept.collectionId));
  });
});

describe("filingSimilarityThresholds (F3.5 §1)", () => {
  const read = (values: Record<string, string>) => (name: string) => values[name];

  test("absent variables keep the defaults", () => {
    assert.deepEqual(filingSimilarityThresholds(read({})), { margin: 0.05, min: 0.7 });
  });

  test("plain decimals in 0-1 apply, the boundaries included", () => {
    assert.deepEqual(filingSimilarityThresholds(read({ FILING_SIMILARITY_MARGIN: "0.02", FILING_SIMILARITY_MIN: "0.65" })), { margin: 0.02, min: 0.65 });
    assert.deepEqual(filingSimilarityThresholds(read({ FILING_SIMILARITY_MARGIN: "1", FILING_SIMILARITY_MIN: "0" })), { margin: 1, min: 0 });
  });

  test("an invalid value falls back to that field's default, independently of the other", () => {
    const invalid = ["", "  ", "abc", "-0.1", "1.5", "1e-1", "0.5 ", "1.", ".5"];
    for (const min of invalid) {
      assert.deepEqual(filingSimilarityThresholds(read({ FILING_SIMILARITY_MIN: min })), { margin: 0.05, min: 0.7 }, `min ${JSON.stringify(min)}`);
    }
    for (const margin of invalid) {
      assert.deepEqual(filingSimilarityThresholds(read({ FILING_SIMILARITY_MARGIN: margin })), { margin: 0.05, min: 0.7 }, `margin ${JSON.stringify(margin)}`);
    }
    assert.deepEqual(filingSimilarityThresholds(read({ FILING_SIMILARITY_MARGIN: "abc", FILING_SIMILARITY_MIN: "0.65" })), { margin: 0.05, min: 0.65 });
  });
});
