import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { PIN_EMBEDDING_DIMENSIONS, type EmbeddingEndpoint } from "../assistant/retrieval/embeddings";
import { chooseCollection, type FilingCandidate, type FilingChoice } from "./choose";
import { collectionCentroid, rankBySimilarity } from "./similarity";

const embedding: EmbeddingEndpoint = { apiKey: "embed-key", baseUrl: "https://appliance.example/v1", model: "embeddinggemma-300m" };
const text = "Page: Cart\nURL: https://shop.example/cart\nPin #1: Button overlaps the total";

// A vector of PIN_EMBEDDING_DIMENSIONS with the given leading components.
// Against the query [1, 0, ...] the cosine is first / norm, so integer
// components with an integer norm give exact values: [4, 3] → 0.8.
function vec(...components: number[]): number[] {
  return [...components, ...new Array<number>(PIN_EMBEDDING_DIMENSIONS - components.length).fill(0)];
}
const QUERY = vec(1);
const COSINE = {
  "-1": vec(-1),
  "0.54": vec(27, 42, 2, 1, 1, 1),
  "0.55": vec(11, 15, 7, 2, 1),
  "0.6": vec(3, 4),
  "0.76": vec(19, 16, 2, 2),
  "0.8": vec(4, 3),
};

type Call = { body: Record<string, unknown>; init: RequestInit; url: string };

function fakeFetch(respond: (call: Call) => Response | Promise<Response> = () => Response.json({ data: [{ embedding: QUERY, index: 0 }] })) {
  const calls: Call[] = [];
  const fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const call: Call = { body: JSON.parse(String(init?.body)), init: init ?? {}, url: String(input) };
    calls.push(call);
    return respond(call);
  }) as typeof fetch;
  return { calls, fetch };
}

function candidate(collectionId: string): FilingCandidate {
  return { collectionId, examples: [], label: `Pinar / ${collectionId}`, lastUsedAt: null };
}

// Centroids by collection id; a missing id has no centroid.
function centroids(byId: Record<string, number[]>) {
  const asked: string[] = [];
  return {
    asked,
    centroid: async (collectionId: string) => {
      asked.push(collectionId);
      return byId[collectionId] ?? null;
    },
  };
}

async function choose(byId: Record<string, number[]>, ids = Object.keys(byId), fetch = fakeFetch().fetch): Promise<FilingChoice> {
  const { centroid } = centroids(byId);
  return chooseCollection({ candidates: ids.map(candidate), engine: { centroid, embedding, kind: "similarity" }, fetch, text });
}

const failure = (reason: "error" | "timeout"): FilingChoice => ({ collectionId: null, confidence: 0, engine: "similarity", reason });

describe("collectionCentroid", () => {
  test("is the mean scaled to unit length, null without vectors or direction", () => {
    assert.equal(collectionCentroid([]), null);
    assert.deepEqual(collectionCentroid([[3, 4], [3, 4]]), [0.6, 0.8]);
    assert.deepEqual(collectionCentroid([[1, 0], [0, 1]]), [1 / Math.SQRT2, 1 / Math.SQRT2]);
    // The mean of the raw vectors, not of their unit versions: [2, 0] weighs twice [0, 1].
    assert.deepEqual(collectionCentroid([[2, 0], [0, 1]]), [2 / Math.sqrt(5), 1 / Math.sqrt(5)]);
    assert.equal(collectionCentroid([[1, 0], [-1, 0]]), null);
  });

  test("refuses vectors of different dimensions or with non-finite values", () => {
    assert.throws(() => collectionCentroid([[1, 0], [1, 0, 0]]), /invalid vector/);
    assert.throws(() => collectionCentroid([[1, Number.NaN]]), /invalid vector/);
    assert.throws(() => collectionCentroid([[Number.POSITIVE_INFINITY, 0]]), /invalid vector/);
  });
});

describe("rankBySimilarity", () => {
  test("embeds the capture as a query and ranks the collections with a centroid by cosine", async () => {
    const fake = fakeFetch();
    const lookup = centroids({ a: COSINE["0.6"], b: COSINE["0.8"], d: COSINE["-1"] });
    const ranked = await rankBySimilarity({
      candidates: ["a", "b", "c", "d"].map(candidate),
      centroid: lookup.centroid,
      embedding,
      fetch: fake.fetch,
      text,
    });
    assert.deepEqual(
      ranked.map(({ candidate, score }) => [candidate.collectionId, score]),
      [
        ["b", 0.8],
        ["a", 0.6],
        ["d", -1],
      ],
    );
    assert.deepEqual(lookup.asked, ["a", "b", "c", "d"]);

    assert.equal(fake.calls.length, 1);
    assert.equal(fake.calls[0]!.url, "https://appliance.example/v1/embeddings");
    assert.deepEqual(fake.calls[0]!.body, { dimensions: 256, input: [text], model: "embeddinggemma-300m", prompt_name: "query" });
    assert.equal((fake.calls[0]!.init.headers as Record<string, string>)["Authorization"], "Bearer embed-key");
  });
});

describe("chooseCollection with the similarity engine", () => {
  test("files the best collection above the minimum and the margin", async () => {
    assert.deepEqual(await choose({ a: COSINE["0.6"], b: COSINE["0.8"] }), {
      collectionId: "b",
      confidence: 0.8,
      engine: "similarity",
      reason: "chosen",
    });
  });

  test("files at a cosine of exactly 0.55 and sends to the Inbox below it", async () => {
    // Mutation captured: `>=` → `>` on FILING_SIMILARITY_MIN sends the 0.55 case to the Inbox.
    assert.deepEqual(await choose({ a: COSINE["0.55"] }), { collectionId: "a", confidence: 0.55, engine: "similarity", reason: "chosen" });
    assert.deepEqual(await choose({ a: COSINE["0.54"] }), {
      collectionId: null,
      confidence: 0.54,
      engine: "similarity",
      reason: "low_confidence",
    });
  });

  test("sends to the Inbox when the margin over the second is below 0.05", async () => {
    // Mutation captured: dropping the margin check files 0.8 over 0.76.
    assert.deepEqual(await choose({ a: COSINE["0.76"], b: COSINE["0.8"] }), {
      collectionId: null,
      confidence: 0.8,
      engine: "similarity",
      reason: "low_confidence",
    });
  });

  test("leaves collections without a centroid out, so a lone one has no rival", async () => {
    assert.deepEqual(await choose({ b: COSINE["0.8"] }, ["a", "b", "c"]), {
      collectionId: "b",
      confidence: 0.8,
      engine: "similarity",
      reason: "chosen",
    });
    assert.deepEqual(await choose({}, ["a", "b"]), { collectionId: null, confidence: 0, engine: "similarity", reason: "low_confidence" });
    assert.deepEqual(await choose({ a: COSINE["-1"] }), { collectionId: null, confidence: 0, engine: "similarity", reason: "low_confidence" });
  });

  test("answers error when the embedding fails or the centroids do not fit", async () => {
    assert.deepEqual(await choose({ a: COSINE["0.8"] }, ["a"], fakeFetch(() => new Response("down", { status: 500 })).fetch), failure("error"));
    assert.deepEqual(
      await choose({ a: COSINE["0.8"] }, ["a"], fakeFetch(() => Response.json({ data: [{ embedding: [1, 0], index: 0 }] })).fetch),
      failure("error"),
    );
    assert.deepEqual(await choose({ a: [4, 3] }), failure("error"));
    assert.deepEqual(await choose({ a: vec(Number.NaN) }), failure("error"));

    const throwing = chooseCollection({
      candidates: [candidate("a")],
      engine: { centroid: async () => Promise.reject(new Error("index unavailable")), embedding, kind: "similarity" },
      fetch: fakeFetch().fetch,
      text,
    });
    assert.deepEqual(await throwing, failure("error"));
  });

  test("answers timeout when a centroid lookup never ends", async () => {
    const choice = await chooseCollection({
      candidates: [candidate("a")],
      engine: { centroid: () => new Promise(() => {}), embedding, kind: "similarity" },
      fetch: fakeFetch().fetch,
      text,
      timeoutMs: 50,
    });
    assert.deepEqual(choice, failure("timeout"));
  });

  test("an aborted caller signal neither embeds nor looks up centroids", async () => {
    const fake = fakeFetch();
    const lookup = centroids({ a: COSINE["0.8"] });
    const controller = new AbortController();
    controller.abort();
    const engine = { centroid: lookup.centroid, embedding, kind: "similarity" } as const;
    assert.deepEqual(await chooseCollection({ candidates: [candidate("a")], engine, fetch: fake.fetch, signal: controller.signal, text }), failure("error"));
    await assert.rejects(
      rankBySimilarity({ candidates: [candidate("a")], centroid: lookup.centroid, embedding, fetch: fake.fetch, signal: controller.signal, text }),
    );
    assert.equal(fake.calls.length, 0);
    assert.deepEqual(lookup.asked, []);
  });
});
