// Cloud pin search (F3 contract §3.3): the cloud-api.ts wiring over a
// migrated SQLite-as-D1 (the model cloud-assistant.test.ts uses) and a fake
// fetch for the appliance. No real endpoint is reached.

import assert from "node:assert/strict";
import { Database } from "bun:sqlite";
import { readdirSync, readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, test } from "node:test";
import { MockLanguageModelV4 } from "ai/test";
import {
  cleanupOldRecords,
  cloudAssistantToolHost,
  cloudPinSearch,
  findAccessibleSession,
  handleCloudApiRequest,
  resetCloudMemoryStateForTests,
  seedCloudWebSessionForTests,
  setCloudNowForTests,
  type CloudEnv,
  type Principal,
} from "../../cloud-api";
import { runtimeEnv } from "../../cloud-env";
import { edgerCloudEnv } from "../../edger/env";
import { assistantMarginMonitor } from "../margin-monitor";
import { buildAssistantToolSet } from "../tools";
import { runAssistantTurn } from "../turn";
import { resetRetrievalCapabilitiesCacheForTests } from "./detect";
import { encodeVector, PIN_EMBEDDING_DIMENSIONS } from "./embeddings";
import type { PinIndexEntry, PinSearchService } from "./index";
import { embeddingIdentity } from "./index";
import {
  CLOUD_PIN_SEARCH_BUDGET_MS,
  CLOUD_PIN_SEARCH_MAX_SESSIONS,
  cloudOwnerPinIndexStore,
  cloudRetrievalEndpoints,
  createCloudPinSearch,
} from "./runtime-cloud";
import type { CloudPinSourceData, CloudPinSourceSession } from "./source-cloud";
import { cloudPinIndexStore } from "./store-cloud";

const NOW = "2026-10-01T12:00:00.000Z";
const BASE_URL = "http://127.0.0.1:9/v1";
const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);

// ---------- D1 shim (same model as cloud-assistant.test.ts), with a query log ----------

type QueryLog = Array<{ params: unknown[]; query: string }>;

function sqliteD1(db: Database, log: QueryLog = []): NonNullable<CloudEnv["DB"]> {
  const statement = (query: string) => {
    let params: unknown[] = [];
    const bound = {
      async all() {
        log.push({ params, query });
        return { results: db.query(query).all(...(params as never[])) as Record<string, unknown>[] };
      },
      bind(...values: unknown[]) {
        params = values.map((value) => value === undefined ? null : value);
        return bound;
      },
      async first() {
        log.push({ params, query });
        return (db.query(query).get(...(params as never[])) as Record<string, unknown> | null) ?? null;
      },
      async run() {
        log.push({ params, query });
        db.query(query).run(...(params as never[]));
        const changes = db.query("SELECT changes() AS changes").get() as { changes: number };
        return { meta: { changes: changes.changes } };
      },
    };
    return bound;
  };
  return {
    async batch(statements) {
      db.exec("BEGIN");
      try {
        const results = [];
        for (const item of statements) results.push(await item.run());
        db.exec("COMMIT");
        return results;
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    },
    prepare(query: string) {
      return statement(query);
    },
  };
}

const MIGRATIONS = new URL("../../../../migrations/", import.meta.url);

// Every migration, or all but those whose file name starts with `skip`.
function migratedDatabase(options: { skip?: string } = {}) {
  const db = new Database(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  for (const file of readdirSync(MIGRATIONS).filter((name) => name.endsWith(".sql")).sort()) {
    if (options.skip && file.startsWith(options.skip)) continue;
    db.exec(readFileSync(new URL(file, MIGRATIONS), "utf8"));
  }
  return db;
}

// ---------- seed helpers ----------

function insertUser(db: Database, id: string, plan: "free" | "pro") {
  db.query(
    "INSERT INTO users (id, email, plan, ever_paid, billing_status, created_at, updated_at) VALUES (?, ?, ?, 1, 'active', ?, ?)",
  ).run(id, `${id}@example.test`, plan, NOW, NOW);
}

function insertCollection(db: Database, id: string, ownerId: string) {
  db.query("INSERT OR IGNORE INTO projects (id, owner_id, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)")
    .run(`project_${ownerId}`, ownerId, `Project ${ownerId}`, NOW, NOW);
  db.query("INSERT INTO collections (id, project_id, owner_id, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)")
    .run(id, `project_${ownerId}`, ownerId, `Collection ${id}`, NOW, NOW);
}

function insertSession(db: Database, id: string, userId: string, collectionId: string, pins: unknown[], createdAt = "2026-09-30T00:00:00.000Z") {
  db.query(
    "INSERT INTO sessions (id, url, title, shot_id, shot_url, pin_count, pins_json, created_at, user_id, plan, is_permanent, byte_size, collection_id, position) "
      + "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pro', 1, 1, ?, 0)",
  ).run(id, `https://site.example/${id}`, `Title ${id}`, id, `https://pinar.test/shots/${id}.png`, pins.length, JSON.stringify(pins), createdAt, userId, collectionId);
}

function insertCollaborator(db: Database, id: string, collectionId: string, ownerId: string, userId: string, status: "accepted" | "pending" | "revoked") {
  db.query(
    "INSERT INTO collection_collaborators (id, collection_id, owner_id, email, user_id, status, created_at, updated_at, accepted_at, revoked_at) "
      + "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
  ).run(id, collectionId, ownerId, `${userId}@example.test`, userId, status, NOW, NOW, status === "accepted" ? NOW : null, status === "revoked" ? NOW : null);
}

function pinIndexRows(db: Database) {
  return db.query("SELECT session_id, pin_id, owner_id, model, caption FROM pin_index WHERE pin_id <> '' ORDER BY session_id, pin_id").all() as Array<{
    caption: string | null;
    model: string;
    owner_id: string;
    pin_id: string;
    session_id: string;
  }>;
}

function principal(id: string, plan: "free" | "pro" = "pro"): Principal {
  return { email: `${id}@example.test`, id, isPermanent: plan === "pro", kind: "account", plan };
}

// ---------- fake appliance and bucket ----------

function terms(text: string): string[] {
  return text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((term) => term.length > 2);
}

function fakeEmbedding(text: string): number[] {
  const vector = new Array<number>(PIN_EMBEDDING_DIMENSIONS).fill(0);
  vector[PIN_EMBEDDING_DIMENSIONS - 1] = 0.01;
  for (const term of terms(text)) {
    let hash = 0;
    for (const character of term) hash = (hash * 31 + character.charCodeAt(0)) % (PIN_EMBEDDING_DIMENSIONS - 1);
    vector[hash]! += 1;
  }
  return vector;
}

interface ApplianceCall {
  body: Record<string, any> | null;
  path: string;
}

// The appliance on a fake fetch: /models lists the chat model (with or
// without image input) and an embedding model; /embeddings answers
// bag-of-words vectors; a non-stream chat call is a vision call and gets a
// caption per marker; a stream chat call is the assistant turn, answered
// by `turn` when set.
function fakeAppliance(options: { model?: string; turn?: (body: Record<string, any>) => Response; vision?: boolean } = {}) {
  const calls: ApplianceCall[] = [];
  const fetchFn = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    const path = url.pathname.replace(/^\/v1/, "");
    const raw = input instanceof Request ? await input.text() : typeof init?.body === "string" ? init.body : "";
    const body = raw ? (JSON.parse(raw) as Record<string, any>) : null;
    calls.push({ body, path });
    if (url.origin !== new URL(BASE_URL).origin) return new Response("unexpected host", { status: 599 });
    if (path === "/models") {
      return Response.json({
        data: [
          { id: options.model ?? "mock", modalities: { input: options.vision ? ["text", "image"] : ["text"] }, type: "chat" },
          { id: "embed-model", type: "embedding" },
        ],
      });
    }
    if (path === "/embeddings") {
      return Response.json({ data: (body!.input as string[]).map((text, index) => ({ embedding: fakeEmbedding(text), index })) });
    }
    if (path === "/chat/completions" && body?.stream) {
      return options.turn ? options.turn(body) : new Response("no turn", { status: 500 });
    }
    if (path === "/chat/completions") {
      const markers = String(body!.messages[1].content[0].text);
      const pins = [...markers.matchAll(/^#(\d+):/gm)].map((match) => ({ caption: `legenda ${match[1]}`, number: Number(match[1]), ocr: "" }));
      return Response.json({ choices: [{ message: { content: JSON.stringify({ pins }), role: "assistant" } }] });
    }
    return new Response("not found", { status: 404 });
  }) as typeof fetch;
  return {
    calls,
    embeddings: () => calls.filter((call) => call.path === "/embeddings"),
    fetch: fetchFn,
    visions: () => calls.filter((call) => call.path === "/chat/completions" && !call.body?.stream),
  };
}

function fakeBucket(shots: Record<string, Uint8Array>): NonNullable<CloudEnv["PINAR_BUCKET"]> {
  return {
    async delete() {},
    async get(key: string) {
      const id = key.replace(/^shots\//, "").replace(/\.png$/, "");
      const bytes = shots[id];
      return bytes ? { body: new Response(bytes).body!, httpEtag: "etag", writeHttpMetadata() {} } : null;
    },
    async put() {},
  };
}

function cloudEnv(db: Database, overrides: Partial<CloudEnv> = {}, log?: QueryLog): CloudEnv {
  return {
    AI_API_KEY: "sk-ai-test",
    AI_BASE_URL: BASE_URL,
    AI_EMBEDDING_MODEL: "embed-model",
    AI_MODEL: "mock",
    ASSISTANT_ENABLED: "true",
    DB: sqliteD1(db, log),
    DEPLOYMENT_ENV: "staging",
    ...overrides,
  };
}

async function searchAs(env: CloudEnv, who: Principal, query: string, fetchFn: typeof fetch, limit = 20) {
  const service = await cloudPinSearch(env, who, { fetch: fetchFn });
  assert.ok(service, `${who.id} has a pin search`);
  const { hits } = await service.search({ limit, query });
  return hits;
}

// An appliance whose assistant turn calls pinar_pins_search once, then
// answers "Achei."; it records the tools offered and the tool results the
// model got back.
function scriptedTurnAppliance() {
  const offered: string[][] = [];
  const toolMessages: string[] = [];
  const sse = (chunks: unknown[]) =>
    new Response(`${chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join("")}data: [DONE]\n\n`, { headers: { "content-type": "text/event-stream" } });
  const chunk = (delta: Record<string, unknown>, finish: string | null = null) => ({
    choices: [{ delta, finish_reason: finish, index: 0 }], created: 1, id: "c1", model: "mock", object: "chat.completion.chunk",
  });
  const appliance = fakeAppliance({
    turn: (body) => {
      const tools = (body.tools ?? []) as Array<{ function: { name: string } }>;
      const toolResults = (body.messages as Array<{ content: unknown; role: string }>).filter((message) => message.role === "tool");
      if (toolResults.length === 0) {
        offered.push(tools.map((item) => item.function.name));
        return sse([
          chunk({ role: "assistant", tool_calls: [{ function: { arguments: JSON.stringify({ query: "contraste do botão" }), name: "pinar_pins_search" }, id: "call_1", index: 0, type: "function" }] }),
          chunk({}, "tool_calls"),
        ]);
      }
      toolMessages.push(...toolResults.map((message) => String(message.content)));
      return sse([chunk({ content: "Achei.", role: "assistant" }), chunk({}, "stop")]);
    },
  });
  return { appliance, offered, toolMessages };
}

// One assistant turn through handleCloudApiRequest, with the global fetch
// (the model's and the pin search's) on the fake appliance.
async function postTurn(env: CloudEnv, cookie: string, fetchFn: typeof fetch) {
  const realFetch = globalThis.fetch;
  globalThis.fetch = fetchFn;
  try {
    const response = await handleCloudApiRequest(new Request("https://pinar.test/api/assistant/turn", {
      body: JSON.stringify({ text: "onde falei de contraste?" }),
      headers: { cookie, "content-type": "application/json" },
      method: "POST",
    }), env);
    assert.equal(response.status, 200);
    assert.ok((await response.text()).includes("Achei."));
  } finally {
    globalThis.fetch = realFetch;
  }
}

// The world of the isolation tests: the owner shares one collection.
function sharedWorld(db: Database) {
  for (const id of ["usr_owner", "usr_collab", "usr_pending", "usr_revoked", "usr_third"]) insertUser(db, id, "pro");
  insertCollection(db, "col_shared", "usr_owner");
  insertCollection(db, "col_private", "usr_owner");
  insertCollection(db, "col_collab", "usr_collab");
  insertCollection(db, "col_third", "usr_third");
  insertSession(db, "ses_shared", "usr_owner", "col_shared", [{ comment: "Contraste baixo no botão comprar", number: 1, pinId: "pin_shared" }]);
  insertSession(db, "ses_private", "usr_owner", "col_private", [{ comment: "Contraste do rascunho privado", number: 1, pinId: "pin_private" }]);
  insertSession(db, "ses_collab", "usr_collab", "col_collab", [{ comment: "Contraste da página do colaborador", number: 1, pinId: "pin_collab" }]);
  insertSession(db, "ses_third", "usr_third", "col_third", [{ comment: "Contraste de outra conta", number: 1, pinId: "pin_third" }]);
  insertCollaborator(db, "collab_ok", "col_shared", "usr_owner", "usr_collab", "accepted");
  insertCollaborator(db, "collab_pending", "col_shared", "usr_owner", "usr_pending", "pending");
  insertCollaborator(db, "collab_revoked", "col_shared", "usr_owner", "usr_revoked", "revoked");
}

describe("Cloud pin search", () => {
  let db: Database;

  beforeEach(() => {
    resetCloudMemoryStateForTests();
    resetRetrievalCapabilitiesCacheForTests();
    setCloudNowForTests(NOW);
    db = migratedDatabase();
  });

  afterEach(() => {
    db.close();
    resetCloudMemoryStateForTests();
    resetRetrievalCapabilitiesCacheForTests();
    setCloudNowForTests(null);
  });

  test("an accepted collaborator finds a pin of the shared collection; entries stay with the session owner", async () => {
    sharedWorld(db);
    const appliance = fakeAppliance();
    const hits = await searchAs(cloudEnv(db), principal("usr_collab"), "contraste", appliance.fetch);
    assert.deepEqual(hits.map((hit) => [hit.sessionId, hit.pinId]).sort(), [["ses_collab", "pin_collab"], ["ses_shared", "pin_shared"]]);
    assert.deepEqual(pinIndexRows(db).map((row) => [row.session_id, row.owner_id]), [
      ["ses_collab", "usr_collab"],
      ["ses_shared", "usr_owner"],
    ]);
  });

  test("a pending or removed collaborator and a third party never find it, even once indexed", async () => {
    sharedWorld(db);
    const appliance = fakeAppliance();
    const env = cloudEnv(db);
    await searchAs(env, principal("usr_collab"), "contraste", appliance.fetch); // indexes ses_shared under the owner
    await searchAs(env, principal("usr_owner"), "contraste", appliance.fetch); // and ses_private
    for (const outsider of ["usr_pending", "usr_revoked", "usr_third"]) {
      const hits = await searchAs(env, principal(outsider), "contraste botão rascunho comprar privado", appliance.fetch);
      assert.deepEqual(
        hits.filter((hit) => hit.sessionId === "ses_shared" || hit.sessionId === "ses_private").map((hit) => hit.sessionId),
        [],
        outsider,
      );
    }
    assert.deepEqual(
      (await searchAs(env, principal("usr_third"), "contraste", appliance.fetch)).map((hit) => hit.sessionId),
      ["ses_third"],
      "a third party sees only its own pins",
    );
    const owners = new Map(pinIndexRows(db).map((row) => [row.session_id, row.owner_id]));
    assert.deepEqual(Object.fromEntries(owners), {
      ses_collab: "usr_collab",
      ses_private: "usr_owner",
      ses_shared: "usr_owner",
      ses_third: "usr_third",
    });
  });

  test("a shared collection of an owner who lost Pro is not searched", async () => {
    sharedWorld(db);
    db.query("UPDATE users SET plan = 'free' WHERE id = 'usr_owner'").run();
    const hits = await searchAs(cloudEnv(db), principal("usr_collab"), "contraste", fakeAppliance().fetch);
    assert.deepEqual(hits.map((hit) => hit.sessionId), ["ses_collab"]);
  });

  test("each owner's store is asked only for that owner's sessions", async () => {
    sharedWorld(db);
    const log: QueryLog = [];
    await searchAs(cloudEnv(db, {}, log), principal("usr_collab"), "contraste", fakeAppliance().fetch);
    const sessionOwner: Record<string, string> = { ses_collab: "usr_collab", ses_shared: "usr_owner" };
    const indexReads = log.filter((entry) => /FROM pin_index WHERE owner_id = \? AND session_id IN/.test(entry.query));
    assert.ok(indexReads.length > 0);
    for (const read of indexReads) {
      const [ownerId, ...ids] = read.params as string[];
      assert.ok(ids.length > 0);
      for (const id of ids) assert.equal(sessionOwner[id], ownerId, `${id} asked of ${ownerId}`);
    }
    assert.deepEqual([...new Set(indexReads.map((read) => read.params[0]))].sort(), ["usr_collab", "usr_owner"]);
  });

  test("the owner store never reads or writes a session outside its map", async () => {
    const store = cloudOwnerPinIndexStore({}, new Map([["s_a", "usr_a"], ["s_b", "usr_b"]]));
    const entry = (sessionId: string, pinId: string): PinIndexEntry => ({
      caption: null, docHash: "h", docText: "t", model: "", number: 1, ocr: null, pinId, sessionId, truncated: false, updatedAt: NOW, vector: null,
    });
    await store.replaceSession("s_a", [entry("s_a", "p1")]);
    await store.replaceSession("s_b", [entry("s_b", "p1")]);
    await assert.rejects(store.replaceSession("s_x", [entry("s_x", "p1")]), /no known owner/);
    assert.deepEqual(await cloudPinIndexStore({}, "usr_a").entries("s_a"), [entry("s_a", "p1")], "written to the owner's store");
    assert.deepEqual(await cloudPinIndexStore({}, "usr_a").entries("s_b"), [], "not to another owner's");
    assert.deepEqual(await cloudPinIndexStore({}, "usr_b").entries("s_b"), [entry("s_b", "p1")]);
    // A session another owner already indexed is still read through its own owner only.
    await cloudPinIndexStore({}, "usr_x").replaceSession("s_x", [entry("s_x", "p1")]);
    assert.deepEqual(await store.entries("s_x"), []);
    assert.deepEqual((await store.entriesFor(["s_b", "s_x", "s_a"])).map((item) => item.sessionId), ["s_b", "s_a"]);
    assert.deepEqual(
      await store.staleSessions({ limit: 10, sessions: [{ id: "s_x", updatedAt: "2099-01-01T00:00:00.000Z" }, { id: "s_a", updatedAt: "2099-01-01T00:00:00.000Z" }] }),
      ["s_a"],
    );
    await store.deleteSession("s_x");
    assert.equal((await cloudPinIndexStore({}, "usr_x").entries("s_x")).length, 1, "deleteSession outside the map touches nothing");
    await store.deleteSession("s_a");
    assert.deepEqual(await cloudPinIndexStore({}, "usr_a").entries("s_a"), []);
  });

  test("cloudPinSearch exists only while the assistant is available to the principal", async () => {
    insertUser(db, "usr_pro", "pro");
    const pro = principal("usr_pro");
    assert.ok(await cloudPinSearch(cloudEnv(db), pro));
    const off: Array<[string, Partial<CloudEnv>]> = [
      ["switch off", { ASSISTANT_ENABLED: undefined }],
      ["switch not true", { ASSISTANT_ENABLED: "1" }],
      ["no base URL", { AI_BASE_URL: undefined }],
      ["no key", { AI_API_KEY: undefined }],
      ["no model", { AI_MODEL: undefined }],
      ["a gateway chain without its key, in production", { ASSISTANT_CHAIN: "gateway:anthropic/claude-haiku-5.5", DEPLOYMENT_ENV: "production" }],
    ];
    for (const [name, overrides] of off) assert.equal(await cloudPinSearch(cloudEnv(db, overrides), pro), undefined, name);
    assert.equal(await cloudPinSearch(cloudEnv(db), principal("usr_free", "free")), undefined, "Free plan");
  });

  test("a turn with the assistant off or on a Free plan indexes nothing and fetches nothing", async () => {
    insertUser(db, "usr_pro", "pro");
    insertUser(db, "usr_free", "free");
    insertCollection(db, "col_pro", "usr_pro");
    insertCollection(db, "col_free", "usr_free");
    insertSession(db, "session_pro", "usr_pro", "col_pro", [{ comment: "Contraste", number: 1, pinId: "p1" }]);
    insertSession(db, "session_free", "usr_free", "col_free", [{ comment: "Contraste", number: 1, pinId: "p1" }]);
    const pro = await seedCloudWebSessionForTests({ email: "usr_pro@example.test", id: "usr_pro", plan: "pro" }, cloudEnv(db));
    const free = await seedCloudWebSessionForTests({ email: "usr_free@example.test", id: "usr_free", plan: "free" }, cloudEnv(db));
    const realFetch = globalThis.fetch;
    const appliance = fakeAppliance();
    globalThis.fetch = appliance.fetch;
    try {
      const turn = (env: CloudEnv, cookie: string) =>
        handleCloudApiRequest(new Request("https://pinar.test/api/assistant/turn", {
          body: JSON.stringify({ text: "onde falei de contraste?" }),
          headers: { cookie, "content-type": "application/json" },
          method: "POST",
        }), env);
      assert.equal((await turn(cloudEnv(db, { ASSISTANT_ENABLED: undefined }), pro.cookie)).status, 503);
      assert.equal((await turn(cloudEnv(db, { ASSISTANT_CHAIN: "gateway:anthropic/claude-haiku-5.5", DEPLOYMENT_ENV: "production" }), pro.cookie)).status, 503, "A46: production is off only without the hub configuration");
      assert.equal((await turn(cloudEnv(db), free.cookie)).status, 403);
    } finally {
      globalThis.fetch = realFetch;
    }
    assert.deepEqual(appliance.calls, []);
    assert.deepEqual(pinIndexRows(db), []);
  });

  test("a Pro turn offers pinar_pins_search and the model receives the hit", async () => {
    sharedWorld(db);
    const collab = await seedCloudWebSessionForTests({ email: "usr_collab@example.test", id: "usr_collab", plan: "pro" }, cloudEnv(db));
    const { appliance, offered, toolMessages } = scriptedTurnAppliance();
    await postTurn(cloudEnv(db), collab.cookie, appliance.fetch);
    assert.ok(offered[0]!.includes("pinar_pins_search"), JSON.stringify(offered));
    assert.equal(toolMessages.length, 1);
    assert.ok(toolMessages[0]!.includes("Contraste baixo no botão comprar"), toolMessages[0]);
    assert.ok(toolMessages[0]!.includes("ses_shared") && toolMessages[0]!.includes("pin_shared"));
    assert.ok(!toolMessages[0]!.includes("rascunho privado"), "the owner's private pin never reaches the collaborator");
  });

  test("a session captured after a search shows up in the next search", async () => {
    insertUser(db, "usr_pro", "pro");
    insertCollection(db, "col_pro", "usr_pro");
    insertSession(db, "session_old", "usr_pro", "col_pro", [{ comment: "Menu lateral sobreposto", number: 1, pinId: "p1" }]);
    const appliance = fakeAppliance();
    const env = cloudEnv(db);
    await searchAs(env, principal("usr_pro"), "checkout lento", appliance.fetch);
    assert.deepEqual(pinIndexRows(db).map((row) => row.session_id), ["session_old"]);
    insertSession(db, "session_new", "usr_pro", "col_pro", [{ comment: "Checkout lento no cartão", number: 1, pinId: "p1" }], "2026-10-01T11:00:00.000Z");
    const hits = await searchAs(env, principal("usr_pro"), "checkout lento", appliance.fetch);
    assert.equal(hits[0]!.sessionId, "session_new");
  });

  test("AI_EMBEDDING_MODEL reaches the turn through runtimeEnv: the turn embeds the question", async () => {
    sharedWorld(db);
    const collab = await seedCloudWebSessionForTests({ email: "usr_collab@example.test", id: "usr_collab", plan: "pro" }, cloudEnv(db));
    const queries = (calls: ApplianceCall[]) =>
      calls.filter((call) => call.path === "/embeddings" && call.body?.prompt_name === "query").map((call) => [call.body!.model, call.body!.input]);

    const withModel = scriptedTurnAppliance();
    await postTurn(runtimeEnv(cloudEnv(db)), collab.cookie, withModel.appliance.fetch);
    assert.deepEqual(queries(withModel.appliance.calls), [["embed-model", ["contraste do botão"]]]);
    assert.ok(withModel.toolMessages[0]!.includes("pin_shared"));

    resetRetrievalCapabilitiesCacheForTests();
    const withoutModel = scriptedTurnAppliance();
    await postTurn(runtimeEnv(cloudEnv(db, { AI_EMBEDDING_MODEL: undefined })), collab.cookie, withoutModel.appliance.fetch);
    assert.deepEqual(queries(withoutModel.appliance.calls), [], "without the env the turn searches by text");
    assert.ok(withoutModel.toolMessages[0]!.includes("pin_shared"));
  });

  test("with 25 pending sessions one search indexes 20 and the next one the rest", async () => {
    assert.equal(CLOUD_PIN_SEARCH_MAX_SESSIONS, 20);
    assert.equal(CLOUD_PIN_SEARCH_BUDGET_MS, 10_000);
    insertUser(db, "usr_pro", "pro");
    insertCollection(db, "col_pro", "usr_pro");
    for (let index = 0; index < 25; index += 1) {
      insertSession(db, `session_${String(index).padStart(2, "0")}`, "usr_pro", "col_pro", [{ comment: `Nota ${index}`, number: 1, pinId: "p1" }], `2026-09-${String(index + 1).padStart(2, "0")}T00:00:00.000Z`);
    }
    const appliance = fakeAppliance();
    const env = cloudEnv(db);
    await searchAs(env, principal("usr_pro"), "nota", appliance.fetch);
    const first = pinIndexRows(db).map((row) => row.session_id);
    assert.equal(first.length, 20);
    assert.ok(!first.includes("session_00") && !first.includes("session_04") && first.includes("session_24"), "the 20 newest first");
    await searchAs(env, principal("usr_pro"), "nota", appliance.fetch);
    assert.equal(pinIndexRows(db).length, 25);
  });

  test("vision (A23): no vision call without image input for AI_MODEL; one per session with it", async () => {
    insertUser(db, "usr_pro", "pro");
    insertCollection(db, "col_pro", "usr_pro");
    insertSession(db, "session_a", "usr_pro", "col_pro", [{ comment: "Primeiro", number: 1, pinId: "p1" }, { comment: "Segundo", number: 2, pinId: "p2" }]);
    insertSession(db, "session_b", "usr_pro", "col_pro", [{ comment: "Terceiro", number: 1, pinId: "p1" }]);
    const bucket = fakeBucket({ session_a: PNG, session_b: PNG });

    const textOnly = fakeAppliance({ vision: false });
    await searchAs(cloudEnv(db, { PINAR_BUCKET: bucket }), principal("usr_pro"), "primeiro", textOnly.fetch);
    assert.equal(textOnly.visions().length, 0);
    assert.deepEqual(pinIndexRows(db).map((row) => row.caption), [null, null, null]);

    db.query("DELETE FROM pin_index").run();
    resetRetrievalCapabilitiesCacheForTests();
    const withVision = fakeAppliance({ vision: true });
    await searchAs(cloudEnv(db, { PINAR_BUCKET: bucket }), principal("usr_pro"), "primeiro", withVision.fetch);
    assert.equal(withVision.visions().length, 2, "one vision call per session");
    for (const call of withVision.visions()) {
      assert.equal(call.body!.model, "mock");
      assert.ok(String(call.body!.messages[1].content[1].image_url.url).startsWith("data:image/png;base64,"));
    }
    assert.deepEqual(pinIndexRows(db).map((row) => row.caption), ["legenda 1", "legenda 2", "legenda 1"]);

    // Without a bucket, or without the session's object, there is no shot:
    // no vision call, and empty captions (A22).
    for (const bucketOverride of [{}, { PINAR_BUCKET: fakeBucket({ session_b: PNG }) }]) {
      db.query("DELETE FROM pin_index").run();
      const noShot = fakeAppliance({ vision: true });
      await searchAs(cloudEnv(db, bucketOverride), principal("usr_pro"), "primeiro", noShot.fetch);
      const captions = Object.fromEntries(pinIndexRows(db).map((row) => [`${row.session_id}/${row.pin_id}`, row.caption]));
      if ("PINAR_BUCKET" in bucketOverride) {
        assert.equal(noShot.visions().length, 1, "only the session with an object");
        assert.deepEqual(captions, { "session_a/p1": "", "session_a/p2": "", "session_b/p1": "legenda 1" });
      } else {
        assert.equal(noShot.visions().length, 0, "no bucket, no vision call");
        assert.deepEqual(captions, { "session_a/p1": "", "session_a/p2": "", "session_b/p1": "" });
      }
    }
  });

  test("without AI_EMBEDDING_MODEL the search is textual and makes no embedding call", async () => {
    insertUser(db, "usr_pro", "pro");
    insertCollection(db, "col_pro", "usr_pro");
    insertSession(db, "session_a", "usr_pro", "col_pro", [{ comment: "Contraste do rodapé", number: 1, pinId: "p1" }]);
    insertSession(db, "session_b", "usr_pro", "col_pro", [{ comment: "Menu lateral", number: 1, pinId: "p1" }]);
    const appliance = fakeAppliance();
    const hits = await searchAs(cloudEnv(db, { AI_EMBEDDING_MODEL: undefined }), principal("usr_pro"), "contraste", appliance.fetch);
    assert.deepEqual(hits.map((hit) => hit.sessionId), ["session_a"]);
    assert.deepEqual(appliance.embeddings(), []);
    assert.deepEqual([...new Set(pinIndexRows(db).map((row) => row.model))], [""], "text-only entries");
  });
});

describe("Cloud pin index invalidation", () => {
  const CREATED = "2026-09-30T00:00:00.000Z";
  let db: Database;

  beforeEach(() => {
    resetCloudMemoryStateForTests();
    resetRetrievalCapabilitiesCacheForTests();
    setCloudNowForTests(NOW);
    db = migratedDatabase();
  });

  afterEach(() => {
    db.close();
    resetCloudMemoryStateForTests();
    resetRetrievalCapabilitiesCacheForTests();
    setCloudNowForTests(null);
  });

  // One Pro session with two pins, a screenshot and a conversation comment,
  // indexed by a first search with vision and embeddings.
  async function indexedSession() {
    insertUser(db, "usr_pro", "pro");
    insertCollection(db, "col_pro", "usr_pro");
    insertCollection(db, "col_other", "usr_pro");
    insertSession(db, "session_one", "usr_pro", "col_pro", [
      { comment: "Primeira nota", number: 1, pinId: "p1" },
      { comment: "Segunda nota", number: 2, pinId: "p2" },
    ], CREATED);
    const env = cloudEnv(db, { PINAR_BUCKET: fakeBucket({ session_one: PNG }) });
    const appliance = fakeAppliance({ vision: true });
    // The assistant's write host: the MCP as the person, the path of a confirmed proposal.
    const host = cloudAssistantToolHost(env, principal("usr_pro"), "https://pinar.test", { writes: true });
    const web = await seedCloudWebSessionForTests({ email: "usr_pro@example.test", id: "usr_pro", plan: "pro" }, env);
    const added = (await host.callTool("pinar.add_pin_comment", { body: "Comentário inicial", pinId: "p2", sessionId: "session_one" })) as { comment: { id: string } };
    await searchAs(env, principal("usr_pro"), "nota", appliance.fetch);
    assert.equal(await stale(env), false, "indexed");
    return { appliance, commentId: added.comment.id, env, host, web };
  }

  async function stale(env: CloudEnv) {
    const listed = [{ id: "session_one", updatedAt: CREATED }];
    return (await cloudPinIndexStore(env, "usr_pro").staleSessions({ limit: 5, sessions: listed })).length === 1;
  }

  function documents() {
    return Object.fromEntries(
      (db.query("SELECT pin_id, doc_text FROM pin_index WHERE session_id = 'session_one' AND pin_id <> '' ORDER BY pin_id").all() as Array<{ doc_text: string; pin_id: string }>)
        .map((row) => [row.pin_id, row.doc_text]),
    );
  }

  async function reindex(context: Awaited<ReturnType<typeof indexedSession>>) {
    await searchAs(context.env, principal("usr_pro"), "nota", context.appliance.fetch);
    assert.equal(await stale(context.env), false, "the next pass indexed it");
  }

  async function web(context: Awaited<ReturnType<typeof indexedSession>>, method: string, path: string, body: unknown) {
    const response = await handleCloudApiRequest(new Request(`https://pinar.test${path}`, {
      body: JSON.stringify(body),
      headers: { cookie: context.web.cookie, "content-type": "application/json" },
      method,
    }), context.env);
    assert.equal(response.status, 200, `${method} ${path}: ${await response.clone().text()}`);
    return (await response.json()) as Record<string, any>;
  }

  test("a pin note edited on the web or over MCP makes the session stale; the next pass indexes the new note", async () => {
    const context = await indexedSession();
    await web(context, "PATCH", "/api/sessions/session_one/pins/p1", { comment: "Nota pela rota" });
    assert.equal(await stale(context.env), true);
    await reindex(context);
    assert.ok(documents().p1!.includes("Pin #1: Nota pela rota"), documents().p1);

    await context.host.callTool("pinar.edit_pin_note", { comment: "Nota pelo MCP", pinId: "p1", sessionId: "session_one" });
    assert.equal(await stale(context.env), true);
    await reindex(context);
    assert.ok(documents().p1!.includes("Pin #1: Nota pelo MCP"), documents().p1);
  });

  test("a new title makes the session stale; the next pass indexes it", async () => {
    const context = await indexedSession();
    await context.host.callTool("pinar.update_session", { page: { title: "Checkout novo" }, sessionId: "session_one" });
    assert.equal(await stale(context.env), true);
    await reindex(context);
    assert.ok(documents().p1!.startsWith("Page: Checkout novo"), documents().p1);
    assert.ok(documents().p2!.startsWith("Page: Checkout novo"), documents().p2);
  });

  test("a comment created, edited and deleted makes the session stale each time", async () => {
    const context = await indexedSession();
    const created = await web(context, "POST", "/api/sessions/session_one/pins/p1/comments", { body: "Comentário pela rota" });
    assert.equal(await stale(context.env), true, "created");
    await reindex(context);
    assert.ok(documents().p1!.includes("Comentário pela rota"));

    await web(context, "PATCH", `/api/sessions/session_one/pins/p1/comments/${created.comment.id}`, { body: "Comentário editado" });
    assert.equal(await stale(context.env), true, "edited on the web");
    await reindex(context);
    assert.ok(documents().p1!.includes("Comentário editado") && !documents().p1!.includes("Comentário pela rota"));

    await context.host.callTool("pinar.edit_pin_comment", { body: "Inicial editado", commentId: context.commentId, pinId: "p2", sessionId: "session_one" });
    assert.equal(await stale(context.env), true, "edited over MCP");
    await reindex(context);
    assert.ok(documents().p2!.includes("Inicial editado"));

    await context.host.callTool("pinar.delete_pin_comment", { commentId: context.commentId, pinId: "p2", sessionId: "session_one" });
    assert.equal(await stale(context.env), true, "deleted");
    await reindex(context);
    assert.ok(!documents().p2!.includes("Inicial editado"), documents().p2);
  });

  test("a pin deleted over MCP makes the session stale; the next pass drops its entry", async () => {
    const context = await indexedSession();
    await context.host.callTool("pinar.delete_pin", { pinId: "p2", sessionId: "session_one" });
    assert.equal(await stale(context.env), true);
    await reindex(context);
    assert.deepEqual(Object.keys(documents()), ["p1"]);
  });

  test("after a note edit only that pin is embedded again; the other keeps its vector and caption", async () => {
    const context = await indexedSession();
    const before = db.query("SELECT pin_id, vector, caption, doc_hash FROM pin_index WHERE session_id = 'session_one' AND pin_id <> '' ORDER BY pin_id").all() as Array<Record<string, unknown>>;
    const embeddings = context.appliance.embeddings().filter((call) => call.body?.prompt_name === "document").length;
    const visions = context.appliance.visions().length;
    await context.host.callTool("pinar.edit_pin_note", { comment: "Nota trocada", pinId: "p1", sessionId: "session_one" });
    await reindex(context);
    const documentsCalls = context.appliance.embeddings().filter((call) => call.body?.prompt_name === "document").slice(embeddings);
    assert.equal(documentsCalls.length, 1);
    assert.equal(documentsCalls[0]!.body!.input.length, 1, "only the edited pin");
    assert.ok(String(documentsCalls[0]!.body!.input[0]).includes("Nota trocada"));
    assert.equal(context.appliance.visions().length - visions, 1, "one vision call: a pin comment changed");
    const after = db.query("SELECT pin_id, vector, caption, doc_hash FROM pin_index WHERE session_id = 'session_one' AND pin_id <> '' ORDER BY pin_id").all() as Array<Record<string, unknown>>;
    assert.deepEqual(after[1], before[1], "p2 keeps vector, caption and document");
    assert.notDeepEqual(after[0]!.doc_hash, before[0]!.doc_hash);
    assert.equal(after[0]!.caption, "legenda 1");
  });

  test("moving the session to another collection does not make it stale", async () => {
    const context = await indexedSession();
    await context.host.callTool("pinar.move_session", { collectionId: "col_other", sessionId: "session_one" });
    assert.equal(await stale(context.env), false);
    const calls = context.appliance.calls.length;
    await searchAs(context.env, principal("usr_pro"), "nota", context.appliance.fetch);
    assert.deepEqual(context.appliance.calls.slice(calls).map((call) => [call.path, call.body?.prompt_name ?? null]), [["/embeddings", "query"]], "only the question is embedded");
  });

  test("best effort: without the pin_index table the writes still succeed", async () => {
    insertUser(db, "usr_pro", "pro");
    insertCollection(db, "col_pro", "usr_pro");
    insertSession(db, "session_one", "usr_pro", "col_pro", [{ comment: "Primeira nota", number: 1, pinId: "p1" }], CREATED);
    db.exec("DROP TABLE pin_index");
    const env = cloudEnv(db);
    const host = cloudAssistantToolHost(env, principal("usr_pro"), "https://pinar.test", { writes: true });
    await host.callTool("pinar.edit_pin_note", { comment: "Nota sem índice", pinId: "p1", sessionId: "session_one" });
    const added = (await host.callTool("pinar.add_pin_comment", { body: "Comentário sem índice", pinId: "p1", sessionId: "session_one" })) as { comment: { id: string } };
    await host.callTool("pinar.edit_pin_comment", { body: "Editado sem índice", commentId: added.comment.id, pinId: "p1", sessionId: "session_one" });
    await host.callTool("pinar.delete_pin_comment", { commentId: added.comment.id, pinId: "p1", sessionId: "session_one" });
    await host.callTool("pinar.delete_pin", { pinId: "p1", sessionId: "session_one" });
    const row = db.query("SELECT pin_count FROM sessions WHERE id = 'session_one'").get() as { pin_count: number };
    assert.equal(row.pin_count, 0, "every write landed");
  });
});

describe("Cloud pin search: access and the turn's deadline", () => {
  let db: Database;

  beforeEach(() => {
    resetCloudMemoryStateForTests();
    resetRetrievalCapabilitiesCacheForTests();
    setCloudNowForTests(NOW);
    db = migratedDatabase();
  });

  afterEach(() => {
    db.close();
    resetCloudMemoryStateForTests();
    resetRetrievalCapabilitiesCacheForTests();
    setCloudNowForTests(null);
  });

  test("a collaboration revoked during the search returns no hit of that session", async () => {
    sharedWorld(db);
    const env = cloudEnv(db);
    const appliance = fakeAppliance();
    let revoked = false;
    // The collaboration is revoked while the shared session's document is
    // being embedded: its entries get written, then access is gone.
    const revoking = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const body = typeof init?.body === "string" ? (JSON.parse(init.body) as Record<string, any>) : null;
      if (!revoked && body?.prompt_name === "document" && JSON.stringify(body.input).includes("botão comprar")) {
        db.query("UPDATE collection_collaborators SET status = 'revoked' WHERE id = 'collab_ok'").run();
        revoked = true;
      }
      return appliance.fetch(input, init);
    }) as typeof fetch;
    const hits = await searchAs(env, principal("usr_collab"), "contraste botão comprar", revoking);
    assert.equal(revoked, true);
    assert.equal(await findAccessibleSession(env, principal("usr_collab"), "ses_shared"), null, "access is gone now");
    assert.deepEqual(pinIndexRows(db).map((row) => row.session_id), ["ses_collab", "ses_shared"], "the shared session was indexed before the revocation");
    assert.deepEqual(hits.map((hit) => hit.sessionId), ["ses_collab"], "but none of its pins comes back");
    assert.ok(!JSON.stringify(hits).includes("botão comprar"));
  });

  // One Pro session through a fake data access, for the runtime alone.
  function oneSession(shot: boolean): CloudPinSourceData {
    const session: CloudPinSourceSession = {
      createdAt: "2026-09-30T00:00:00.000Z",
      id: "session_slow",
      page: { title: "Lenta", url: "https://site.example/lenta" },
      pins: [{ comment: "Nota lenta", coords: { x: 0, y: 0 }, number: 1, pinId: "p1", type: "point" }],
    };
    return {
      async comments() { return []; },
      async ownedSessions() { return [{ createdAt: session.createdAt, id: session.id, ownerId: "usr_pro" }]; },
      async session(id) { return id === session.id ? session : null; },
      async sharedSessions() { return []; },
      async shot() { return shot ? PNG : null; },
    };
  }

  const RUNTIME_ENV = { AI_API_KEY: "sk-ai-test", AI_BASE_URL: BASE_URL, AI_EMBEDDING_MODEL: "embed-model", AI_MODEL: "mock" };

  test("a search with slow vision ends near the indexing deadline; the session stays stale and a later search indexes it", async () => {
    const appliance = fakeAppliance({ vision: true });
    let visions = 0;
    // Vision never answers and ignores its signal.
    const slow = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const body = typeof init?.body === "string" ? (JSON.parse(init.body) as Record<string, any>) : null;
      if (body?.messages && !body.stream) {
        visions += 1;
        return new Promise<Response>(() => {});
      }
      return appliance.fetch(input, init);
    }) as typeof fetch;
    const started = Date.now();
    const result = await createCloudPinSearch({ data: oneSession(true), env: RUNTIME_ENV, fetch: slow, indexBudgetMs: 200 }).search({ limit: 5, query: "nota lenta" });
    const elapsed = Date.now() - started;
    assert.ok(elapsed >= 150 && elapsed < 2_000, `ended after ${elapsed} ms`);
    assert.equal(visions, 1);
    assert.equal(appliance.embeddings().filter((call) => call.body?.prompt_name === "document").length, 0, "no document embedding after the deadline");
    assert.equal(appliance.embeddings().filter((call) => call.body?.prompt_name === "query").length, 1, "the question still embedded, on the turn's signal");
    // The query was embedded, so the ranking that ran is the vector one —
    // with no vector to rank, the hits are empty and the answer says the
    // semantic one ran.
    assert.deepEqual(result, { hits: [], semantic: true });
    assert.deepEqual(await cloudPinIndexStore({}, "usr_pro").entries("session_slow"), [], "the cut session stays stale");

    const { hits: hitsLater } = await createCloudPinSearch({ data: oneSession(true), env: RUNTIME_ENV, fetch: appliance.fetch, indexBudgetMs: 200 }).search({ limit: 5, query: "nota lenta" });
    assert.deepEqual(hitsLater.map((hit) => [hit.sessionId, hit.caption]), [["session_slow", "legenda 1"]]);
  });

  test("once the turn aborts, the search starts no new request and cuts the one in flight", async () => {
    const appliance = fakeAppliance();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let afterOutcome = false;
    const requests: Array<{ afterOutcome: boolean; kind: string; signal: AbortSignal | null }> = [];
    const gated = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const body = typeof init?.body === "string" ? (JSON.parse(init.body) as Record<string, any>) : null;
      const kind = body?.prompt_name ?? (body ? "chat" : "models");
      requests.push({ afterOutcome, kind, signal: init?.signal ?? null });
      if (kind === "document") await gate; // the document embedding outlives the turn
      return appliance.fetch(input, init);
    }) as typeof fetch;
    const service = createCloudPinSearch({ data: oneSession(false), env: RUNTIME_ENV, fetch: gated });
    let searchDone: Promise<unknown> = Promise.resolve();
    const tracked: PinSearchService = {
      search(input) {
        const running = service.search(input);
        searchDone = running.catch(() => {});
        return running;
      },
    };
    const model = new MockLanguageModelV4({
      doStream: (async () => ({
        stream: new ReadableStream({
          start(controller) {
            controller.enqueue({ input: JSON.stringify({ limit: 5, query: "nota lenta" }), toolCallId: "call1", toolName: "pinar_pins_search", type: "tool-call" });
            controller.enqueue({ finishReason: { raw: "tool-calls", unified: "tool-calls" }, type: "finish", usage: { inputTokens: { total: 1 }, outputTokens: { total: 1 } } });
            controller.close();
          },
        }),
      })) as unknown as MockLanguageModelV4["doStream"],
      modelId: "mock",
    });
    const turn = runAssistantTurn({
      history: [{ role: "user", text: "onde falei da nota lenta?" }],
      model,
      system: "sys",
      thread: { id: "ath_test000000000000000000", title: "t" },
      timeoutMs: 40,
      tools: buildAssistantToolSet({ host: { callTool: async () => ({}) }, kinds: ["read"], pinSearch: tracked, surface: "cloud" }),
    });
    const reading = turn.response.text();
    const outcome = await turn.outcome;
    afterOutcome = true;
    await searchDone;
    release();
    await reading;
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(outcome.kind, "error");
    assert.equal(outcome.kind === "error" ? outcome.code : null, "ASSISTANT_TURN_TIMEOUT");
    assert.deepEqual(requests.filter((request) => request.afterOutcome), [], "no request after the turn ended");
    assert.ok(!requests.some((request) => request.kind === "query"), "the question was never embedded");
    const document = requests.find((request) => request.kind === "document");
    assert.ok(document, "the document embedding had started");
    assert.equal(document.signal?.aborted, true, "and its request was cut");
    assert.deepEqual(await cloudPinIndexStore({}, "usr_pro").entries("session_slow"), [], "the cut session stays stale");
  });
});
