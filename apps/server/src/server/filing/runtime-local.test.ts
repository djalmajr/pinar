// Local capture filing (F3.5 contract §3.1): POST /api/shots and
// GET /api/preferences of api.local.ts over a temporary PINAR_HOME, with
// ai.json written directly and a fake fetch for the endpoint. No real
// endpoint, vault or ~/.pinar is reached, and the pin index runtime never
// fires (its timers are inert).

import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, test } from "node:test";
import { openHistoryDb } from "@pinar/cli/history";
import { setLocalAiDependenciesForTests } from "../ai/local-ai";
import { handleApiRequest, resetLocalApiForTests } from "../api.local";
import { resetThinkingControlCacheForTests } from "../assistant/models";
import { resetRetrievalCapabilitiesCacheForTests } from "../assistant/retrieval/detect";
import { encodeVector, PIN_EMBEDDING_DIMENSIONS } from "../assistant/retrieval/embeddings";
import { setLocalPinIndexOptionsForTests } from "../assistant/retrieval/runtime-local";
import { FILING_NONE_OPTION } from "./choose";
import { setLocalFilingFetchForTests } from "./runtime-local";

const VALID_PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
const BASE_URL = "http://127.0.0.1:9/v1";
const CHAT_MODEL = "fake-model";
const EMBEDDING_MODEL = "embed-model";
const DECISIONS_EXTRA = { available: true, endpoint: "/v1/decisions", experimental: true, scope: "decisions" };

type Engine = "decisions" | "none" | "similarity";
interface Call {
  body: Record<string, any> | null;
  method: string;
  path: string;
}

// A 256-dimension vector with the given leading components.
function vector(...leading: number[]): number[] {
  const values = new Array<number>(PIN_EMBEDDING_DIMENSIONS).fill(0);
  leading.forEach((value, index) => {
    values[index] = value;
  });
  return values;
}

// The endpoint of ai.json: /models declares the engine; /decisions and
// /embeddings answer with the given handlers.
function fakeEndpoint(options: {
  decide?: (body: Record<string, any>, init?: RequestInit) => Response | Promise<Response>;
  embed?: (text: string) => number[];
  engine: Engine;
}) {
  const calls: Call[] = [];
  const fetchFn = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    const raw = typeof init?.body === "string" ? init.body : "";
    const body = raw ? (JSON.parse(raw) as Record<string, any>) : null;
    const path = url.pathname.replace(/^\/v1/, "");
    calls.push({ body, method: init?.method ?? "GET", path });
    if (url.origin !== new URL(BASE_URL).origin) return new Response("unexpected host", { status: 599 });
    if (path === "/models") {
      return Response.json({
        data: [
          { ...(options.engine === "decisions" ? { decisions: DECISIONS_EXTRA } : {}), id: CHAT_MODEL, type: "chat" },
          ...(options.engine === "none" ? [] : [{ id: EMBEDDING_MODEL, type: "embedding" }]),
        ],
      });
    }
    if (path === "/decisions" && options.decide) return options.decide(body!, init);
    if (path === "/embeddings" && options.embed) {
      return Response.json({ data: (body!.input as string[]).map((text, index) => ({ embedding: options.embed!(text), index })) });
    }
    return new Response("not found", { status: 404 });
  }) as typeof fetch;
  return {
    calls,
    engineCalls: () => calls.filter((call) => call.path === "/decisions" || call.path === "/embeddings"),
    fetch: fetchFn,
  };
}

// The decision of the label whose text contains `match`, at `probability`.
function decideFor(match: string, probability: number) {
  return (body: Record<string, any>) => {
    const options = body.questions[0].options as string[];
    const choice = options.find((option) => option.includes(match)) ?? FILING_NONE_OPTION;
    const probabilities = Object.fromEntries(options.map((option) => [option, option === choice ? probability : (1 - probability) / options.length]));
    return Response.json({ decisions: [{ choice, id: "collection", probabilities }] });
  };
}

let root = "";
let previousHome: string | undefined;

function request(path: string, init: RequestInit = {}) {
  return handleApiRequest(new Request(`http://127.0.0.1:17373${path}`, init));
}

async function post(path: string, body: unknown): Promise<Record<string, any>> {
  const response = await request(path, { body: JSON.stringify(body), headers: { "content-type": "application/json" }, method: "POST" });
  assert.ok(response.status < 300, `${path}: ${response.status}`);
  return (await response.json()) as Record<string, any>;
}

async function patchPreferences(body: Record<string, unknown>) {
  const response = await request("/api/preferences", { body: JSON.stringify(body), headers: { "content-type": "application/json" }, method: "PATCH" });
  assert.equal(response.status, 200);
}

function configureAi() {
  writeFileSync(join(root, "ai.json"), JSON.stringify({ endpoint: BASE_URL, mode: "local", model: CHAT_MODEL }));
}

// Projects "Shop" (Checkout, Onboarding, and a Checkout nested under
// Onboarding, whose label repeats "Shop / Checkout") and "Docs" (Checkout).
async function seedCollections() {
  const shop = (await post("/api/projects", { name: "Shop" })).project.id as string;
  const docs = (await post("/api/projects", { name: "Docs" })).project.id as string;
  const checkout = (await post(`/api/projects/${shop}/collections`, { name: "Checkout" })).collection.id as string;
  const onboarding = (await post(`/api/projects/${shop}/collections`, { name: "Onboarding" })).collection.id as string;
  await post(`/api/projects/${shop}/collections`, { name: "Checkout", parentId: onboarding });
  const docsCheckout = (await post(`/api/projects/${docs}/collections`, { name: "Checkout" })).collection.id as string;
  const tree = (await (await request("/api/project-tree")).json()) as { tree: { projects: Array<{ collections: Array<{ id: string; isProtected: boolean }> }> } };
  const inbox = tree.tree.projects.flatMap((project) => project.collections).find((collection) => collection.isProtected)!.id;
  return { checkout, docsCheckout, inbox, onboarding };
}

// A saved session (POST /api/history never files) and its index entry.
async function seedSession(input: { batchId?: string; collectionId: string; createdAt: string; id: string; title: string; vector?: number[] }) {
  await post("/api/history", {
    ...(input.batchId ? { batch: { id: input.batchId, label: "Batch", startedAt: input.createdAt } } : {}),
    collectionId: input.collectionId,
    createdAt: input.createdAt,
    id: input.id,
    page: { title: input.title, url: `https://example.test/${input.id}` },
    pins: [{ comment: `${input.title} note`, kind: "element", number: 1, pinId: `pin_${input.id}` }],
  });
  if (!input.vector) return;
  const db = openHistoryDb(root);
  try {
    db.replacePinIndexSession(input.id, [{
      caption: null,
      docHash: `hash_${input.id}`,
      docText: input.title,
      model: EMBEDDING_MODEL,
      number: 1,
      ocr: null,
      pinId: `pin_${input.id}`,
      sessionId: input.id,
      truncated: false,
      updatedAt: input.createdAt,
      vector: encodeVector(input.vector),
    }]);
  } finally {
    db.close();
  }
}

function shot(input: { batchId?: string; collectionId?: string; id: string; title: string }) {
  return request("/api/shots", {
    body: JSON.stringify({
      ...(input.batchId ? { batch: { id: input.batchId, label: "Batch", startedAt: "2026-10-17T10:00:00.000Z" } } : {}),
      ...(input.collectionId ? { collectionId: input.collectionId } : {}),
      id: input.id,
      image: VALID_PNG,
      page: { title: input.title, url: "https://example.test/new" },
      pins: [{ comment: `${input.title} pin`, kind: "element", number: 1 }],
    }),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
}

async function storedSession(id: string): Promise<Record<string, any>> {
  return ((await (await request(`/api/sessions/${id}`)).json()) as { session: Record<string, any> }).session;
}

let endpoint = fakeEndpoint({ engine: "none" });

function useEndpoint(next: ReturnType<typeof fakeEndpoint>) {
  endpoint = next;
}

describe("local capture filing (POST /api/shots)", () => {
  beforeEach(async () => {
    previousHome = process.env.PINAR_HOME;
    root = await mkdtemp(join(tmpdir(), "pinar-local-filing-"));
    process.env.PINAR_HOME = root;
    resetLocalApiForTests();
    resetRetrievalCapabilitiesCacheForTests();
    resetThinkingControlCacheForTests();
    endpoint = fakeEndpoint({ engine: "none" });
    const viaCurrent = ((input: RequestInfo | URL, init?: RequestInit) => endpoint.fetch(input, init)) as typeof fetch;
    // A vault that never reaches the keychain, inert index timers.
    setLocalAiDependenciesForTests({ vault: { async clear() {}, async get() { return null; }, async set() {} } });
    setLocalPinIndexOptionsForTests({ fetch: viaCurrent, timers: { clear() {}, set: () => 0 } });
    setLocalFilingFetchForTests(viaCurrent);
  });

  afterEach(async () => {
    resetLocalApiForTests();
    setLocalPinIndexOptionsForTests(null);
    setLocalFilingFetchForTests(null);
    resetRetrievalCapabilitiesCacheForTests();
    resetThinkingControlCacheForTests();
    if (previousHome === undefined) delete process.env.PINAR_HOME;
    else process.env.PINAR_HOME = previousHome;
    await rm(root, { force: true, recursive: true });
  });

  test("switch off: the body's collectionId is kept, no filing and no fetch", async () => {
    configureAi();
    useEndpoint(fakeEndpoint({ decide: decideFor("Onboarding", 0.95), engine: "decisions" }));
    const { checkout } = await seedCollections();

    const response = await shot({ collectionId: checkout, id: "local_off", title: "Onboarding welcome" });
    assert.equal(response.status, 201);
    const body = (await response.json()) as Record<string, any>;
    assert.equal(body.destination.collectionId, checkout);
    assert.equal("filing" in body, false);
    assert.equal(endpoint.calls.length, 0, "the switch off reads no endpoint");
    const stored = await storedSession("local_off");
    assert.equal(stored.collectionId, checkout);
    assert.equal("filedBy" in stored, false);
  });

  test("switch on without AI configured: the preference is ignored and nothing is fetched", async () => {
    useEndpoint(fakeEndpoint({ decide: decideFor("Onboarding", 0.95), engine: "decisions" }));
    const { checkout } = await seedCollections();
    await patchPreferences({ autoCaptureDestination: true });

    const body = (await (await shot({ collectionId: checkout, id: "local_no_ai", title: "Onboarding welcome" })).json()) as Record<string, any>;
    assert.equal(body.destination.collectionId, checkout);
    assert.equal("filing" in body, false);
    assert.equal(endpoint.calls.length, 0);
  });

  test("decisions: the chosen collection with the auto mark, the body's collectionId ignored", async () => {
    configureAi();
    useEndpoint(fakeEndpoint({ decide: decideFor("Shop / Onboarding", 0.92), engine: "decisions" }));
    const { checkout, onboarding } = await seedCollections();
    await seedSession({ collectionId: onboarding, createdAt: "2026-10-01T10:00:00.000Z", id: "local_seed_onb", title: "Welcome tour" });
    await seedSession({ collectionId: checkout, createdAt: "2026-10-02T10:00:00.000Z", id: "local_seed_chk", title: "Card form" });
    await patchPreferences({ autoCaptureDestination: true });

    const response = await shot({ collectionId: checkout, id: "local_decided", title: "Onboarding step 2" });
    assert.equal(response.status, 201);
    const body = (await response.json()) as Record<string, any>;
    assert.equal(body.destination.collectionId, onboarding, "the body's collectionId is ignored");
    assert.deepEqual(body.filing, { collectionId: onboarding, confidence: 0.92, engine: "decisions", reason: "chosen" });
    assert.equal(JSON.stringify(body).includes(BASE_URL), false, "the response carries no endpoint");
    const stored = await storedSession("local_decided");
    assert.equal(stored.collectionId, onboarding);
    assert.equal(stored.filedBy, "auto");

    // The request: the candidates (no Inbox, repeated labels made unique),
    // with the examples of each collection, then the none option.
    const decision = endpoint.calls.find((call) => call.path === "/decisions")!;
    assert.deepEqual(decision.body!.questions[0].options, ["Shop / Checkout", "Shop / Onboarding", "Shop / Checkout (2)", "Docs / Checkout", FILING_NONE_OPTION]);
    assert.match(decision.body!.instructions, /"Shop \/ Onboarding" \(recent captures: "Welcome tour"\)/);
    assert.match(decision.body!.instructions, /"Shop \/ Checkout" \(recent captures: "Card form"\)/);
    assert.match(decision.body!.state, /Page: Onboarding step 2/);
    assert.equal(decision.body!.model, CHAT_MODEL);
    assert.equal(endpoint.calls.some((call) => call.path === "/embeddings"), false, "decisions wins over similarity");
  });

  test("decisions below the threshold: the Inbox without a mark", async () => {
    configureAi();
    useEndpoint(fakeEndpoint({ decide: decideFor("Shop / Onboarding", 0.5), engine: "decisions" }));
    const { checkout, inbox } = await seedCollections();
    await patchPreferences({ autoCaptureDestination: true });

    const body = (await (await shot({ collectionId: checkout, id: "local_unsure", title: "Something else" })).json()) as Record<string, any>;
    assert.equal(body.destination.collectionId, inbox);
    assert.deepEqual(body.filing, { collectionId: null, confidence: 0.5, engine: "decisions", reason: "low_confidence" });
    const stored = await storedSession("local_unsure");
    assert.equal(stored.collectionId, inbox);
    assert.equal("filedBy" in stored, false);
  });

  test("similarity: the collection whose centroid is closest, from the index of its recent sessions", async () => {
    configureAi();
    useEndpoint(fakeEndpoint({
      embed: (text) => (text.includes("Payment") ? vector(1, 0.05) : vector(0, 0, 1)),
      engine: "similarity",
    }));
    const { checkout, inbox, onboarding } = await seedCollections();
    await seedSession({ collectionId: checkout, createdAt: "2026-10-01T10:00:00.000Z", id: "local_chk_1", title: "Card form", vector: vector(1, 0) });
    await seedSession({ collectionId: checkout, createdAt: "2026-10-02T10:00:00.000Z", id: "local_chk_2", title: "Card errors", vector: vector(0.9, 0.1) });
    await seedSession({ collectionId: onboarding, createdAt: "2026-10-03T10:00:00.000Z", id: "local_onb_1", title: "Welcome", vector: vector(0, 1) });
    // An entry of another model never enters a centroid.
    const db = openHistoryDb(root);
    try {
      db.replacePinIndexSession("local_onb_1", [
        ...db.listPinIndexEntries("local_onb_1"),
        { caption: null, docHash: "other", docText: "x", model: "old-model", number: 2, ocr: null, pinId: "pin_old", sessionId: "local_onb_1", truncated: false, updatedAt: "2026-10-03T10:00:00.000Z", vector: encodeVector(vector(1, 0)) },
      ]);
    } finally {
      db.close();
    }
    await patchPreferences({ autoCaptureDestination: true });

    const response = await shot({ collectionId: onboarding, id: "local_similar", title: "Payment declined" });
    const body = (await response.json()) as Record<string, any>;
    assert.equal(body.destination.collectionId, checkout);
    assert.equal(body.filing.collectionId, checkout);
    assert.equal(body.filing.engine, "similarity");
    assert.equal(body.filing.reason, "chosen");
    assert.ok(body.filing.confidence > 0.95, String(body.filing.confidence));
    assert.equal((await storedSession("local_similar")).filedBy, "auto");
    const embedding = endpoint.calls.find((call) => call.path === "/embeddings")!;
    assert.equal(embedding.body!.prompt_name, "query");
    assert.equal(embedding.body!.model, EMBEDDING_MODEL);

    // Far from every centroid: the Inbox, without a mark.
    const far = (await (await shot({ collectionId: onboarding, id: "local_far", title: "Unrelated" })).json()) as Record<string, any>;
    assert.equal(far.destination.collectionId, inbox);
    assert.equal(far.filing.collectionId, null);
    assert.equal(far.filing.engine, "similarity");
    assert.equal(far.filing.reason, "low_confidence");
    assert.equal("filedBy" in (await storedSession("local_far")), false);
  });

  test("a capture that enters an existing batch follows the batch's collection without asking the engine", async () => {
    configureAi();
    useEndpoint(fakeEndpoint({ decide: decideFor("Shop / Onboarding", 0.95), engine: "decisions" }));
    const { checkout, inbox, onboarding } = await seedCollections();
    await seedSession({ batchId: "batch_review", collectionId: checkout, createdAt: "2026-10-01T10:00:00.000Z", id: "local_batch_1", title: "First" });
    await seedSession({ batchId: "batch_inbox", collectionId: inbox, createdAt: "2026-10-01T10:00:00.000Z", id: "local_batch_inbox", title: "First" });
    await patchPreferences({ autoCaptureDestination: true });

    const body = (await (await shot({ batchId: "batch_review", collectionId: onboarding, id: "local_batch_2", title: "Onboarding" })).json()) as Record<string, any>;
    assert.equal(body.destination.collectionId, checkout);
    assert.deepEqual(body.filing, { collectionId: checkout, confidence: 0, engine: "none", reason: "chosen" });
    const stored = await storedSession("local_batch_2");
    assert.equal(stored.collectionId, checkout);
    assert.equal(stored.filedBy, "auto");
    assert.equal(stored.batchId, "batch_review");
    assert.deepEqual(endpoint.engineCalls(), [], "the batch rule asks no engine");

    // A batch kept in the Inbox keeps its next capture there, unmarked.
    const inInbox = (await (await shot({ batchId: "batch_inbox", collectionId: onboarding, id: "local_batch_3", title: "Onboarding" })).json()) as Record<string, any>;
    assert.equal(inInbox.destination.collectionId, inbox);
    assert.deepEqual(inInbox.filing, { collectionId: null, confidence: 0, engine: "none", reason: "chosen" });
    assert.equal("filedBy" in (await storedSession("local_batch_3")), false);
    assert.deepEqual(endpoint.engineCalls(), []);

    // A new batch (no other session in it) is decided by the engine.
    const fresh = (await (await shot({ batchId: "batch_new", collectionId: checkout, id: "local_batch_4", title: "Onboarding" })).json()) as Record<string, any>;
    assert.equal(fresh.destination.collectionId, onboarding);
    assert.equal(fresh.filing.engine, "decisions");
    assert.equal(endpoint.engineCalls().length, 1);
  });

  test("without an engine: the Inbox with reason error, never the manual destination", async () => {
    configureAi();
    useEndpoint(fakeEndpoint({ engine: "none" }));
    const { checkout, inbox } = await seedCollections();
    await patchPreferences({ autoCaptureDestination: true, captureDestination: { collectionId: checkout, projectId: "ignored" } });

    const body = (await (await shot({ collectionId: checkout, id: "local_no_engine", title: "Anything" })).json()) as Record<string, any>;
    assert.equal(body.destination.collectionId, inbox);
    assert.deepEqual(body.filing, { collectionId: null, confidence: 0, engine: "none", reason: "error" });
    assert.equal("filedBy" in (await storedSession("local_no_engine")), false);
  });

  test("an engine that never answers: the Inbox before 3.5 s with reason timeout", async () => {
    configureAi();
    let aborted = false;
    useEndpoint(fakeEndpoint({
      decide: (_body, init) => new Promise<Response>(() => {
        init?.signal?.addEventListener("abort", () => {
          aborted = true;
        });
      }),
      engine: "decisions",
    }));
    const { checkout, inbox } = await seedCollections();
    await patchPreferences({ autoCaptureDestination: true });

    const startedAt = Date.now();
    const body = (await (await shot({ collectionId: checkout, id: "local_hang", title: "Anything" })).json()) as Record<string, any>;
    const elapsed = Date.now() - startedAt;
    assert.ok(elapsed < 3_500, `took ${elapsed} ms`);
    assert.equal(body.destination.collectionId, inbox);
    assert.deepEqual(body.filing, { collectionId: null, confidence: 0, engine: "decisions", reason: "timeout" });
    assert.equal("filedBy" in (await storedSession("local_hang")), false);
    assert.equal(aborted, true, "the request is cut at the deadline");
  });

  test("a re-upload of the same id follows the new decision", async () => {
    configureAi();
    let probability = 0.92;
    useEndpoint(fakeEndpoint({ decide: (body) => decideFor("Shop / Onboarding", probability)(body), engine: "decisions" }));
    const { checkout, inbox, onboarding } = await seedCollections();
    await patchPreferences({ autoCaptureDestination: true });

    await shot({ id: "local_again", title: "Onboarding" });
    let stored = await storedSession("local_again");
    assert.equal(stored.collectionId, onboarding);
    assert.equal(stored.filedBy, "auto");

    // Unsure now: the Inbox, and the earlier mark is gone.
    probability = 0.4;
    await shot({ id: "local_again", title: "Onboarding" });
    stored = await storedSession("local_again");
    assert.equal(stored.collectionId, inbox);
    assert.equal("filedBy" in stored, false);

    // Filed again, then re-uploaded with the switch off into the same
    // collection: the manual destination never keeps the mark.
    probability = 0.92;
    await shot({ id: "local_again", title: "Onboarding" });
    assert.equal((await storedSession("local_again")).filedBy, "auto");
    await patchPreferences({ autoCaptureDestination: false });
    await shot({ collectionId: onboarding, id: "local_again", title: "Onboarding" });
    stored = await storedSession("local_again");
    assert.equal(stored.collectionId, onboarding);
    assert.equal("filedBy" in stored, false);
    assert.notEqual(checkout, onboarding);
  });
});

describe("local GET /api/preferences autoCaptureDestinationAvailable", () => {
  beforeEach(async () => {
    previousHome = process.env.PINAR_HOME;
    root = await mkdtemp(join(tmpdir(), "pinar-local-filing-"));
    process.env.PINAR_HOME = root;
    resetLocalApiForTests();
    resetRetrievalCapabilitiesCacheForTests();
    resetThinkingControlCacheForTests();
    const viaCurrent = ((input: RequestInfo | URL, init?: RequestInit) => endpoint.fetch(input, init)) as typeof fetch;
    setLocalAiDependenciesForTests({ vault: { async clear() {}, async get() { return null; }, async set() {} } });
    setLocalPinIndexOptionsForTests({ fetch: viaCurrent, timers: { clear() {}, set: () => 0 } });
    setLocalFilingFetchForTests(viaCurrent);
  });

  afterEach(async () => {
    resetLocalApiForTests();
    setLocalPinIndexOptionsForTests(null);
    setLocalFilingFetchForTests(null);
    resetRetrievalCapabilitiesCacheForTests();
    resetThinkingControlCacheForTests();
    if (previousHome === undefined) delete process.env.PINAR_HOME;
    else process.env.PINAR_HOME = previousHome;
    await rm(root, { force: true, recursive: true });
  });

  async function available() {
    const body = (await (await request("/api/preferences")).json()) as Record<string, unknown>;
    return body.autoCaptureDestinationAvailable;
  }

  test("without AI: false, without any fetch", async () => {
    useEndpoint(fakeEndpoint({ engine: "decisions" }));
    assert.equal(await available(), false);
    assert.equal(endpoint.calls.length, 0);
  });

  test("with an engine: true (decisions or similarity), from the cached detection", async () => {
    configureAi();
    useEndpoint(fakeEndpoint({ engine: "decisions" }));
    assert.equal(await available(), true);
    const probes = endpoint.calls.length;
    assert.equal(await available(), true);
    assert.equal(endpoint.calls.length, probes, "the second read uses the cache");

    resetRetrievalCapabilitiesCacheForTests();
    resetThinkingControlCacheForTests();
    useEndpoint(fakeEndpoint({ engine: "similarity" }));
    assert.equal(await available(), true);
  });

  test("AI configured without an engine: false", async () => {
    configureAi();
    useEndpoint(fakeEndpoint({ engine: "none" }));
    assert.equal(await available(), false);
    assert.ok(endpoint.calls.some((call) => call.path === "/models"));
  });
});
