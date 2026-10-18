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
import { PIN_EMBEDDING_DIMENSIONS } from "./embeddings";
import type { PinIndexEntry, PinSearchService } from "./index";
import { embeddingIdentity } from "./index";
import {
  CLOUD_PIN_SEARCH_BUDGET_MS,
  CLOUD_PIN_SEARCH_MAX_SESSIONS,
  cloudOwnerPinIndexStore,
  cloudRetrievalEndpoints,
  createByokTextPinSearch,
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
  return service.search({ limit, query });
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
    const hits = await createCloudPinSearch({ data: oneSession(true), env: RUNTIME_ENV, fetch: slow, indexBudgetMs: 200 }).search({ limit: 5, query: "nota lenta" });
    const elapsed = Date.now() - started;
    assert.ok(elapsed >= 150 && elapsed < 2_000, `ended after ${elapsed} ms`);
    assert.equal(visions, 1);
    assert.equal(appliance.embeddings().filter((call) => call.body?.prompt_name === "document").length, 0, "no document embedding after the deadline");
    assert.equal(appliance.embeddings().filter((call) => call.body?.prompt_name === "query").length, 1, "the question still embedded, on the turn's signal");
    assert.deepEqual(hits, []);
    assert.deepEqual(await cloudPinIndexStore({}, "usr_pro").entries("session_slow"), [], "the cut session stays stale");

    const hitsLater = await createCloudPinSearch({ data: oneSession(true), env: RUNTIME_ENV, fetch: appliance.fetch, indexBudgetMs: 200 }).search({ limit: 5, query: "nota lenta" });
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

// ---------- the BYOK text search's budget and the turn's abort (R2) ----------

describe("The BYOK text search's budget and the turn's abort (R2)", () => {
  const R2_SESSION: CloudPinSourceSession = {
    createdAt: "2026-10-17T12:00:00.000Z",
    id: "ses_byok_r2",
    page: { title: "Página", url: "https://exemplo.test" },
    pins: [{ comment: "alfinete da agulha", coords: { x: 0, y: 0 }, number: 1, pinId: "pin_r2", type: "point" }],
  };
  const R2_ROW = { createdAt: R2_SESSION.createdAt, id: R2_SESSION.id, ownerId: "usr_byok" };
  const R2_OLD_ROW = { createdAt: "2026-10-16T00:00:00.000Z", id: "ses_byok_r2_old", ownerId: "usr_byok" };
  const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

  // The reviewer's budget probe, the fixed behavior: a pending read does
  // not hold the search past the budget, and no read starts after it.
  test("a pending read does not hold the search past the budget: it settles with what it built and starts no new read", async () => {
    let release!: () => void;
    let markStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let sessionReads = 0;
    let commentsReads = 0;
    const data: CloudPinSourceData = {
      async comments() {
        commentsReads += 1;
        return [];
      },
      async ownedSessions() {
        return [R2_ROW];
      },
      async session() {
        sessionReads += 1;
        if (sessionReads === 1) {
          markStarted();
          await held;
        }
        return R2_SESSION;
      },
      async sharedSessions() {
        return [];
      },
      async shot() {
        return null;
      },
    };
    const begin = performance.now();
    const pending = createByokTextPinSearch({ budgetMs: 150, data, env: {} }).search({ limit: 5, query: "agulha" });
    await started;
    let settled = false;
    const done = pending.then((hits) => {
      settled = true;
      return hits;
    });
    await sleep(400);
    assert.equal(settled, true, `the search settled right after the budget, while the read is still held (t=${Math.round(performance.now() - begin)} ms)`);
    assert.ok(performance.now() - begin < 1_000, "at the budget, not after the read");
    assert.deepEqual(await done, [], "the held read never contributed");
    release();
    await sleep(20);
    assert.equal(sessionReads, 1, "no session read starts after the budget");
    assert.equal(commentsReads, 0, "no comments read starts after the budget");
  });

  test("the search settles at the budget with a pending read in flight and starts no new read", async () => {
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let sessionReads = 0;
    let commentsReads = 0;
    const data: CloudPinSourceData = {
      async comments() {
        commentsReads += 1;
        return [];
      },
      async ownedSessions() {
        return [R2_ROW, R2_OLD_ROW];
      },
      async session(id) {
        sessionReads += 1;
        if (id === R2_OLD_ROW.id) await held; // the older session's read is held
        return id === R2_ROW.id || id === R2_OLD_ROW.id ? { ...R2_SESSION, id } : null;
      },
      async sharedSessions() {
        return [];
      },
      async shot() {
        return null;
      },
    };
    const pending = createByokTextPinSearch({ budgetMs: 150, data, env: {} }).search({ limit: 5, query: "agulha" });
    const hits = await Promise.race([
      pending,
      new Promise<never>((_resolve, reject) => setTimeout(() => reject(new Error("not settled after the budget")), 800)),
    ]);
    // Nothing resolved at the budget answers; the built-but-unresolved
    // session does not hold the search either.
    assert.deepEqual(hits, []);
    // The reads the search started at the budget: the first session's
    // build, its comments' access re-check, the second session's in-flight
    // build. Nothing more may start, even after the held read is released.
    const sessionReadsAtBudget = sessionReads;
    const commentsReadsAtBudget = commentsReads;
    release();
    await sleep(20);
    assert.equal(sessionReads, sessionReadsAtBudget, "no session read starts after the budget");
    assert.equal(commentsReads, commentsReadsAtBudget, "the held session's comments never start");
  });

  // The reviewer's cancel probe, the fixed behavior: the abort ends the
  // search with the caller's reason (the gateway search's answer) and no
  // read starts after it.
  test("the turn's abort ends the search with the caller's reason and starts no new read", async () => {
    const controller = new AbortController();
    let release!: () => void;
    let markStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let sessionReads = 0;
    let commentsAfterAbort = 0;
    const data: CloudPinSourceData = {
      async comments() {
        if (controller.signal.aborted) commentsAfterAbort += 1;
        return [];
      },
      async ownedSessions() {
        return [R2_ROW];
      },
      async session() {
        sessionReads += 1;
        if (sessionReads === 1) {
          markStarted();
          await held;
        }
        return R2_SESSION;
      },
      async sharedSessions() {
        return [];
      },
      async shot() {
        return null;
      },
    };
    const cancel = new Error("client cancelled turn");
    const pending = createByokTextPinSearch({ data, env: {} }).search({ limit: 5, query: "agulha", signal: controller.signal });
    await started;
    controller.abort(cancel);
    release();
    await assert.rejects(
      pending,
      (reason: unknown) => reason === cancel,
      "the search ends with the caller's reason, as the gateway search does",
    );
    assert.equal(commentsAfterAbort, 0, "no comments read starts after the abort");
    assert.equal(sessionReads, 1, "no session read starts after the abort");
  });

  test("an already aborted turn's signal starts no read", async () => {
    const controller = new AbortController();
    const cancel = new Error("client cancelled turn");
    controller.abort(cancel);
    let sessionReads = 0;
    let commentsReads = 0;
    const data: CloudPinSourceData = {
      async comments() {
        commentsReads += 1;
        return [];
      },
      async ownedSessions() {
        return [R2_ROW];
      },
      async session() {
        sessionReads += 1;
        return R2_SESSION;
      },
      async sharedSessions() {
        return [];
      },
      async shot() {
        return null;
      },
    };
    await assert.rejects(
      createByokTextPinSearch({ data, env: {} }).search({ limit: 5, query: "agulha", signal: controller.signal }),
      (reason: unknown) => reason === cancel,
    );
    assert.equal(sessionReads + commentsReads, 0, "no read starts");
  });

  // The reviewer's nested probe, the fixed behavior (R2 recheck): the
  // comments' inner access recheck is held when the abort happens; the
  // search ends with the caller's reason, and the abandoned continuation
  // starts no comments read after it — the data's guard refuses the new
  // operation — and the abandoned chain's rejection is observed, not left
  // unhandled.
  test("an abandoned comments access recheck starts no comments read after the abort", async () => {
    const controller = new AbortController();
    let release!: () => void;
    let markStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let sessionReads = 0;
    let commentsBeforeRelease = 0;
    let commentsAfterAbort = 0;
    const data: CloudPinSourceData = {
      async comments() {
        if (controller.signal.aborted) commentsAfterAbort += 1;
        else commentsBeforeRelease += 1;
        return [];
      },
      async ownedSessions() {
        return [R2_ROW];
      },
      async session() {
        sessionReads += 1;
        if (sessionReads === 2) {
          markStarted();
          await held;
        }
        return R2_SESSION;
      },
      async sharedSessions() {
        return [];
      },
      async shot() {
        return null;
      },
    };
    const unhandled: unknown[] = [];
    const listener = (event: unknown) => unhandled.push(event);
    process.on("unhandledRejection", listener);
    try {
      const cancel = new Error("client cancelled during the comments access recheck");
      const pending = createByokTextPinSearch({ data, env: {} }).search({ limit: 5, query: "agulha", signal: controller.signal });
      await started;
      controller.abort(cancel);
      await assert.rejects(
        pending,
        (reason: unknown) => reason === cancel,
        "the search ends with the caller's reason, as the gateway search does",
      );
      assert.equal(commentsBeforeRelease, 0, "no comments read before the release");
      release();
      await sleep(30);
      assert.equal(commentsAfterAbort, 0, "the abandoned continuation starts no comments read after the abort");
      assert.equal(sessionReads, 2, "no session read starts after the abort");
      assert.equal(unhandled.length, 0, "the abandoned chain's rejection is observed, not left unhandled");
    } finally {
      process.off("unhandledRejection", listener);
    }
  });

  // The deadline with the inner read held (R2 recheck): the search
  // settles at the budget with what it already resolved, and the
  // abandoned continuation (the comments read after the access recheck)
  // starts no new read and leaves no unhandled rejection.
  test("the deadline settles the search with a pending inner read: the continuation starts no new read and no rejection is unhandled", async () => {
    let release!: () => void;
    let markStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let sessionReads = 0;
    let commentsReads = 0;
    const data: CloudPinSourceData = {
      async comments() {
        commentsReads += 1;
        return [];
      },
      async ownedSessions() {
        return [R2_ROW];
      },
      async session() {
        sessionReads += 1;
        if (sessionReads === 2) {
          markStarted();
          await held;
        }
        return R2_SESSION;
      },
      async sharedSessions() {
        return [];
      },
      async shot() {
        return null;
      },
    };
    const unhandled: unknown[] = [];
    const listener = (event: unknown) => unhandled.push(event);
    process.on("unhandledRejection", listener);
    try {
      const begin = performance.now();
      const pending = createByokTextPinSearch({ budgetMs: 150, data, env: {} }).search({ limit: 5, query: "agulha" });
      await started;
      const hits = await Promise.race([
        pending,
        new Promise<never>((_resolve, reject) => setTimeout(() => reject(new Error("not settled after the budget")), 800)),
      ]);
      assert.ok(performance.now() - begin < 1_000, "at the budget, not after the read");
      assert.deepEqual(hits, [], "the held read never contributed");
      assert.equal(commentsReads, 0, "no comments read before the release");
      release();
      await sleep(30);
      assert.equal(commentsReads, 0, "the abandoned continuation starts no comments read after the budget");
      assert.equal(unhandled.length, 0, "the abandoned chain's rejection is observed, not left unhandled");
    } finally {
      process.off("unhandledRejection", listener);
    }
  });
});

// ---------- production through the gateway (F4 contract §4) ----------

const GATEWAY_URL = "https://ai-gateway.vercel.sh/v1";
const GATEWAY_KEY = "vck-gateway-test";
const GATEWAY_EMBEDDING = "openai/text-embedding-3-small";
const CHAIN = "gateway:anthropic/claude-haiku-5.5,gateway:deepseek/deepseek-v4.1-flash";

// The gateway catalog (GET /v1/models): an embedding model listed before
// the configured one, the chain's models with or without the vision tag,
// and a decisions extra the gateway path must never read.
function gatewayCatalog(visionTagged: string[]) {
  return [
    { id: "openai/text-embedding-3-large", pricing: { input: "0.00000013" }, tags: null, type: "embedding" },
    ...["anthropic/claude-haiku-5.5", "deepseek/deepseek-v4.1-flash"].map((id) => ({
      decisions: { available: true },
      id,
      modalities: { input: ["text", "image"] },
      pricing: { input: "0.0000001", output: "0.0000005" },
      tags: visionTagged.includes(id) ? ["tool-use", "vision"] : ["tool-use"],
      type: "language",
    })),
    { id: GATEWAY_EMBEDDING, pricing: { input: "0.00000002", output: null }, tags: null, type: "embedding" },
  ];
}

interface HubCall {
  authorization: string | null;
  body: Record<string, any> | null;
  method: string;
  origin: string;
  path: string;
}

// The two hubs on one fake fetch: the gateway (catalog, /embeddings with
// its cost in providerMetadata, captions with usage only) and, at
// BASE_URL, an appliance that answers everything, so a request that
// reaches AI_BASE_URL would succeed and only the recorded origin shows it.
function fakeHubs(options: { model?: string; visionTagged?: string[] } = {}) {
  const calls: HubCall[] = [];
  const appliance = fakeAppliance({ model: options.model, vision: true });
  const fetchFn = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    const raw = input instanceof Request ? await input.clone().text() : typeof init?.body === "string" ? init.body : "";
    const body = raw ? (JSON.parse(raw) as Record<string, any>) : null;
    const path = url.pathname.replace(/^\/v1/, "");
    calls.push({ authorization: new Headers(init?.headers).get("authorization"), body, method: init?.method ?? "GET", origin: url.origin, path });
    if (url.origin !== new URL(GATEWAY_URL).origin) return appliance.fetch(input, init);
    if (path === "/models") return Response.json({ data: gatewayCatalog(options.visionTagged ?? ["anthropic/claude-haiku-5.5"]), object: "list" });
    if (path === "/embeddings") {
      const texts = body!.input as string[];
      return Response.json({
        data: texts.map((text, index) => ({ embedding: fakeEmbedding(text), index, object: "embedding" })),
        model: body!.model,
        object: "list",
        providerMetadata: { gateway: { cost: "0.00000012", routing: {} } },
        usage: { prompt_tokens: texts.length * 7, total_tokens: texts.length * 7 },
      });
    }
    if (path === "/chat/completions" && !body?.stream) {
      const markers = String(body!.messages[1].content[0].text);
      const pins = [...markers.matchAll(/^#(\d+):/gm)].map((match) => ({ caption: `legenda ${match[1]}`, number: Number(match[1]), ocr: "" }));
      return Response.json({
        choices: [{ finish_reason: "stop", index: 0, message: { content: JSON.stringify({ pins }), role: "assistant" } }],
        usage: { completion_tokens: 200, prompt_tokens: 1000 },
      });
    }
    return new Response("not found", { status: 404 });
  }) as typeof fetch;
  const gatewayOrigin = new URL(GATEWAY_URL).origin;
  return {
    applianceCalls: () => calls.filter((call) => call.origin !== gatewayOrigin),
    calls,
    embeddings: () => calls.filter((call) => call.origin === gatewayOrigin && call.path === "/embeddings"),
    fetch: fetchFn,
    gatewayCalls: () => calls.filter((call) => call.origin === gatewayOrigin),
    visions: () => calls.filter((call) => call.origin === gatewayOrigin && call.path === "/chat/completions"),
  };
}

// Production with a gateway chain; the appliance's AI_* stay set, so a
// path that used them would reach BASE_URL.
function productionEnv(db: Database, overrides: Partial<CloudEnv> = {}, log?: QueryLog): CloudEnv {
  return cloudEnv(db, {
    AI_EMBEDDING_MODEL: GATEWAY_EMBEDDING,
    AI_GATEWAY_API_KEY: GATEWAY_KEY,
    ASSISTANT_CHAIN: CHAIN,
    DEPLOYMENT_ENV: "production",
    ...overrides,
  }, log);
}

const PRIVACY = { gateway: { disallowPromptTraining: true } };
const PRIVACY_ZDR = { gateway: { disallowPromptTraining: true, zeroDataRetention: true } };

// console.log lines of `run` that are assistant_index_cost lines, raw.
async function indexCostLines(run: () => Promise<unknown>): Promise<string[]> {
  const lines: string[] = [];
  const original = console.log;
  console.log = (...args: unknown[]) => {
    if (typeof args[0] === "string" && args[0].includes("assistant_index_cost")) lines.push(args[0]);
    else original(...args);
  };
  try {
    await run();
  } finally {
    console.log = original;
  }
  return lines;
}

describe("Cloud pin search in production, through the gateway (F4 contract §4)", () => {
  let db: Database;

  beforeEach(() => {
    resetCloudMemoryStateForTests();
    resetRetrievalCapabilitiesCacheForTests();
    setCloudNowForTests(NOW);
    db = migratedDatabase();
    insertUser(db, "usr_pro", "pro");
    insertCollection(db, "col_pro", "usr_pro");
    insertSession(db, "session_a", "usr_pro", "col_pro", [{ comment: "Contraste baixo no rodapé", number: 1, pinId: "p1" }, { comment: "Menu cortado", number: 2, pinId: "p2" }]);
    insertSession(db, "session_b", "usr_pro", "col_pro", [{ comment: "Preço errado no carrinho", number: 1, pinId: "p1" }]);
  });

  afterEach(() => {
    db.close();
    resetCloudMemoryStateForTests();
    resetRetrievalCapabilitiesCacheForTests();
    setCloudNowForTests(null);
  });

  const shots = () => fakeBucket({ session_a: PNG, session_b: PNG });

  test("captions and embeddings go to the gateway with its key and the privacy options; nothing reaches AI_BASE_URL", async () => {
    const hubs = fakeHubs();
    const hits = await searchAs(productionEnv(db, { PINAR_BUCKET: shots() }), principal("usr_pro"), "contraste", hubs.fetch);
    assert.equal(hits[0]!.sessionId, "session_a");
    assert.deepEqual(hubs.applianceCalls(), [], "no request to AI_BASE_URL");
    assert.deepEqual([...new Set(hubs.gatewayCalls().map((call) => `${call.method} ${call.path}`))].sort(), [
      "GET /models",
      "POST /chat/completions",
      "POST /embeddings",
    ]);
    // The public catalog is read without the key.
    for (const call of hubs.gatewayCalls().filter((item) => item.path === "/models")) assert.equal(call.authorization, null);

    // Documents and the question: the configured model, never the catalog's
    // first embedding, no prompt_name.
    assert.ok(hubs.embeddings().length >= 2);
    for (const call of hubs.embeddings()) {
      assert.equal(call.authorization, `Bearer ${GATEWAY_KEY}`);
      assert.deepEqual(Object.keys(call.body!).sort(), ["dimensions", "input", "model", "providerOptions"]);
      assert.equal(call.body!.model, GATEWAY_EMBEDDING);
      assert.equal(call.body!.dimensions, PIN_EMBEDDING_DIMENSIONS);
      assert.deepEqual(call.body!.providerOptions, PRIVACY);
    }
    // One caption call per session, by the chain's first link.
    assert.equal(hubs.visions().length, 2);
    for (const call of hubs.visions()) {
      assert.equal(call.authorization, `Bearer ${GATEWAY_KEY}`);
      assert.equal(call.body!.model, "anthropic/claude-haiku-5.5");
      assert.deepEqual(call.body!.providerOptions, PRIVACY);
      assert.equal(call.body!.chat_template_kwargs, undefined);
    }
    assert.deepEqual(pinIndexRows(db).map((row) => [row.session_id, row.caption, row.model]), [
      ["session_a", "legenda 1", GATEWAY_EMBEDDING],
      ["session_a", "legenda 2", GATEWAY_EMBEDDING],
      ["session_b", "legenda 1", GATEWAY_EMBEDDING],
    ]);
  });

  test("without AI_EMBEDDING_MODEL, or with one the catalog does not list as embedding, the search is textual", async () => {
    for (const AI_EMBEDDING_MODEL of [undefined, "", "anthropic/claude-haiku-5.5", "openai/text-embedding-9"]) {
      db.query("DELETE FROM pin_index").run();
      resetRetrievalCapabilitiesCacheForTests();
      const hubs = fakeHubs();
      const hits = await searchAs(productionEnv(db, { AI_EMBEDDING_MODEL }), principal("usr_pro"), "contraste", hubs.fetch);
      assert.deepEqual(hits.map((hit) => hit.sessionId), ["session_a"], String(AI_EMBEDDING_MODEL));
      assert.deepEqual(hubs.embeddings(), [], `no embedding call with ${AI_EMBEDDING_MODEL}`);
      assert.deepEqual(hubs.applianceCalls(), [], String(AI_EMBEDDING_MODEL));
      assert.deepEqual([...new Set(pinIndexRows(db).map((row) => row.model))], [""], "text-only entries");
    }
  });

  test("captions follow the vision tag of the chain's first link, not of a later one", async () => {
    const untagged = fakeHubs({ visionTagged: ["deepseek/deepseek-v4.1-flash"] });
    await searchAs(productionEnv(db, { PINAR_BUCKET: shots() }), principal("usr_pro"), "contraste", untagged.fetch);
    assert.deepEqual(untagged.visions(), [], "the first link has no vision tag");
    assert.deepEqual(pinIndexRows(db).map((row) => row.caption), [null, null, null]);

    db.query("DELETE FROM pin_index").run();
    resetRetrievalCapabilitiesCacheForTests();
    const swapped = fakeHubs({ visionTagged: ["deepseek/deepseek-v4.1-flash"] });
    await searchAs(
      productionEnv(db, { ASSISTANT_CHAIN: "gateway:deepseek/deepseek-v4.1-flash,gateway:anthropic/claude-haiku-5.5", PINAR_BUCKET: shots() }),
      principal("usr_pro"),
      "contraste",
      swapped.fetch,
    );
    assert.deepEqual(swapped.visions().map((call) => call.body!.model), ["deepseek/deepseek-v4.1-flash", "deepseek/deepseek-v4.1-flash"]);
    assert.deepEqual(swapped.applianceCalls(), []);
  });

  test("a search indexes through the gateway too, with zero data retention when the env asks for it", async () => {
    const hubs = fakeHubs();
    const hits = await searchAs(productionEnv(db, { AI_GATEWAY_ZERO_DATA_RETENTION: "true", PINAR_BUCKET: shots() }), principal("usr_pro"), "contraste", hubs.fetch);
    assert.equal(hits[0]!.sessionId, "session_a");
    assert.deepEqual(hubs.applianceCalls(), []);
    assert.equal(hubs.embeddings().length, 3, "one document batch per session and the question");
    assert.equal(hubs.visions().length, 2);
    for (const call of [...hubs.embeddings(), ...hubs.visions()]) {
      assert.equal(call.authorization, `Bearer ${GATEWAY_KEY}`);
      assert.deepEqual(call.body!.providerOptions, PRIVACY_ZDR);
    }
    // Any other value is off.
    db.query("DELETE FROM pin_index").run();
    resetRetrievalCapabilitiesCacheForTests();
    const off = fakeHubs();
    await searchAs(productionEnv(db, { AI_GATEWAY_ZERO_DATA_RETENTION: "TRUE", PINAR_BUCKET: shots() }), principal("usr_pro"), "contraste", off.fetch);
    assert.deepEqual(off.embeddings()[0]!.body!.providerOptions, PRIVACY);
  });

  test("assistant_index_cost: one line per embedding batch and per caption, without the key, a URL or the person's text", async () => {
    const hubs = fakeHubs();
    const lines = await indexCostLines(() =>
      searchAs(productionEnv(db, { PINAR_BUCKET: shots() }), principal("usr_pro"), "contraste do rodapé", hubs.fetch));
    const parsed = lines.map((line) => JSON.parse(line) as Record<string, unknown>);
    assert.equal(parsed.filter((line) => line["kind"] === "embedding").length, hubs.embeddings().length);
    assert.equal(parsed.filter((line) => line["kind"] === "caption").length, hubs.visions().length);
    for (const line of parsed) {
      assert.deepEqual(Object.keys(line), ["message", "kind", "model", "costUsdMicros", "costSource"]);
    }
    // Embeddings: the gateway's figure (0.00000012 USD → 1 micro). Captions:
    // no cost in the body, so ASSISTANT_MODEL_PRICES × usage (1000 × 0.00000055
    // + 200 × 0.00000275 = 0.0011 USD).
    assert.deepEqual(new Set(parsed.map((line) => JSON.stringify(line))), new Set([
      JSON.stringify({ message: "assistant_index_cost", kind: "embedding", model: GATEWAY_EMBEDDING, costUsdMicros: 1, costSource: "gateway" }),
      JSON.stringify({ message: "assistant_index_cost", kind: "caption", model: "anthropic/claude-haiku-5.5", costUsdMicros: 1100, costSource: "table" }),
    ]));
    for (const line of lines) {
      for (const leak of [GATEWAY_KEY, "sk-ai-test", "https://", "ai-gateway", "127.0.0.1", "/v1", "Contraste", "contraste", "rodapé", "Preço", "Menu", "legenda", "base64"]) {
        assert.ok(!line.includes(leak), `${leak} in ${line}`);
      }
    }
  });

  test("the appliance logs no assistant_index_cost line", async () => {
    const lines = await indexCostLines(() =>
      searchAs(cloudEnv(db, { PINAR_BUCKET: shots() }), principal("usr_pro"), "contraste", fakeAppliance({ vision: true }).fetch));
    assert.deepEqual(lines, []);
  });

  test("the runtime alone has no endpoint when the first link's hub lacks its configuration, in every environment (A46)", async () => {
    const data: CloudPinSourceData = {
      async comments() { return []; },
      async ownedSessions() { return [{ createdAt: "2026-09-30T00:00:00.000Z", id: "session_x", ownerId: "usr_pro" }]; },
      async session(id) {
        return { createdAt: "2026-09-30T00:00:00.000Z", id, page: { title: "T", url: "https://u.example" }, pins: [{ comment: "Nota", coords: { x: 0, y: 0 }, number: 1, pinId: "p1", type: "point" }] };
      },
      async sharedSessions() { return []; },
      async shot() { return PNG; },
    };
    const base = { AI_API_KEY: "sk-ai-test", AI_BASE_URL: BASE_URL, AI_EMBEDDING_MODEL: "embed-model", AI_MODEL: "mock" };
    const variants: Array<[string, Record<string, string | undefined>]> = [
      ["an invalid chain", { ASSISTANT_CHAIN: "gateway" }],
      ["a gateway chain without AI_GATEWAY_API_KEY", { ASSISTANT_CHAIN: CHAIN }],
      ["an appliance chain without AI_BASE_URL", { ASSISTANT_CHAIN: "appliance:mock", AI_BASE_URL: undefined }],
      ["an appliance chain without AI_API_KEY", { ASSISTANT_CHAIN: "appliance:mock", AI_API_KEY: undefined }],
    ];
    for (const deployment of ["production", "staging", undefined] as const) {
      for (const [name, overrides] of variants) {
        const label = `${deployment ?? "development"}: ${name}`;
        const hubs = fakeHubs();
        const env = { ...base, DEPLOYMENT_ENV: deployment, ...overrides };
        await assert.rejects(createCloudPinSearch({ data, env, fetch: hubs.fetch }).search({ limit: 5, query: "nota" }), /pin search unavailable/, label);
        assert.deepEqual(hubs.calls, [], label);
      }
    }
  });
});

describe("Cloud pin search in production, through the appliance (A46)", () => {
  let db: Database;

  beforeEach(() => {
    resetCloudMemoryStateForTests();
    resetRetrievalCapabilitiesCacheForTests();
    setCloudNowForTests(NOW);
    db = migratedDatabase();
    insertUser(db, "usr_pro", "pro");
    insertCollection(db, "col_pro", "usr_pro");
    insertSession(db, "session_a", "usr_pro", "col_pro", [{ comment: "Contraste baixo no rodapé", number: 1, pinId: "p1" }, { comment: "Menu cortado", number: 2, pinId: "p2" }]);
    insertSession(db, "session_b", "usr_pro", "col_pro", [{ comment: "Preço errado no carrinho", number: 1, pinId: "p1" }]);
  });

  afterEach(() => {
    db.close();
    resetCloudMemoryStateForTests();
    resetRetrievalCapabilitiesCacheForTests();
    setCloudNowForTests(null);
  });

  const shots = () => fakeBucket({ session_a: PNG, session_b: PNG });
  const APPLIANCE_ORIGIN = new URL(BASE_URL).origin;
  // Production with the appliance chain of A46: the same configuration as
  // staging, only DEPLOYMENT_ENV changes.
  function applianceProductionEnv(overrides: Partial<CloudEnv> = {}): CloudEnv {
    // The chain's appliance link carries the chat model; AI_MODEL is absent
    // (A46).
    return cloudEnv(db, { AI_GATEWAY_API_KEY: undefined, AI_EMBEDDING_MODEL: "embed-model", AI_MODEL: undefined, ASSISTANT_CHAIN: "appliance:qwen3.8-27b", DEPLOYMENT_ENV: "production", ...overrides });
  }

  test("captions and embeddings use AI_BASE_URL and the chain link's model, and nothing reaches the gateway", async () => {
    const hubs = fakeHubs({ model: "qwen3.8-27b" });
    const hits = await searchAs(applianceProductionEnv({ PINAR_BUCKET: shots() }), principal("usr_pro"), "contraste", hubs.fetch);
    assert.equal(hits[0]!.sessionId, "session_a");
    assert.deepEqual(hubs.gatewayCalls(), [], "no request to the gateway");
    const appliance = hubs.applianceCalls();
    assert.ok(appliance.length > 0);
    for (const call of appliance) assert.equal(call.origin, APPLIANCE_ORIGIN, "every call goes to AI_BASE_URL");
    // Embeddings by AI_EMBEDDING_MODEL, on the appliance, with its key.
    const embeddings = appliance.filter((call) => call.path === "/embeddings");
    assert.ok(embeddings.length >= 2, "the documents and the question");
    for (const call of embeddings) {
      assert.equal(call.authorization, "Bearer sk-ai-test");
      assert.equal(call.body!.model, "embed-model");
      assert.equal(call.body!.dimensions, PIN_EMBEDDING_DIMENSIONS);
    }
    // Captions by the chain's appliance link model (no AI_MODEL), on the
    // appliance's chat endpoint.
    const visions = appliance.filter((call) => call.path === "/chat/completions" && !call.body?.stream);
    assert.equal(visions.length, 2, "one caption per session");
    for (const call of visions) {
      assert.equal(call.authorization, "Bearer sk-ai-test");
      assert.equal(call.body!.model, "qwen3.8-27b");
    }
    assert.deepEqual(pinIndexRows(db).map((row) => [row.session_id, row.caption, row.model]), [
      ["session_a", "legenda 1", embeddingIdentity({ baseUrl: BASE_URL, model: "embed-model" })],
      ["session_a", "legenda 2", embeddingIdentity({ baseUrl: BASE_URL, model: "embed-model" })],
      ["session_b", "legenda 1", embeddingIdentity({ baseUrl: BASE_URL, model: "embed-model" })],
    ]);
  });

  test("the hub of the first link is the same in production, staging and development (A46)", async () => {
    for (const deployment of ["production", "staging", undefined] as const) {
      const label = String(deployment ?? "development");
      db.query("DELETE FROM pin_index").run();
      resetRetrievalCapabilitiesCacheForTests();
      const applianceHubs = fakeHubs({ model: "qwen3.8-27b" });
      await searchAs(
        cloudEnv(db, { AI_GATEWAY_API_KEY: undefined, AI_EMBEDDING_MODEL: "embed-model", ASSISTANT_CHAIN: "appliance:qwen3.8-27b", DEPLOYMENT_ENV: deployment, PINAR_BUCKET: shots() }),
        principal("usr_pro"),
        "contraste",
        applianceHubs.fetch,
      );
      assert.deepEqual(applianceHubs.gatewayCalls(), [], label);
      assert.ok(applianceHubs.calls.some((call) => call.origin === APPLIANCE_ORIGIN && call.path === "/embeddings"), label);

      db.query("DELETE FROM pin_index").run();
      resetRetrievalCapabilitiesCacheForTests();
      const gatewayHubs = fakeHubs();
      await searchAs(
        cloudEnv(db, { AI_GATEWAY_API_KEY: GATEWAY_KEY, AI_EMBEDDING_MODEL: GATEWAY_EMBEDDING, ASSISTANT_CHAIN: CHAIN, DEPLOYMENT_ENV: deployment, PINAR_BUCKET: shots() }),
        principal("usr_pro"),
        "contraste",
        gatewayHubs.fetch,
      );
      assert.deepEqual(gatewayHubs.applianceCalls(), [], label);
      assert.ok(gatewayHubs.embeddings().length > 0, label);
    }
  });
  test("an explicit appliance chain without AI_MODEL: the gate opens and retrieval uses the link's model (A46)", async () => {
    const env = applianceProductionEnv();
    const health = await handleCloudApiRequest(new Request("https://pinar.test/api/health"), env);
    assert.ok(health, "the health answer");
    assert.equal((await health.json()).hasAssistant, true);
    // The capability probe is the only fetch; the fake answers /models.
    const appliance = fakeAppliance({ model: "qwen3.8-27b", vision: true });
    const endpoints = await cloudRetrievalEndpoints(env, appliance.fetch);
    assert.ok(endpoints, "the gate's configuration has retrieval endpoints");
    assert.equal(endpoints.chat?.model, "qwen3.8-27b");
    assert.equal(endpoints.chat?.baseUrl, BASE_URL);
    assert.equal(endpoints.decisions, null);
    assert.equal(endpoints.embedding?.model, "embed-model");
  });

  test("without ASSISTANT_CHAIN the default chain keeps using AI_MODEL", async () => {
    const mustNotFetch = async (): Promise<Response> => {
      throw new Error("must not fetch");
    };
    // No chain: the appliance's chat model is AI_MODEL itself.
    const defaultAppliance = fakeAppliance({ vision: true });
    const defaults = await cloudRetrievalEndpoints(cloudEnv(db, { AI_GATEWAY_API_KEY: undefined }), defaultAppliance.fetch);
    assert.equal(defaults?.chat?.model, "mock");
    // Without AI_MODEL and without a chain there is no chat model, hence no
    // endpoint.
    const bare = await cloudRetrievalEndpoints(cloudEnv(db, { AI_GATEWAY_API_KEY: undefined, AI_MODEL: undefined }), mustNotFetch);
    assert.equal(bare, null);
  });
});

describe("Cloud index costs recorded for the margin monitor (F4 contract §3)", () => {
  let db: Database;

  beforeEach(() => {
    resetCloudMemoryStateForTests();
    resetRetrievalCapabilitiesCacheForTests();
    setCloudNowForTests(NOW);
    db = migratedDatabase();
    insertUser(db, "usr_pro", "pro");
    insertCollection(db, "col_pro", "usr_pro");
    insertSession(db, "session_a", "usr_pro", "col_pro", [{ comment: "Contraste baixo no rodapé", number: 1, pinId: "p1" }, { comment: "Menu cortado", number: 2, pinId: "p2" }]);
    insertSession(db, "session_b", "usr_pro", "col_pro", [{ comment: "Preço errado no carrinho", number: 1, pinId: "p1" }]);
  });

  afterEach(() => {
    db.close();
    resetCloudMemoryStateForTests();
    resetRetrievalCapabilitiesCacheForTests();
    setCloudNowForTests(null);
  });

  const shots = () => fakeBucket({ session_a: PNG, session_b: PNG });
  const costRows = () => db.query("SELECT kind, model, cost_usd_micros, cost_source, created_at FROM assistant_index_costs ORDER BY kind, rowid").all() as Array<{
    cost_source: string;
    cost_usd_micros: number | null;
    created_at: string;
    kind: string;
    model: string;
  }>;
  // Silences the cost and failure lines of a run, and returns them.
  async function quietly(run: () => Promise<unknown>): Promise<string[]> {
    const lines: string[] = [];
    const saved = [console.log, console.error] as const;
    console.log = console.error = (...args: unknown[]) => {
      lines.push(args.map(String).join(" "));
    };
    try {
      await run();
    } finally {
      [console.log, console.error] = saved;
    }
    return lines;
  }

  test("a search through the gateway records each cost with its source, at the Cloud's clock", async () => {
    const hubs = fakeHubs();
    await quietly(() => searchAs(productionEnv(db, { PINAR_BUCKET: shots() }), principal("usr_pro"), "contraste", hubs.fetch));
    const embeddings = hubs.embeddings().length;
    assert.ok(embeddings >= 2, "the documents and the question");
    // Embeddings: the gateway's figure (0.00000012 USD → 1 micro). Captions:
    // ASSISTANT_MODEL_PRICES × usage (1100 micros), as the log lines say.
    assert.deepEqual(costRows(), [
      ...hubs.visions().map(() => ({ cost_source: "table", cost_usd_micros: 1100, created_at: NOW, kind: "caption", model: "anthropic/claude-haiku-5.5" })),
      ...hubs.embeddings().map(() => ({ cost_source: "gateway", cost_usd_micros: 1, created_at: NOW, kind: "embedding", model: GATEWAY_EMBEDDING })),
    ]);
    assert.equal(hubs.visions().length, 2);
  });

  test("the appliance records nothing", async () => {
    const appliance = fakeAppliance({ vision: true });
    await searchAs(cloudEnv(db, { PINAR_BUCKET: shots() }), principal("usr_pro"), "contraste", appliance.fetch);
    assert.ok(appliance.embeddings().length > 0 && appliance.visions().length > 0, "the appliance did embed and caption");
    assert.deepEqual(costRows(), []);
  });

  test("a failing recorder never breaks the search", async () => {
    db.query("DROP TABLE assistant_index_costs").run();
    const hubs = fakeHubs();
    let hits: Awaited<ReturnType<typeof searchAs>> = [];
    const searchLines = await quietly(async () => {
      hits = await searchAs(productionEnv(db, { PINAR_BUCKET: shots() }), principal("usr_pro"), "contraste", hubs.fetch);
    });
    assert.equal(hits[0]!.sessionId, "session_a");
    assert.deepEqual(pinIndexRows(db).map((row) => [row.session_id, row.caption, row.model]), [
      ["session_a", "legenda 1", GATEWAY_EMBEDDING],
      ["session_a", "legenda 2", GATEWAY_EMBEDDING],
      ["session_b", "legenda 1", GATEWAY_EMBEDDING],
    ]);
    assert.equal(searchLines.filter((line) => line.includes("assistant_index_cost_record_failed")).length, hubs.embeddings().length + hubs.visions().length);
  });

  test("with a turn's revenue, the index costs the producer recorded raise index_cost over 20% of it, and not below", async () => {
    // One assistant turn of 3 credits: 9000 USD micros of revenue in the window.
    db.query("INSERT INTO ai_credit_grants (id, owner_type, owner_id, source_type, source_id, credits, consumed_credits, created_at) VALUES ('grant_pro', 'account', 'usr_pro', 'purchase', 'purchase_pro', 500, 0, ?)").run(NOW);
    db.query("INSERT INTO ai_credit_usages (id, request_id, owner_type, owner_id, grant_id, feature, resource_id, model, credits, status, created_at) VALUES ('turn_1', 'turn:m1', 'account', 'usr_pro', 'grant_pro', 'assistant_turn', 'assistant:t1', 'gateway:anthropic/claude-haiku-5.5', 3, 'reserved', ?)").run(NOW);
    db.query("UPDATE ai_credit_usages SET status = 'succeeded', cost_usd_micros = 900, result_json = ?, completed_at = ? WHERE id = 'turn_1'")
      .run(JSON.stringify({ costSource: "gateway", fallback: false, link: 0 }), NOW);
    const later = new Date(Date.parse(NOW) + 60_000);
    const indexAlerts = async () => {
      let alerts: Array<{ alert: string }> = [];
      await quietly(async () => {
        const saved = [console.warn, console.info] as const;
        console.warn = console.info = () => {};
        try {
          alerts = (await assistantMarginMonitor(productionEnv(db), later)).alerts.filter((alert) => alert.alert === "index_cost");
        } finally {
          [console.warn, console.info] = saved;
        }
      });
      return alerts;
    };

    // Without shots, only embeddings (1 micro each): far below 20% of 9000.
    await quietly(() => searchAs(productionEnv(db), principal("usr_pro"), "contraste", fakeHubs().fetch));
    const embeddingsOnly = costRows().reduce((sum, row) => sum + (row.cost_usd_micros ?? 0), 0);
    assert.ok(embeddingsOnly > 0 && embeddingsOnly * 5 <= 9000, String(embeddingsOnly));
    assert.deepEqual(await indexAlerts(), []);

    // With the shots, two captions at 1100 each: over 1800.
    db.query("DELETE FROM pin_index").run();
    await quietly(() => searchAs(productionEnv(db, { PINAR_BUCKET: shots() }), principal("usr_pro"), "contraste", fakeHubs().fetch));
    const recorded = costRows().reduce((sum, row) => sum + (row.cost_usd_micros ?? 0), 0);
    assert.ok(recorded * 5 > 9000, String(recorded));
    assert.deepEqual(await indexAlerts(), [{ alert: "index_cost", indexCostUsdMicros: recorded, revenueUsdMicros: 9000 }]);
  });
});

describe("Cloud pin search outside production with ASSISTANT_CHAIN", () => {
  let db: Database;

  beforeEach(() => {
    resetCloudMemoryStateForTests();
    resetRetrievalCapabilitiesCacheForTests();
    setCloudNowForTests(NOW);
    db = migratedDatabase();
    insertUser(db, "usr_pro", "pro");
    insertCollection(db, "col_pro", "usr_pro");
    insertSession(db, "session_a", "usr_pro", "col_pro", [{ comment: "Contraste baixo no rodapé", number: 1, pinId: "p1" }]);
  });

  afterEach(() => {
    db.close();
    resetCloudMemoryStateForTests();
    resetRetrievalCapabilitiesCacheForTests();
    setCloudNowForTests(null);
  });

  test("the first link picks the hub: an appliance first keeps AI_BASE_URL as before; a gateway first uses the gateway", async () => {
    const cases: Array<[string, "appliance" | "gateway"]> = [
      ["appliance:mock", "appliance"],
      [`appliance:mock,${CHAIN}`, "appliance"],
      [CHAIN, "gateway"],
      [`${CHAIN},appliance:mock`, "gateway"],
    ];
    for (const [chain, hub] of cases) {
      db.query("DELETE FROM pin_index").run();
      resetRetrievalCapabilitiesCacheForTests();
      const hubs = fakeHubs();
      const env = cloudEnv(db, { AI_GATEWAY_API_KEY: GATEWAY_KEY, ASSISTANT_CHAIN: chain, ...(hub === "gateway" ? { AI_EMBEDDING_MODEL: GATEWAY_EMBEDDING } : {}) });
      await searchAs(env, principal("usr_pro"), "contraste", hubs.fetch);
      const embeddings = hubs.calls.filter((call) => call.path === "/embeddings");
      assert.ok(embeddings.length > 0, chain);
      if (hub === "appliance") {
        assert.deepEqual(hubs.gatewayCalls(), [], chain);
        for (const call of embeddings) {
          assert.deepEqual([call.authorization, call.body!.model, call.body!.providerOptions], ["Bearer sk-ai-test", "embed-model", undefined], chain);
          assert.ok(["document", "query"].includes(call.body!.prompt_name), chain);
        }
      } else {
        assert.deepEqual(hubs.applianceCalls(), [], chain);
        for (const call of embeddings) assert.deepEqual([call.authorization, call.body!.providerOptions], [`Bearer ${GATEWAY_KEY}`, PRIVACY], chain);
      }
    }
  });
});

describe("AI_EMBEDDING_MODEL in the EdgeR env", () => {
  const ai = { AI_API_KEY: "sk", AI_BASE_URL: "https://ai.example.invalid/v1", AI_MODEL: "chat-model", AI_TRANSCRIPTION_MODEL: "whisper" };
  const read = (values: Record<string, string>) => (name: string) => values[name];

  test("is optional and its absence never turns the AI off", () => {
    const without = edgerCloudEnv(read(ai));
    assert.equal(without.AI_MODEL, "chat-model");
    assert.ok(without.AI);
    assert.equal(without.AI_EMBEDDING_MODEL, undefined);
    assert.equal(edgerCloudEnv(read({ ...ai, AI_EMBEDDING_MODEL: "  " })).AI_EMBEDDING_MODEL, undefined, "blank is absent");
    assert.equal(edgerCloudEnv(read({ ...ai, AI_EMBEDDING_MODEL: "embeddinggemma-300m" })).AI_EMBEDDING_MODEL, "embeddinggemma-300m");
  });

  test("alone, without the AI group, it neither completes the group nor fails (A46)", () => {
    const env = edgerCloudEnv(read({ AI_EMBEDDING_MODEL: "embeddinggemma-300m" }));
    assert.equal(env.AI, undefined);
    assert.equal(env.AI_BASE_URL, undefined);
    // The embedding model is the assistant's own option: it stands alone,
    // inert without a hub configuration.
    assert.equal(env.AI_EMBEDDING_MODEL, "embeddinggemma-300m");
    assert.throws(() => edgerCloudEnv(read({ AI_EMBEDDING_MODEL: "embeddinggemma-300m", AI_MODEL: "chat-model" })), /incomplete AI configuration: missing AI_API_KEY, AI_BASE_URL, AI_TRANSCRIPTION_MODEL/);
  });
});

describe("the filing similarity thresholds in the EdgeR env (F3.5 §1)", () => {
  const read = (values: Record<string, string>) => (name: string) => values[name];

  test("are optional, passed as text, and outside every group", () => {
    const without = edgerCloudEnv(read({}));
    assert.equal(without.FILING_SIMILARITY_MIN, undefined);
    assert.equal(without.FILING_SIMILARITY_MARGIN, undefined);
    const withBoth = edgerCloudEnv(read({ FILING_SIMILARITY_MARGIN: "0.02", FILING_SIMILARITY_MIN: "0.65" }));
    assert.equal(withBoth.FILING_SIMILARITY_MIN, "0.65");
    assert.equal(withBoth.FILING_SIMILARITY_MARGIN, "0.02");
    // One alone stands: no group validation, and a blank is absent.
    const withOne = edgerCloudEnv(read({ FILING_SIMILARITY_MIN: "0.65" }));
    assert.equal(withOne.FILING_SIMILARITY_MIN, "0.65");
    assert.equal(withOne.FILING_SIMILARITY_MARGIN, undefined);
    assert.equal(edgerCloudEnv(read({ FILING_SIMILARITY_MIN: "  " })).FILING_SIMILARITY_MIN, undefined, "blank is absent");
  });

  test("an invalid value is passed as is: the fallback happens where it is read", () => {
    const env = edgerCloudEnv(read({ FILING_SIMILARITY_MARGIN: "abc", FILING_SIMILARITY_MIN: "1.5" }));
    assert.equal(env.FILING_SIMILARITY_MIN, "1.5");
    assert.equal(env.FILING_SIMILARITY_MARGIN, "abc");
  });
});

// Code can ship before migration 0029 runs: deleting a session and the
// retention cleanup must keep working without the pin_index table, and
// clean the index once it exists.
describe("Cloud session deletes before and after migration 0029", () => {
  let db: Database;

  beforeEach(() => {
    resetCloudMemoryStateForTests();
    setCloudNowForTests(NOW);
  });

  afterEach(() => {
    db.close();
    resetCloudMemoryStateForTests();
    setCloudNowForTests(null);
  });

  function seed() {
    insertUser(db, "usr_pro", "pro");
    insertCollection(db, "col_pro", "usr_pro");
    insertSession(db, "session_mcp", "usr_pro", "col_pro", [{ comment: "Nota", number: 1, pinId: "p1" }]);
    insertSession(db, "session_web", "usr_pro", "col_pro", [{ comment: "Nota", number: 1, pinId: "p1" }]);
  }

  async function deleteBoth(env: CloudEnv) {
    const host = cloudAssistantToolHost(env, principal("usr_pro"), "https://pinar.test", { writes: true });
    await host.callTool("pinar.delete_session", { sessionId: "session_mcp" });
    const web = await seedCloudWebSessionForTests({ email: "usr_pro@example.test", id: "usr_pro", plan: "pro" }, env);
    const response = await handleCloudApiRequest(new Request("https://pinar.test/api/history/session_web", {
      headers: { cookie: web.cookie, origin: "https://pinar.test" },
      method: "DELETE",
    }), env);
    assert.equal(response.status, 200, await response.clone().text());
    const left = db.query("SELECT id FROM sessions WHERE id IN ('session_mcp', 'session_web')").all();
    assert.deepEqual(left, [], "both sessions are gone");
  }

  test("without the pin_index table, deletes and the retention cleanup still work", async () => {
    db = migratedDatabase({ skip: "0029" });
    seed();
    // The assistant off: the switch is off.
    const env = cloudEnv(db, { ASSISTANT_ENABLED: undefined, DEPLOYMENT_ENV: "production" });
    await deleteBoth(env);
    await cleanupOldRecords(env);
  });

  test("with the table, the same deletes and the cleanup remove index entries", async () => {
    db = migratedDatabase();
    seed();
    const env = cloudEnv(db);
    const owner = cloudPinIndexStore(env, "usr_pro");
    const entry = (sessionId: string): PinIndexEntry => ({
      caption: null, docHash: "h", docText: "t", model: "", number: 1, ocr: null, pinId: "p1", sessionId, truncated: false, updatedAt: NOW, vector: null,
    });
    await owner.replaceSession("session_mcp", [entry("session_mcp")]);
    await owner.replaceSession("session_web", [entry("session_web")]);
    await owner.replaceSession("session_orphan", [entry("session_orphan")]); // no session row
    await deleteBoth(env);
    assert.deepEqual(pinIndexRows(db).map((row) => row.session_id), ["session_orphan"]);
    await cleanupOldRecords(env);
    assert.deepEqual(pinIndexRows(db), [], "the cleanup drops entries of sessions that are gone");
  });
});
