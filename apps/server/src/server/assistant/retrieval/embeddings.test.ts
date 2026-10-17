import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  cosine,
  decodeVector,
  EMBEDDING_TIMEOUT_MS,
  embedTexts,
  encodeVector,
  PIN_EMBEDDING_DIMENSIONS,
  type EmbeddingEndpoint,
} from "./embeddings";

const endpoint: EmbeddingEndpoint = {
  apiKey: "embed-key",
  baseUrl: "https://appliance.example/v1/",
  model: "embeddinggemma-300m",
};

type Call = { body: { dimensions: number; input: string[]; model: string; prompt_name: string }; init: RequestInit; url: string };

// Vector whose first component encodes the text's position so order is
// checkable: text "t17" → [17, 0, 0, ...].
function vectorFor(text: string, dimensions = PIN_EMBEDDING_DIMENSIONS): number[] {
  const vector = new Array(dimensions).fill(0);
  vector[0] = Number(text.replace(/\D/g, "")) || 0;
  return vector;
}

function embeddingsResponse(texts: string[], dimensions = PIN_EMBEDDING_DIMENSIONS): Response {
  return Response.json({ data: texts.map((text, index) => ({ embedding: vectorFor(text, dimensions), index, object: "embedding" })), model: "m", object: "list" });
}

// Fake fetch that records calls and the peak number of requests in flight;
// each request waits a tick so the batches overlap.
function fakeFetch(respond: (call: Call) => Response | Promise<Response> = (call) => embeddingsResponse(call.body.input)) {
  const calls: Call[] = [];
  let inFlight = 0;
  let peak = 0;
  const fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const call: Call = { body: JSON.parse(String(init?.body)), init: init ?? {}, url: String(input) };
    calls.push(call);
    inFlight += 1;
    peak = Math.max(peak, inFlight);
    try {
      await new Promise((resolve) => setTimeout(resolve, 5));
      return await respond(call);
    } finally {
      inFlight -= 1;
    }
  }) as typeof fetch;
  return { calls, fetch, peak: () => peak };
}

const texts = (count: number) => Array.from({ length: count }, (_, index) => `t${index}`);

describe("embedTexts", () => {
  test("sends exactly the contract body, the key only in Authorization", async () => {
    const fake = fakeFetch();
    const vectors = await embedTexts({ endpoint, fetch: fake.fetch, kind: "document", texts: ["t1", "t2"] });
    assert.equal(fake.calls.length, 1);
    const call = fake.calls[0]!;
    assert.equal(call.url, "https://appliance.example/v1/embeddings");
    assert.equal(call.init.method, "POST");
    assert.equal(call.init.redirect, "manual");
    assert.ok(call.init.signal instanceof AbortSignal);
    assert.deepEqual(Object.keys(call.body).sort(), ["dimensions", "input", "model", "prompt_name"]);
    assert.deepEqual(call.body, { dimensions: 256, input: ["t1", "t2"], model: "embeddinggemma-300m", prompt_name: "document" });
    const headers = new Headers(call.init.headers);
    assert.equal(headers.get("authorization"), "Bearer embed-key");
    assert.equal(headers.get("content-type"), "application/json");
    assert.ok(!call.url.includes("embed-key"));
    assert.ok(!String(call.init.body).includes("embed-key"));
    assert.equal(vectors.length, 2);
    assert.equal(vectors[0]!.length, 256);
    assert.equal(vectors[1]![0], 2);
  });

  test("query kind sends prompt_name query; no key, no Authorization", async () => {
    const fake = fakeFetch();
    await embedTexts({ endpoint: { baseUrl: "http://127.0.0.1:8080/v1", model: "m" }, fetch: fake.fetch, kind: "query", texts: ["q"] });
    assert.equal(fake.calls[0]!.body.prompt_name, "query");
    assert.equal(new Headers(fake.calls[0]!.init.headers).get("authorization"), null);
  });

  test("no texts, no request", async () => {
    const fake = fakeFetch();
    assert.deepEqual(await embedTexts({ endpoint, fetch: fake.fetch, kind: "document", texts: [] }), []);
    assert.equal(fake.calls.length, 0);
  });

  test("batches of 32 with at most 3 requests in flight, results in order", async () => {
    const fake = fakeFetch();
    const input = texts(200); // 7 batches: 6 × 32 + 8
    const vectors = await embedTexts({ endpoint, fetch: fake.fetch, kind: "document", texts: input });
    assert.deepEqual(
      fake.calls.map((call) => call.body.input.length),
      [32, 32, 32, 32, 32, 32, 8],
    );
    assert.deepEqual(fake.calls.flatMap((call) => call.body.input).sort(), [...input].sort());
    assert.equal(fake.peak(), 3);
    assert.deepEqual(
      vectors.map((vector) => vector[0]),
      input.map((_, index) => index),
    );
  });

  test("places vectors by index when the endpoint reorders them", async () => {
    const fake = fakeFetch((call) =>
      Response.json({ data: call.body.input.map((text, index) => ({ embedding: vectorFor(text), index })).reverse() }),
    );
    const vectors = await embedTexts({ endpoint, fetch: fake.fetch, kind: "document", texts: ["t5", "t6", "t7"] });
    assert.deepEqual(
      vectors.map((vector) => vector[0]),
      [5, 6, 7],
    );
  });

  test("rejects a wrong dimension", async () => {
    const fake = fakeFetch((call) => embeddingsResponse(call.body.input, 255));
    await assert.rejects(embedTexts({ endpoint, fetch: fake.fetch, kind: "document", texts: ["t1"] }), /embedding response invalid/);
  });

  test("rejects a wrong count, a duplicated index and a non-numeric value", async () => {
    const fewer = fakeFetch((call) => embeddingsResponse(call.body.input.slice(1)));
    await assert.rejects(embedTexts({ endpoint, fetch: fewer.fetch, kind: "document", texts: ["t1", "t2"] }), /embedding response invalid/);
    const duplicated = fakeFetch(() => Response.json({ data: [{ embedding: vectorFor("t1"), index: 0 }, { embedding: vectorFor("t2"), index: 0 }] }));
    await assert.rejects(embedTexts({ endpoint, fetch: duplicated.fetch, kind: "document", texts: ["t1", "t2"] }), /embedding response invalid/);
    const nonNumeric = fakeFetch(() => Response.json({ data: [{ embedding: [...vectorFor("t1").slice(1), "x"], index: 0 }] }));
    await assert.rejects(embedTexts({ endpoint, fetch: nonNumeric.fetch, kind: "document", texts: ["t1"] }), /embedding response invalid/);
  });

  test("rejects a batch where only some items carry an index", async () => {
    const mixed = fakeFetch(() => Response.json({ data: [{ embedding: vectorFor("t2"), index: 1 }, { embedding: vectorFor("t1") }] }));
    await assert.rejects(embedTexts({ endpoint, fetch: mixed.fetch, kind: "document", texts: ["t1", "t2"] }), /embedding response invalid/);
    const positional = fakeFetch(() => Response.json({ data: [{ embedding: vectorFor("t1") }, { embedding: vectorFor("t2") }] }));
    const vectors = await embedTexts({ endpoint, fetch: positional.fetch, kind: "document", texts: ["t1", "t2"] });
    assert.deepEqual(vectors, [vectorFor("t1"), vectorFor("t2")]);
  });

  test("one bad batch rejects the whole call and stops new batches", async () => {
    const fake = fakeFetch((call) => (call.body.input[0] === "t0" ? new Response("boom", { status: 500 }) : embeddingsResponse(call.body.input)));
    await assert.rejects(embedTexts({ endpoint, fetch: fake.fetch, kind: "document", texts: texts(200) }), /embedding request failed \(status 500\)/);
    assert.ok(fake.calls.length <= 3, `started ${fake.calls.length} batches`);
  });

  test("refuses a redirect without following it or leaking the target", async () => {
    const fake = fakeFetch(() => new Response(null, { headers: { location: "https://evil.example/steal" }, status: 307 }));
    const error = await embedTexts({ endpoint, fetch: fake.fetch, kind: "document", texts: ["t1"] }).catch((caught: Error) => caught);
    assert.ok(error instanceof Error);
    assert.equal(error.message, "assistant endpoint redirect refused");
    assert.equal(fake.calls.length, 1);
  });

  test("refuses invalid base URLs before any request", async () => {
    const fake = fakeFetch();
    for (const baseUrl of [
      "http://appliance.example/v1",
      "https://user:pass@appliance.example/v1",
      "https://appliance.example/v1?x=1",
      "https://appliance.example/v1#frag",
      "ftp://appliance.example/v1",
      "not a url",
    ]) {
      await assert.rejects(embedTexts({ endpoint: { ...endpoint, baseUrl }, fetch: fake.fetch, kind: "document", texts: ["t1"] }), /invalid assistant endpoint/);
    }
    assert.equal(fake.calls.length, 0);
  });

  test("times out a stalled request; the default deadline is 15 s", async () => {
    assert.equal(EMBEDDING_TIMEOUT_MS, 15_000);
    const stalled = (async (_input: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(init.signal!.reason));
      })) as typeof fetch;
    const started = Date.now();
    await assert.rejects(embedTexts({ endpoint, fetch: stalled, kind: "document", texts: ["t1"], timeoutMs: 30 }), /embedding request timed out/);
    assert.ok(Date.now() - started < 2_000);
  });

  test("errors never carry the key, the URL or the texts", async () => {
    const fake = fakeFetch(() => new Response("secret text t1 embed-key", { status: 400 }));
    const error = await embedTexts({ endpoint, fetch: fake.fetch, kind: "document", texts: ["secret text"] }).catch((caught: Error) => caught);
    assert.ok(error instanceof Error);
    for (const leak of ["embed-key", "appliance.example", "secret text"]) assert.ok(!error.message.includes(leak), leak);
  });
});

describe("vector encoding", () => {
  test("encodeVector/decodeVector round-trip as Float32 little-endian", () => {
    const vector = [0.5, -1.25, 3, 0, 1e-3];
    const bytes = encodeVector(vector);
    assert.equal(bytes.byteLength, 20);
    assert.deepEqual([...bytes.slice(0, 4)], [0x00, 0x00, 0x00, 0x3f]); // 0.5f LE
    const decoded = decodeVector(bytes);
    assert.deepEqual([...decoded], [...Float32Array.from(vector)]);
  });

  test("decodeVector reads a view at an offset and rejects a partial float", () => {
    const encoded = encodeVector([1, 2]);
    const padded = new Uint8Array(encoded.byteLength + 3);
    padded.set(encoded, 3);
    assert.deepEqual([...decodeVector(padded.subarray(3))], [1, 2]);
    assert.throws(() => decodeVector(new Uint8Array(5)), /invalid vector bytes/);
  });
});

describe("cosine", () => {
  test("is 1 for the same direction, -1 for opposite, 0 for orthogonal", () => {
    assert.equal(cosine([1, 2, 3], [2, 4, 6]), 1);
    assert.ok(Math.abs(cosine([1, 0], [-1, 0]) + 1) < 1e-12);
    assert.equal(cosine([1, 0], [0, 1]), 0);
    assert.ok(Math.abs(cosine([1, 1], [1, 0]) - Math.SQRT1_2) < 1e-12);
  });

  test("works across number[] and Float32Array; 0 for mismatched or zero vectors", () => {
    assert.ok(Math.abs(cosine([0.5, 0.5], Float32Array.from([1, 1])) - 1) < 1e-6);
    assert.equal(cosine([1, 2], [1, 2, 3]), 0);
    assert.equal(cosine([0, 0], [1, 1]), 0);
    assert.equal(cosine([], []), 0);
  });
});
