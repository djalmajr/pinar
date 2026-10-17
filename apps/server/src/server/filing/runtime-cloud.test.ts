// Cloud capture filing (F3.5 contract §3.1): POST /api/shots and
// GET /api/preferences of cloud-api.ts over a migrated SQLite-as-D1 (the
// model cloud-assistant.test.ts uses) and a fake fetch for the appliance.
// No real endpoint is reached.

import assert from "node:assert/strict";
import { Database } from "bun:sqlite";
import { readdirSync, readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, test } from "node:test";
import {
  handleCloudApiRequest,
  resetCloudMemoryStateForTests,
  seedCloudWebSessionForTests,
  setCloudNowForTests,
  writeOwnerDeliveryPreferences,
  type CloudEnv,
} from "../cloud-api";
import { resetRetrievalCapabilitiesCacheForTests } from "../assistant/retrieval/detect";
import { encodeVector, PIN_EMBEDDING_DIMENSIONS } from "../assistant/retrieval/embeddings";
import { cloudPinIndexStore } from "../assistant/retrieval/store-cloud";
import { FILING_NONE_OPTION } from "./choose";
import { setCloudFilingFetchForTests } from "./runtime-cloud";

const NOW = "2026-10-17T12:00:00.000Z";
const VALID_PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
const BASE_URL = "http://127.0.0.1:9/v1";
const EMBEDDING_MODEL = "embed-model";
const DECISIONS_EXTRA = { available: true, endpoint: "/v1/decisions", experimental: true, scope: "decisions" };
const OWNER = "usr_owner";

// ---------- D1 shim (same model as cloud-mcp.test.ts) ----------

// Batches run one at a time, as D1 runs each batch as one transaction: two
// concurrent requests never open two transactions on the one connection.
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
        return (db.query(query).get(...params) as Record<string, unknown> | null) ?? null;
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
    model: item.model ?? EMBEDDING_MODEL,
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
}) {
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
          { ...(options.engine === "decisions" ? { decisions: DECISIONS_EXTRA } : {}), id: "mock", type: "chat" },
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
// A's whole request is done, so A claims the batch first. `beforeB` runs
// between the two.
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

  test("outside the gate (switch off, production, no Pro) the preference is ignored and nothing is fetched", async () => {
    const variants: Array<{ name: string; overrides: Partial<CloudEnv>; plan: "free" | "pro" }> = [
      { name: "assistant switch off", overrides: { ASSISTANT_ENABLED: "false" }, plan: "pro" },
      { name: "production", overrides: { DEPLOYMENT_ENV: "production" }, plan: "pro" },
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

        const body = await shot(env, cookie, { collectionId: "col_checkout", id: "cloud_gate_001", title: "Onboarding" });
        assert.equal(body.destination.collectionId, "col_checkout", variant.name);
        assert.equal("filing" in body, false, variant.name);
        assert.equal(appliance.calls.length, 0, variant.name);
        assert.equal(stored(db, "cloud_gate_001").filed_by, null, variant.name);
      } finally {
        db.close();
      }
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

  test("a re-upload of the same id follows the new decision", async () => {
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

      probability = 0.4;
      await shot(env, cookie, { id: "cloud_again", title: "Onboarding" });
      assert.deepEqual(stored(db, "cloud_again"), { batch_id: null, collection_id: "col_inbox", filed_by: null });

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
    // Mutation captured: an UPDATE without "IS NULL" lets B overwrite the claim and keep Onboarding.
    // Mutation captured: ignoring the value read back files B in Onboarding, splitting the batch.
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
      assert.deepEqual(b.filing, { collectionId: null, confidence: 0, engine: "none", reason: "error" });
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
    assert.deepEqual(await available({ DEPLOYMENT_ENV: "production" }, "decisions"), { calls: 0, value: false });
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
