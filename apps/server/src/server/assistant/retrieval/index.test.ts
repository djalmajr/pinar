import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { AssistantEndpoint } from "../models";
import type { PinDocumentInput } from "./document";
import { decodeVector, PIN_EMBEDDING_DIMENSIONS, type EmbeddingEndpoint } from "./embeddings";
import {
  indexSession,
  indexStale,
  PIN_SEARCH_MAX_SESSIONS,
  searchPins,
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
        ["p1", 1, "Caption #1", "OCR 1", "embeddinggemma-300m", "s1", "2026-10-17T12:00:00.000Z"],
        ["p2", 2, "Caption #2", "OCR 2", "embeddinggemma-300m", "s1", "2026-10-17T12:00:00.000Z"],
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
    assert.ok(data.get("s1")!.every((entry) => entry.vector !== null && entry.model === "embeddinggemma-300m"));
    assert.deepEqual(await indexStale(withEmbedding, pass), { indexed: 0, remaining: false });
    assert.equal(fake.calls.embeddings.length, 1);
  });

  test("re-embeds entries of another model or without their vector", async () => {
    const { source } = fakeSource([checkoutSession()]);
    const { data, store } = fakeStore();
    const fake = fakeFetch();
    await indexStale(deps(source, store, fake.fetch, { chat: null, embedding: { ...embedding, model: "old-model" } }), pass);
    assert.ok(data.get("s1")!.every((entry) => entry.model === "old-model" && entry.vector !== null));

    const current = deps(source, store, fake.fetch, { chat: null });
    assert.deepEqual(await indexStale(current, pass), { indexed: 1, remaining: false });
    assert.deepEqual(fake.calls.embeddings.at(-1)!.input.length, 2);
    assert.ok(data.get("s1")!.every((entry) => entry.model === "embeddinggemma-300m"));
    assert.deepEqual(await indexStale(current, pass), { indexed: 0, remaining: false });

    // A current-model entry whose vector is gone (a store that lost it).
    data.get("s1")![1]!.vector = null;
    const embeddingsBefore = fake.calls.embeddings.length;
    assert.deepEqual(await indexStale(current, pass), { indexed: 1, remaining: false });
    assert.equal(fake.calls.embeddings.length, embeddingsBefore + 1);
    assert.equal(fake.calls.embeddings.at(-1)!.input.length, 1);
    assert.ok(data.get("s1")!.every((entry) => entry.vector !== null));
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
    const all = await searchPins(d, { limit: 50, query: "contrast" });
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
    const top = await searchPins(d, { limit: 3, query: "contrast" });
    assert.deepEqual(top, all.slice(0, 3));
    assert.equal((await searchPins(d, { limit: 0, query: "contrast" })).length, 1, "limit is clamped to 1..50");
  });

  test("asks the store only for listSessions ids and never returns other sessions", async () => {
    const { calls, d } = await indexed();
    const hits = await searchPins(d, { limit: 50, query: "contrast" });
    assert.deepEqual(calls.entriesFor, [["s2", "s1"]]);
    assert.ok(hits.every((hit) => hit.sessionId !== "secret"));
  });

  test("drops sessions outside listSessions even when the store leaks them", async () => {
    const { d, data } = await indexed({ leaky: true });
    assert.ok(data.has("secret"));
    const hits = await searchPins(d, { limit: 50, query: "contrast" });
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
    const hits = await searchPins(d, { limit: 10, query: "CONTRASTE botao" });
    assert.equal(fake.calls.embeddings.length, embeddingsBefore, "no embeddings call");
    assert.deepEqual(
      hits.map((hit) => [hit.sessionId, hit.number, hit.score]),
      [["s2", 2, 1]],
    );
    const partial = await searchPins(d, { limit: 10, query: "contrast checkout" });
    assert.deepEqual(
      partial.map((hit) => [hit.sessionId, hit.number, hit.score]),
      [
        ["s1", 2, 1],
        ["s1", 1, 0.5],
      ],
    );
    assert.deepEqual(await searchPins(d, { limit: 10, query: "nothing-matches" }), []);
  });

  test("falls back to the text ranking when embedding the query fails", async () => {
    const { d, fake } = await indexed();
    const textOnly = await searchPins({ ...d, embedding: null }, { limit: 10, query: "contrast checkout" });
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
      const hits = await searchPins({ ...d, fetch: failing }, { limit: 10, query: "contrast checkout" });
      assert.equal(queried, 1, "the query embedding was attempted");
      assert.deepEqual(hits, textOnly);
    }
  });

  test("ignores entries of another model or without a vector, and pins gone from the session", async () => {
    const { d, data, visible } = await indexed();
    data.get("s2")![0]!.model = "other-model";
    data.get("s2")![1]!.vector = null;
    visible.byId.get("s1")!.pinIds[1] = "p2-replaced";
    const hits = await searchPins(d, { limit: 50, query: "contrast" });
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
