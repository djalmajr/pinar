import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { AssistantEndpoint } from "../models";
import type { PinDocumentInput } from "./document";
import { decodeVector, PIN_EMBEDDING_DIMENSIONS, type EmbeddingEndpoint } from "./embeddings";
import {
  canonicalTime,
  embeddingIdentity,
  identityMatches,
  indexSession,
  indexStale,
  PIN_SEARCH_MAX_SESSIONS,
  searchPins,
  withAbortSignal,
  type PinIndexDeps,
  type PinIndexEntry,
  type PinIndexStore,
  type PinSource,
} from "./index";

const chat: AssistantEndpoint = { apiKey: "k", baseUrl: "https://appliance.example/v1", kind: "appliance", model: "qwen3.8-27b", thinkingControl: true };
const embedding: EmbeddingEndpoint = { apiKey: "k", baseUrl: "https://appliance.example/v1", model: "embeddinggemma-300m" };

// ---------- fakes ----------

type FakeSession = {
  comments: Map<string, Array<{ author: string; body: string }>>;
  id: string;
  page: { title: string; url: string };
  pinIds: string[];
  pins: PinDocumentInput["pin"][];
  shot: boolean;
  updatedAt: string;
};

// The source lists only `visible` sessions (newest first), but session()
// answers for every known id, like a lookup that does not re-check access:
// the isolation tests rely on search not trusting it.
function fakeSource(sessions: FakeSession[], visible = sessions.map((session) => session.id)) {
  const calls = { listSessions: [] as Array<{ limit: number; offset: number }>, session: [] as string[], shot: [] as string[] };
  const byId = new Map(sessions.map((session) => [session.id, session]));
  const source: PinSource & { onSession?: () => void } = {
    async comments(sessionId) {
      return new Map(byId.get(sessionId)?.comments ?? []);
    },
    async listSessions(input) {
      calls.listSessions.push(input);
      return visible
        .map((id) => byId.get(id)!)
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
        .slice(input.offset, input.offset + input.limit)
        .map((session) => ({ id: session.id, updatedAt: session.updatedAt }));
    },
    async session(id) {
      calls.session.push(id);
      source.onSession?.();
      const session = byId.get(id);
      if (!session) return null;
      return { id, page: { ...session.page }, pinIds: [...session.pinIds], pins: session.pins.map((pin) => ({ ...pin })) };
    },
    async shot(sessionId) {
      calls.shot.push(sessionId);
      return byId.get(sessionId)?.shot ? { bytes: new Uint8Array([1, 2, 3]), mimeType: "image/png" } : null;
    },
  };
  return { byId, calls, source };
}

// In-memory store. `leaky` makes entriesFor ignore its ids, standing for a
// store bug: search must still drop sessions outside listSessions.
function fakeStore(options: { leaky?: boolean } = {}) {
  const data = new Map<string, PinIndexEntry[]>();
  const calls = { entriesFor: [] as string[][], replaceSession: [] as Array<{ entries: PinIndexEntry[]; sessionId: string }> };
  const store: PinIndexStore = {
    async deleteSession(sessionId) {
      data.delete(sessionId);
    },
    async entries(sessionId) {
      return (data.get(sessionId) ?? []).map((entry) => ({ ...entry }));
    },
    async entriesFor(sessionIds) {
      calls.entriesFor.push([...sessionIds]);
      const ids = options.leaky ? [...data.keys()] : sessionIds;
      return ids.flatMap((id) => data.get(id) ?? []).map((entry) => ({ ...entry }));
    },
    async replaceSession(sessionId, entries) {
      calls.replaceSession.push({ entries, sessionId });
      data.set(sessionId, entries.map((entry) => ({ ...entry })));
    },
    async staleSessions(input) {
      const stale = input.sessions.filter((session) => {
        const entries = data.get(session.id);
        if (!entries || entries.length === 0) return true;
        return entries.some((entry) => entry.updatedAt < session.updatedAt);
      });
      return stale.slice(0, input.limit).map((session) => session.id);
    },
  };
  return { calls, data, store };
}

// Keyword vector: one dimension per keyword plus a bias, so cosine order is
// predictable.
const KEYWORDS = ["contrast", "checkout", "price", "typo"];
function keywordVector(text: string): number[] {
  const lower = text.toLowerCase();
  const vector = new Array(PIN_EMBEDDING_DIMENSIONS).fill(0);
  KEYWORDS.forEach((keyword, index) => {
    vector[index] = lower.split(keyword).length - 1;
  });
  vector[KEYWORDS.length] = 1;
  return vector;
}

// Routes /embeddings and /chat/completions. Vision answers "Caption #n" for
// every marker listed in the request, or nothing with `describe: false`.
function fakeFetch(options: { describe?: boolean } = {}) {
  const calls = { chat: [] as unknown[], embeddings: [] as Array<{ input: string[]; prompt_name: string }> };
  const fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const body = JSON.parse(String(init?.body));
    if (url.endsWith("/embeddings")) {
      calls.embeddings.push(body);
      return Response.json({ data: (body.input as string[]).map((text, index) => ({ embedding: keywordVector(text), index })) });
    }
    calls.chat.push(body);
    const markers = String(body.messages[1].content[0].text)
      .split("\n")
      .slice(1)
      .map((line) => Number(line.slice(1, line.indexOf(":"))));
    const pins = options.describe === false ? [] : markers.map((number) => ({ caption: `Caption #${number}`, number, ocr: `OCR ${number}` }));
    return Response.json({ choices: [{ message: { content: JSON.stringify({ pins }), role: "assistant" } }] });
  }) as typeof fetch;
  return { calls, fetch };
}

function session(id: string, updatedAt: string, pins: Array<{ comment: string; id: string; number: number }>, title = `Title ${id}`): FakeSession {
  return {
    comments: new Map(),
    id,
    page: { title, url: `https://site.example/${id}` },
    pinIds: pins.map((pin) => pin.id),
    pins: pins.map((pin) => ({ comment: pin.comment, number: pin.number, selector: `#${pin.id}`, tag: "div" })),
    shot: true,
    updatedAt,
  };
}

function deps(source: PinSource, store: PinIndexStore, fetch: typeof globalThis.fetch, overrides: Partial<PinIndexDeps> = {}): PinIndexDeps {
  return { chat, embedding, fetch, now: () => new Date("2026-10-17T12:00:00.000Z"), source, store, ...overrides };
}

function checkoutSession(): FakeSession {
  const s = session("s1", "2026-10-17T10:00:00.000Z", [
    { comment: "Contrast is too low", id: "p1", number: 1 },
    { comment: "Wrong price", id: "p2", number: 2 },
  ]);
  s.comments.set("p2", [{ author: "Ana", body: "Since yesterday" }]);
  return s;
}

// ---------- indexSession ----------

describe("indexSession", () => {
  test("one entry per pin, with caption and vector", async () => {
    const { source } = fakeSource([checkoutSession()]);
    const { data, store } = fakeStore();
    const fake = fakeFetch();
    const result = await indexSession(deps(source, store, fake.fetch), "s1");
    assert.deepEqual(result, { captioned: true, embedded: 2, pins: 2 });
    assert.equal(fake.calls.chat.length, 1);
    assert.equal(fake.calls.embeddings.length, 1);
    assert.equal(fake.calls.embeddings[0]!.prompt_name, "document");
    const entries = data.get("s1")!;
    assert.deepEqual(
      entries.map((entry) => [entry.pinId, entry.number, entry.caption, entry.ocr, entry.model, entry.sessionId, entry.updatedAt]),
      [
        ["p1", 1, "Caption #1", "OCR 1", embeddingIdentity(embedding), "s1", "2026-10-17T12:00:00.000Z"],
        ["p2", 2, "Caption #2", "OCR 2", embeddingIdentity(embedding), "s1", "2026-10-17T12:00:00.000Z"],
      ],
    );
    for (const entry of entries) {
      assert.equal(entry.vector!.byteLength, PIN_EMBEDDING_DIMENSIONS * 4);
      assert.deepEqual([...decodeVector(entry.vector!)], [...Float32Array.from(keywordVector(entry.docText))]);
      assert.match(entry.docHash, /^[0-9a-f]{64}$/);
      assert.equal(entry.truncated, false);
    }
    assert.ok(entries[0]!.docText.includes("Pin #1: Contrast is too low"));
    assert.ok(entries[0]!.docText.includes("Caption: Caption #1"));
    assert.ok(entries[1]!.docText.includes("- Ana: Since yesterday"));
    assert.deepEqual(fake.calls.embeddings[0]!.input, entries.map((entry) => entry.docText));
  });

  test("reindexing without changes calls neither vision nor embedding", async () => {
    const { calls, source } = fakeSource([checkoutSession()]);
    const { data, store } = fakeStore();
    const fake = fakeFetch();
    await indexSession(deps(source, store, fake.fetch), "s1");
    const before = data.get("s1")!;
    const result = await indexSession(deps(source, store, fake.fetch, { now: () => new Date("2026-10-17T13:00:00.000Z") }), "s1");
    assert.deepEqual(result, { captioned: false, embedded: 0, pins: 2 });
    assert.equal(fake.calls.chat.length, 1);
    assert.equal(fake.calls.embeddings.length, 1);
    assert.equal(calls.shot.length, 1, "the screenshot is not read again");
    const after = data.get("s1")!;
    assert.deepEqual(
      after.map((entry) => [entry.docHash, entry.caption, entry.ocr, [...entry.vector!]]),
      before.map((entry) => [entry.docHash, entry.caption, entry.ocr, [...entry.vector!]]),
    );
    assert.ok(after.every((entry) => entry.updatedAt === "2026-10-17T13:00:00.000Z"), "entries are refreshed so the session is no longer stale");
  });

  test("a changed endpoint (the same model) re-embeds: the vector identity includes the endpoint", async () => {
    const { source } = fakeSource([checkoutSession()]);
    const { data, store } = fakeStore();
    const fake = fakeFetch();
    const first: EmbeddingEndpoint = { apiKey: "k", baseUrl: "https://old.example/v1", model: "same-model" };
    const second: EmbeddingEndpoint = { apiKey: "k", baseUrl: "https://new.example/v1", model: "same-model" };
    assert.equal(embeddingIdentity(first), "same-model\u0000https://old.example/v1");
    assert.notEqual(embeddingIdentity(first), embeddingIdentity(second), "the endpoint is part of the identity");
    const urls: string[] = [];
    const routed = (async (input: RequestInfo | URL, init?: RequestInit) => {
      urls.push(String(input));
      return fake.fetch(input, init);
    }) as typeof fetch;

    await indexSession(deps(source, store, routed, { chat: null, embedding: first }), "s1");
    assert.equal(fake.calls.embeddings.length, 1);
    // The URL changes, the model name stays: the old vectors are in another
    // space, so the consumer re-embeds them against the new endpoint.
    const result = await indexSession(deps(source, store, routed, { chat: null, embedding: second }), "s1");
    assert.equal(result.embedded, 2, "every pin is re-embedded");
    assert.equal(fake.calls.embeddings.length, 2);
    assert.ok(urls[1]!.includes("new.example"), "the new call goes to the new endpoint");
    assert.ok(data.get("s1")!.every((entry) => entry.model === embeddingIdentity(second)), "the stored identity is the new one");
    // And a reindex on the same endpoint reuses the new vectors.
    const again = await indexSession(deps(source, store, routed, { chat: null, embedding: second }), "s1");
    assert.equal(again.embedded, 0);
    assert.equal(fake.calls.embeddings.length, 2);
  });

  test("entries written before the endpoint joined the identity: kept by the same model on any direct URL, kept by the gateway", async () => {
    const { source } = fakeSource([checkoutSession()]);
    const { data, store } = fakeStore();
    const fake = fakeFetch();
    const direct: EmbeddingEndpoint = { apiKey: "k", baseUrl: "https://old.example/v1", model: "same-model" };
    const gateway: EmbeddingEndpoint = {
      apiKey: "k",
      baseUrl: "https://ai-gateway.vercel.sh/v1",
      gateway: { inputPrice: null, zeroDataRetention: true },
      model: "same-model",
    };
    await indexSession(deps(source, store, fake.fetch, { chat: null, embedding: direct }), "s1");
    // Simulate the entries as written before this change: the plain model name.
    for (const entry of data.get("s1")!) entry.model = "same-model";
    // The old format is compatible: the same model on a direct endpoint keeps
    // the vectors (an upgrade must not strand them), and the entry is
    // rewritten with the endpoint's identity...
    const redone = await indexSession(deps(source, store, fake.fetch, { chat: null, embedding: direct }), "s1");
    assert.equal(redone.embedded, 0, "the legacy entry is reused by a direct endpoint of the same model");
    assert.ok(data.get("s1")!.every((entry) => entry.model === embeddingIdentity(direct)));
    // ...and the gateway, whose identity is the plain model name, keeps them as-is.
    for (const entry of data.get("s1")!) entry.model = "same-model";
    const kept = await indexSession(deps(source, store, fake.fetch, { chat: null, embedding: gateway }), "s1");
    assert.equal(kept.embedded, 0, "the gateway reuses the old vectors");
    assert.ok(data.get("s1")!.every((entry) => entry.model === "same-model"));
  });

  test("a URL change with the same model re-embeds only the new-format entries", async () => {
    const { source } = fakeSource([checkoutSession()]);
    const { data, store } = fakeStore();
    const fake = fakeFetch();
    const first: EmbeddingEndpoint = { apiKey: "k", baseUrl: "https://old.example/v1", model: "same-model" };
    const second: EmbeddingEndpoint = { apiKey: "k", baseUrl: "https://new.example/v1", model: "same-model" };
    await indexSession(deps(source, store, fake.fetch, { chat: null, embedding: first }), "s1");
    const legacyVector = data.get("s1")![0]!.vector!;
    // One entry is still in the old format (written before the change), the other in the new one.
    data.get("s1")![0]!.model = "same-model";
    const result = await indexSession(deps(source, store, fake.fetch, { chat: null, embedding: second }), "s1");
    assert.equal(result.embedded, 1, "only the new-format entry is in another vector space");
    assert.equal(fake.calls.embeddings.length, 2);
    // The legacy vector is kept, and every entry is rewritten with the endpoint's identity.
    assert.deepEqual(decodeVector(data.get("s1")![0]!.vector!), decodeVector(legacyVector));
    assert.ok(data.get("s1")!.every((entry) => entry.model === embeddingIdentity(second)));
  });

  test("a new conversation comment re-embeds only that pin, without vision", async () => {
    const { byId, source } = fakeSource([checkoutSession()]);
    const { data, store } = fakeStore();
    const fake = fakeFetch();
    await indexSession(deps(source, store, fake.fetch), "s1");
    const p1Before = data.get("s1")![0]!;
    byId.get("s1")!.comments.set("p2", [
      { author: "Ana", body: "Since yesterday" },
      { author: "Bruno", body: "Checkout total too" },
    ]);
    const result = await indexSession(deps(source, store, fake.fetch), "s1");
    assert.deepEqual(result, { captioned: false, embedded: 1, pins: 2 });
    assert.equal(fake.calls.chat.length, 1);
    assert.equal(fake.calls.embeddings.length, 2);
    assert.equal(fake.calls.embeddings[1]!.input.length, 1);
    assert.ok(fake.calls.embeddings[1]!.input[0]!.includes("- Bruno: Checkout total too"));
    const [p1, p2] = data.get("s1")!;
    assert.equal(p1!.docHash, p1Before.docHash);
    assert.deepEqual([...p1!.vector!], [...p1Before.vector!]);
    assert.equal(p2!.caption, "Caption #2", "the stored caption is reused");
    assert.equal(decodeVector(p2!.vector!)[1], 1, "the new vector counts the checkout keyword");
  });

  test("a changed pin comment re-captions the session and re-embeds only that pin", async () => {
    const { byId, source } = fakeSource([checkoutSession()]);
    const { data, store } = fakeStore();
    const fake = fakeFetch();
    await indexSession(deps(source, store, fake.fetch), "s1");
    byId.get("s1")!.pins[0]!.comment = "Contrast fixed, check typo";
    const result = await indexSession(deps(source, store, fake.fetch), "s1");
    assert.deepEqual(result, { captioned: true, embedded: 1, pins: 2 });
    assert.equal(fake.calls.chat.length, 2);
    assert.equal(fake.calls.embeddings[1]!.input.length, 1);
    assert.ok(fake.calls.embeddings[1]!.input[0]!.includes("Pin #1: Contrast fixed, check typo"));
    assert.ok(data.get("s1")![0]!.docText.includes("Pin #1: Contrast fixed, check typo"));
  });

  test("page text that repeats the new comment does not hide a comment change", async () => {
    const s = checkoutSession();
    s.page.title = "Checkout\nPin #1: Contrast fixed";
    const { byId, source } = fakeSource([s]);
    const { data, store } = fakeStore();
    const fake = fakeFetch();
    await indexSession(deps(source, store, fake.fetch), "s1");
    byId.get("s1")!.pins[0]!.comment = "Contrast fixed";
    const result = await indexSession(deps(source, store, fake.fetch), "s1");
    assert.equal(result.captioned, true);
    assert.equal(fake.calls.chat.length, 2, "the changed comment re-captions the session");
    assert.equal(data.get("s1")![0]!.docText.split("\n")[2], "Pin #1: Contrast fixed");
  });

  test("an entry written by another document format is rebuilt, not reused", async () => {
    // An older renderer kept line breaks, so a title could hold a forged
    // "Pin #1" line in the place the current comparison reads.
    const s = checkoutSession();
    const { byId, source } = fakeSource([s]);
    const { data, store } = fakeStore();
    const fake = fakeFetch();
    await indexSession(deps(source, store, fake.fetch), "s1");
    const old = data.get("s1")!;
    const forged = ["Page: Checkout", "extra", "Pin #1: Contrast fixed", "URL: x", "Pin #1: Contrast is too low"].join("\n");
    const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(forged)));
    old[0] = { ...old[0]!, docHash: Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join(""), docText: forged };
    byId.get("s1")!.pins[0]!.comment = "Contrast fixed";
    const result = await indexSession(deps(source, store, fake.fetch), "s1");
    assert.equal(fake.calls.chat.length, 2, "the old-format entry re-captions the session");
    assert.deepEqual(result, { captioned: true, embedded: 1, pins: 2 });
    assert.equal(data.get("s1")![0]!.docText.split("\n")[2], "Pin #1: Contrast fixed");
  });

  test("reads the store's edit mark before the session and hands it to the replacement", async () => {
    const { calls: sourceCalls, source } = fakeSource([checkoutSession()]);
    const { calls, store } = fakeStore();
    const order: string[] = [];
    const replaced: unknown[] = [];
    const marked: PinIndexStore = {
      ...store,
      async readMark(sessionId) {
        order.push(`readMark:${sessionId}:${sourceCalls.session.length}`);
        return "mark-1";
      },
      async replaceSession(sessionId, entries, options) {
        replaced.push(options);
        await store.replaceSession(sessionId, entries);
      },
    };
    await indexSession(deps(source, marked, fakeFetch().fetch), "s1");
    assert.deepEqual(order, ["readMark:s1:0"], "read before the session");
    assert.deepEqual(replaced, [{ readMark: "mark-1" }]);
    assert.equal(calls.replaceSession.length, 1);

    // A store without marks gets no options.
    const plain: unknown[] = [];
    await indexSession(deps(source, { ...store, async replaceSession(sessionId, entries, options) { plain.push(options); await store.replaceSession(sessionId, entries); } }, fakeFetch().fetch), "s1");
    assert.deepEqual(plain, [undefined]);
  });

  test("a removed pin disappears from the session's entries", async () => {
    const { byId, source } = fakeSource([checkoutSession()]);
    const { calls, data, store } = fakeStore();
    const fake = fakeFetch();
    await indexSession(deps(source, store, fake.fetch), "s1");
    const s1 = byId.get("s1")!;
    s1.pins.splice(1, 1);
    s1.pinIds.splice(1, 1);
    const result = await indexSession(deps(source, store, fake.fetch), "s1");
    assert.equal(result.pins, 1);
    assert.deepEqual(
      data.get("s1")!.map((entry) => entry.pinId),
      ["p1"],
    );
    assert.equal(calls.replaceSession.length, 2);
    assert.equal(calls.replaceSession[1]!.entries.length, 1);
    assert.equal(result.embedded, 0, "p1's document did not change");
  });

  test("without embedding: text-only entries, no embeddings call", async () => {
    const { source } = fakeSource([checkoutSession()]);
    const { data, store } = fakeStore();
    const fake = fakeFetch();
    const result = await indexSession(deps(source, store, fake.fetch, { embedding: null }), "s1");
    assert.deepEqual(result, { captioned: true, embedded: 0, pins: 2 });
    assert.equal(fake.calls.embeddings.length, 0);
    for (const entry of data.get("s1")!) {
      assert.equal(entry.vector, null);
      assert.equal(entry.model, "");
    }
  });

  test("without chat: no captions, no vision call", async () => {
    const { source } = fakeSource([checkoutSession()]);
    const { data, store } = fakeStore();
    const fake = fakeFetch();
    const result = await indexSession(deps(source, store, fake.fetch, { chat: null }), "s1");
    assert.equal(result.captioned, false);
    assert.equal(fake.calls.chat.length, 0);
    assert.ok(data.get("s1")!.every((entry) => entry.caption === null && entry.ocr === null && !entry.docText.includes("Caption:")));
  });

  test("without a screenshot: empty captions, no vision call, not pending afterwards", async () => {
    const noShot = checkoutSession();
    noShot.shot = false;
    const { calls, source } = fakeSource([noShot]);
    const { data, store } = fakeStore();
    const fake = fakeFetch();
    const d = deps(source, store, fake.fetch);
    const result = await indexSession(d, "s1");
    assert.equal(result.captioned, false);
    assert.equal(fake.calls.chat.length, 0);
    assert.ok(data.get("s1")!.every((entry) => entry.caption === "" && entry.ocr === "" && !entry.docText.includes("Caption:")));
    assert.deepEqual(await indexStale(d, { budgetMs: 60_000, maxSessions: 10 }), { indexed: 0, remaining: false });
    assert.deepEqual(calls.shot, ["s1"]);
  });

  test("a failed vision call indexes without captions and retries next time", async () => {
    const { source } = fakeSource([checkoutSession()]);
    const { data, store } = fakeStore();
    const fake = fakeFetch();
    let failVision = true;
    const flaky = (async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).endsWith("/chat/completions") && failVision) return new Response("down", { status: 503 });
      return fake.fetch(input, init);
    }) as typeof fetch;
    const first = await indexSession(deps(source, store, flaky), "s1");
    assert.deepEqual(first, { captioned: false, embedded: 2, pins: 2 });
    assert.ok(data.get("s1")!.every((entry) => entry.caption === null));
    failVision = false;
    const second = await indexSession(deps(source, store, flaky), "s1");
    assert.deepEqual(second, { captioned: true, embedded: 2, pins: 2 });
    assert.equal(data.get("s1")![0]!.caption, "Caption #1");
  });

  test("an embedding failure leaves the stored entries untouched", async () => {
    const { byId, source } = fakeSource([checkoutSession()]);
    const { calls, data, store } = fakeStore();
    const fake = fakeFetch();
    await indexSession(deps(source, store, fake.fetch), "s1");
    const before = data.get("s1");
    byId.get("s1")!.pins[1]!.comment = "Price fixed";
    const failing = (async (input: RequestInfo | URL, init?: RequestInit) =>
      String(input).endsWith("/embeddings") ? new Response("down", { status: 503 }) : fake.fetch(input, init)) as typeof fetch;
    await assert.rejects(indexSession(deps(source, store, failing), "s1"), /embedding request failed/);
    assert.equal(calls.replaceSession.length, 1);
    assert.equal(data.get("s1"), before);
  });

  test("an unknown session is a no-op", async () => {
    const { source } = fakeSource([]);
    const { calls, store } = fakeStore();
    const fake = fakeFetch();
    assert.deepEqual(await indexSession(deps(source, store, fake.fetch), "missing"), { captioned: false, embedded: 0, pins: 0 });
    assert.equal(calls.replaceSession.length, 0);
  });
});

// ---------- indexStale ----------

describe("indexStale", () => {
  function threeSessions() {
    return [
      session("a", "2026-10-17T09:00:00.000Z", [{ comment: "Contrast", id: "a1", number: 1 }]),
      session("b", "2026-10-17T10:00:00.000Z", [{ comment: "Checkout", id: "b1", number: 1 }]),
      session("c", "2026-10-17T11:00:00.000Z", [{ comment: "Price", id: "c1", number: 1 }]),
    ];
  }

  test("stops at maxSessions and reports what remains", async () => {
    const { source } = fakeSource(threeSessions());
    const { data, store } = fakeStore();
    const fake = fakeFetch();
    const d = deps(source, store, fake.fetch);
    assert.deepEqual(await indexStale(d, { budgetMs: 60_000, maxSessions: 2 }), { indexed: 2, remaining: true });
    assert.deepEqual([...data.keys()], ["c", "b"], "newest first");
    assert.deepEqual(await indexStale(d, { budgetMs: 60_000, maxSessions: 2 }), { indexed: 1, remaining: false });
    assert.deepEqual(await indexStale(d, { budgetMs: 60_000, maxSessions: 2 }), { indexed: 0, remaining: false });
  });

  test("starts no session once the budget has passed", async () => {
    const { source } = fakeSource(threeSessions());
    const { data, store } = fakeStore();
    const fake = fakeFetch();
    let clock = 0;
    source.onSession = () => {
      clock += 100; // each indexed session takes 100 ms
    };
    const d = deps(source, store, fake.fetch, { now: () => new Date(Date.UTC(2026, 9, 17, 12) + clock) });
    assert.deepEqual(await indexStale(d, { budgetMs: 150, maxSessions: 10 }), { indexed: 2, remaining: true });
    assert.equal(data.size, 2);
    assert.deepEqual(await indexStale(d, { budgetMs: 0, maxSessions: 10 }), { indexed: 0, remaining: true });
    assert.equal(data.size, 2);
  });

  test("starts no session once its signal is aborted, and leaves them stale", async () => {
    const { calls, source } = fakeSource(threeSessions());
    const { data, store } = fakeStore();
    const fake = fakeFetch();
    const controller = new AbortController();
    source.onSession = () => controller.abort(); // aborted while the first session runs
    const d = deps(source, store, fake.fetch);
    assert.deepEqual(await indexStale(d, { budgetMs: 60_000, maxSessions: 10, signal: controller.signal }), { indexed: 1, remaining: true });
    assert.deepEqual(calls.session, ["c"], "no session started after the abort");
    assert.equal(data.size, 1);
    assert.deepEqual(await indexStale(d, { budgetMs: 60_000, maxSessions: 10, signal: controller.signal }), { indexed: 0, remaining: true });
    source.onSession = undefined;
    assert.deepEqual(await indexStale(d, { budgetMs: 60_000, maxSessions: 10 }), { indexed: 2, remaining: false }, "the next pass takes them");
  });

  test("a failing session does not stop the pass and stays stale", async () => {
    const sessions = threeSessions();
    sessions[1]!.pinIds.push("orphan"); // pins and pinIds disagree → indexSession throws
    const { source } = fakeSource(sessions);
    const { data, store } = fakeStore();
    const fake = fakeFetch();
    assert.deepEqual(await indexStale(deps(source, store, fake.fetch), { budgetMs: 60_000, maxSessions: 10 }), { indexed: 2, remaining: true });
    assert.deepEqual([...data.keys()].sort(), ["a", "c"]);
  });

  const pass = { budgetMs: 60_000, maxSessions: 10 };

  test("re-embeds a session indexed without embedding once embedding appears", async () => {
    const s1 = checkoutSession();
    const { source } = fakeSource([s1]);
    const { calls, data, store } = fakeStore();
    const fake = fakeFetch();
    assert.deepEqual(await indexStale(deps(source, store, fake.fetch, { chat: null, embedding: null }), pass), { indexed: 1, remaining: false });
    assert.equal(calls.entriesFor.length, 0, "without chat or embedding nothing can lag");
    assert.ok(data.get("s1")!.every((entry) => entry.vector === null && entry.model === ""));
    assert.deepEqual(await store.staleSessions({ limit: 10, sessions: [{ id: "s1", updatedAt: s1.updatedAt }] }), [], "updatedAt alone does not pick it");

    const withEmbedding = deps(source, store, fake.fetch, { chat: null });
    assert.deepEqual(await indexStale(withEmbedding, pass), { indexed: 1, remaining: false });
    assert.deepEqual(calls.entriesFor, [["s1"]], "one entriesFor read over the listed sessions");
    assert.equal(fake.calls.embeddings.length, 1);
    assert.ok(data.get("s1")!.every((entry) => entry.vector !== null && entry.model === embeddingIdentity(embedding)));
    assert.deepEqual(await indexStale(withEmbedding, pass), { indexed: 0, remaining: false });
    assert.equal(fake.calls.embeddings.length, 1);
  });

  test("re-embeds entries of another model or without their vector", async () => {
    const { source } = fakeSource([checkoutSession()]);
    const { data, store } = fakeStore();
    const fake = fakeFetch();
    await indexStale(deps(source, store, fake.fetch, { chat: null, embedding: { ...embedding, model: "old-model" } }), pass);
    assert.ok(data.get("s1")!.every((entry) => entry.model === embeddingIdentity({ ...embedding, model: "old-model" }) && entry.vector !== null));

    const current = deps(source, store, fake.fetch, { chat: null });
    assert.deepEqual(await indexStale(current, pass), { indexed: 1, remaining: false });
    assert.deepEqual(fake.calls.embeddings.at(-1)!.input.length, 2);
    assert.ok(data.get("s1")!.every((entry) => entry.model === embeddingIdentity(embedding)));
    assert.deepEqual(await indexStale(current, pass), { indexed: 0, remaining: false });

    // A current-model entry whose vector is gone (a store that lost it).
    data.get("s1")![1]!.vector = null;
    const embeddingsBefore = fake.calls.embeddings.length;
    assert.deepEqual(await indexStale(current, pass), { indexed: 1, remaining: false });
    assert.equal(fake.calls.embeddings.length, embeddingsBefore + 1);
    assert.equal(fake.calls.embeddings.at(-1)!.input.length, 1);
    assert.ok(data.get("s1")!.every((entry) => entry.vector !== null));
  });

  test("a legacy entry of the same model is not lagging: the pass leaves it alone", async () => {
    const { source } = fakeSource([checkoutSession()]);
    const { data, store } = fakeStore();
    const fake = fakeFetch();
    await indexSession(deps(source, store, fake.fetch, { chat: null, embedding }), "s1");
    // The entries as written before the endpoint joined the identity: the
    // plain model name, with their vectors.
    for (const entry of data.get("s1")!) entry.model = "embeddinggemma-300m";
    const current = deps(source, store, fake.fetch, { chat: null });
    const embeddingsBefore = fake.calls.embeddings.length;
    assert.deepEqual(await indexStale(current, pass), { indexed: 0, remaining: false }, "the legacy vector is current for the same model");
    assert.equal(fake.calls.embeddings.length, embeddingsBefore);
    assert.ok(data.get("s1")!.every((entry) => entry.model === "embeddinggemma-300m" && entry.vector !== null), "the entry is not rewritten");
  });

  test("a session without captions gets them once vision appears", async () => {
    const { source } = fakeSource([checkoutSession()]);
    const { data, store } = fakeStore();
    const fake = fakeFetch();
    await indexStale(deps(source, store, fake.fetch, { chat: null }), pass);
    assert.ok(data.get("s1")!.every((entry) => entry.caption === null));

    const withVision = deps(source, store, fake.fetch);
    assert.deepEqual(await indexStale(withVision, pass), { indexed: 1, remaining: false });
    assert.equal(fake.calls.chat.length, 1);
    assert.deepEqual(
      data.get("s1")!.map((entry) => entry.caption),
      ["Caption #1", "Caption #2"],
    );
    assert.deepEqual(await indexStale(withVision, pass), { indexed: 0, remaining: false });
    assert.equal(fake.calls.chat.length, 1);
  });

  test('an empty caption ("" — vision already ran) is not pending', async () => {
    const { source } = fakeSource([checkoutSession()]);
    const { data, store } = fakeStore();
    const fake = fakeFetch({ describe: false });
    const d = deps(source, store, fake.fetch);
    assert.deepEqual(await indexStale(d, pass), { indexed: 1, remaining: false });
    assert.ok(data.get("s1")!.every((entry) => entry.caption === "" && entry.ocr === ""));
    assert.deepEqual(await indexStale(d, pass), { indexed: 0, remaining: false });
    assert.equal(fake.calls.chat.length, 1);
  });

  test("changed sessions go before lagging ones, within maxSessions", async () => {
    const lagging = session("lag", "2026-10-17T11:00:00.000Z", [{ comment: "Contrast", id: "l1", number: 1 }]);
    const fresh = session("new", "2026-10-17T09:00:00.000Z", [{ comment: "Price", id: "n1", number: 1 }]);
    const { source } = fakeSource([lagging, fresh]);
    const { data, store } = fakeStore();
    const fake = fakeFetch();
    await indexSession(deps(source, store, fake.fetch, { chat: null, embedding: null }), "lag");
    const d = deps(source, store, fake.fetch, { chat: null });
    assert.deepEqual(await indexStale(d, { budgetMs: 60_000, maxSessions: 1 }), { indexed: 1, remaining: true });
    assert.ok(data.get("new")!.every((entry) => entry.vector !== null), "the never-indexed session first");
    assert.ok(data.get("lag")!.every((entry) => entry.vector === null));
    assert.deepEqual(await indexStale(d, { budgetMs: 60_000, maxSessions: 1 }), { indexed: 1, remaining: false });
    assert.ok(data.get("lag")!.every((entry) => entry.vector !== null));
  });

  test("a session dated in the future is indexed once, not on every pass", async () => {
    const future = session("s1", "2099-01-01T00:00:00.000Z", [{ comment: "Contrast is too low", id: "p1", number: 1 }]);
    const { source } = fakeSource([future]);
    const { calls, data, store } = fakeStore();
    const fake = fakeFetch();
    const d = deps(source, store, fake.fetch);
    assert.deepEqual(await indexStale(d, pass), { indexed: 1, remaining: false });
    assert.equal(data.get("s1")![0]!.updatedAt, "2099-01-01T00:00:00.000Z", "stamped no earlier than the listed session");
    assert.deepEqual(await indexStale(d, pass), { indexed: 0, remaining: false });
    assert.equal(calls.replaceSession.length, 1);
  });

  test("listed times with an offset or without milliseconds compare by instant", async () => {
    const s = session("s1", "2099-01-01T10:00:00+05:00", [{ comment: "Old note", id: "p1", number: 1 }]);
    const { byId, source } = fakeSource([s]);
    const { data, store } = fakeStore();
    const fake = fakeFetch();
    const d = deps(source, store, fake.fetch);
    assert.deepEqual(await indexStale(d, pass), { indexed: 1, remaining: false });
    assert.equal(data.get("s1")![0]!.updatedAt, "2099-01-01T05:00:00.000Z");
    // As text "10:00:00+05:00" sorts after "05:00:00.000Z"; as instants they
    // are equal, so an unchanged session is not stale.
    assert.deepEqual(await indexStale(d, pass), { indexed: 0, remaining: false });
    // An edit one hour later in absolute time, written with another offset.
    byId.get("s1")!.updatedAt = "2099-01-01T09:00:00+00:00";
    byId.get("s1")!.pins[0]!.comment = "New note";
    assert.deepEqual(await indexStale(d, pass), { indexed: 1, remaining: false });
    assert.ok(data.get("s1")![0]!.docText.includes("Pin #1: New note"));

    // Without milliseconds, a past time is not stale after its indexing.
    const plain = session("s2", "2026-10-17T10:00:00Z", [{ comment: "Plain", id: "q1", number: 1 }]);
    const other = fakeSource([plain]);
    const second = fakeStore();
    const d2 = deps(other.source, second.store, fake.fetch);
    assert.deepEqual(await indexStale(d2, pass), { indexed: 1, remaining: false });
    assert.deepEqual(await indexStale(d2, pass), { indexed: 0, remaining: false });
  });

  test("canonicalTime: same instant in ISO UTC, epoch when unreadable, capped at year 9999", () => {
    assert.equal(canonicalTime("2026-10-17T10:00:00+02:00"), "2026-10-17T08:00:00.000Z");
    assert.equal(canonicalTime("2026-10-17T10:00:00Z"), "2026-10-17T10:00:00.000Z");
    assert.equal(canonicalTime("not a date"), "1970-01-01T00:00:00.000Z");
    assert.equal(canonicalTime(""), "1970-01-01T00:00:00.000Z");
    assert.equal(canonicalTime("+275760-09-13T00:00:00.000Z"), "9999-12-31T23:59:59.999Z");
  });

  test("never indexes a stale id outside listSessions", async () => {
    const { calls, source } = fakeSource(threeSessions(), ["a"]);
    const { data, store } = fakeStore();
    store.staleSessions = async () => ["c", "a"];
    const fake = fakeFetch();
    assert.deepEqual(await indexStale(deps(source, store, fake.fetch), { budgetMs: 60_000, maxSessions: 10 }), { indexed: 1, remaining: false });
    assert.deepEqual([...data.keys()], ["a"]);
    assert.ok(!calls.session.includes("c"));
  });
});

// ---------- searchPins ----------

describe("identityMatches", () => {
  const directA: EmbeddingEndpoint = { baseUrl: "https://a.example/v1", model: "m" };
  const directB: EmbeddingEndpoint = { baseUrl: "https://b.example/v1", model: "m" };
  const gateway: EmbeddingEndpoint = { baseUrl: "https://gateway.example/v1", gateway: { inputPrice: null, zeroDataRetention: true }, model: "m" };

  test("the new format matches only the same model and URL", () => {
    assert.equal(identityMatches("m\u0000https://a.example/v1", directA), true);
    assert.equal(identityMatches("m\u0000https://b.example/v1", directA), false, "another URL is another vector space");
    assert.equal(identityMatches("m\u0000https://a.example/v1", directB), false);
    assert.equal(identityMatches("other\u0000https://a.example/v1", directA), false, "another model never matches");
  });

  test("the old format (the plain model) matches any endpoint of the same model", () => {
    assert.equal(identityMatches("m", directA), true);
    assert.equal(identityMatches("m", directB), true, "the legacy vector is kept across URLs of the same model");
    assert.equal(identityMatches("other", directA), false);
  });

  test("the gateway: the old format matches, the new format does not", () => {
    assert.equal(identityMatches("m", gateway), true);
    assert.equal(identityMatches("m\u0000https://a.example/v1", gateway), false, "the gateway's identity is the plain model");
  });
});

describe("searchPins", () => {
  async function indexed(options: { embedding?: EmbeddingEndpoint | null; leaky?: boolean; visible?: string[] } = {}) {
    const sessions = [
      session("s1", "2026-10-17T10:00:00.000Z", [
        { comment: "Contrast is too low", id: "p1", number: 1 },
        { comment: "Checkout button contrast", id: "p2", number: 2 },
      ]),
      session("s2", "2026-10-17T11:00:00.000Z", [
        { comment: "Price is wrong", id: "q1", number: 1 },
        { comment: "Contraste baixo no botão", id: "q2", number: 2 },
      ]),
      session("secret", "2026-10-17T12:00:00.000Z", [{ comment: "Contrast contrast contrast", id: "x1", number: 1 }], "Private"),
    ];
    const fake = fakeFetch();
    const all = fakeSource(sessions);
    const { calls, data, store } = fakeStore({ leaky: options.leaky });
    const embeddingEndpoint = options.embedding === undefined ? embedding : options.embedding;
    for (const s of sessions) await indexSession(deps(all.source, store, fake.fetch, { chat: null, embedding: embeddingEndpoint }), s.id);
    const visible = fakeSource(sessions, options.visible ?? ["s1", "s2"]);
    calls.entriesFor.length = 0;
    return { calls, d: deps(visible.source, store, fake.fetch, { chat: null, embedding: embeddingEndpoint }), data, fake, visible };
  }

  test("ranks by cosine against the embedded query and respects limit", async () => {
    const { d, fake } = await indexed();
    // Query [contrast=1, bias=1]. Documents: s1#1 and s2#2 ("Contraste")
    // [1,0,0,0,1] → 1; s1#2 adds checkout → 2/√6; s2#1 (price) → 1/2.
    const { hits: all, semantic } = await searchPins(d, { limit: 50, query: "contrast" });
    assert.equal(semantic, true, "the embedded query's cosine ranking is the semantic one");
    assert.equal(fake.calls.embeddings.at(-1)!.prompt_name, "query");
    assert.deepEqual(fake.calls.embeddings.at(-1)!.input, ["contrast"]);
    assert.deepEqual(
      all.map((hit) => [hit.sessionId, hit.number, Math.round(hit.score * 1000) / 1000]),
      [
        ["s2", 2, 1], // tie on score: the newer session first
        ["s1", 1, 1],
        ["s1", 2, 0.816],
        ["s2", 1, 0.5],
      ],
    );
    assert.deepEqual(all[1], {
      caption: null,
      comment: "Contrast is too low",
      number: 1,
      pinId: "p1",
      score: all[1]!.score,
      sessionId: "s1",
      sessionTitle: "Title s1",
      url: "https://site.example/s1",
    });
    const { hits: top } = await searchPins(d, { limit: 3, query: "contrast" });
    assert.deepEqual(top, all.slice(0, 3));
    assert.equal((await searchPins(d, { limit: 0, query: "contrast" })).hits.length, 1, "limit is clamped to 1..50");
  });

  test("entries in the old format are ranked by their vector, not by text", async () => {
    const { d, data, fake } = await indexed();
    // The entries as written before the endpoint joined the identity.
    for (const entries of data.values()) for (const entry of entries) entry.model = "embeddinggemma-300m";
    const { hits: all } = await searchPins(d, { limit: 50, query: "contrast" });
    assert.equal(fake.calls.embeddings.at(-1)!.prompt_name, "query");
    // The same cosine order as the new-format entries: a textual fallback
    // would rank the two "contrast" documents first, without the 0.816 and
    // 0.5 cosine scores.
    assert.deepEqual(
      all.map((hit) => [hit.sessionId, hit.number, Math.round(hit.score * 1000) / 1000]),
      [
        ["s2", 2, 1],
        ["s1", 1, 1],
        ["s1", 2, 0.816],
        ["s2", 1, 0.5],
      ],
    );
  });

  test("asks the store only for listSessions ids and never returns other sessions", async () => {
    const { calls, d } = await indexed();
    const { hits } = await searchPins(d, { limit: 50, query: "contrast" });
    assert.deepEqual(calls.entriesFor, [["s2", "s1"]]);
    assert.ok(hits.every((hit) => hit.sessionId !== "secret"));
  });

  test("drops sessions outside listSessions even when the store leaks them", async () => {
    const { d, data } = await indexed({ leaky: true });
    assert.ok(data.has("secret"));
    const { hits } = await searchPins(d, { limit: 50, query: "contrast" });
    assert.ok(hits.length > 0);
    assert.deepEqual(
      hits.filter((hit) => hit.sessionId === "secret" || hit.sessionTitle === "Private"),
      [],
    );
  });

  test("text search without embedding: case and accent insensitive, score in 0..1", async () => {
    const { d, data, fake } = await indexed({ embedding: null });
    assert.ok([...data.values()].flat().every((entry) => entry.vector === null));
    const embeddingsBefore = fake.calls.embeddings.length;
    const { hits, semantic } = await searchPins(d, { limit: 10, query: "CONTRASTE botao" });
    assert.equal(semantic, false, "the textual ranking says the semantic one did not run");
    assert.equal(fake.calls.embeddings.length, embeddingsBefore, "no embeddings call");
    assert.deepEqual(
      hits.map((hit) => [hit.sessionId, hit.number, hit.score]),
      [["s2", 2, 1]],
    );
    const { hits: partial } = await searchPins(d, { limit: 10, query: "contrast checkout" });
    assert.deepEqual(
      partial.map((hit) => [hit.sessionId, hit.number, hit.score]),
      [
        ["s1", 2, 1],
        ["s1", 1, 0.5],
      ],
    );
    assert.deepEqual(await searchPins(d, { limit: 10, query: "nothing-matches" }), { hits: [], semantic: false });
  });

  test("falls back to the text ranking when embedding the query fails", async () => {
    const { d, fake } = await indexed();
    const { hits: textOnly, semantic: textSemantic } = await searchPins({ ...d, embedding: null }, { limit: 10, query: "contrast checkout" });
    assert.equal(textSemantic, false);
    assert.deepEqual(
      textOnly.map((hit) => [hit.sessionId, hit.number, hit.score]),
      [
        ["s1", 2, 1],
        ["s1", 1, 0.5],
      ],
    );
    const failures: Array<() => Response> = [
      () => new Response("down", { status: 503 }),
      () => Response.json({ data: [{ embedding: [1, 2, 3], index: 0 }] }), // wrong dimension
    ];
    for (const failure of failures) {
      let queried = 0;
      const failing = (async (input: RequestInfo | URL, init?: RequestInit) => {
        if (!String(input).endsWith("/embeddings")) return fake.fetch(input, init);
        queried += 1;
        return failure();
      }) as typeof fetch;
      const result = await searchPins({ ...d, fetch: failing }, { limit: 10, query: "contrast checkout" });
      assert.equal(queried, 1, "the query embedding was attempted");
      // The failed query's embedding settles the textual ranking: the hits
      // are the text-only ones and the answer says the semantic did not run
      // (the provider's body never crosses it).
      assert.deepEqual(result, { hits: textOnly, semantic: false });
    }
  });

  test("ignores entries of another model or without a vector, and pins gone from the session", async () => {
    const { d, data, visible } = await indexed();
    data.get("s2")![0]!.model = "other-model";
    data.get("s2")![1]!.vector = null;
    visible.byId.get("s1")!.pinIds[1] = "p2-replaced";
    const { hits } = await searchPins(d, { limit: 50, query: "contrast" });
    assert.deepEqual(
      hits.map((hit) => [hit.sessionId, hit.number]),
      [["s1", 1]],
    );
  });

  test(`looks at most at the ${PIN_SEARCH_MAX_SESSIONS} most recent accessible sessions`, async () => {
    const sessions = Array.from({ length: 520 }, (_, index) =>
      session(`s${String(index).padStart(3, "0")}`, new Date(Date.UTC(2026, 0, 1) + index * 60_000).toISOString(), []),
    );
    const { calls: sourceCalls, source } = fakeSource(sessions);
    const { calls, store } = fakeStore();
    await searchPins(deps(source, store, fakeFetch().fetch), { limit: 5, query: "contrast" });
    assert.equal(calls.entriesFor[0]!.length, 500);
    assert.ok(calls.entriesFor[0]!.includes("s519"));
    assert.ok(!calls.entriesFor[0]!.includes("s019"));
    assert.ok(sourceCalls.listSessions.every((call) => call.limit <= 100));
  });
});

describe("withAbortSignal", () => {
  function recordingFetch(answer: (init?: RequestInit) => Promise<Response>) {
    const calls: Array<RequestInit | undefined> = [];
    const fetchFn = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      calls.push(init);
      return answer(init);
    }) as typeof fetch;
    return { calls, fetchFn };
  }

  test("without a signal the fetch is unchanged", () => {
    const { fetchFn } = recordingFetch(async () => new Response("ok"));
    assert.equal(withAbortSignal(fetchFn, undefined), fetchFn);
    assert.equal(withAbortSignal(undefined, undefined), undefined);
  });

  test("an aborted signal starts no request", async () => {
    const { calls, fetchFn } = recordingFetch(async () => new Response("ok"));
    const controller = new AbortController();
    controller.abort(new Error("turn over"));
    await assert.rejects(withAbortSignal(fetchFn, controller.signal)!("https://x.example/a"), /turn over/);
    assert.equal(calls.length, 0);
  });

  test("a request in flight is cut at the abort, even by a fetch that ignores its signal", async () => {
    const { calls, fetchFn } = recordingFetch(() => new Promise<Response>(() => {})); // never answers
    const controller = new AbortController();
    const own = new AbortController();
    const pending = withAbortSignal(fetchFn, controller.signal)!("https://x.example/a", { signal: own.signal });
    await new Promise((resolve) => setTimeout(resolve, 5));
    assert.equal(calls.length, 1);
    assert.equal(calls[0]!.signal!.aborted, false);
    controller.abort(new Error("deadline"));
    await assert.rejects(pending, /deadline/);
    assert.equal(calls[0]!.signal!.aborted, true, "the request's own signal now carries the abort");
  });

  test("the request's own signal still applies, and an answer passes through", async () => {
    const { calls, fetchFn } = recordingFetch(async () => Response.json({ ok: true }));
    const controller = new AbortController();
    const own = new AbortController();
    const response = await withAbortSignal(fetchFn, controller.signal)!("https://x.example/a", { method: "POST", signal: own.signal });
    assert.deepEqual(await response.json(), { ok: true });
    assert.equal(calls[0]!.method, "POST");
    own.abort();
    assert.equal(calls[0]!.signal!.aborted, true, "combined with the request's own signal");
  });
});
