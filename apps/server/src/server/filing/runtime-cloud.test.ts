// Cloud capture filing (F3.5 contract §3.1): POST /api/shots and
// GET /api/preferences of cloud-api.ts over a migrated SQLite-as-D1 (the
// model cloud-assistant.test.ts uses) and a fake fetch for the appliance.
// No real endpoint is reached.

import assert from "node:assert/strict";
import { Database } from "bun:sqlite";
import { readdirSync, readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, test } from "node:test";
import {
  findOwnedSession,
  handleCloudApiRequest,
  persistSession,
  resetCloudMemoryStateForTests,
  seedCloudWebSessionForTests,
  setCloudNowForTests,
  writeOwnerDeliveryPreferences,
  type CloudEnv,
} from "../cloud-api";
import { resetRetrievalCapabilitiesCacheForTests } from "../assistant/retrieval/detect";
import { encodeVector, PIN_EMBEDDING_DIMENSIONS } from "../assistant/retrieval/embeddings";
import { embeddingIdentity } from "../assistant/retrieval/index";
import { cloudPinIndexStore } from "../assistant/retrieval/store-cloud";
import { FILING_NONE_OPTION, FILING_SIMILARITY_MIN } from "./choose";
import { cloudAutoCaptureDestinationAvailable, cloudFilingEngine, setCloudFilingFetchForTests } from "./runtime-cloud";
import { byokCrypto } from "../byok/crypto";
import { ByokEgressUnavailableError, setByokEgressForTests } from "../byok/fetch";
import { byokAcquireSlot, byokSlotRelease, resetByokConcurrencyForTests } from "../byok/route";

const NOW = "2026-10-17T12:00:00.000Z";
const VALID_PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
const BASE_URL = "http://127.0.0.1:9/v1";
const EMBEDDING_MODEL = "embed-model";
// The identity of the tests' direct embedding endpoint: the seeds without an
// explicit model carry it (the current model's vectors); an explicit model
// (a gateway's, or "old-model") is another space.
const EMBEDDING_IDENTITY = embeddingIdentity({ baseUrl: BASE_URL, model: EMBEDDING_MODEL });
const DECISIONS_EXTRA = { available: true, endpoint: "/v1/decisions", experimental: true, scope: "decisions" };
const OWNER = "usr_owner";

// ---------- D1 shim (same model as cloud-mcp.test.ts) ----------

// Batches run one at a time, as D1 runs each batch as one transaction: two
// concurrent requests never open two transactions on the one connection.
// A test may pause a request right after one of its reads (`first()`), to
// interleave another request there. Reset in afterEach.
let afterFirst: ((query: string, params: unknown[], row: unknown) => Promise<void>) | null = null;

function sqliteD1(db: Database): NonNullable<CloudEnv["DB"]> {
  let batches: Promise<unknown> = Promise.resolve();
  const statement = (query: string) => {
    let params: unknown[] = [];
    const bound = {
      async all() {
        return { results: db.query(query).all(...params) as Record<string, unknown>[] };
      },
      bind(...values: unknown[]) {
        params = values.map((value) => value === undefined ? null : value);
        return bound;
      },
      async first() {
        const row = (db.query(query).get(...params) as Record<string, unknown> | null) ?? null;
        await afterFirst?.(query, params, row);
        return row;
      },
      async run() {
        db.query(query).run(...params);
        const changes = db.query("SELECT changes() AS changes").get() as { changes: number };
        return { meta: { changes: changes.changes } };
      },
    };
    return bound;
  };
  return {
    batch(statements) {
      const work = batches.then(async () => {
        db.exec("BEGIN");
        try {
          const results = [];
          for (const statement of statements) results.push(await statement.run());
          db.exec("COMMIT");
          return results;
        } catch (error) {
          db.exec("ROLLBACK");
          throw error;
        }
      });
      batches = work.catch(() => {});
      return work;
    },
    prepare(query: string) {
      return statement(query);
    },
  };
}

function migratedDatabase() {
  const db = new Database(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  const directory = new URL("../../../migrations/", import.meta.url);
  for (const file of readdirSync(directory).filter((name) => name.endsWith(".sql")).sort()) {
    db.exec(readFileSync(new URL(file, directory), "utf8"));
  }
  return db;
}

// ---------- seed ----------

function insertUser(db: Database, id: string, plan: "free" | "pro") {
  db.query(
    "INSERT INTO users (id, email, plan, ever_paid, billing_status, created_at, updated_at) VALUES (?, ?, ?, 1, 'active', ?, ?)",
  ).run(id, `${id}@example.test`, plan, NOW, NOW);
}

function insertProject(db: Database, id: string, name: string, position: number, isProtected = false) {
  db.query(
    "INSERT INTO projects (id, owner_id, name, position, is_protected, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
  ).run(id, OWNER, name, position, isProtected ? 1 : 0, NOW, NOW);
}

function insertCollection(db: Database, id: string, projectId: string, name: string, position: number, isProtected = false) {
  db.query(
    "INSERT INTO collections (id, project_id, owner_id, name, position, is_protected, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
  ).run(id, projectId, OWNER, name, position, isProtected ? 1 : 0, NOW, NOW);
}

function insertSession(db: Database, input: { batchId?: string; collectionId: string; createdAt: string; id: string; title: string }) {
  if (input.batchId) {
    db.query("INSERT OR IGNORE INTO batches (id, user_id, label, started_at) VALUES (?, ?, 'Batch', ?)").run(input.batchId, OWNER, input.createdAt);
  }
  db.query(
    "INSERT INTO sessions (id, url, title, shot_id, shot_url, pin_count, pins_json, created_at, user_id, plan, is_permanent, byte_size, collection_id, position, batch_id) "
      + "VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?, 'pro', 1, 1, ?, 0, ?)",
  ).run(
    input.id,
    `https://example.test/${input.id}`,
    input.title,
    input.id,
    `https://pinar.test/shots/${input.id}.png`,
    JSON.stringify([{ comment: `${input.title} note`, number: 1, pinId: `pin_${input.id}` }]),
    input.createdAt,
    OWNER,
    input.collectionId,
    input.batchId ?? null,
  );
}

// Personal/Inbox (protected), Shop (Checkout, Onboarding) and Docs
// (Checkout), plus another owner's collection.
function seedCollections(db: Database) {
  insertProject(db, "prj_personal", "Personal", 0, true);
  insertCollection(db, "col_inbox", "prj_personal", "Inbox", 0, true);
  insertProject(db, "prj_shop", "Shop", 1);
  insertCollection(db, "col_checkout", "prj_shop", "Checkout", 0);
  insertCollection(db, "col_onboarding", "prj_shop", "Onboarding", 1);
  insertProject(db, "prj_docs", "Docs", 2);
  insertCollection(db, "col_docs_checkout", "prj_docs", "Checkout", 0);
  insertUser(db, "usr_other", "pro");
  db.query("INSERT INTO projects (id, owner_id, name, created_at, updated_at) VALUES ('prj_other', 'usr_other', 'Other', ?, ?)").run(NOW, NOW);
  db.query("INSERT INTO collections (id, project_id, owner_id, name, created_at, updated_at) VALUES ('col_other', 'prj_other', 'usr_other', 'Elsewhere', ?, ?)").run(NOW, NOW);
}

async function indexSession(env: CloudEnv, sessionId: string, vectors: Array<{ model?: string; vector: number[] }>) {
  await cloudPinIndexStore(env, OWNER).replaceSession(sessionId, vectors.map((item, index) => ({
    caption: null,
    docHash: `hash_${sessionId}_${index}`,
    docText: sessionId,
    model: item.model ?? EMBEDDING_IDENTITY,
    number: index + 1,
    ocr: null,
    pinId: `pin_${sessionId}_${index}`,
    sessionId,
    truncated: false,
    updatedAt: NOW,
    vector: encodeVector(item.vector),
  })));
}

function vector(...leading: number[]): number[] {
  const values = new Array<number>(PIN_EMBEDDING_DIMENSIONS).fill(0);
  leading.forEach((value, index) => {
    values[index] = value;
  });
  return values;
}

// ---------- fake appliance ----------

type Engine = "decisions" | "none" | "similarity";
interface Call {
  body: Record<string, any> | null;
  path: string;
}

function fakeAppliance(options: {
  decide?: (body: Record<string, any>, init?: RequestInit) => Response | Promise<Response>;
  embed?: (text: string) => number[];
  engine: Engine;
  model?: string;
}) {
  const model = options.model ?? "mock";
  const calls: Call[] = [];
  const fetchFn = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    const raw = typeof init?.body === "string" ? init.body : "";
    const body = raw ? (JSON.parse(raw) as Record<string, any>) : null;
    const path = url.pathname.replace(/^\/v1/, "");
    calls.push({ body, path });
    if (url.origin !== new URL(BASE_URL).origin) return new Response("unexpected host", { status: 599 });
    if (path === "/models") {
      return Response.json({
        data: [
          { ...(options.engine === "decisions" ? { decisions: DECISIONS_EXTRA } : {}), id: model, type: "chat" },
          { id: EMBEDDING_MODEL, type: "embedding" },
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

function decideFor(match: string, probability: number) {
  return (body: Record<string, any>) => {
    const options = body.questions[0].options as string[];
    const choice = options.find((option) => option.includes(match)) ?? FILING_NONE_OPTION;
    // A normalized distribution: the rest of the mass spread over the other options.
    const probabilities = Object.fromEntries(options.map((option) => [option, option === choice ? probability : (1 - probability) / (options.length - 1)]));
    return Response.json({ decisions: [{ choice, id: "collection", probabilities }] });
  };
}

// ---------- requests ----------

function filingEnv(db: Database, overrides: Partial<CloudEnv> = {}): CloudEnv {
  return {
    AI_API_KEY: "sk-ai-test",
    AI_BASE_URL: BASE_URL,
    AI_EMBEDDING_MODEL: EMBEDDING_MODEL,
    AI_MODEL: "mock",
    ASSISTANT_ENABLED: "true",
    DB: sqliteD1(db),
    DEPLOYMENT_ENV: "staging",
    ...overrides,
  };
}

async function signIn(db: Database, env: CloudEnv, plan: "free" | "pro" = "pro") {
  insertUser(db, OWNER, plan);
  return (await seedCloudWebSessionForTests({ email: `${OWNER}@example.test`, id: OWNER, plan }, env)).cookie;
}

async function shot(env: CloudEnv, cookie: string, input: { batchId?: string; collectionId?: string; id: string; title: string }) {
  const response = await handleCloudApiRequest(new Request("https://pinar.test/api/shots", {
    body: JSON.stringify({
      ...(input.batchId ? { batch: { id: input.batchId, label: "Batch", startedAt: NOW } } : {}),
      ...(input.collectionId ? { collectionId: input.collectionId } : {}),
      id: input.id,
      image: VALID_PNG,
      page: { title: input.title, url: "https://example.test/new" },
      pins: [{ comment: `${input.title} pin`, number: 1 }],
    }),
    headers: { "content-type": "application/json", cookie },
    method: "POST",
  }), env);
  assert.equal(response.status, 201, await response.clone().text());
  return (await response.json()) as Record<string, any>;
}

function stored(db: Database, id: string) {
  return db.query("SELECT collection_id, filed_by, batch_id FROM sessions WHERE id = ?").get(id) as {
    batch_id: string | null;
    collection_id: string;
    filed_by: string | null;
  };
}

let appliance = fakeAppliance({ engine: "none" });

// Holds every caller until `count` of them are waiting, so captures that ask
// the engine run side by side.
function heldUntil(count: number) {
  const waiting: Array<() => void> = [];
  return () => new Promise<void>((resolve) => {
    waiting.push(resolve);
    if (waiting.length === count) waiting.forEach((done) => done());
  });
}

// Two first captures of `batchId` ("Race A" and "Race B") ask the engine
// together; A's answer (`answerA`) comes at once, B's (`answerB`) only after
// A's whole request is done, so A claims the batch and saves first, and B
// finds A's session when it reads the batch again after its choice.
// `beforeB` runs between the two.
async function raceFirstCaptures(
  env: CloudEnv,
  cookie: string,
  input: {
    answerA: (body: Record<string, any>) => Response;
    answerB: (body: Record<string, any>) => Response;
    batchId: string;
    beforeB?: () => void | Promise<void>;
  },
) {
  const bothAsked = heldUntil(2);
  let releaseB = () => {};
  const bReleased = new Promise<void>((resolve) => {
    releaseB = resolve;
  });
  appliance = fakeAppliance({
    decide: async (body) => {
      await bothAsked();
      if (!String(body.state).includes("Race B")) return input.answerA(body);
      await bReleased;
      return input.answerB(body);
    },
    engine: "decisions",
  });
  const first = shot(env, cookie, { batchId: input.batchId, id: `${input.batchId}_a`, title: "Race A" });
  const second = shot(env, cookie, { batchId: input.batchId, id: `${input.batchId}_b`, title: "Race B" });
  const a = await first;
  await input.beforeB?.();
  releaseB();
  return { a, b: await second };
}

function claimOf(db: Database, batchId: string) {
  return (db.query("SELECT filing_collection_id FROM batches WHERE id = ?").get(batchId) as { filing_collection_id: string | null }).filing_collection_id;
}

describe("cloud capture filing (POST /api/shots)", () => {
  beforeEach(() => {
    resetCloudMemoryStateForTests();
    resetRetrievalCapabilitiesCacheForTests();
    setCloudNowForTests(NOW);
    appliance = fakeAppliance({ engine: "none" });
    setCloudFilingFetchForTests(((input: RequestInfo | URL, init?: RequestInit) => appliance.fetch(input, init)) as typeof fetch);
  });

  afterEach(() => {
    setCloudFilingFetchForTests(null);
    resetRetrievalCapabilitiesCacheForTests();
    resetCloudMemoryStateForTests();
  });

  test("switch off: the body's collectionId is kept, no filing and no fetch", async () => {
    const db = migratedDatabase();
    try {
      const env = filingEnv(db);
      const cookie = await signIn(db, env);
      seedCollections(db);
      appliance = fakeAppliance({ decide: decideFor("Onboarding", 0.95), engine: "decisions" });

      const body = await shot(env, cookie, { collectionId: "col_checkout", id: "cloud_off_001", title: "Onboarding" });
      assert.equal(body.destination.collectionId, "col_checkout");
      assert.equal("filing" in body, false);
      assert.equal(appliance.calls.length, 0);
      assert.deepEqual(stored(db, "cloud_off_001"), { batch_id: null, collection_id: "col_checkout", filed_by: null });
    } finally {
      db.close();
    }
  });

  test("outside the gate (switch off, production without the hub key, no AI, no Pro) the switch on files in the Inbox with reason error, fetching nothing (A45)", async () => {
    // Mutation captured: ignoring the switch outside the gate keeps the body's Checkout.
    const variants: Array<{ name: string; overrides: Partial<CloudEnv>; plan: "free" | "pro" }> = [
      { name: "assistant switch off", overrides: { ASSISTANT_ENABLED: "false" }, plan: "pro" },
      // A46: production alone is not outside the gate; the gateway chain
      // without its key is.
      { name: "production with a gateway chain and no gateway key", overrides: { ASSISTANT_CHAIN: "gateway:anthropic/claude-haiku-5.5", DEPLOYMENT_ENV: "production" }, plan: "pro" },
      { name: "no AI configuration", overrides: { AI_API_KEY: undefined, AI_BASE_URL: undefined, AI_MODEL: undefined }, plan: "pro" },
      { name: "Free plan", overrides: {}, plan: "free" },
    ];
    for (const variant of variants) {
      resetCloudMemoryStateForTests();
      const db = migratedDatabase();
      try {
        const env = filingEnv(db, variant.overrides);
        const cookie = await signIn(db, env, variant.plan);
        seedCollections(db);
        await writeOwnerDeliveryPreferences(env, OWNER, { autoCaptureDestination: true });
        appliance = fakeAppliance({ decide: decideFor("Onboarding", 0.95), engine: "decisions" });

        const inbox = { collectionId: null, confidence: 0, engine: "none", reason: "error" };
        const body = await shot(env, cookie, { collectionId: "col_checkout", id: "cloud_gate_001", title: "Onboarding" });
        assert.equal(body.destination.collectionId, "col_inbox", variant.name);
        assert.deepEqual(body.filing, inbox, variant.name);
        assert.deepEqual(stored(db, "cloud_gate_001"), { batch_id: null, collection_id: "col_inbox", filed_by: null }, variant.name);

        // Not even an existing batch is followed: nothing of the filing runs.
        insertSession(db, { batchId: "batch_gate", collectionId: "col_checkout", createdAt: "2026-10-01T10:00:00.000Z", id: "cloud_gate_first", title: "First" });
        const batched = await shot(env, cookie, { batchId: "batch_gate", collectionId: "col_checkout", id: "cloud_gate_002", title: "Onboarding" });
        assert.equal(batched.destination.collectionId, "col_inbox", variant.name);
        assert.deepEqual(batched.filing, inbox, variant.name);
        assert.deepEqual(stored(db, "cloud_gate_002"), { batch_id: "batch_gate", collection_id: "col_inbox", filed_by: null }, variant.name);
        assert.equal(appliance.calls.length, 0, variant.name);
      } finally {
        db.close();
      }
    }
  });

  test("production with the appliance chain: the automatic destination uses decisions when the model declares it (A46)", async () => {
    const db = migratedDatabase();
    try {
      const env = filingEnv(db, { DEPLOYMENT_ENV: "production" });
      const cookie = await signIn(db, env);
      seedCollections(db);
      insertSession(db, { collectionId: "col_onboarding", createdAt: "2026-10-01T10:00:00.000Z", id: "prd_onb_1", title: "Welcome tour" });
      insertSession(db, { collectionId: "col_checkout", createdAt: "2026-10-02T10:00:00.000Z", id: "prd_chk_1", title: "Card form" });
      await writeOwnerDeliveryPreferences(env, OWNER, { autoCaptureDestination: true });
      appliance = fakeAppliance({ decide: decideFor("Shop / Onboarding", 0.9), engine: "decisions" });

      const body = await shot(env, cookie, { collectionId: "col_checkout", id: "prd_decided", title: "Onboarding step 1" });
      assert.equal(body.destination.collectionId, "col_onboarding");
      assert.deepEqual(body.filing, { collectionId: "col_onboarding", confidence: 0.9, engine: "decisions", reason: "chosen" });
      assert.equal(stored(db, "prd_decided").filed_by, "auto");
      // The engine is asked through the appliance (AI_BASE_URL).
      assert.ok(appliance.calls.some((call) => call.path === "/decisions"));
      for (const call of appliance.calls) assert.ok(call.path === "/models" || call.path === "/decisions", JSON.stringify(call.path));
    } finally {
      db.close();
    }
  });

  test("an explicit appliance chain without AI_MODEL: the automatic destination uses decisions when the link's model declares it (A46)", async () => {
    const db = migratedDatabase();
    try {
      const env = filingEnv(db, { AI_MODEL: undefined, ASSISTANT_CHAIN: "appliance:qwen3.8-27b", DEPLOYMENT_ENV: "production" });
      const cookie = await signIn(db, env);
      seedCollections(db);
      insertSession(db, { collectionId: "col_onboarding", createdAt: "2026-10-01T10:00:00.000Z", id: "prd_link_1", title: "Welcome tour" });
      insertSession(db, { collectionId: "col_checkout", createdAt: "2026-10-02T10:00:00.000Z", id: "prd_link_2", title: "Card form" });
      await writeOwnerDeliveryPreferences(env, OWNER, { autoCaptureDestination: true });
      appliance = fakeAppliance({ decide: decideFor("Shop / Onboarding", 0.9), engine: "decisions", model: "qwen3.8-27b" });

      const body = await shot(env, cookie, { collectionId: "col_checkout", id: "prd_link_shot", title: "Onboarding step 1" });
      assert.equal(body.destination.collectionId, "col_onboarding");
      assert.deepEqual(body.filing, { collectionId: "col_onboarding", confidence: 0.9, engine: "decisions", reason: "chosen" });
      assert.equal(stored(db, "prd_link_shot").filed_by, "auto");
      // The engine is asked through the appliance (AI_BASE_URL) with the
      // link's model.
      assert.ok(appliance.calls.some((call) => call.path === "/decisions"));
      for (const call of appliance.calls) assert.ok(call.path === "/models" || call.path === "/decisions", JSON.stringify(call.path));
    } finally {
      db.close();
    }
  });

  test("decisions: the chosen collection with the auto mark, the body's collectionId ignored", async () => {
    const db = migratedDatabase();
    try {
      const env = filingEnv(db);
      const cookie = await signIn(db, env);
      seedCollections(db);
      insertSession(db, { collectionId: "col_onboarding", createdAt: "2026-10-01T10:00:00.000Z", id: "cloud_seed_onb", title: "Welcome tour" });
      insertSession(db, { collectionId: "col_onboarding", createdAt: "2026-10-02T10:00:00.000Z", id: "cloud_seed_onb2", title: "Profile step" });
      insertSession(db, { collectionId: "col_checkout", createdAt: "2026-10-03T10:00:00.000Z", id: "cloud_seed_chk", title: "Card form" });
      await writeOwnerDeliveryPreferences(env, OWNER, { autoCaptureDestination: true });
      appliance = fakeAppliance({ decide: decideFor("Shop / Onboarding", 0.92), engine: "decisions" });

      const body = await shot(env, cookie, { collectionId: "col_checkout", id: "cloud_decided", title: "Onboarding step 3" });
      assert.equal(body.destination.collectionId, "col_onboarding");
      assert.deepEqual(body.filing, { collectionId: "col_onboarding", confidence: 0.92, engine: "decisions", reason: "chosen" });
      assert.equal(JSON.stringify(body).includes("sk-ai-test"), false);
      assert.equal(stored(db, "cloud_decided").filed_by, "auto");
      assert.equal(stored(db, "cloud_decided").collection_id, "col_onboarding");

      const decision = appliance.calls.find((call) => call.path === "/decisions")!;
      // The owner's collections only, the Inbox left out, project then collection order.
      assert.deepEqual(decision.body!.questions[0].options, ["Shop / Checkout", "Shop / Onboarding", "Docs / Checkout", FILING_NONE_OPTION]);
      // The most recent titles first.
      assert.match(decision.body!.instructions, /"Shop \/ Onboarding" \(recent captures: "Profile step", "Welcome tour"\)/);
      assert.match(decision.body!.instructions, /"Docs \/ Checkout" \(no captures yet\)/);
      assert.equal(appliance.calls.some((call) => call.path === "/embeddings"), false);
    } finally {
      db.close();
    }
  });

  test("decisions below the threshold: the Inbox without a mark", async () => {
    const db = migratedDatabase();
    try {
      const env = filingEnv(db);
      const cookie = await signIn(db, env);
      seedCollections(db);
      await writeOwnerDeliveryPreferences(env, OWNER, { autoCaptureDestination: true });
      appliance = fakeAppliance({ decide: decideFor("Shop / Onboarding", 0.5), engine: "decisions" });

      const body = await shot(env, cookie, { collectionId: "col_checkout", id: "cloud_unsure", title: "Other" });
      assert.equal(body.destination.collectionId, "col_inbox");
      assert.deepEqual(body.filing, { collectionId: null, confidence: 0.5, engine: "decisions", reason: "low_confidence" });
      assert.deepEqual(stored(db, "cloud_unsure"), { batch_id: null, collection_id: "col_inbox", filed_by: null });
    } finally {
      db.close();
    }
  });

  test("similarity with AI_EMBEDDING_MODEL: the closest centroid of the index", async () => {
    const db = migratedDatabase();
    try {
      const env = filingEnv(db);
      const cookie = await signIn(db, env);
      seedCollections(db);
      insertSession(db, { collectionId: "col_checkout", createdAt: "2026-10-01T10:00:00.000Z", id: "cloud_chk_1", title: "Card form" });
      insertSession(db, { collectionId: "col_onboarding", createdAt: "2026-10-02T10:00:00.000Z", id: "cloud_onb_1", title: "Welcome" });
      await indexSession(env, "cloud_chk_1", [{ vector: vector(1, 0) }, { vector: vector(0.9, 0.1) }]);
      // An entry of another model never enters a centroid.
      await indexSession(env, "cloud_onb_1", [{ vector: vector(0, 1) }, { model: "old-model", vector: vector(1, 0) }]);
      await writeOwnerDeliveryPreferences(env, OWNER, { autoCaptureDestination: true });
      appliance = fakeAppliance({ embed: (text) => (text.includes("Payment") ? vector(1, 0.05) : vector(0, 0, 1)), engine: "similarity" });

      const body = await shot(env, cookie, { collectionId: "col_onboarding", id: "cloud_similar", title: "Payment declined" });
      assert.equal(body.destination.collectionId, "col_checkout");
      assert.equal(body.filing.engine, "similarity");
      assert.equal(body.filing.reason, "chosen");
      assert.ok(body.filing.confidence > 0.95, String(body.filing.confidence));
      assert.equal(stored(db, "cloud_similar").filed_by, "auto");
      const embedding = appliance.calls.find((call) => call.path === "/embeddings")!;
      assert.equal(embedding.body!.model, EMBEDDING_MODEL);
      assert.equal(embedding.body!.prompt_name, "query");

      const far = await shot(env, cookie, { collectionId: "col_onboarding", id: "cloud_far", title: "Unrelated" });
      assert.equal(far.destination.collectionId, "col_inbox");
      assert.equal(far.filing.reason, "low_confidence");
      assert.equal(stored(db, "cloud_far").filed_by, null);
    } finally {
      db.close();
    }
  });

  test("a capture that enters an existing batch follows the batch's collection and mark without asking the engine", async () => {
    const db = migratedDatabase();
    try {
      const env = filingEnv(db);
      const cookie = await signIn(db, env);
      seedCollections(db);
      insertSession(db, { batchId: "batch_review", collectionId: "col_checkout", createdAt: "2026-10-01T10:00:00.000Z", id: "cloud_batch_1", title: "First" });
      insertSession(db, { batchId: "batch_inbox", collectionId: "col_inbox", createdAt: "2026-10-01T10:00:00.000Z", id: "cloud_batch_in", title: "First" });
      await writeOwnerDeliveryPreferences(env, OWNER, { autoCaptureDestination: true });
      appliance = fakeAppliance({ decide: decideFor("Shop / Onboarding", 0.95), engine: "decisions" });

      // The batch's most recent session is unmarked: so is the new capture.
      const body = await shot(env, cookie, { batchId: "batch_review", collectionId: "col_onboarding", id: "cloud_batch_2", title: "Onboarding" });
      assert.equal(body.destination.collectionId, "col_checkout");
      assert.deepEqual(body.filing, { collectionId: "col_checkout", confidence: 0, engine: "none", reason: "chosen" });
      assert.deepEqual(stored(db, "cloud_batch_2"), { batch_id: "batch_review", collection_id: "col_checkout", filed_by: null });
      assert.deepEqual(appliance.calls, [], "the batch rule reads no endpoint");

      const inInbox = await shot(env, cookie, { batchId: "batch_inbox", collectionId: "col_onboarding", id: "cloud_batch_3", title: "Onboarding" });
      assert.equal(inInbox.destination.collectionId, "col_inbox");
      assert.deepEqual(stored(db, "cloud_batch_3"), { batch_id: "batch_inbox", collection_id: "col_inbox", filed_by: null });
      assert.deepEqual(appliance.calls, []);

      // A new batch is decided by the engine, and its next capture inherits
      // the "auto" mark of that session.
      const fresh = await shot(env, cookie, { batchId: "batch_new", collectionId: "col_checkout", id: "cloud_batch_4", title: "Onboarding" });
      assert.equal(fresh.destination.collectionId, "col_onboarding");
      assert.equal(fresh.filing.engine, "decisions");
      assert.equal(stored(db, "cloud_batch_4").filed_by, "auto");
      assert.equal(appliance.engineCalls().length, 1);
      const next = await shot(env, cookie, { batchId: "batch_new", collectionId: "col_checkout", id: "cloud_batch_5", title: "Checkout card" });
      assert.deepEqual(next.filing, { collectionId: "col_onboarding", confidence: 0, engine: "none", reason: "chosen" });
      assert.deepEqual(stored(db, "cloud_batch_5"), { batch_id: "batch_new", collection_id: "col_onboarding", filed_by: "auto" });
      assert.equal(appliance.engineCalls().length, 1, "the batch rule asks no engine");
    } finally {
      db.close();
    }
  });

  test("an existing batch is followed with the endpoint down", async () => {
    const db = migratedDatabase();
    try {
      const env = filingEnv(db);
      const cookie = await signIn(db, env);
      seedCollections(db);
      insertSession(db, { batchId: "batch_down", collectionId: "col_checkout", createdAt: "2026-10-01T10:00:00.000Z", id: "cloud_down_1", title: "First" });
      await writeOwnerDeliveryPreferences(env, OWNER, { autoCaptureDestination: true });
      const down = fakeAppliance({ engine: "none" });
      appliance = {
        ...down,
        fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
          await down.fetch(input, init);
          throw new TypeError("connect ECONNREFUSED");
        }) as typeof fetch,
      };

      const body = await shot(env, cookie, { batchId: "batch_down", collectionId: "col_onboarding", id: "cloud_down_2", title: "Second" });
      assert.equal(body.destination.collectionId, "col_checkout");
      assert.deepEqual(body.filing, { collectionId: "col_checkout", confidence: 0, engine: "none", reason: "chosen" });
      assert.equal(down.calls.length, 0, "the batch rule never reaches the endpoint");

      // Outside a batch: no decisions extra is read, so AI_EMBEDDING_MODEL
      // gives similarity, whose embedding request fails: the Inbox.
      const alone = await shot(env, cookie, { collectionId: "col_onboarding", id: "cloud_down_3", title: "Third" });
      assert.equal(alone.destination.collectionId, "col_inbox");
      assert.deepEqual(alone.filing, { collectionId: null, confidence: 0, engine: "similarity", reason: "error" });
      assert.ok(down.calls.length > 0, "the detection was tried");
    } finally {
      db.close();
    }
  });

  test("without an engine: the Inbox with reason error", async () => {
    const db = migratedDatabase();
    try {
      const env = filingEnv(db, { AI_EMBEDDING_MODEL: undefined });
      const cookie = await signIn(db, env);
      seedCollections(db);
      await writeOwnerDeliveryPreferences(env, OWNER, { autoCaptureDestination: true, captureDestination: { collectionId: "col_checkout", projectId: "prj_shop" } });
      appliance = fakeAppliance({ engine: "none" });

      const body = await shot(env, cookie, { collectionId: "col_checkout", id: "cloud_no_engine", title: "Anything" });
      assert.equal(body.destination.collectionId, "col_inbox");
      assert.deepEqual(body.filing, { collectionId: null, confidence: 0, engine: "none", reason: "error" });
      assert.equal(stored(db, "cloud_no_engine").filed_by, null);
    } finally {
      db.close();
    }
  });

  test("an engine that never answers: the Inbox before 3.5 s with reason timeout", async () => {
    const db = migratedDatabase();
    try {
      const env = filingEnv(db);
      const cookie = await signIn(db, env);
      seedCollections(db);
      await writeOwnerDeliveryPreferences(env, OWNER, { autoCaptureDestination: true });
      appliance = fakeAppliance({ decide: () => new Promise<Response>(() => {}), engine: "decisions" });

      const startedAt = Date.now();
      const body = await shot(env, cookie, { collectionId: "col_checkout", id: "cloud_hang", title: "Anything" });
      const elapsed = Date.now() - startedAt;
      assert.ok(elapsed < 3_500, `took ${elapsed} ms`);
      assert.equal(body.destination.collectionId, "col_inbox");
      assert.deepEqual(body.filing, { collectionId: null, confidence: 0, engine: "decisions", reason: "timeout" });
      assert.equal(stored(db, "cloud_hang").filed_by, null);
    } finally {
      db.close();
    }
  });

  test("a re-upload of the same id replays the stored decision (F4d)", async () => {
    const db = migratedDatabase();
    try {
      const env = filingEnv(db);
      const cookie = await signIn(db, env);
      seedCollections(db);
      await writeOwnerDeliveryPreferences(env, OWNER, { autoCaptureDestination: true });
      let probability = 0.92;
      appliance = fakeAppliance({ decide: (body) => decideFor("Shop / Onboarding", probability)(body), engine: "decisions" });

      await shot(env, cookie, { id: "cloud_again", title: "Onboarding" });
      assert.deepEqual(stored(db, "cloud_again"), { batch_id: null, collection_id: "col_onboarding", filed_by: "auto" });

      // F4d: the engine is only called by the run that created the
      // reservation. A re-upload of a settled capture replays the stored
      // choice — the lower probability is never even asked.
      probability = 0.4;
      await shot(env, cookie, { id: "cloud_again", title: "Onboarding" });
      assert.deepEqual(stored(db, "cloud_again"), { batch_id: null, collection_id: "col_onboarding", filed_by: "auto" });

      probability = 0.92;
      await shot(env, cookie, { id: "cloud_again", title: "Onboarding" });
      assert.equal(stored(db, "cloud_again").filed_by, "auto");
      await writeOwnerDeliveryPreferences(env, OWNER, { autoCaptureDestination: false });
      await shot(env, cookie, { collectionId: "col_onboarding", id: "cloud_again", title: "Onboarding" });
      assert.deepEqual(stored(db, "cloud_again"), { batch_id: null, collection_id: "col_onboarding", filed_by: null });
    } finally {
      db.close();
    }
  });
});

describe("cloud capture filing keeps a batch whole (A36)", () => {
  beforeEach(() => {
    resetCloudMemoryStateForTests();
    resetRetrievalCapabilitiesCacheForTests();
    setCloudNowForTests(NOW);
    appliance = fakeAppliance({ engine: "none" });
    setCloudFilingFetchForTests(((input: RequestInfo | URL, init?: RequestInit) => appliance.fetch(input, init)) as typeof fetch);
  });

  afterEach(() => {
    afterFirst = null;
    setCloudFilingFetchForTests(null);
    resetRetrievalCapabilitiesCacheForTests();
    resetCloudMemoryStateForTests();
  });

  async function filingSetup(db: Database) {
    const env = filingEnv(db);
    const cookie = await signIn(db, env);
    seedCollections(db);
    await writeOwnerDeliveryPreferences(env, OWNER, { autoCaptureDestination: true });
    return { cookie, env };
  }

  test("two first captures that arrive together: the second follows the collection the first claimed", async () => {
    // A saves before B's answer, so B follows A's session; the claim itself
    // decides in "a first capture that claimed but has not saved yet" below.
    const db = migratedDatabase();
    try {
      const { cookie, env } = await filingSetup(db);
      const { a, b } = await raceFirstCaptures(env, cookie, {
        answerA: decideFor("Shop / Checkout", 0.95),
        answerB: decideFor("Shop / Onboarding", 0.95),
        batchId: "batch_race",
      });
      assert.deepEqual(a.filing, { collectionId: "col_checkout", confidence: 0.95, engine: "decisions", reason: "chosen" });
      assert.equal(b.destination.collectionId, "col_checkout");
      assert.deepEqual(b.filing, { collectionId: "col_checkout", confidence: 0, engine: "none", reason: "chosen" });
      assert.deepEqual(stored(db, "batch_race_a"), { batch_id: "batch_race", collection_id: "col_checkout", filed_by: "auto" });
      assert.deepEqual(stored(db, "batch_race_b"), { batch_id: "batch_race", collection_id: "col_checkout", filed_by: "auto" });
      assert.equal(claimOf(db, "batch_race"), "col_checkout");
      assert.equal(appliance.engineCalls().length, 2, "both found the batch empty and asked the engine");
    } finally {
      db.close();
    }
  });

  test("when the Inbox won the batch, the second capture follows it unmarked", async () => {
    const db = migratedDatabase();
    try {
      const { cookie, env } = await filingSetup(db);
      const { a, b } = await raceFirstCaptures(env, cookie, {
        answerA: decideFor("No such collection", 0.95),
        answerB: decideFor("Shop / Onboarding", 0.95),
        batchId: "batch_inbox_race",
      });
      assert.equal(a.destination.collectionId, "col_inbox");
      assert.equal(a.filing.reason, "low_confidence");
      assert.equal(b.destination.collectionId, "col_inbox");
      assert.deepEqual(b.filing, { collectionId: null, confidence: 0, engine: "none", reason: "chosen" });
      assert.deepEqual(stored(db, "batch_inbox_race_b"), { batch_id: "batch_inbox_race", collection_id: "col_inbox", filed_by: null });
      assert.equal(claimOf(db, "batch_inbox_race"), "col_inbox");
    } finally {
      db.close();
    }
  });

  test("a claimed collection deleted before the second capture saves leaves it in the Inbox, unmarked", async () => {
    const db = migratedDatabase();
    try {
      const { cookie, env } = await filingSetup(db);
      const { b } = await raceFirstCaptures(env, cookie, {
        answerA: decideFor("Shop / Checkout", 0.95),
        answerB: decideFor("Shop / Onboarding", 0.95),
        batchId: "batch_gone",
        beforeB: () => {
          db.query("UPDATE sessions SET collection_id = 'col_inbox' WHERE collection_id = 'col_checkout'").run();
          db.query("DELETE FROM collections WHERE id = 'col_checkout'").run();
        },
      });
      assert.equal(b.destination.collectionId, "col_inbox");
      // The deletion moved A to the Inbox before B's answer: B follows A's
      // session there, as the batch rule does (reason "chosen"). The claim of
      // a collection gone before the save: "a claimed collection deleted
      // while the first capture has not saved" below.
      assert.deepEqual(b.filing, { collectionId: null, confidence: 0, engine: "none", reason: "chosen" });
      assert.deepEqual(stored(db, "batch_gone_b"), { batch_id: "batch_gone", collection_id: "col_inbox", filed_by: null });
    } finally {
      db.close();
    }
  });

  test("a batch with a session follows its latest session, not the claim, so a move still corrects it", async () => {
    // Mutation captured: claiming when the batch rule applied sends C back to the claimed Checkout.
    const db = migratedDatabase();
    try {
      const { cookie, env } = await filingSetup(db);
      appliance = fakeAppliance({ decide: decideFor("Shop / Checkout", 0.95), engine: "decisions" });
      await shot(env, cookie, { batchId: "batch_moved", id: "moved_first", title: "Checkout" });
      assert.equal(claimOf(db, "batch_moved"), "col_checkout");
      // The person moves the first capture: the move clears its mark.
      db.query("UPDATE sessions SET collection_id = 'col_onboarding', filed_by = NULL WHERE id = 'moved_first'").run();

      const next = await shot(env, cookie, { batchId: "batch_moved", id: "moved_next", title: "Checkout again" });
      assert.equal(next.destination.collectionId, "col_onboarding");
      assert.deepEqual(next.filing, { collectionId: "col_onboarding", confidence: 0, engine: "none", reason: "chosen" });
      assert.deepEqual(stored(db, "moved_next"), { batch_id: "batch_moved", collection_id: "col_onboarding", filed_by: null });
      assert.equal(appliance.engineCalls().length, 1);
    } finally {
      db.close();
    }
  });

  test("another owner's batch is refused before any claim", async () => {
    const db = migratedDatabase();
    try {
      const { cookie, env } = await filingSetup(db);
      db.query("INSERT INTO batches (id, user_id, label, started_at) VALUES ('batch_foreign', 'usr_other', 'Theirs', ?)").run(NOW);
      appliance = fakeAppliance({ decide: decideFor("Shop / Checkout", 0.95), engine: "decisions" });
      const response = await handleCloudApiRequest(new Request("https://pinar.test/api/shots", {
        body: JSON.stringify({
          batch: { id: "batch_foreign", label: "Theirs", startedAt: NOW },
          id: "foreign_batch_shot",
          image: VALID_PNG,
          page: { title: "Checkout", url: "https://example.test/new" },
          pins: [{ comment: "Checkout pin", number: 1 }],
        }),
        headers: { "content-type": "application/json", cookie },
        method: "POST",
      }), env);
      assert.equal(response.status, 409);
      assert.equal(claimOf(db, "batch_foreign"), null);
      assert.equal(appliance.engineCalls().length, 0);
    } finally {
      db.close();
    }
  });

  test("without D1, the in-memory batches keep the same rule", async () => {
    const env: CloudEnv = { AI_API_KEY: "sk-ai-test", AI_BASE_URL: BASE_URL, AI_MODEL: "mock", ASSISTANT_ENABLED: "true", DEPLOYMENT_ENV: "staging" };
    const { cookie } = await seedCloudWebSessionForTests({ email: "mem@example.test", id: OWNER, plan: "pro" }, env);
    const call = async (path: string, body: unknown) => {
      const response = await handleCloudApiRequest(new Request(`https://pinar.test${path}`, {
        body: JSON.stringify(body),
        headers: { "content-type": "application/json", cookie },
        method: "POST",
      }), env);
      assert.ok(response.status < 300, `${path}: ${response.status}`);
      return (await response.json()) as Record<string, any>;
    };
    const shop = (await call("/api/projects", { name: "Shop" })).project.id as string;
    const checkout = (await call(`/api/projects/${shop}/collections`, { name: "Checkout" })).collection.id as string;
    await call(`/api/projects/${shop}/collections`, { name: "Onboarding" });
    await writeOwnerDeliveryPreferences(env, OWNER, { autoCaptureDestination: true });

    const { a, b } = await raceFirstCaptures(env, cookie, {
      answerA: decideFor("Shop / Checkout", 0.95),
      answerB: decideFor("Shop / Onboarding", 0.95),
      batchId: "batch_memory",
    });
    assert.equal(a.destination.collectionId, checkout);
    assert.equal(b.destination.collectionId, checkout);
    assert.deepEqual(b.filing, { collectionId: checkout, confidence: 0, engine: "none", reason: "chosen" });
    const session = await handleCloudApiRequest(new Request("https://pinar.test/api/sessions/batch_memory_b", { headers: { cookie } }), env);
    const saved = ((await session.json()) as { session: Record<string, unknown> }).session;
    assert.equal(saved.collectionId, checkout);
    assert.equal(saved.filedBy, "auto");
  });

  test("a re-upload of the batch's only session replays the stored decision, and the batch stays claimed (F4d)", async () => {
    // F4d: the engine is only called by the run that created the
    // reservation. The re-upload of the settled capture replays the stored
    // choice (Checkout), without the engine and without a charge, so the
    // batch keeps the destination the first capture claimed.
    const db = migratedDatabase();
    try {
      const { cookie, env } = await filingSetup(db);
      appliance = fakeAppliance({ decide: decideFor("Shop / Checkout", 0.95), engine: "decisions" });
      const first = await shot(env, cookie, { batchId: "batch_again", id: "batch_again_only", title: "Checkout" });
      assert.equal(first.destination.collectionId, "col_checkout");
      assert.equal(claimOf(db, "batch_again"), "col_checkout");

      // The engine would now decide Onboarding: the re-upload must not ask it.
      appliance = fakeAppliance({ decide: decideFor("Shop / Onboarding", 0.95), engine: "decisions" });
      const again = await shot(env, cookie, { batchId: "batch_again", id: "batch_again_only", title: "Onboarding, changed" });
      assert.equal(appliance.engineCalls().length, 0, "the re-upload does not call the engine again");
      assert.equal(again.destination.collectionId, "col_checkout");
      assert.deepEqual(again.filing, { collectionId: "col_checkout", confidence: 0.95, engine: "decisions", reason: "chosen" });
      assert.deepEqual(stored(db, "batch_again_only"), { batch_id: "batch_again", collection_id: "col_checkout", filed_by: "auto" });
      assert.equal(claimOf(db, "batch_again"), "col_checkout");

      // The batch's next capture follows the session there, asking nothing.
      appliance = fakeAppliance({ decide: decideFor("Shop / Checkout", 0.95), engine: "decisions" });
      const next = await shot(env, cookie, { batchId: "batch_again", id: "batch_again_next", title: "Checkout" });
      assert.equal(next.destination.collectionId, "col_checkout");
      assert.equal(appliance.engineCalls().length, 0);
    } finally {
      db.close();
    }
  });

  test("a move made while another first capture waits for the engine corrects that capture too", async () => {
    // Mutation captured: without reading the batch again, B follows the stale claim (Checkout).
    const db = migratedDatabase();
    try {
      const { cookie, env } = await filingSetup(db);
      const { a, b } = await raceFirstCaptures(env, cookie, {
        answerA: decideFor("Shop / Checkout", 0.95),
        // B's own answer is a third collection, so following A shows.
        answerB: decideFor("Docs / Checkout", 0.95),
        batchId: "batch_corrected",
        beforeB: () => {
          // The person moves A while B waits: the move clears its mark.
          db.query("UPDATE sessions SET collection_id = 'col_onboarding', filed_by = NULL WHERE id = 'batch_corrected_a'").run();
        },
      });
      assert.equal(a.destination.collectionId, "col_checkout");
      assert.equal(b.destination.collectionId, "col_onboarding");
      assert.deepEqual(b.filing, { collectionId: "col_onboarding", confidence: 0, engine: "none", reason: "chosen" });
      assert.deepEqual(stored(db, "batch_corrected_b"), { batch_id: "batch_corrected", collection_id: "col_onboarding", filed_by: null });
      assert.equal(appliance.engineCalls().length, 2, "both found the batch empty and asked the engine");
    } finally {
      db.close();
    }
  });

  // A first capture A that claimed its batch is held before its session is
  // saved (its screenshot upload waits), while B, which also found the batch
  // empty, gets its answer: B reads no session and meets A's claim.
  async function claimWhileFirstUnsaved(db: Database, input: { batchId: string; beforeB?: () => void }) {
    const { cookie, env } = await filingSetup(db);
    let release = () => {};
    let reached = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const atUpload = new Promise<void>((resolve) => {
      reached = resolve;
    });
    const heldId = `${input.batchId}_a`;
    const bucket = {
      async delete() {},
      async get() {
        return null;
      },
      async head() {
        return null;
      },
      async put(key: string) {
        if (key.includes(heldId)) {
          reached();
          await gate;
        }
        return null;
      },
    } as unknown as NonNullable<CloudEnv["PINAR_BUCKET"]>;
    const heldEnv: CloudEnv = { ...env, PINAR_BUCKET: bucket };
    const bothAsked = heldUntil(2);
    appliance = fakeAppliance({
      decide: async (body) => {
        await bothAsked();
        if (!String(body.state).includes("Race B")) return decideFor("Shop / Checkout", 0.95)(body);
        await atUpload;
        input.beforeB?.();
        return decideFor("Shop / Onboarding", 0.95)(body);
      },
      engine: "decisions",
    });
    const first = handleCloudApiRequest(new Request("https://pinar.test/api/shots", {
      body: JSON.stringify({
        batch: { id: input.batchId, label: "Batch", startedAt: NOW },
        id: heldId,
        image: VALID_PNG,
        page: { title: "Race A", url: "https://example.test/new" },
        pins: [{ comment: "Race A pin", number: 1 }],
      }),
      headers: { "content-type": "application/json", cookie },
      method: "POST",
    }), heldEnv);
    let b: Record<string, any>;
    try {
      b = await shot(heldEnv, cookie, { batchId: input.batchId, id: `${input.batchId}_b`, title: "Race B" });
    } finally {
      release();
      // A settles before the test goes on, also when B's request failed, so
      // it never runs on after the database is closed.
      await first.catch(() => null);
    }
    return { a: await first, b };
  }

  test("a first capture that claimed but has not saved yet: the second follows its claim", async () => {
    // Mutation captured: an UPDATE without "IS NULL" lets B overwrite the claim and keep Onboarding.
    // Mutation captured: ignoring the value read back files B in Onboarding, splitting the batch.
    const db = migratedDatabase();
    try {
      const { a, b } = await claimWhileFirstUnsaved(db, { batchId: "batch_unsaved" });
      assert.equal(b.destination.collectionId, "col_checkout");
      assert.deepEqual(b.filing, { collectionId: "col_checkout", confidence: 0, engine: "none", reason: "chosen" });
      assert.equal(a.status, 201);
      assert.deepEqual(stored(db, "batch_unsaved_a"), { batch_id: "batch_unsaved", collection_id: "col_checkout", filed_by: "auto" });
      assert.deepEqual(stored(db, "batch_unsaved_b"), { batch_id: "batch_unsaved", collection_id: "col_checkout", filed_by: "auto" });
      assert.equal(claimOf(db, "batch_unsaved"), "col_checkout");
      assert.equal(appliance.engineCalls().length, 2);
    } finally {
      db.close();
    }
  });

  test("a claimed collection deleted while the first capture has not saved leaves the second in the Inbox, unmarked", async () => {
    const db = migratedDatabase();
    try {
      const { b } = await claimWhileFirstUnsaved(db, {
        batchId: "batch_claim_gone",
        beforeB: () => {
          db.query("DELETE FROM collections WHERE id = 'col_checkout'").run();
        },
      });
      assert.equal(b.destination.collectionId, "col_inbox");
      assert.deepEqual(b.filing, { collectionId: null, confidence: 0, engine: "none", reason: "error" });
      assert.deepEqual(stored(db, "batch_claim_gone_b"), { batch_id: "batch_claim_gone", collection_id: "col_inbox", filed_by: null });
      // A's own save, into the collection deleted under it, is not what this test is about.
    } finally {
      db.close();
    }
  });

  test("without D1, a re-upload of the batch's only session replays the stored decision (F4d)", async () => {
    const env: CloudEnv = { AI_API_KEY: "sk-ai-test", AI_BASE_URL: BASE_URL, AI_MODEL: "mock", ASSISTANT_ENABLED: "true", DEPLOYMENT_ENV: "staging" };
    const { cookie } = await seedCloudWebSessionForTests({ email: "mem-again@example.test", id: OWNER, plan: "pro" }, env);
    const call = async (path: string, body: unknown) => {
      const response = await handleCloudApiRequest(new Request(`https://pinar.test${path}`, {
        body: JSON.stringify(body),
        headers: { "content-type": "application/json", cookie },
        method: "POST",
      }), env);
      assert.ok(response.status < 300, `${path}: ${response.status}`);
      return (await response.json()) as Record<string, any>;
    };
    const shop = (await call("/api/projects", { name: "Shop" })).project.id as string;
    const checkout = (await call(`/api/projects/${shop}/collections`, { name: "Checkout" })).collection.id as string;
    await writeOwnerDeliveryPreferences(env, OWNER, { autoCaptureDestination: true });

    appliance = fakeAppliance({ decide: decideFor("Shop / Checkout", 0.95), engine: "decisions" });
    assert.equal((await shot(env, cookie, { batchId: "batch_memory_again", id: "memory_again", title: "Checkout" })).destination.collectionId, checkout);
    // F4d: the engine is only called by the run that created the
    // reservation. The re-upload replays the stored choice (Checkout),
    // without asking the engine — which would now decide Onboarding.
    appliance = fakeAppliance({ decide: decideFor("Shop / Onboarding", 0.95), engine: "decisions" });
    const reuploaded = await shot(env, cookie, { batchId: "batch_memory_again", id: "memory_again", title: "Onboarding" });
    assert.equal(appliance.engineCalls().length, 0, "the re-upload does not call the engine again");
    assert.equal(reuploaded.destination.collectionId, checkout);
    // The batch's next capture follows the session there, asking nothing.
    appliance = fakeAppliance({ decide: decideFor("Shop / Onboarding", 0.95), engine: "decisions" });
    assert.equal((await shot(env, cookie, { batchId: "batch_memory_again", id: "memory_next", title: "Checkout" })).destination.collectionId, checkout);
  });

  // The workspace's routes, as the browser sends them.
  function webCall(env: CloudEnv, cookie: string, path: string, init: { body?: unknown; method: string }) {
    return handleCloudApiRequest(new Request(`https://pinar.test${path}`, {
      ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
      headers: { cookie, "content-type": "application/json", origin: "https://pinar.test" },
      method: init.method,
    }), env);
  }

  function moveTo(env: CloudEnv, cookie: string, sessionId: string, collectionId: string) {
    return webCall(env, cookie, `/api/sessions/${sessionId}/move`, { body: { collectionId }, method: "POST" });
  }

  function claims(db: Database) {
    return db.query("SELECT id, user_id, filing_collection_id FROM batches ORDER BY id").all();
  }

  test("moving a batch session updates the batch's claim, in the move's own D1 batch", async () => {
    // Mutation captured: a move that leaves the claim alone keeps Checkout.
    const db = migratedDatabase();
    try {
      const { cookie, env } = await filingSetup(db);
      // Every D1 batch, as the list of its statements' SQL.
      const batches: string[][] = [];
      const database = env.DB!;
      const recorded: CloudEnv = {
        ...env,
        DB: {
          batch(statements) {
            batches.push(statements.map((statement) => (statement as unknown as { sql: string }).sql));
            return database.batch(statements);
          },
          prepare(query: string) {
            return Object.assign(database.prepare(query), { sql: query.replace(/\s+/g, " ").trim() });
          },
        },
      };
      appliance = fakeAppliance({ decide: decideFor("Shop / Checkout", 0.95), engine: "decisions" });
      await shot(env, cookie, { batchId: "batch_claim_moves", id: "claim_moves_a", title: "Checkout" });
      assert.equal(claimOf(db, "batch_claim_moves"), "col_checkout");

      assert.equal((await moveTo(recorded, cookie, "claim_moves_a", "col_onboarding")).status, 200);
      assert.deepEqual(stored(db, "claim_moves_a"), { batch_id: "batch_claim_moves", collection_id: "col_onboarding", filed_by: null });
      assert.equal(claimOf(db, "batch_claim_moves"), "col_onboarding");
      const moveBatch = batches.find((sqls) => sqls.some((sql) => sql.startsWith("UPDATE sessions SET collection_id")));
      assert.ok(moveBatch, "the move runs in a D1 batch");
      assert.ok(moveBatch.some((sql) => sql.startsWith("UPDATE batches SET filing_collection_id")), "the claim is updated in the same batch");

      // To the Inbox as well: the claim is where the batch is now.
      assert.equal((await moveTo(env, cookie, "claim_moves_a", "col_inbox")).status, 200);
      assert.equal(claimOf(db, "batch_claim_moves"), "col_inbox");
    } finally {
      db.close();
    }
  });

  test("a move writes no claim for a session outside a batch, nor for a batch with no claim yet", async () => {
    // Mutation captured: without "IS NOT NULL" a batch with no claim gets one from a move.
    const db = migratedDatabase();
    try {
      const { cookie, env } = await filingSetup(db);
      appliance = fakeAppliance({ decide: decideFor("Shop / Checkout", 0.95), engine: "decisions" });
      await shot(env, cookie, { batchId: "batch_other", id: "other_batch_a", title: "Checkout" });
      await shot(env, cookie, { id: "no_batch", title: "Checkout" });
      const before = claims(db);
      assert.equal((await moveTo(env, cookie, "no_batch", "col_onboarding")).status, 200);
      assert.deepEqual(claims(db), before);

      // With the switch off nothing claims the batch.
      await writeOwnerDeliveryPreferences(env, OWNER, { autoCaptureDestination: false });
      await shot(env, cookie, { batchId: "batch_unclaimed", collectionId: "col_checkout", id: "unclaimed_a", title: "Checkout" });
      assert.equal(claimOf(db, "batch_unclaimed"), null);
      assert.equal((await moveTo(env, cookie, "unclaimed_a", "col_onboarding")).status, 200);
      assert.equal(claimOf(db, "batch_unclaimed"), null);
      assert.equal(claimOf(db, "batch_other"), "col_checkout");
    } finally {
      db.close();
    }
  });

  test("deleting a collection, or the project holding it, sends the claims of its batches to the Inbox", async () => {
    // Mutation captured: a deletion that leaves the claims alone keeps the deleted collection.
    const db = migratedDatabase();
    try {
      const { cookie, env } = await filingSetup(db);
      appliance = fakeAppliance({ decide: decideFor("Shop / Checkout", 0.95), engine: "decisions" });
      await shot(env, cookie, { batchId: "batch_deleted", id: "deleted_a", title: "Checkout" });
      appliance = fakeAppliance({ decide: decideFor("Shop / Onboarding", 0.95), engine: "decisions" });
      await shot(env, cookie, { batchId: "batch_project", id: "project_a", title: "Onboarding" });
      assert.equal(claimOf(db, "batch_deleted"), "col_checkout");
      assert.equal(claimOf(db, "batch_project"), "col_onboarding");

      assert.equal((await webCall(env, cookie, "/api/collections/col_checkout", { method: "DELETE" })).status, 200);
      assert.equal(stored(db, "deleted_a").collection_id, "col_inbox");
      assert.equal(claimOf(db, "batch_deleted"), "col_inbox");
      assert.equal(claimOf(db, "batch_project"), "col_onboarding");

      assert.equal((await webCall(env, cookie, "/api/projects/prj_shop", { method: "DELETE" })).status, 200);
      assert.equal(stored(db, "project_a").collection_id, "col_inbox");
      assert.equal(claimOf(db, "batch_project"), "col_inbox");
    } finally {
      db.close();
    }
  });

  test("a move or a deletion never rewrites another owner's batch claim", async () => {
    // Mutation captured: without the owner filter on batches, usr_other's claim follows the move.
    const db = migratedDatabase();
    try {
      const { cookie, env } = await filingSetup(db);
      db.query("INSERT INTO batches (id, user_id, label, started_at, filing_collection_id) VALUES ('batch_theirs', 'usr_other', 'Theirs', ?, 'col_other')").run(NOW);
      // A session of the owner that names the other owner's batch (the batch row stays theirs).
      insertSession(db, { batchId: "batch_theirs", collectionId: "col_checkout", createdAt: NOW, id: "forged_batch", title: "Checkout" });
      assert.equal((await moveTo(env, cookie, "forged_batch", "col_onboarding")).status, 200);
      assert.equal(stored(db, "forged_batch").collection_id, "col_onboarding");
      assert.deepEqual(claims(db), [{ filing_collection_id: "col_other", id: "batch_theirs", user_id: "usr_other" }]);
      assert.equal((await webCall(env, cookie, "/api/collections/col_onboarding", { method: "DELETE" })).status, 200);
      assert.equal(stored(db, "forged_batch").collection_id, "col_inbox");
      assert.deepEqual(claims(db), [{ filing_collection_id: "col_other", id: "batch_theirs", user_id: "usr_other" }]);
    } finally {
      db.close();
    }
  });

  test("without D1, a move updates the in-memory claim: a capture into the emptied batch follows it", async () => {
    // Mutation captured: a memory move that leaves the claim alone sends the next capture to Checkout.
    const env: CloudEnv = { AI_API_KEY: "sk-ai-test", AI_BASE_URL: BASE_URL, AI_MODEL: "mock", ASSISTANT_ENABLED: "true", DEPLOYMENT_ENV: "staging" };
    const { cookie } = await seedCloudWebSessionForTests({ email: "mem-move@example.test", id: OWNER, plan: "pro" }, env);
    const created = async (path: string, body: unknown) => {
      const response = await webCall(env, cookie, path, { body, method: "POST" });
      assert.ok(response.status < 300, `${path}: ${response.status}`);
      return (await response.json()) as Record<string, any>;
    };
    const shop = (await created("/api/projects", { name: "Shop" })).project.id as string;
    const checkout = (await created(`/api/projects/${shop}/collections`, { name: "Checkout" })).collection.id as string;
    const onboarding = (await created(`/api/projects/${shop}/collections`, { name: "Onboarding" })).collection.id as string;
    await created(`/api/projects/${shop}/collections`, { name: "Research" });
    await writeOwnerDeliveryPreferences(env, OWNER, { autoCaptureDestination: true });

    appliance = fakeAppliance({ decide: decideFor("Shop / Checkout", 0.95), engine: "decisions" });
    assert.equal((await shot(env, cookie, { batchId: "batch_memory_move", id: "memory_move_a", title: "Checkout" })).destination.collectionId, checkout);
    assert.equal((await moveTo(env, cookie, "memory_move_a", onboarding)).status, 200);
    // The batch loses its only session; its claim remains, and is where A went.
    assert.equal((await webCall(env, cookie, "/api/history/memory_move_a", { method: "DELETE" })).status, 200);

    appliance = fakeAppliance({ decide: decideFor("Shop / Research", 0.95), engine: "decisions" });
    const next = await shot(env, cookie, { batchId: "batch_memory_move", id: "memory_move_b", title: "Research" });
    assert.equal(next.destination.collectionId, onboarding);
    assert.deepEqual(next.filing, { collectionId: onboarding, confidence: 0, engine: "none", reason: "chosen" });
  });

  // POST /api/history as the extension sends it without a screenshot: the
  // same id, and the batch when there is one, in `collectionId`.
  function historySave(env: CloudEnv, cookie: string, input: { batchId?: string; collectionId: string; id: string; title: string }) {
    return webCall(env, cookie, "/api/history", {
      body: {
        ...(input.batchId ? { batch: { id: input.batchId, label: "Batch", startedAt: NOW } } : {}),
        collectionId: input.collectionId,
        id: input.id,
        page: { title: input.title, url: "https://example.test/new" },
        pins: [{ comment: `${input.title} pin`, number: 1 }],
      },
      method: "POST",
    });
  }

  // Every D1 batch of `env`, as the list of its statements' SQL.
  function recordD1Batches(env: CloudEnv) {
    const batches: string[][] = [];
    const database = env.DB!;
    const recorded: CloudEnv = {
      ...env,
      DB: {
        batch(statements) {
          batches.push(statements.map((statement) => (statement as unknown as { sql: string }).sql));
          return database.batch(statements);
        },
        prepare(query: string) {
          return Object.assign(database.prepare(query), { sql: query.replace(/\s+/g, " ").trim() });
        },
      },
    };
    return { batches, env: recorded };
  }

  // B reads the batch empty and is about to claim; A saves then, and
  // `moveA` puts it in Onboarding. B must follow A there.
  async function windowCorrectionIsFollowed(moveA: (env: CloudEnv, cookie: string) => Promise<Response>) {
    const db = migratedDatabase();
    let releaseA = () => {};
    let first: Promise<Record<string, any>> | undefined;
    try {
      const { cookie, env } = await filingSetup(db);
      const gateA = new Promise<void>((resolve) => {
        releaseA = resolve;
      });
      let reachedA = () => {};
      const atUploadA = new Promise<void>((resolve) => {
        reachedA = resolve;
      });
      const bucket = {
        async delete() {},
        async get() {
          return null;
        },
        async head() {
          return null;
        },
        async put(key: string) {
          if (key.includes("window_a")) {
            reachedA();
            await gateA;
          }
          return null;
        },
      } as unknown as NonNullable<CloudEnv["PINAR_BUCKET"]>;
      const heldEnv: CloudEnv = { ...env, PINAR_BUCKET: bucket };
      const bothAsked = heldUntil(2);
      appliance = fakeAppliance({
        decide: async (body) => {
          await bothAsked();
          if (!String(body.state).includes("Race B")) return decideFor("Shop / Checkout", 0.95)(body);
          await atUploadA;
          // B's own answer is a third collection: only the batch can bring it to Onboarding.
          return decideFor("Docs / Checkout", 0.95)(body);
        },
        engine: "decisions",
      });
      let moved = false;
      afterFirst = async (query, params) => {
        if (moved || query !== "SELECT id FROM sessions WHERE id = ? AND user_id = ? AND batch_id = ?" || params[0] !== "window_b") return;
        moved = true;
        // B read the batch empty and is about to claim: A saves now, and the person moves it.
        releaseA();
        await first;
        const response = await moveA(env, cookie);
        assert.ok(response.status === 200 || response.status === 201, await response.clone().text());
      };
      first = shot(heldEnv, cookie, { batchId: "batch_window", id: "window_a", title: "Race A" });
      const b = await shot(heldEnv, cookie, { batchId: "batch_window", id: "window_b", title: "Race B" });
      assert.equal(moved, true, "the move happened inside B's window");
      assert.equal(b.destination.collectionId, "col_onboarding");
      assert.deepEqual(b.filing, { collectionId: "col_onboarding", confidence: 0, engine: "none", reason: "chosen" });
      assert.deepEqual(stored(db, "window_a"), { batch_id: "batch_window", collection_id: "col_onboarding", filed_by: null });
      assert.deepEqual(stored(db, "window_b"), { batch_id: "batch_window", collection_id: "col_onboarding", filed_by: "auto" });
      assert.equal(claimOf(db, "batch_window"), "col_onboarding");
    } finally {
      afterFirst = null;
      releaseA();
      await first?.catch(() => null);
      db.close();
    }
  }

  test("a move made after the second capture read the batch but before it claims is followed", async () => {
    // Mutation captured: a move that leaves the claim alone sends B back to Checkout, splitting the batch.
    await windowCorrectionIsFollowed((env, cookie) => moveTo(env, cookie, "window_a", "col_onboarding"));
  });

  test("a re-save through POST /api/history made in that window is followed too", async () => {
    // Mutation captured: a persistSession that leaves the claim alone sends B back to Checkout.
    await windowCorrectionIsFollowed((env, cookie) =>
      historySave(env, cookie, { batchId: "batch_window", collectionId: "col_onboarding", id: "window_a", title: "Race A" }));
  });

  test("re-saving a claimed batch's only session through POST /api/history in another collection moves the claim, in the upsert's own D1 batch", async () => {
    // Mutation captured: a persistSession without the claim's UPDATE keeps Checkout.
    const db = migratedDatabase();
    try {
      const { cookie, env } = await filingSetup(db);
      appliance = fakeAppliance({ decide: decideFor("Shop / Checkout", 0.95), engine: "decisions" });
      await shot(env, cookie, { batchId: "batch_history", id: "history_only", title: "Checkout" });
      assert.equal(claimOf(db, "batch_history"), "col_checkout");

      const recorded = recordD1Batches(env);
      const response = await historySave(recorded.env, cookie, { batchId: "batch_history", collectionId: "col_onboarding", id: "history_only", title: "Checkout" });
      assert.equal(response.status, 201, await response.clone().text());
      assert.deepEqual(stored(db, "history_only"), { batch_id: "batch_history", collection_id: "col_onboarding", filed_by: null });
      assert.equal(claimOf(db, "batch_history"), "col_onboarding");
      // The upsert and the claim's UPDATE are the two statements of one D1 batch, in that order.
      const upsertBatch = recorded.batches.find((sqls) => sqls.some((sql) => sql.startsWith("INSERT INTO sessions")));
      assert.ok(upsertBatch, "the upsert runs in a D1 batch");
      assert.equal(upsertBatch.length, 2);
      assert.ok(upsertBatch[0]!.startsWith("INSERT INTO sessions"));
      assert.equal(upsertBatch[1], "UPDATE batches SET filing_collection_id = ? WHERE id = ? AND user_id = ? AND filing_collection_id IS NOT NULL");

      // Back to the Inbox as well: the claim is where the batch's session was written last.
      assert.equal((await historySave(env, cookie, { batchId: "batch_history", collectionId: "col_inbox", id: "history_only", title: "Checkout" })).status, 201);
      assert.equal(claimOf(db, "batch_history"), "col_inbox");
    } finally {
      db.close();
    }
  });

  test("POST /api/history writes no claim without a batch, nor for a batch with no claim yet", async () => {
    // Mutation captured: without "IS NOT NULL" the unclaimed batch gets a claim from the re-save.
    const db = migratedDatabase();
    try {
      const { cookie, env } = await filingSetup(db);
      appliance = fakeAppliance({ decide: decideFor("Shop / Checkout", 0.95), engine: "decisions" });
      await shot(env, cookie, { batchId: "batch_kept", id: "kept_batch_a", title: "Checkout" });
      const before = claims(db);

      // No batch: the upsert runs alone, and no claim changes.
      const recorded = recordD1Batches(env);
      assert.equal((await historySave(recorded.env, cookie, { collectionId: "col_onboarding", id: "history_no_batch", title: "Loose" })).status, 201);
      assert.equal(stored(db, "history_no_batch").collection_id, "col_onboarding");
      assert.deepEqual(claims(db), before);
      assert.deepEqual(recorded.batches.filter((sqls) => sqls.some((sql) => sql.startsWith("UPDATE batches"))), []);

      // A batch nothing claimed (switch off): a re-save elsewhere leaves it unclaimed.
      await writeOwnerDeliveryPreferences(env, OWNER, { autoCaptureDestination: false });
      await shot(env, cookie, { batchId: "batch_unclaimed", collectionId: "col_checkout", id: "unclaimed_a", title: "Checkout" });
      assert.equal(claimOf(db, "batch_unclaimed"), null);
      assert.equal((await historySave(env, cookie, { batchId: "batch_unclaimed", collectionId: "col_onboarding", id: "unclaimed_a", title: "Checkout" })).status, 201);
      assert.equal(stored(db, "unclaimed_a").collection_id, "col_onboarding");
      assert.equal(claimOf(db, "batch_unclaimed"), null);
      assert.equal(claimOf(db, "batch_kept"), "col_checkout");
    } finally {
      db.close();
    }
  });

  test("a write of a session never rewrites another owner's batch claim", async () => {
    // Mutation captured: without the owner filter on batches, usr_other's claim follows the write.
    const db = migratedDatabase();
    try {
      const { cookie, env } = await filingSetup(db);
      db.query("INSERT INTO batches (id, user_id, label, started_at, filing_collection_id) VALUES ('batch_theirs', 'usr_other', 'Theirs', ?, 'col_other')").run(NOW);
      const theirs = [{ filing_collection_id: "col_other", id: "batch_theirs", user_id: "usr_other" }];
      // POST /api/history refuses the other owner's batch before any write.
      const refused = await historySave(env, cookie, { batchId: "batch_theirs", collectionId: "col_onboarding", id: "history_foreign", title: "Theirs" });
      assert.equal(refused.status, 409);
      assert.deepEqual(claims(db), theirs);

      // A session of the owner that names the other owner's batch: an edit
      // (keepPlacement) touches no claim, and a capture write of it with that
      // batch id, as persistSession places a session, leaves their claim too.
      const owner = { id: OWNER, isPermanent: true, kind: "account" as const, plan: "pro" as const };
      insertSession(db, { batchId: "batch_theirs", collectionId: "col_checkout", createdAt: NOW, id: "forged_batch", title: "Checkout" });
      const edited = await webCall(env, cookie, "/api/sessions/forged_batch", { body: { reproduction: null }, method: "PATCH" });
      assert.equal(edited.status, 200, await edited.clone().text());
      assert.deepEqual(claims(db), theirs);
      const forged = await findOwnedSession(env, owner, "forged_batch");
      await persistSession(env, { ...forged!, collectionId: "col_onboarding" }, "batch_theirs");
      assert.deepEqual(claims(db), theirs);

      // Control: of the owner's own batch session, an edit leaves the claim
      // where it was (the place did not change) and a capture write moves it.
      appliance = fakeAppliance({ decide: decideFor("Shop / Checkout", 0.95), engine: "decisions" });
      await shot(env, cookie, { batchId: "batch_mine", id: "mine_batch_a", title: "Checkout" });
      db.query("UPDATE sessions SET collection_id = 'col_onboarding' WHERE id = 'mine_batch_a'").run();
      assert.equal((await webCall(env, cookie, "/api/sessions/mine_batch_a", { body: { reproduction: null }, method: "PATCH" })).status, 200);
      assert.equal(claimOf(db, "batch_mine"), "col_checkout");
      await persistSession(env, (await findOwnedSession(env, owner, "mine_batch_a"))!, "batch_mine");
      assert.equal(claimOf(db, "batch_mine"), "col_onboarding");
      assert.deepEqual(claims(db).filter((row) => (row as { id: string }).id === "batch_theirs"), theirs);
    } finally {
      db.close();
    }
  });

  test("without D1, a history re-save updates the in-memory claim: a capture into the emptied batch follows it", async () => {
    // Mutation captured: a memory write that leaves the claim alone sends the next capture to Checkout.
    const env: CloudEnv = { AI_API_KEY: "sk-ai-test", AI_BASE_URL: BASE_URL, AI_MODEL: "mock", ASSISTANT_ENABLED: "true", DEPLOYMENT_ENV: "staging" };
    const { cookie } = await seedCloudWebSessionForTests({ email: "mem-history@example.test", id: OWNER, plan: "pro" }, env);
    const created = async (path: string, body: unknown) => {
      const response = await webCall(env, cookie, path, { body, method: "POST" });
      assert.ok(response.status < 300, `${path}: ${response.status}`);
      return (await response.json()) as Record<string, any>;
    };
    const shop = (await created("/api/projects", { name: "Shop" })).project.id as string;
    const checkout = (await created(`/api/projects/${shop}/collections`, { name: "Checkout" })).collection.id as string;
    const onboarding = (await created(`/api/projects/${shop}/collections`, { name: "Onboarding" })).collection.id as string;
    await created(`/api/projects/${shop}/collections`, { name: "Research" });
    await writeOwnerDeliveryPreferences(env, OWNER, { autoCaptureDestination: true });

    appliance = fakeAppliance({ decide: decideFor("Shop / Checkout", 0.95), engine: "decisions" });
    assert.equal((await shot(env, cookie, { batchId: "batch_memory_history", id: "memory_history_a", title: "Checkout" })).destination.collectionId, checkout);
    assert.equal((await historySave(env, cookie, { batchId: "batch_memory_history", collectionId: onboarding, id: "memory_history_a", title: "Checkout" })).status, 201);
    // The batch loses its only session; its claim remains, and is where A was written last.
    assert.equal((await webCall(env, cookie, "/api/history/memory_history_a", { method: "DELETE" })).status, 200);

    appliance = fakeAppliance({ decide: decideFor("Shop / Research", 0.95), engine: "decisions" });
    const next = await shot(env, cookie, { batchId: "batch_memory_history", id: "memory_history_b", title: "Research" });
    assert.equal(next.destination.collectionId, onboarding);
    assert.deepEqual(next.filing, { collectionId: onboarding, confidence: 0, engine: "none", reason: "chosen" });
  });
});

describe("cloud capture filing without D1 (the in-memory fallback)", () => {
  beforeEach(() => {
    resetCloudMemoryStateForTests();
    resetRetrievalCapabilitiesCacheForTests();
    setCloudNowForTests(NOW);
  });

  afterEach(() => {
    setCloudFilingFetchForTests(null);
    resetRetrievalCapabilitiesCacheForTests();
    resetCloudMemoryStateForTests();
  });

  test("the owner's collections, its recent titles and the batch rule come from memory", async () => {
    const env: CloudEnv = { AI_API_KEY: "sk-ai-test", AI_BASE_URL: BASE_URL, AI_MODEL: "mock", ASSISTANT_ENABLED: "true", DEPLOYMENT_ENV: "staging" };
    const owner = await seedCloudWebSessionForTests({ email: "mem@example.test", id: OWNER, plan: "pro" }, env);
    const other = await seedCloudWebSessionForTests({ email: "other@example.test", id: "usr_other", plan: "pro" }, env);
    const call = async (cookie: string, path: string, body: unknown, method = "POST") => {
      const response = await handleCloudApiRequest(new Request(`https://pinar.test${path}`, {
        body: JSON.stringify(body),
        headers: { "content-type": "application/json", cookie },
        method,
      }), env);
      assert.ok(response.status < 300, `${path}: ${response.status}`);
      return (await response.json()) as Record<string, any>;
    };
    const shop = (await call(owner.cookie, "/api/projects", { name: "Shop" })).project.id as string;
    const checkout = (await call(owner.cookie, `/api/projects/${shop}/collections`, { name: "Checkout" })).collection.id as string;
    const onboarding = (await call(owner.cookie, `/api/projects/${shop}/collections`, { name: "Onboarding" })).collection.id as string;
    const elsewhere = (await call(other.cookie, "/api/projects", { name: "Elsewhere" })).project.id as string;
    await call(other.cookie, `/api/projects/${elsewhere}/collections`, { name: "Foreign" });
    const history = (id: string, collectionId: string, title: string, createdAt: string, batchId?: string) => call(owner.cookie, "/api/history", {
      ...(batchId ? { batch: { id: batchId, label: "Batch", startedAt: createdAt } } : {}),
      collectionId,
      createdAt,
      id,
      page: { title, url: `https://example.test/${id}` },
      pins: [{ comment: "note", number: 1 }],
    });
    await history("mem_onb_1", onboarding, "Welcome tour", "2026-10-01T10:00:00.000Z");
    await history("mem_onb_2", onboarding, "Profile step", "2026-10-02T10:00:00.000Z");
    await history("mem_batch_1", checkout, "Card form", "2026-10-03T10:00:00.000Z", "batch_mem");
    await writeOwnerDeliveryPreferences(env, OWNER, { autoCaptureDestination: true });
    appliance = fakeAppliance({ decide: decideFor("Shop / Onboarding", 0.9), engine: "decisions" });
    setCloudFilingFetchForTests(appliance.fetch);

    const decided = await shot(env, owner.cookie, { collectionId: checkout, id: "mem_decided", title: "Onboarding" });
    assert.equal(decided.destination.collectionId, onboarding);
    assert.deepEqual(decided.filing, { collectionId: onboarding, confidence: 0.9, engine: "decisions", reason: "chosen" });
    const decision = appliance.calls.find((item) => item.path === "/decisions")!;
    assert.deepEqual(decision.body!.questions[0].options, ["Shop / Checkout", "Shop / Onboarding", FILING_NONE_OPTION]);
    assert.match(decision.body!.instructions, /"Shop \/ Onboarding" \(recent captures: "Profile step", "Welcome tour"\)/);
    const session = await handleCloudApiRequest(new Request("https://pinar.test/api/sessions/mem_decided", { headers: { cookie: owner.cookie } }), env);
    assert.equal(((await session.json()) as { session: Record<string, unknown> }).session.filedBy, "auto");

    const engineCalls = appliance.engineCalls().length;
    const filedBy = async (id: string) => {
      const response = await handleCloudApiRequest(new Request(`https://pinar.test/api/sessions/${id}`, { headers: { cookie: owner.cookie } }), env);
      return ((await response.json()) as { session: Record<string, unknown> }).session.filedBy;
    };
    const batched = await shot(env, owner.cookie, { batchId: "batch_mem", collectionId: onboarding, id: "mem_batch_2", title: "Onboarding" });
    assert.equal(batched.destination.collectionId, checkout);
    assert.deepEqual(batched.filing, { collectionId: checkout, confidence: 0, engine: "none", reason: "chosen" });
    assert.equal(await filedBy("mem_batch_2"), undefined, "the batch's session is unmarked");
    assert.equal(appliance.engineCalls().length, engineCalls, "the batch rule asks no engine");

    // A batch whose most recent session was filed automatically passes the mark on.
    await shot(env, owner.cookie, { batchId: "batch_auto", collectionId: checkout, id: "mem_auto_1", title: "Onboarding" });
    assert.equal(await filedBy("mem_auto_1"), "auto");
    const inherited = await shot(env, owner.cookie, { batchId: "batch_auto", collectionId: checkout, id: "mem_auto_2", title: "Card" });
    assert.equal(inherited.destination.collectionId, onboarding);
    assert.equal(inherited.filing.engine, "none");
    assert.equal(await filedBy("mem_auto_2"), "auto");
    assert.equal(appliance.engineCalls().length, engineCalls + 1);
  });
});

describe("cloud GET /api/preferences autoCaptureDestinationAvailable", () => {
  beforeEach(() => {
    resetCloudMemoryStateForTests();
    resetRetrievalCapabilitiesCacheForTests();
    setCloudNowForTests(NOW);
    appliance = fakeAppliance({ engine: "none" });
    setCloudFilingFetchForTests(((input: RequestInfo | URL, init?: RequestInit) => appliance.fetch(input, init)) as typeof fetch);
  });

  afterEach(() => {
    setCloudFilingFetchForTests(null);
    resetRetrievalCapabilitiesCacheForTests();
    resetCloudMemoryStateForTests();
  });

  async function available(overrides: Partial<CloudEnv>, engine: Engine, plan: "free" | "pro" = "pro") {
    resetCloudMemoryStateForTests();
    resetRetrievalCapabilitiesCacheForTests();
    const db = migratedDatabase();
    try {
      const env = filingEnv(db, overrides);
      const cookie = await signIn(db, env, plan);
      appliance = fakeAppliance({ engine });
      const response = await handleCloudApiRequest(new Request("https://pinar.test/api/preferences", { headers: { cookie } }), env);
      assert.equal(response.status, 200);
      return { calls: appliance.calls.length, value: ((await response.json()) as Record<string, unknown>).autoCaptureDestinationAvailable };
    } finally {
      db.close();
    }
  }

  test("without AI, or outside the gate: false, without any fetch", async () => {
    assert.deepEqual(await available({ AI_API_KEY: undefined, AI_BASE_URL: undefined, AI_MODEL: undefined }, "decisions"), { calls: 0, value: false });
    assert.deepEqual(await available({ ASSISTANT_ENABLED: "false" }, "decisions"), { calls: 0, value: false });
    assert.deepEqual(await available({ ASSISTANT_CHAIN: "gateway:anthropic/claude-haiku-5.5", DEPLOYMENT_ENV: "production" }, "decisions"), { calls: 0, value: false });
    assert.deepEqual(await available({}, "decisions", "free"), { calls: 0, value: false });
  });

  test("with an engine: true for decisions and for similarity", async () => {
    assert.equal((await available({ AI_EMBEDDING_MODEL: undefined }, "decisions")).value, true);
    assert.equal((await available({}, "similarity")).value, true);
  });

  test("PATCH answers the availability with the saved preferences", async () => {
    const patch = async (overrides: Partial<CloudEnv>, engine: Engine) => {
      resetCloudMemoryStateForTests();
      resetRetrievalCapabilitiesCacheForTests();
      const db = migratedDatabase();
      try {
        const env = filingEnv(db, overrides);
        const cookie = await signIn(db, env);
        appliance = fakeAppliance({ engine });
        const response = await handleCloudApiRequest(new Request("https://pinar.test/api/preferences", {
          body: JSON.stringify({ autoCaptureDestination: true }),
          headers: { "content-type": "application/json", cookie },
          method: "PATCH",
        }), env);
        assert.equal(response.status, 200);
        const body = (await response.json()) as Record<string, unknown>;
        assert.equal(body.autoCaptureDestination, true);
        return { calls: appliance.calls.length, value: body.autoCaptureDestinationAvailable };
      } finally {
        db.close();
      }
    };
    assert.deepEqual(await patch({ ASSISTANT_ENABLED: "false" }, "decisions"), { calls: 0, value: false });
    assert.equal((await patch({ AI_EMBEDDING_MODEL: undefined }, "decisions")).value, true);
    assert.equal((await patch({ AI_EMBEDDING_MODEL: undefined }, "none")).value, false);
  });

  test("inside the gate without an engine: false", async () => {
    const result = await available({ AI_EMBEDDING_MODEL: undefined }, "none");
    assert.equal(result.value, false);
    assert.equal(result.calls, 1, "one /models detection");
  });

  test("with the user's BYOK embeddings ok: available, and the detection never leaves to the deployment (F5/S3c)", async () => {
    resetCloudMemoryStateForTests();
    resetRetrievalCapabilitiesCacheForTests();
    const db = migratedDatabase();
    const byokKey = Buffer.alloc(32, 41).toString("base64");
    try {
      const env = filingEnv(db, { BYOK_MASTER_KEY: byokKey });
      const cookie = await signIn(db, env);
      appliance = fakeAppliance({ engine: "none" });
      // The user's BYOK row: the embeddings ok (the capability tested),
      // the chat model without the vision ok (the captions stay the
      // deployment's, if the turn asks for them).
      const cryptoObj = await byokCrypto(byokKey);
      const ciphertext = await cryptoObj.encrypt("sk-byok-pref-test-3141");
      db.query(`INSERT INTO byok_endpoints (owner_id, base_url, key_ciphertext, key_last4, key_id, chat_model,
           embedding_model, transcription_model, capabilities_json, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
        OWNER,
        "https://byok-pref.test/v1",
        ciphertext,
        "3141",
        cryptoObj.keyId,
        "chat-1",
        EMBEDDING_MODEL,
        "",
        JSON.stringify({
          chat: { error: null, ok: true, testedAt: NOW },
          embeddings: { dims: 256, error: null, ok: true, testedAt: NOW },
          tools: { error: null, ok: true, testedAt: NOW },
          transcription: { error: null, ok: null, testedAt: null },
          vision: { error: null, ok: null, testedAt: null },
        }),
        NOW,
        NOW,
      );
      const response = await handleCloudApiRequest(new Request("https://pinar.test/api/preferences", { headers: { cookie } }), env);
      assert.equal(response.status, 200);
      const body = (await response.json()) as Record<string, unknown>;
      assert.equal(body.autoCaptureDestinationAvailable, true, "the user's embeddings ok make the destination available");
      assert.equal(appliance.calls.length, 0, "the BYOK wins: no deployment detection call left");
    } finally {
      db.close();
    }
  });
});

// ---------- production through the gateway (F4 contract §4) ----------

const GATEWAY_ORIGIN = "https://ai-gateway.vercel.sh";
const GATEWAY_KEY = "vck-gateway-test";
const GATEWAY_EMBEDDING = "openai/text-embedding-3-small";
const CHAIN = "gateway:anthropic/claude-haiku-5.5,gateway:deepseek/deepseek-v4.1-flash";

interface HubCall {
  authorization: string | null;
  body: Record<string, any> | null;
  origin: string;
  path: string;
}

// The gateway on a fake fetch (its catalog, where the first link even
// declares the decisions extra, and /embeddings) and, at BASE_URL, an
// appliance that would answer decisions for Onboarding: a request that
// reached either the decisions engine or AI_BASE_URL would change the
// destination, and the recorded calls show it.
function fakeGatewayHubs(embed: (text: string) => number[]) {
  const calls: HubCall[] = [];
  const applianceFake = fakeAppliance({ decide: decideFor("Onboarding", 0.95), embed, engine: "decisions" });
  const fetchFn = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    const raw = typeof init?.body === "string" ? init.body : "";
    const body = raw ? (JSON.parse(raw) as Record<string, any>) : null;
    const path = url.pathname.replace(/^\/v1/, "");
    calls.push({ authorization: new Headers(init?.headers).get("authorization"), body, origin: url.origin, path });
    if (url.origin !== GATEWAY_ORIGIN) return applianceFake.fetch(input, init);
    if (path === "/models") {
      return Response.json({
        data: [
          { id: "openai/text-embedding-3-large", pricing: { input: "0.00000013" }, tags: null, type: "embedding" },
          { decisions: DECISIONS_EXTRA, id: "anthropic/claude-haiku-5.5", pricing: { input: "0.0000001", output: "0.0000005" }, tags: ["vision"], type: "language" },
          { id: GATEWAY_EMBEDDING, pricing: { input: "0.00000002", output: null }, tags: null, type: "embedding" },
        ],
      });
    }
    if (path === "/decisions") return decideFor("Onboarding", 0.95)(body!);
    if (path === "/embeddings") {
      return Response.json({ data: (body!.input as string[]).map((text, index) => ({ embedding: embed(text), index })), usage: { prompt_tokens: 5, total_tokens: 5 } });
    }
    return new Response("not found", { status: 404 });
  }) as typeof fetch;
  return {
    applianceCalls: () => calls.filter((call) => call.origin !== GATEWAY_ORIGIN),
    calls,
    fetch: fetchFn,
    gatewayCalls: () => calls.filter((call) => call.origin === GATEWAY_ORIGIN),
  };
}

function productionFilingEnv(db: Database, overrides: Partial<CloudEnv> = {}): CloudEnv {
  return filingEnv(db, {
    AI_EMBEDDING_MODEL: GATEWAY_EMBEDDING,
    AI_GATEWAY_API_KEY: GATEWAY_KEY,
    ASSISTANT_CHAIN: CHAIN,
    DEPLOYMENT_ENV: "production",
    ...overrides,
  });
}

describe("cloud capture filing in production, through the gateway (F4 contract §4)", () => {
  beforeEach(() => {
    resetCloudMemoryStateForTests();
    resetRetrievalCapabilitiesCacheForTests();
    setCloudNowForTests(NOW);
  });

  afterEach(() => {
    setCloudFilingFetchForTests(null);
    resetRetrievalCapabilitiesCacheForTests();
    resetCloudMemoryStateForTests();
  });

  async function preferencesAvailable(env: CloudEnv, cookie: string) {
    const response = await handleCloudApiRequest(new Request("https://pinar.test/api/preferences", { headers: { cookie } }), env);
    assert.equal(response.status, 200);
    return ((await response.json()) as Record<string, unknown>).autoCaptureDestinationAvailable;
  }

  test("similarity through the gateway with its key and the privacy options; never decisions, nothing to AI_BASE_URL", async () => {
    const db = migratedDatabase();
    try {
      const env = productionFilingEnv(db);
      const cookie = await signIn(db, env);
      seedCollections(db);
      insertSession(db, { collectionId: "col_checkout", createdAt: "2026-10-01T10:00:00.000Z", id: "cloud_chk_1", title: "Card form" });
      insertSession(db, { collectionId: "col_onboarding", createdAt: "2026-10-02T10:00:00.000Z", id: "cloud_onb_1", title: "Welcome" });
      await indexSession(env, "cloud_chk_1", [{ model: GATEWAY_EMBEDDING, vector: vector(1, 0) }]);
      await indexSession(env, "cloud_onb_1", [{ model: GATEWAY_EMBEDDING, vector: vector(0, 1) }]);
      await writeOwnerDeliveryPreferences(env, OWNER, { autoCaptureDestination: true });
      const hubs = fakeGatewayHubs((text) => (text.includes("Payment") ? vector(1, 0.05) : vector(0, 0, 1)));
      setCloudFilingFetchForTests(hubs.fetch);

      assert.equal(await preferencesAvailable(env, cookie), true);
      const body = await shot(env, cookie, { collectionId: "col_onboarding", id: "cloud_gateway", title: "Payment declined" });
      assert.equal(body.destination.collectionId, "col_checkout");
      assert.equal(body.filing.engine, "similarity");
      assert.equal(body.filing.reason, "chosen");
      assert.equal(stored(db, "cloud_gateway").filed_by, "auto");

      assert.deepEqual(hubs.applianceCalls(), [], "no request to AI_BASE_URL");
      assert.deepEqual([...new Set(hubs.gatewayCalls().map((call) => call.path))].sort(), ["/embeddings", "/models"], "never /decisions");
      const embedding = hubs.gatewayCalls().find((call) => call.path === "/embeddings")!;
      assert.equal(embedding.authorization, `Bearer ${GATEWAY_KEY}`);
      assert.deepEqual(Object.keys(embedding.body!).sort(), ["dimensions", "input", "model", "providerOptions"]);
      assert.equal(embedding.body!.model, GATEWAY_EMBEDDING);
      assert.deepEqual(embedding.body!.providerOptions, { gateway: { disallowPromptTraining: true } });
      // The capture's embedding is recorded for the margin monitor: no cost
      // in the body, so pricing.input × usage (5 × 0.00000002 USD → 1 micro).
      assert.deepEqual(db.query("SELECT kind, model, cost_usd_micros, cost_source, created_at FROM assistant_index_costs").all(), [
        { cost_source: "table", cost_usd_micros: 1, created_at: NOW, kind: "embedding", model: GATEWAY_EMBEDDING },
      ]);
    } finally {
      db.close();
    }
  });

  test("without AI_EMBEDDING_MODEL, or with one the catalog does not list as embedding, the automatic destination is unavailable: the Inbox", async () => {
    for (const AI_EMBEDDING_MODEL of [undefined, "anthropic/claude-haiku-5.5", "openai/text-embedding-9"]) {
      resetCloudMemoryStateForTests();
      resetRetrievalCapabilitiesCacheForTests();
      const db = migratedDatabase();
      try {
        const env = productionFilingEnv(db, { AI_EMBEDDING_MODEL });
        const cookie = await signIn(db, env);
        seedCollections(db);
        await writeOwnerDeliveryPreferences(env, OWNER, { autoCaptureDestination: true });
        const hubs = fakeGatewayHubs(() => vector(1, 0));
        setCloudFilingFetchForTests(hubs.fetch);

        assert.equal(await preferencesAvailable(env, cookie), false, String(AI_EMBEDDING_MODEL));
        const body = await shot(env, cookie, { collectionId: "col_onboarding", id: "cloud_no_embedding", title: "Onboarding" });
        assert.equal(body.destination.collectionId, "col_inbox", String(AI_EMBEDDING_MODEL));
        assert.deepEqual(body.filing, { collectionId: null, confidence: 0, engine: "none", reason: "error" }, String(AI_EMBEDDING_MODEL));
        assert.deepEqual([...new Set(hubs.calls.map((call) => `${call.origin}${call.path}`))], [`${GATEWAY_ORIGIN}/models`], String(AI_EMBEDDING_MODEL));
      } finally {
        db.close();
      }
    }
  });

  test("without the configuration of the first link's hub there is no engine, even with the other hub's strings set", async () => {
    const base = {
      AI_API_KEY: "sk-ai-test",
      AI_BASE_URL: BASE_URL,
      AI_EMBEDDING_MODEL: GATEWAY_EMBEDDING,
      AI_GATEWAY_API_KEY: GATEWAY_KEY,
      AI_MODEL: "mock",
      DEPLOYMENT_ENV: "production",
    };
    for (const overrides of [{ ASSISTANT_CHAIN: "gateway" }, { ASSISTANT_CHAIN: CHAIN, AI_GATEWAY_API_KEY: undefined }, { ASSISTANT_CHAIN: "appliance:mock", AI_BASE_URL: undefined }, { ASSISTANT_CHAIN: "appliance:mock", AI_API_KEY: undefined }] as Array<Partial<CloudEnv>>) {
      const hubs = fakeGatewayHubs(() => vector(1, 0));
      setCloudFilingFetchForTests(hubs.fetch);
      assert.equal(await cloudFilingEngine({ ...base, ...overrides }), null, JSON.stringify(overrides));
      assert.deepEqual(hubs.calls, [], JSON.stringify(overrides));
    }
  });
});

// F5/S3c: the automatic destination follows the user's BYOK embeddings
// capability. With them ok the capture's embedding runs on the user's
// endpoint — one link, no reservation, no credit, and the deployment
// receives nothing (not even the detection) — comparing only with the
// centroids of the same identity (model\u0000url). A failure (a caused
// egress, the per-user cap) keeps the capture in the default destination
// with the cause in the choice's result — no gateway, no credit. Without
// the capability the path is today's: the gateway's engine, one credit.
describe("cloud capture filing follows the user's BYOK embeddings (F5/S3c)", () => {
  const BYOK_FILING_HOST = "https://byok-filing.test";
  const BYOK_FILING_URL = `${BYOK_FILING_HOST}/v1`;
  const BYOK_FILING_KEY = "sk-byok-filing-test-3141";
  // The same model name as the deployment's (EMBEDDING_MODEL): the URL is
  // what keeps the two vector spaces apart.
  const S3C_BYOK_EMBEDDING = EMBEDDING_MODEL;
  const S3C_BYOK_IDENTITY = `${S3C_BYOK_EMBEDDING}\u0000${BYOK_FILING_URL}`;

  beforeEach(() => {
    resetCloudMemoryStateForTests();
    resetRetrievalCapabilitiesCacheForTests();
    setCloudNowForTests(NOW);
  });

  afterEach(() => {
    setByokEgressForTests(null);
    setCloudFilingFetchForTests(null);
    resetByokConcurrencyForTests();
    resetRetrievalCapabilitiesCacheForTests();
    resetCloudMemoryStateForTests();
  });

  async function seedByokFilingRow(db: Database, byokKey: string, capabilities: string) {
    const cryptoObj = (await byokCrypto(byokKey))!;
    const ciphertext = await cryptoObj.encrypt(BYOK_FILING_KEY);
    db.query(
      `INSERT INTO byok_endpoints (owner_id, base_url, key_ciphertext, key_last4, key_id, chat_model,
         embedding_model, transcription_model, capabilities_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(OWNER, BYOK_FILING_URL, ciphertext, "3141", cryptoObj.keyId, "chat-1", S3C_BYOK_EMBEDDING, "", capabilities, NOW, NOW);
  }

  const caps = (embeddings: boolean) =>
    JSON.stringify({
      chat: { error: null, ok: true, testedAt: NOW },
      embeddings: embeddings ? { dims: 256, error: null, ok: true, testedAt: NOW } : { dims: null, error: "key_rejected", ok: false, testedAt: NOW },
      tools: { error: null, ok: true, testedAt: NOW },
      transcription: { error: null, ok: null, testedAt: null },
      vision: { error: null, ok: null, testedAt: null },
    });

  // The BYOK egress the tests inject: only the BYOK host, as byokFetch
  // does until S6. The capture's embedding is the payment-like one.
  function byokFilingEgress(options: { fail?: Response | null; embed?: (text: string) => number[] } = {}) {
    const calls: Array<{ auth: string | null; body: Record<string, any> | null; path: string }> = [];
    setByokEgressForTests(async (url, init) => {
      if (!url.startsWith(BYOK_FILING_HOST)) throw new ByokEgressUnavailableError();
      const raw = String(init?.body ?? "");
      const body = raw ? (JSON.parse(raw) as Record<string, any>) : null;
      const path = new URL(url).pathname;
      calls.push({ auth: new Headers(init?.headers ?? {}).get("authorization"), body, path });
      if (path.endsWith("/embeddings")) {
        if (options.fail) return options.fail;
        const text = Array.isArray(body!.input) ? String(body!.input[0]) : String(body!.input);
        return Response.json({ data: [{ embedding: options.embed?.(text) ?? (text.includes("Payment") ? vector(1, 0.05) : vector(0, 0, 1)), index: 0 }] });
      }
      return new Response("not found", { status: 404 });
    });
    return calls;
  }

  async function seedCentroidSessions(db: Database, env: CloudEnv) {
    seedCollections(db);
    insertSession(db, { collectionId: "col_checkout", createdAt: "2026-10-01T10:00:00.000Z", id: "fil_s3c_1", title: "Card form" });
    insertSession(db, { collectionId: "col_onboarding", createdAt: "2026-10-02T10:00:00.000Z", id: "fil_s3c_2", title: "Welcome" });
    await writeOwnerDeliveryPreferences(env, OWNER, { autoCaptureDestination: true });
  }

  test("S3c: with the embeddings ok the automatic destination runs on the BYOK (the centroids of its identity, no credit, 0 deployment calls)", async () => {
    const db = migratedDatabase();
    const byokKey = Buffer.alloc(32, 31).toString("base64");
    try {
      const env = { ...filingEnv(db), BYOK_MASTER_KEY: byokKey };
      const cookie = await signIn(db, env);
      await seedCentroidSessions(db, env);
      await indexSession(env, "fil_s3c_1", [{ model: S3C_BYOK_IDENTITY, vector: vector(1, 0) }]);
      await indexSession(env, "fil_s3c_2", [{ model: S3C_BYOK_IDENTITY, vector: vector(0, 1) }]);
      await seedByokFilingRow(db, byokKey, caps(true));
      const byokCalls = byokFilingEgress();
      const deployment = fakeAppliance({ engine: "none" });
      setCloudFilingFetchForTests(deployment.fetch);

      const body = await shot(env, cookie, { collectionId: "col_onboarding", id: "fil_s3c_cap", title: "Payment declined" });
      assert.equal(body.destination.collectionId, "col_checkout", "the BYOK's centroids chose the collection");
      assert.deepEqual(body.filing, { collectionId: "col_checkout", confidence: body.filing.confidence, engine: "similarity", reason: "chosen" });
      assert.ok(body.filing.confidence >= FILING_SIMILARITY_MIN, "confident enough");
      assert.equal(stored(db, "fil_s3c_cap").filed_by, "auto");

      // The capture's embedding left only through the BYOK — its model,
      // its key, only in the Authorization header: the deployment received
      // nothing (not even the detection), and nothing was reserved or
      // consumed.
      assert.equal(byokCalls.length, 1, "one embedding call: the capture's");
      assert.equal(byokCalls[0]!.auth, `Bearer ${BYOK_FILING_KEY}`);
      assert.equal(byokCalls[0]!.body!.model, S3C_BYOK_EMBEDDING);
      assert.deepEqual(deployment.calls, [], "the deployment received 0 calls");
      assert.deepEqual(db.query("SELECT id FROM ai_credit_usages WHERE feature = 'capture_filing'").all(), [], "no credit reserved, no credit consumed");
      assert.deepEqual(db.query("SELECT id FROM assistant_index_costs").all(), [], "no index cost line");
    } finally {
      db.close();
    }
  });

  test("S3c: a BYOK failure keeps the capture in the default destination with the cause (no gateway, no credit)", async () => {
    const cases: Array<{ cause: string; label: string; fail?: Response | null; holdSlots?: boolean }> = [
      { cause: "key_rejected", fail: new Response("PROVIDER-BODY-SECRET", { status: 401 }), label: "401" },
      {
        // The 2xx outside the embeddings' schema (the 256 dimensions):
        // the caused ByokCallError at the operation's boundary — the
        // cause reaches the choice's result, not a generic error.
        cause: "invalid_response",
        fail: new Response(JSON.stringify({ data: [{ index: 0, embedding: [1], note: "PROVIDER-BODY-SECRET" }] }), { status: 200, headers: { "content-type": "application/json" } }),
        label: "the invalid 2xx",
      },
      {
        // The 2xx that is not even a JSON body: the same caused boundary
        // (the parse failed), the cause, not a generic error.
        cause: "invalid_response",
        fail: new Response("{invalid PROVIDER-BODY-SECRET", { status: 200, headers: { "content-type": "application/json" } }),
        label: "the non-JSON 2xx",
      },
      { cause: "rate_limited", label: "the cap", holdSlots: true },
    ];
    for (const item of cases) {
      resetCloudMemoryStateForTests();
      resetRetrievalCapabilitiesCacheForTests();
      const db = migratedDatabase();
      const byokKey = Buffer.alloc(32, 32).toString("base64");
      try {
        const env = { ...filingEnv(db), BYOK_MASTER_KEY: byokKey };
        const cookie = await signIn(db, env);
        await seedCentroidSessions(db, env);
        await indexSession(env, "fil_s3c_1", [{ model: S3C_BYOK_IDENTITY, vector: vector(1, 0) }]);
        await seedByokFilingRow(db, byokKey, caps(true));
        const byokCalls = byokFilingEgress({ fail: item.fail });
        const deployment = fakeAppliance({ engine: "none" });
        setCloudFilingFetchForTests(deployment.fetch);
        if (item.holdSlots) {
          // The turn's slot plus another in-flight call: the capture's
          // per-call slot is refused (no queue).
          assert.equal(byokAcquireSlot(OWNER), true);
          assert.equal(byokAcquireSlot(OWNER), true);
        }

        const body = await shot(env, cookie, { collectionId: "col_onboarding", id: `fil_s3c_fail_${item.cause}`, title: "Payment declined" });
        assert.equal(body.destination.collectionId, "col_inbox", `${item.label}: the default destination`);
        assert.equal(body.filing.collectionId, null);
        assert.equal(body.filing.engine, "similarity", `${item.label}: the engine that failed`);
        assert.equal(body.filing.reason, item.cause, `${item.label}: the cause in the choice's result`);
        assert.equal(stored(db, `fil_s3c_fail_${item.cause}`).filed_by, null, `${item.label}: unmarked`);
        // No credit and no gateway: the provider's body never crossed.
        assert.deepEqual(db.query("SELECT id FROM ai_credit_usages WHERE feature = 'capture_filing'").all(), [], `${item.label}: no credit`);
        assert.deepEqual(deployment.calls, [], `${item.label}: 0 deployment calls`);
        assert.ok(!JSON.stringify(body).includes("PROVIDER-BODY-SECRET"), `${item.label}: the provider's body never crosses`);
        if (item.holdSlots) {
          assert.equal(byokCalls.length, 0, "the cap refused before the egress");
          byokSlotRelease(OWNER)();
          byokSlotRelease(OWNER)();
        }
      } finally {
        db.close();
      }
    }
  });

  test("S3c: without the embeddings ok the path is today's (the gateway's engine, one credit)", async () => {
    const db = migratedDatabase();
    const byokKey = Buffer.alloc(32, 33).toString("base64");
    try {
      const env = { ...filingEnv(db), BYOK_MASTER_KEY: byokKey };
      const cookie = await signIn(db, env);
      await seedCentroidSessions(db, env);
      await indexSession(env, "fil_s3c_1", [{ vector: vector(1, 0) }]);
      await indexSession(env, "fil_s3c_2", [{ vector: vector(0, 1) }]);
      await seedByokFilingRow(db, byokKey, caps(false));
      const byokCalls = byokFilingEgress();
      const deployment = fakeAppliance({ engine: "similarity", embed: (text) => (text.includes("Payment") ? vector(1, 0.05) : vector(0, 0, 1)) });
      setCloudFilingFetchForTests(deployment.fetch);

      const body = await shot(env, cookie, { collectionId: "col_onboarding", id: "fil_s3c_no_ok", title: "Payment declined" });
      assert.equal(body.destination.collectionId, "col_checkout", "today's path chose the collection");
      assert.equal(body.filing.engine, "similarity");
      assert.equal(body.filing.reason, "chosen");
      // The engine ran on the deployment (its embedding model), and the
      // capture's credit was reserved and consumed: one credit.
      const embeddings = deployment.calls.filter((call) => call.path === "/embeddings");
      assert.ok(embeddings.length >= 1, "the capture's embedding left through the deployment");
      assert.equal(embeddings[0]!.body!.model, EMBEDDING_MODEL);
      assert.deepEqual(byokCalls, [], "the BYOK egress was not used");
      const deadline = Date.now() + 5_000;
      for (;;) {
        const rows = db.query("SELECT status FROM ai_credit_usages WHERE feature = 'capture_filing'").all();
        if (JSON.stringify(rows) === JSON.stringify([{ status: "succeeded" }])) break;
        if (Date.now() > deadline) throw new Error(`the capture was not billed: ${JSON.stringify(rows)}`);
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
    } finally {
      db.close();
    }
  });

  test("S3c: the identities never mix in the centroids (the swap, filing side)", async () => {
    // The same numeric vector (1,0) under two identities: the BYOK's
    // (model\u0000url) and the legacy plain-model with the same model name
    // (a different URL: a different vector space the identity rule keeps
    // apart). The BYOK engine must see only the former, the deployment's
    // engine only the latter — if one leaked into the other's centroid,
    // the two collections would tie and the margin rule would refuse to
    // choose.
    const db = migratedDatabase();
    const byokKey = Buffer.alloc(32, 34).toString("base64");
    try {
      const env = { ...filingEnv(db), BYOK_MASTER_KEY: byokKey };
      const cookie = await signIn(db, env);
      await seedCentroidSessions(db, env);
      await indexSession(env, "fil_s3c_1", [{ model: S3C_BYOK_IDENTITY, vector: vector(1, 0) }]);
      await indexSession(env, "fil_s3c_2", [{ model: EMBEDDING_MODEL, vector: vector(1, 0) }]); // the legacy plain-model (the same name, no URL)s
      const byokCalls = byokFilingEgress();
      const deployment = fakeAppliance({ engine: "similarity", embed: (text) => (text.includes("Payment") ? vector(1, 0.05) : vector(0, 0, 1)) });
      setCloudFilingFetchForTests(deployment.fetch);

      // The BYOK engine (the capability ok): col_checkout has the BYOK
      // centroid; col_onboarding's legacy vector is a different identity
      // and stays out — a lone centroid chooses, so the legacy never
      // leaked.
      await seedByokFilingRow(db, byokKey, caps(true));
      const first = await shot(env, cookie, { collectionId: "col_onboarding", id: "fil_s3c_mix_1", title: "Payment declined" });
      assert.equal(first.destination.collectionId, "col_checkout", "the BYOK engine chose the BYOK centroid's collection");
      assert.equal(first.filing.reason, "chosen", "a lone centroid: the legacy vector stayed out of the BYOK's centroid");
      assert.equal(byokCalls.length, 1, "the BYOK's embedding only");

      // The deployment's engine (the capability no longer ok): col_onboarding
      // has the legacy centroid; col_checkout's BYOK vector stays out —
      // a lone centroid chooses, so the BYOK never leaked.
      db.query("UPDATE byok_endpoints SET capabilities_json = ? WHERE owner_id = ?").run(caps(false), OWNER);
      const second = await shot(env, cookie, { collectionId: "col_checkout", id: "fil_s3c_mix_2", title: "Payment declined" });
      assert.equal(second.destination.collectionId, "col_onboarding", "the deployment's engine chose the legacy centroid's collection");
      assert.equal(second.filing.reason, "chosen", "a lone centroid: the BYOK vector stayed out of the deployment's centroid");
    } finally {
      db.close();
    }
  });

  test("S3c: the availability sees the user's BYOK embeddings (the destination is available, no deployment detection call)", async () => {
    resetRetrievalCapabilitiesCacheForTests();
    const db = migratedDatabase();
    try {
      const env = filingEnv(db);
      const deployment = fakeAppliance({ engine: "none" });
      setCloudFilingFetchForTests(deployment.fetch);
      // The user's retrieval endpoints (the capabilities ok, as
      // byokRetrievalEndpoints answers them — the Pro gate and the
      // no-decrypt rule are inside it): the embedding endpoint is never
      // called by the availability, it only answers the engine's choice.
      const byok = {
        embedding: { apiKey: BYOK_FILING_KEY, baseUrl: BYOK_FILING_URL, byok: true as const, model: S3C_BYOK_EMBEDDING },
        vision: null,
      };
      const engine = await cloudFilingEngine(env, byok);
      assert.equal(engine?.kind, "similarity", "the BYOK's engine wins");
      assert.equal((engine as { byok?: boolean }).byok, true);
      const available = await cloudAutoCaptureDestinationAvailable(env, byok, 100);
      assert.equal(available, true, "the user's embeddings ok make the automatic destination available");
      assert.deepEqual(deployment.calls, [], "the BYOK wins: no deployment detection call");
      // Without the BYOK, today's rule: the deployment's detection decides
      // — a deployment without an embedding model leaves the destination
      // unavailable (the preferences keep advertising false).
      const bare = (async (input: RequestInfo | URL) => {
        if (String(input).endsWith("/models")) return Response.json({ data: [{ id: "mock", type: "chat" }] });
        return new Response("not found", { status: 404 });
      }) as typeof fetch;
      setCloudFilingFetchForTests(bare);
      const withoutByok = await cloudAutoCaptureDestinationAvailable({ ...env, AI_EMBEDDING_MODEL: undefined }, null, 100);
      assert.equal(withoutByok, false, "without the BYOK, the deployment's detection decides");
    } finally {
      db.close();
      setCloudFilingFetchForTests(null);
      resetRetrievalCapabilitiesCacheForTests();
    }
  });
});


describe("cloud-api.ts loads the filing engines lazily", () => {
  test("only types and the constants are imported statically from filing/", () => {
    const source = readFileSync(new URL("../cloud-api.ts", import.meta.url), "utf8");
    const imports = [...source.matchAll(/^import\s+(type\s+)?[^;]*?from\s+"\.\/filing\/([^"]+)";/gms)];
    assert.ok(imports.length > 0);
    for (const [statement, typeOnly, module] of imports) {
      assert.ok(typeOnly || module === "constants", statement);
    }
    assert.match(source, /await import\("\.\/filing\/runtime-cloud"\)/);
  });
});

// ---------- A53: one credit per capture whose automatic destination calls the engine ----------

interface A53LedgerEntry {
  credits: number;
  feature: string;
  status: string;
  errorCode?: string;
}

// The two ledgers the tests run against: the migrated D1 (read by SQL) and
// the in-memory fallback (read through GET /api/account/entitlements, whose
// aiUsage now lists the capture_filing entries).
interface A53Setup {
  balance(): Promise<number>;
  checkout: string;
  close(): void;
  cookie: string;
  env: CloudEnv;
  inbox: string;
  ledger(): Promise<A53LedgerEntry[]>;
  onboarding: string;
  spendAll(): void | Promise<void>;
}

async function a53Entitlements(cookie: string, env: CloudEnv) {
  const response = await handleCloudApiRequest(new Request("https://pinar.test/api/account/entitlements", { headers: { cookie } }), env);
  assert.ok(response.status < 300, await response.clone().text());
  return (await response.json()) as { aiCredits: { balance: number }; aiUsage: A53LedgerEntry[] };
}

function a53Setup(useDb: boolean): Promise<A53Setup> {
  if (useDb) {
    const db = migratedDatabase();
    const env = filingEnv(db);
    return signIn(db, env).then((cookie) => {
      seedCollections(db);
      return {
        // The entitlements read seeds the pro grant before the spend, as
        // the meter does at the first reservation.
        async balance() {
          return (await a53Entitlements(cookie, env)).aiCredits.balance;
        },
        checkout: "col_checkout",
        close: () => db.close(),
        cookie,
        env,
        inbox: "col_inbox",
        async ledger() {
          return (db.query("SELECT feature, status, error_code, credits FROM ai_credit_usages WHERE owner_id = ? ORDER BY created_at, rowid").all(OWNER) as Array<{ credits: number; error_code: string | null; feature: string; status: string }>)
            .map((row) => ({ credits: row.credits, feature: row.feature, status: row.status, ...(row.error_code ? { errorCode: row.error_code } : {}) }));
        },
        onboarding: "col_onboarding",
        spendAll: async () => {
          await a53Entitlements(cookie, env);
          db.query("UPDATE ai_credit_grants SET consumed_credits = credits WHERE owner_id = ?").run(OWNER);
        },
      };
    });
  }
  const env: CloudEnv = { AI_API_KEY: "sk-ai-test", AI_BASE_URL: BASE_URL, AI_EMBEDDING_MODEL: EMBEDDING_MODEL, AI_MODEL: "mock", ASSISTANT_ENABLED: "true", DEPLOYMENT_ENV: "staging" };
  const owner = seedCloudWebSessionForTests({ email: "mem@example.test", id: OWNER, plan: "pro" }, env);
  return owner.then(async (ownerResult) => {
    const call = (path: string, body: unknown, method = "POST") => handleCloudApiRequest(new Request(`https://pinar.test${path}`, {
      body: JSON.stringify(body),
      headers: { "content-type": "application/json", cookie: ownerResult.cookie },
      method,
    }), env).then((response) => {
      assert.ok(response.status < 300, `${path}: ${response.status}`);
      return (response.json()) as Promise<Record<string, any>>;
    });
    const projectsResponse = await handleCloudApiRequest(new Request("https://pinar.test/api/projects", { headers: { cookie: ownerResult.cookie } }), env);
    const projects = ((await projectsResponse.json()) as { projects: Array<{ id: string; isProtected: boolean }> }).projects;
    const personal = projects.find((project) => project.isProtected);
    const collectionsResponse = await handleCloudApiRequest(
      new Request(`https://pinar.test/api/projects/${personal!.id}/collections`, { headers: { cookie: ownerResult.cookie } }),
      env,
    );
    const inbox = ((await collectionsResponse.json()) as { collections: Array<{ id: string; isProtected: boolean }> })
      .collections.find((collection) => collection.isProtected)!.id;
    const shop = await call("/api/projects", { name: "Shop" });
    const checkout = (await call(`/api/projects/${shop.project.id}/collections`, { name: "Checkout" })).collection.id as string;
    const onboarding = (await call(`/api/projects/${shop.project.id}/collections`, { name: "Onboarding" })).collection.id as string;
    return {
      async balance() {
        return (await a53Entitlements(ownerResult.cookie, env)).aiCredits.balance;
      },
      checkout,
      close: () => undefined,
      cookie: ownerResult.cookie,
      env,
      inbox,
      async ledger() {
        return (await a53Entitlements(ownerResult.cookie, env)).aiUsage;
      },
      onboarding,
      // The entitlements read seeds the pro grant; the meter's own
      // reservations then spend the balance without calling any engine.
      async spendAll() {
        const before = await this.balance();
        const { cloudCaptureFilingMeter, resolvePrincipal } = await import("../cloud-api");
        const resolved = await resolvePrincipal(new Request("https://pinar.test/api/account/entitlements", { headers: { cookie: ownerResult.cookie } }), env);
        if (!resolved) throw new Error("no principal");
        for (let i = 0; i < before; i++) {
          const state = await cloudCaptureFilingMeter(env, resolved, `drain_${i}`).reserve("mock");
          if (state !== "reserved") throw new Error(`the drain stopped at ${state}`);
        }
      },
    };
  });
}

const a53Runtimes: Array<{ name: string; useDb: boolean }> = [
  { name: "D1", useDb: true },
  { name: "memory", useDb: false },
];

// The capture_filing entries of the ledger: with the status (and the error
// code, that only the D1 read carries — the account view does not expose it).
const filingRows = (rows: A53LedgerEntry[], useDb: boolean) => rows
  .filter((entry) => entry.feature === "capture_filing")
  .map((entry) => (useDb ? [entry.status, entry.errorCode] : [entry.status]));

// The ledger read after a settlement that settled after the capture's
// deadline (the fire-and-forget refund): poll until the rows land, bounded.
async function settledRows(setup: A53Setup, count: number): Promise<A53LedgerEntry[]> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const rows = await setup.ledger();
    if (rows.length >= count) return rows;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  return setup.ledger();
}

async function ownerPrincipal(setup: A53Setup) {
  const { resolvePrincipal } = await import("../cloud-api");
  const principal = await resolvePrincipal(new Request("https://pinar.test/api/account/entitlements", { headers: { cookie: setup.cookie } }), setup.env);
  assert.ok(principal, "the owner principal");
  return principal;
}

for (const runtime of a53Runtimes) {
  describe(`cloud capture filing charges one credit when the engine is called (A53, ${runtime.name})`, () => {
    beforeEach(() => {
      resetCloudMemoryStateForTests();
      resetRetrievalCapabilitiesCacheForTests();
      setCloudNowForTests(NOW);
      appliance = fakeAppliance({ engine: "none" });
      setCloudFilingFetchForTests(((input: RequestInfo | URL, init?: RequestInit) => appliance.fetch(input, init)) as typeof fetch);
    });

    afterEach(() => {
      setCloudFilingFetchForTests(null);
      resetRetrievalCapabilitiesCacheForTests();
      resetCloudMemoryStateForTests();
    });

    test("with balance: one credit when the engine chooses a collection, and also when it answers the Inbox", async () => {
      const setup = await a53Setup(runtime.useDb);
      try {
        await writeOwnerDeliveryPreferences(setup.env, OWNER, { autoCaptureDestination: true });
        appliance = fakeAppliance({ decide: decideFor("Onboarding", 0.95), engine: "decisions" });

        const chosen = await shot(setup.env, setup.cookie, { id: "a53_chosen", title: "Onboarding" });
        assert.equal(chosen.filing.reason, "chosen");
        assert.equal(chosen.filing.collectionId, setup.onboarding);
        assert.equal(await setup.balance(), 499, "the charge of one credit");
        assert.deepEqual((await setup.ledger()).map((entry) => [entry.feature, entry.status, entry.credits]), [["capture_filing", "succeeded", 1]]);

        appliance = fakeAppliance({ decide: decideFor("Onboarding", 0.4), engine: "decisions" });
        const inbox = await shot(setup.env, setup.cookie, { id: "a53_inbox", title: "Onboarding" });
        assert.equal(inbox.filing.reason, "low_confidence", "the engine answered with the Inbox");
        assert.equal(inbox.filing.collectionId, null);
        assert.equal(inbox.destination.collectionId, setup.inbox, "the capture is in the Inbox");
        assert.equal(await setup.balance(), 498, "the answer to the Inbox charges the same one credit");
        const rows = await setup.ledger();
        assert.deepEqual(rows.map((entry) => [entry.feature, entry.status, entry.credits]).sort(), [
          ["capture_filing", "succeeded", 1],
          ["capture_filing", "succeeded", 1],
        ]);
      } finally {
        setup.close();
      }
    });

    test("without balance: the engine is not called and the capture is the Inbox with reason no_credits", async () => {
      const setup = await a53Setup(runtime.useDb);
      try {
        await writeOwnerDeliveryPreferences(setup.env, OWNER, { autoCaptureDestination: true });
        await setup.spendAll();
        assert.equal(await setup.balance(), 0, "the balance is spent before the capture");
        appliance = fakeAppliance({ decide: decideFor("Onboarding", 0.95), engine: "decisions" });

        const body = await shot(setup.env, setup.cookie, { id: "a53_poor", title: "Onboarding" });
        assert.equal(body.filing.reason, "no_credits");
        assert.equal(body.filing.collectionId, null);
        assert.equal(body.destination.collectionId, setup.inbox, "the capture still lands, in the Inbox");
        assert.equal(appliance.engineCalls().length, 0, "no engine call without credits");
        assert.deepEqual((await setup.ledger()).filter((entry) => entry.feature === "capture_filing" && entry.status === "succeeded"), [], "the capture itself was never reserved");
      } finally {
        setup.close();
      }
    });

    test("an engine that fails or never answers refunds the credit and leaves the capture in the Inbox", async () => {
      const setup = await a53Setup(runtime.useDb);
      try {
        await writeOwnerDeliveryPreferences(setup.env, OWNER, { autoCaptureDestination: true });

        // A 500 from the engine: the credit goes back as ai_inference_failed.
        appliance = fakeAppliance({ decide: () => new Response("boom", { status: 500 }), engine: "decisions" });
        const failed = await shot(setup.env, setup.cookie, { id: "a53_failed", title: "Onboarding" });
        assert.equal(failed.filing.reason, "error");
        assert.equal(failed.filing.collectionId, null);
        assert.equal(await setup.balance(), 500, "the refund");
        let rows = await setup.ledger();
        assert.deepEqual(filingRows(rows, runtime.useDb), runtime.useDb ? [["refunded", "ai_inference_failed"]] : [["refunded"]]);

        // An engine that is detected but never answers: the filing's deadline
        // fires and the reserved credit goes back. The deadline has fired by
        // the time the capture answers, so the refund settles after the
        // response: the read waits for it, bounded.
        appliance = fakeAppliance({ decide: () => new Promise<Response>(() => {}), engine: "decisions" });
        const timeout = await shot(setup.env, setup.cookie, { id: "a53_timeout", title: "Onboarding" });
        assert.equal(timeout.filing.reason, "timeout");
        assert.equal(timeout.filing.collectionId, null);
        assert.equal(timeout.destination.collectionId, setup.inbox);
        assert.equal(await setup.balance(), 500, "the second refund");
        rows = await settledRows(setup, 2);
        assert.deepEqual(filingRows(rows, runtime.useDb), runtime.useDb
          ? [["refunded", "ai_inference_failed"], ["refunded", "reservation_timeout"]]
          : [["refunded"], ["refunded"]]);
      } finally {
        setup.close();
      }
    });

    test("a re-upload of the same capture charges only once", async () => {
      const setup = await a53Setup(runtime.useDb);
      try {
        await writeOwnerDeliveryPreferences(setup.env, OWNER, { autoCaptureDestination: true });
        appliance = fakeAppliance({ decide: decideFor("Onboarding", 0.95), engine: "decisions" });

        const first = await shot(setup.env, setup.cookie, { id: "a53_once", title: "Onboarding" });
        assert.equal(first.filing.reason, "chosen");
        const replay = await shot(setup.env, setup.cookie, { id: "a53_once", title: "Onboarding again" });
        assert.equal(replay.filing.reason, "chosen", "the stored choice is replayed, not re-decided");
        assert.equal(await setup.balance(), 499, "one capture, one credit");
        const rows = await setup.ledger();
        assert.deepEqual(rows.map((entry) => [entry.feature, entry.status, entry.credits]), [["capture_filing", "succeeded", 1]], "the earlier row is found, whatever its status");
      } finally {
        setup.close();
      }
    });

    test("a refunded run is not a payment: the re-upload does not call the engine and the balance stays (F4d)", async () => {
      const setup = await a53Setup(runtime.useDb);
      try {
        await writeOwnerDeliveryPreferences(setup.env, OWNER, { autoCaptureDestination: true });
        appliance = fakeAppliance({ decide: () => new Response("boom", { status: 500 }), engine: "decisions" });
        const failed = await shot(setup.env, setup.cookie, { id: "a53_refunded", title: "Onboarding" });
        assert.equal(failed.filing.reason, "error");
        assert.equal(failed.destination.collectionId, setup.inbox, "the failed run left the capture in the Inbox");
        assert.equal(await setup.balance(), 500, "the refund of the failed run");

        // The engine would now decide: the re-upload must not call it.
        const decided = fakeAppliance({ decide: decideFor("Onboarding", 0.95), engine: "decisions" });
        appliance = decided;
        const reuploaded = await shot(setup.env, setup.cookie, { id: "a53_refunded", title: "Onboarding" });
        assert.equal(reuploaded.filing.reason, "error");
        assert.equal(reuploaded.destination.collectionId, setup.inbox, "the session keeps its destination (the Inbox)");
        assert.equal(decided.engineCalls().length, 0, "the engine is not called for a refunded capture");
        assert.equal(await setup.balance(), 500, "no new charge: a refund is not a payment");
      } finally {
        setup.close();
      }
    });

    test("a settled run is replayed: the re-upload is filed again without the engine and without a charge", async () => {
      const setup = await a53Setup(runtime.useDb);
      try {
        await writeOwnerDeliveryPreferences(setup.env, OWNER, { autoCaptureDestination: true });
        const decided = fakeAppliance({ decide: decideFor("Onboarding", 0.95), engine: "decisions" });
        appliance = decided;
        const first = await shot(setup.env, setup.cookie, { id: "a53_replay", title: "Onboarding" });
        assert.equal(first.filing.reason, "chosen");
        assert.equal(await setup.balance(), 499, "the charge of one credit");

        // The engine would now answer the Inbox (low confidence): the
        // re-upload must replay the stored choice, not re-decide.
        appliance = fakeAppliance({ decide: decideFor("Onboarding", 0.2), engine: "decisions" });
        const replay = await shot(setup.env, setup.cookie, { id: "a53_replay", title: "Onboarding again" });
        assert.equal(replay.filing.reason, "chosen", "the stored choice is replayed");
        assert.equal(replay.filing.collectionId, setup.onboarding);
        assert.equal(decided.engineCalls().length, 1, "the re-upload does not call the engine again");
        assert.equal(await setup.balance(), 499, "the re-upload does not charge again");
      } finally {
        setup.close();
      }
    });

    test("an open reservation of the capture keeps it in the Inbox without the engine and without a new charge", async () => {
      const setup = await a53Setup(runtime.useDb);
      try {
        await writeOwnerDeliveryPreferences(setup.env, OWNER, { autoCaptureDestination: true });
        const { cloudCaptureFilingMeter } = await import("../cloud-api");
        const principal = await ownerPrincipal(setup);
        const state = await cloudCaptureFilingMeter(setup.env, principal, "a53_open").reserve("mock");
        assert.equal(state, "reserved", "the reservation is left open (never settled)");
        assert.equal(await setup.balance(), 499, "the open reservation debits the balance");
        appliance = fakeAppliance({ decide: decideFor("Onboarding", 0.95), engine: "decisions" });

        const body = await shot(setup.env, setup.cookie, { id: "a53_open", title: "Onboarding" });
        assert.equal(body.filing.reason, "error", "the capture keeps the destination it has: the Inbox");
        assert.equal(body.filing.collectionId, null);
        assert.equal(appliance.engineCalls().length, 0, "the open reservation keeps the engine away");
        assert.equal(await setup.balance(), 499, "no second reservation");
      } finally {
        setup.close();
      }
    });

    test("two reservations of the same capture side by side: one debits, the other finds the row", async () => {
      const setup = await a53Setup(runtime.useDb);
      try {
        await writeOwnerDeliveryPreferences(setup.env, OWNER, { autoCaptureDestination: true });
        const { cloudCaptureFilingMeter } = await import("../cloud-api");
        const principal = await ownerPrincipal(setup);
        const meters = [
          cloudCaptureFilingMeter(setup.env, principal, "a53_race"),
          cloudCaptureFilingMeter(setup.env, principal, "a53_race"),
        ];
        const states = await Promise.all(meters.map((meter) => meter.reserve("mock")));
        assert.deepEqual(states.sort(), ["existing", "reserved"], "one reservation debits, the other finds the row");
        assert.equal(await setup.balance(), 499, "one credit");
        const rows = (await setup.ledger()).filter((entry) => entry.feature === "capture_filing");
        assert.equal(rows.length, 1, "the ledger has the reservation once");
      } finally {
        setup.close();
      }
    });

    test("a refunded run whose session moved keeps the new destination on the re-upload (F4d round 2)", async () => {
      const setup = await a53Setup(runtime.useDb);
      try {
        await writeOwnerDeliveryPreferences(setup.env, OWNER, { autoCaptureDestination: true });
        appliance = fakeAppliance({ decide: () => new Response("boom", { status: 500 }), engine: "decisions" });
        const failed = await shot(setup.env, setup.cookie, { id: "a53_moved", title: "Onboarding" });
        assert.equal(failed.destination.collectionId, setup.inbox);
        assert.equal(await setup.balance(), 500, "the refund of the failed run");

        // The owner moves the capture to Checkout.
        const move = await handleCloudApiRequest(new Request("https://pinar.test/api/sessions/a53_moved/move", {
          body: JSON.stringify({ collectionId: setup.checkout }),
          headers: { "content-type": "application/json", cookie: setup.cookie },
          method: "POST",
        }), setup.env);
        assert.equal(move.status, 200, await move.clone().text());

        // The re-upload must not call the engine and must not send the
        // capture back to the Inbox: it keeps where it is.
        const decided = fakeAppliance({ decide: decideFor("Onboarding", 0.95), engine: "decisions" });
        appliance = decided;
        const replay = await shot(setup.env, setup.cookie, { id: "a53_moved", title: "Onboarding" });
        assert.equal(decided.engineCalls().length, 0, "no engine for a refunded capture");
        assert.equal(replay.destination.collectionId, setup.checkout, "the moved session keeps its destination");
        assert.equal(await setup.balance(), 500, "no new charge");

        // The Inbox case is unchanged: a session the owner did not move
        // stays in the Inbox.
        appliance = fakeAppliance({ decide: () => new Response("boom", { status: 500 }), engine: "decisions" });
        const failedAgain = await shot(setup.env, setup.cookie, { id: "a53_moved_inbox", title: "Onboarding" });
        assert.equal(failedAgain.destination.collectionId, setup.inbox);
        const inboxReplay = await shot(setup.env, setup.cookie, { id: "a53_moved_inbox", title: "Onboarding" });
        assert.equal(inboxReplay.destination.collectionId, setup.inbox, "a session the owner kept in the Inbox stays there");
        assert.equal(await setup.balance(), 500);
      } finally {
        setup.close();
      }
    });

    test("with the switch off nothing is charged and no engine is called", async () => {
      const setup = await a53Setup(runtime.useDb);
      try {
        appliance = fakeAppliance({ decide: decideFor("Onboarding", 0.95), engine: "decisions" });

        const body = await shot(setup.env, setup.cookie, { collectionId: setup.checkout, id: "a53_off_1", title: "Onboarding" });
        assert.equal(body.destination.collectionId, setup.checkout);
        assert.equal("filing" in body, false);
        assert.equal(appliance.engineCalls().length, 0);
        assert.deepEqual(await setup.ledger(), [], "no reservation, no charge");
        assert.equal(await setup.balance(), 500, "the balance was never spent (the read itself seeds the grant)");
      } finally {
        setup.close();
      }
    });
  });
}
