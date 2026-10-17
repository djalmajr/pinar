import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, test } from "node:test";
import type { AssistantEndpoint } from "../models";
import {
  RETRIEVAL_DETECT_FAILURE_TTL_MS,
  RETRIEVAL_DETECT_TIMEOUT_MS,
  RETRIEVAL_DETECT_TTL_MS,
  detectGatewayRetrievalCapabilities,
  detectRetrievalCapabilities,
  resetRetrievalCapabilitiesCacheForTests,
} from "./detect";
import { GATEWAY_OPENAI_BASE_URL } from "./gateway";

const ENDPOINT: AssistantEndpoint = {
  apiKey: "test-key",
  baseUrl: "http://127.0.0.1:9/v1",
  kind: "openai-compatible",
  model: "chat-a",
  thinkingControl: false,
};

const NONE = { decisions: false, embeddingModel: null, vision: false };

type Reply = Response | Error | (() => Response | Promise<Response>);

// A fake fetch that answers each call with the next reply (the last one
// repeats) and records the calls.
function fakeFetch(...replies: Reply[]) {
  const calls: Array<{ init: RequestInit | undefined; url: string }> = [];
  const fetchFn = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ init, url: String(input) });
    const reply = replies[Math.min(calls.length - 1, replies.length - 1)]!;
    if (reply instanceof Error) throw reply;
    return typeof reply === "function" ? reply() : reply.clone();
  }) as typeof fetch;
  return { calls, fetch: fetchFn };
}

function models(data: unknown[]): Response {
  return Response.json({ data, object: "list" });
}

const APPLIANCE = [
  { id: "chat-b", modalities: { input: ["text", "image"] }, type: "chat" },
  { id: "chat-a", modalities: { input: ["text", "image"], output: ["text"] }, type: "chat" },
  { id: "embeddinggemma-300m", type: "embedding" },
  { id: "other-embedding", type: "embedding" },
];

// Date.now under the test's control; restored in afterEach.
const realNow = Date.now;
let clock = 0;

describe("detectRetrievalCapabilities", () => {
  beforeEach(() => {
    resetRetrievalCapabilitiesCacheForTests();
    clock = Date.UTC(2026, 9, 17);
    Date.now = () => clock;
  });

  afterEach(() => {
    Date.now = realNow;
    resetRetrievalCapabilitiesCacheForTests();
  });

  test("reads GET <baseUrl>/models with the key, no redirects and a 5 s deadline", async () => {
    const { calls, fetch } = fakeFetch(models(APPLIANCE));
    const realTimeout = AbortSignal.timeout;
    const deadlines: number[] = [];
    AbortSignal.timeout = ((ms: number) => {
      deadlines.push(ms);
      return realTimeout.call(AbortSignal, ms);
    }) as typeof AbortSignal.timeout;
    try {
      await detectRetrievalCapabilities({ endpoint: { ...ENDPOINT, baseUrl: "http://127.0.0.1:9/v1/" }, fetch });
    } finally {
      AbortSignal.timeout = realTimeout;
    }
    assert.equal(calls.length, 1);
    assert.equal(calls[0]!.url, "http://127.0.0.1:9/v1/models");
    assert.equal(new Headers(calls[0]!.init?.headers).get("Authorization"), "Bearer test-key");
    assert.equal(calls[0]!.init?.redirect, "manual");
    assert.ok(calls[0]!.init?.signal instanceof AbortSignal);
    assert.deepEqual(deadlines, [RETRIEVAL_DETECT_TIMEOUT_MS]);
    assert.equal(RETRIEVAL_DETECT_TIMEOUT_MS, 5_000);

    const keyless = fakeFetch(models(APPLIANCE));
    await detectRetrievalCapabilities({ endpoint: { ...ENDPOINT, apiKey: undefined, model: "keyless" }, fetch: keyless.fetch });
    assert.equal(new Headers(keyless.calls[0]!.init?.headers).has("Authorization"), false);
  });

  test("embeddingModel is the first data[].id with type embedding", async () => {
    const { fetch } = fakeFetch(models(APPLIANCE));
    assert.deepEqual(await detectRetrievalCapabilities({ endpoint: ENDPOINT, fetch }), { decisions: false, embeddingModel: "embeddinggemma-300m", vision: true });

    resetRetrievalCapabilitiesCacheForTests();
    const noEmbedding = fakeFetch(models([{ id: "chat-a", modalities: { input: ["text"] } }, { id: "embed-ish", type: "chat" }]));
    assert.deepEqual(await detectRetrievalCapabilities({ endpoint: ENDPOINT, fetch: noEmbedding.fetch }), NONE);

    resetRetrievalCapabilitiesCacheForTests();
    const odd = fakeFetch(models([null, { type: "embedding" }, { id: 7, type: "embedding" }, { id: "", type: "embedding" }, { id: "late-embedding", type: "embedding" }]));
    assert.deepEqual(await detectRetrievalCapabilities({ endpoint: ENDPOINT, fetch: odd.fetch }), { decisions: false, embeddingModel: "late-embedding", vision: false });
  });

  test("vision follows the modalities of the endpoint's own model, not another one", async () => {
    const otherHasImage = fakeFetch(models([
      { id: "chat-b", modalities: { input: ["text", "image"] } },
      { id: "chat-a", modalities: { input: ["text"] } },
    ]));
    assert.deepEqual(await detectRetrievalCapabilities({ endpoint: ENDPOINT, fetch: otherHasImage.fetch }), NONE);

    resetRetrievalCapabilitiesCacheForTests();
    const ownHasImage = fakeFetch(models([
      { id: "chat-b", modalities: { input: ["text"] } },
      { id: "chat-a", modalities: { input: ["image", "text"] } },
    ]));
    assert.deepEqual(await detectRetrievalCapabilities({ endpoint: ENDPOINT, fetch: ownHasImage.fetch }), { decisions: false, embeddingModel: null, vision: true });

    resetRetrievalCapabilitiesCacheForTests();
    const malformed = fakeFetch(models([
      { id: "chat-a", modalities: { input: "image" } },
      { id: "chat-a", modalities: { input: ["image"] } }, // only the first entry of the model counts
    ]));
    assert.deepEqual(await detectRetrievalCapabilities({ endpoint: ENDPOINT, fetch: malformed.fetch }), NONE);

    resetRetrievalCapabilitiesCacheForTests();
    const missing = fakeFetch(models([{ id: "chat-a" }]));
    assert.deepEqual(await detectRetrievalCapabilities({ endpoint: ENDPOINT, fetch: missing.fetch }), NONE);
  });

  test("decisions follows the available flag of the decisions extra of the endpoint's own model", async () => {
    // The appliance's /models item, as the canary lists it.
    const extra = { available: true, endpoint: "/v1/decisions", experimental: true, scope: "decisions" };
    const own = fakeFetch(models([
      { decisions: extra, id: "chat-a", modalities: { input: ["text", "image"] }, type: "chat" },
      { id: "embeddinggemma-300m", type: "embedding" },
    ]));
    assert.deepEqual(
      await detectRetrievalCapabilities({ endpoint: ENDPOINT, fetch: own.fetch }),
      { decisions: true, embeddingModel: "embeddinggemma-300m", vision: true },
    );

    const cases: Array<{ item: Record<string, unknown>; name: string }> = [
      { item: { decisions: { ...extra, available: false }, id: "chat-a" }, name: "unavailable" },
      { item: { decisions: { ...extra, available: "true" }, id: "chat-a" }, name: "available not a boolean" },
      { item: { decisions: { ...extra, available: 1 }, id: "chat-a" }, name: "available a number" },
      { item: { decisions: true, id: "chat-a" }, name: "extra not an object" },
      { item: { decisions: [extra], id: "chat-a" }, name: "extra an array" },
      { item: { decisions: { endpoint: "/v1/decisions" }, id: "chat-a" }, name: "no available flag" },
      { item: { available: true, id: "chat-a" }, name: "flag outside the extra" },
      { item: { id: "chat-a" }, name: "no extra" },
    ];
    for (const { item, name } of cases) {
      resetRetrievalCapabilitiesCacheForTests();
      const { fetch } = fakeFetch(models([item]));
      assert.deepEqual(await detectRetrievalCapabilities({ endpoint: ENDPOINT, fetch }), NONE, name);
    }

    // Another model's extra does not count, and only the first item of the model does.
    resetRetrievalCapabilitiesCacheForTests();
    const other = fakeFetch(models([{ decisions: extra, id: "chat-b" }, { id: "chat-a" }]));
    assert.deepEqual(await detectRetrievalCapabilities({ endpoint: ENDPOINT, fetch: other.fetch }), NONE);
    resetRetrievalCapabilitiesCacheForTests();
    const later = fakeFetch(models([{ id: "chat-a" }, { decisions: extra, id: "chat-a" }]));
    assert.deepEqual(await detectRetrievalCapabilities({ endpoint: ENDPOINT, fetch: later.fetch }), NONE);
  });

  test("the decisions flag shares the detection cache", async () => {
    const extra = { available: true, endpoint: "/v1/decisions", experimental: true, scope: "decisions" };
    const { calls, fetch } = fakeFetch(models([{ decisions: extra, id: "chat-a" }]), models([{ id: "chat-a" }]));
    assert.equal((await detectRetrievalCapabilities({ endpoint: ENDPOINT, fetch })).decisions, true);
    clock += RETRIEVAL_DETECT_TTL_MS - 1;
    assert.equal((await detectRetrievalCapabilities({ endpoint: ENDPOINT, fetch })).decisions, true);
    assert.equal(calls.length, 1, "one probe for every capability");
    clock += 1;
    assert.equal((await detectRetrievalCapabilities({ endpoint: ENDPOINT, fetch })).decisions, false, "read again at 10 minutes");
    assert.equal(calls.length, 2);
  });

  test("network failure, 500, invalid JSON, a redirect and a body without data give nulls", async () => {
    const failures: Array<{ name: string; reply: Reply }> = [
      { name: "network", reply: new TypeError("connect ECONNREFUSED SECRET_HOST") },
      { name: "status 500", reply: new Response("boom", { status: 500 }) },
      { name: "invalid JSON", reply: new Response("{not json", { headers: { "content-type": "application/json" } }) },
      { name: "redirect", reply: new Response(null, { headers: { Location: "https://evil.example/models" }, status: 302 }) },
      { name: "no data array", reply: Response.json({ models: APPLIANCE }) },
      { name: "data not an array", reply: Response.json({ data: { id: "chat-a" } }) },
    ];
    for (const failure of failures) {
      resetRetrievalCapabilitiesCacheForTests();
      const { calls, fetch } = fakeFetch(failure.reply);
      assert.deepEqual(await detectRetrievalCapabilities({ endpoint: ENDPOINT, fetch }), NONE, failure.name);
      assert.equal(calls.length, 1, `${failure.name}: one request, the redirect is not followed`);
    }
  });

  test("an invalid base URL gives nulls without any request", async () => {
    for (const baseUrl of ["http://appliance.example/v1", "https://user:pass@appliance.example/v1", "https://appliance.example/v1?x=1", "not a url"]) {
      resetRetrievalCapabilitiesCacheForTests();
      const { calls, fetch } = fakeFetch(models(APPLIANCE));
      assert.deepEqual(await detectRetrievalCapabilities({ endpoint: { ...ENDPOINT, baseUrl }, fetch }), NONE, baseUrl);
      assert.equal(calls.length, 0, baseUrl);
    }
  });

  test("a deadline that fires aborts the probe and gives nulls", async () => {
    const realTimeout = AbortSignal.timeout;
    const controller = new AbortController();
    AbortSignal.timeout = (() => controller.signal) as typeof AbortSignal.timeout;
    try {
      // Never answers; rejects only when its signal aborts.
      const hanging = (async (_input: RequestInfo | URL, init?: RequestInit) => {
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new DOMException("timed out", "TimeoutError")));
        });
      }) as typeof globalThis.fetch;
      const pending = detectRetrievalCapabilities({ endpoint: ENDPOINT, fetch: hanging });
      controller.abort();
      assert.deepEqual(await pending, NONE);
    } finally {
      AbortSignal.timeout = realTimeout;
    }
  });

  test("a success is cached for 10 minutes per baseUrl and model", async () => {
    const { calls, fetch } = fakeFetch(models(APPLIANCE), models([{ id: "chat-a" }]));
    const first = await detectRetrievalCapabilities({ endpoint: ENDPOINT, fetch });
    assert.deepEqual(first, { decisions: false, embeddingModel: "embeddinggemma-300m", vision: true });
    clock += RETRIEVAL_DETECT_TTL_MS - 1;
    assert.deepEqual(await detectRetrievalCapabilities({ endpoint: ENDPOINT, fetch }), first);
    assert.equal(calls.length, 1, "cached just before 10 minutes");
    assert.equal(RETRIEVAL_DETECT_TTL_MS, 10 * 60 * 1000);

    // Another model or another base URL is another entry.
    await detectRetrievalCapabilities({ endpoint: { ...ENDPOINT, model: "chat-b" }, fetch });
    await detectRetrievalCapabilities({ endpoint: { ...ENDPOINT, baseUrl: "http://localhost:9/v1" }, fetch });
    assert.equal(calls.length, 3);

    clock += 1;
    assert.deepEqual(await detectRetrievalCapabilities({ endpoint: ENDPOINT, fetch }), NONE, "expired at 10 minutes: read again");
    assert.equal(calls.length, 4);

    // The cached value is a copy: changing a result does not change the cache.
    const copy = await detectRetrievalCapabilities({ endpoint: ENDPOINT, fetch });
    copy.vision = true;
    assert.deepEqual(await detectRetrievalCapabilities({ endpoint: ENDPOINT, fetch }), NONE);
  });

  test("a failure is cached only for 1 minute", async () => {
    const { calls, fetch } = fakeFetch(new Response("down", { status: 503 }), models(APPLIANCE));
    assert.deepEqual(await detectRetrievalCapabilities({ endpoint: ENDPOINT, fetch }), NONE);
    clock += RETRIEVAL_DETECT_FAILURE_TTL_MS - 1;
    assert.deepEqual(await detectRetrievalCapabilities({ endpoint: ENDPOINT, fetch }), NONE);
    assert.equal(calls.length, 1, "the failure is cached just before 1 minute");
    assert.equal(RETRIEVAL_DETECT_FAILURE_TTL_MS, 60 * 1000);

    clock += 1;
    assert.deepEqual(
      await detectRetrievalCapabilities({ endpoint: ENDPOINT, fetch }),
      { decisions: false, embeddingModel: "embeddinggemma-300m", vision: true },
      "probed again after 1 minute, not 10",
    );
    assert.equal(calls.length, 2);
  });
});

// The gateway catalog's shape (GET /v1/models of 2026-10-17): language and
// embedding models with type, tags and pricing; hundreds of them.
const CATALOG = [
  { id: "openai/text-embedding-3-large", pricing: { input: "0.00000013" }, tags: null, type: "embedding" },
  { id: "anthropic/claude-haiku-5.5", pricing: { input: "0.0000001", output: "0.0000005" }, tags: ["tool-use", "vision", "structured-output"], type: "language" },
  { id: "zai/glm-5.3-flash", pricing: { input: "0.00000015", output: "0.0000005" }, tags: ["reasoning", "tool-use"], type: "language" },
  { id: "openai/text-embedding-3-small", pricing: { input: "0.00000002", output: null }, tags: null, type: "embedding" },
  { decisions: { available: true }, id: "mistral/mistral-embed", pricing: {}, tags: ["vision"], type: "embedding" },
];

describe("detectGatewayRetrievalCapabilities", () => {
  beforeEach(() => {
    resetRetrievalCapabilitiesCacheForTests();
    clock = Date.UTC(2026, 9, 17);
    Date.now = () => clock;
  });

  afterEach(() => {
    Date.now = realNow;
    resetRetrievalCapabilitiesCacheForTests();
  });

  const detect = (fetchFn: typeof fetch, chatModel: string, embeddingModel: string | null) =>
    detectGatewayRetrievalCapabilities({ baseUrl: GATEWAY_OPENAI_BASE_URL, chatModel, embeddingModel, fetch: fetchFn });

  test("reads the public catalog without the key, no redirects and a 5 s deadline", async () => {
    const { calls, fetch } = fakeFetch(models(CATALOG));
    await detect(fetch, "anthropic/claude-haiku-5.5", "openai/text-embedding-3-small");
    assert.equal(calls.length, 1);
    assert.equal(calls[0]!.url, "https://ai-gateway.vercel.sh/v1/models");
    assert.equal(new Headers(calls[0]!.init?.headers).get("authorization"), null);
    assert.equal(calls[0]!.init?.redirect, "manual");
    assert.ok(calls[0]!.init?.signal instanceof AbortSignal);
    assert.equal(RETRIEVAL_DETECT_TIMEOUT_MS, 5_000);
  });

  test("only the configured ids: vision from the chat model's tags, the embedding model with its pricing.input", async () => {
    const { fetch } = fakeFetch(models(CATALOG));
    assert.deepEqual(await detect(fetch, "anthropic/claude-haiku-5.5", "openai/text-embedding-3-small"), {
      decisions: false,
      embeddingInputPrice: "0.00000002",
      embeddingModel: "openai/text-embedding-3-small",
      vision: true,
    });
    // Without AI_EMBEDDING_MODEL no model is picked, although the catalog
    // lists embedding models; a chat model without the vision tag has none.
    assert.deepEqual(await detect(fetch, "zai/glm-5.3-flash", null), {
      decisions: false,
      embeddingInputPrice: null,
      embeddingModel: null,
      vision: false,
    });
  });

  test("an embedding id the catalog does not list as embedding, or does not list, is no embedding model", async () => {
    const { fetch } = fakeFetch(models(CATALOG));
    for (const embeddingModel of ["anthropic/claude-haiku-5.5", "openai/text-embedding-4", ""]) {
      const found = await detect(fetch, "zai/glm-5.3-flash", embeddingModel);
      assert.equal(found.embeddingModel, null, embeddingModel);
      assert.equal(found.embeddingInputPrice, null, embeddingModel);
    }
  });

  test("a model without pricing.input keeps the embedding with a null price; decisions are never read", async () => {
    const { fetch } = fakeFetch(models(CATALOG));
    assert.deepEqual(await detect(fetch, "mistral/mistral-embed", "mistral/mistral-embed"), {
      decisions: false,
      embeddingInputPrice: null,
      embeddingModel: "mistral/mistral-embed",
      vision: true,
    });
  });

  test("failures give nulls and are cached for 1 minute; a success for 10, per chat and embedding model", async () => {
    const { calls, fetch } = fakeFetch(new Response("down", { status: 503 }), models(CATALOG));
    assert.deepEqual(await detect(fetch, "anthropic/claude-haiku-5.5", "openai/text-embedding-3-small"), NONE);
    clock += RETRIEVAL_DETECT_FAILURE_TTL_MS - 1;
    assert.deepEqual(await detect(fetch, "anthropic/claude-haiku-5.5", "openai/text-embedding-3-small"), NONE);
    assert.equal(calls.length, 1);
    clock += 1;
    assert.equal((await detect(fetch, "anthropic/claude-haiku-5.5", "openai/text-embedding-3-small")).vision, true);
    assert.equal(calls.length, 2);
    clock += RETRIEVAL_DETECT_TTL_MS - 1;
    assert.equal((await detect(fetch, "anthropic/claude-haiku-5.5", "openai/text-embedding-3-small")).vision, true);
    assert.equal(calls.length, 2, "cached just before 10 minutes");
    await detect(fetch, "anthropic/claude-haiku-5.5", null);
    await detect(fetch, "zai/glm-5.3-flash", "openai/text-embedding-3-small");
    assert.equal(calls.length, 4, "another chat or embedding model is another entry");
  });

  test("shares the cache with the appliance detection without mixing their entries", async () => {
    const { calls, fetch } = fakeFetch(models(CATALOG));
    const endpoint: AssistantEndpoint = { ...ENDPOINT, baseUrl: GATEWAY_OPENAI_BASE_URL, model: "anthropic/claude-haiku-5.5" };
    // The appliance reading of the same list picks the first embedding.
    assert.deepEqual(await detectRetrievalCapabilities({ endpoint, fetch }), { decisions: false, embeddingModel: "openai/text-embedding-3-large", vision: false });
    assert.equal((await detect(fetch, "anthropic/claude-haiku-5.5", null)).vision, true);
    assert.equal(calls.length, 2);
    resetRetrievalCapabilitiesCacheForTests();
    await detect(fetch, "anthropic/claude-haiku-5.5", null);
    assert.equal(calls.length, 3, "the reset hook drops the gateway entries too");
  });
});
