// Cloud pin search (F3 contract §3.3): the cloud-api.ts wiring over a
// migrated SQLite-as-D1 (the model cloud-assistant.test.ts uses) and a fake
// fetch for the appliance. No real endpoint is reached.

import assert from "node:assert/strict";
import { Database } from "bun:sqlite";
import { readdirSync, readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, test } from "node:test";
import {
  cloudPinSearch,
  handleCloudApiRequest,
  indexPinSearch,
  resetCloudMemoryStateForTests,
  seedCloudWebSessionForTests,
  setCloudNowForTests,
  type CloudEnv,
  type Principal,
} from "../../cloud-api";
import { edgerCloudEnv } from "../../edger/env";
import { resetRetrievalCapabilitiesCacheForTests } from "./detect";
import { PIN_EMBEDDING_DIMENSIONS } from "./embeddings";
import type { PinIndexEntry } from "./index";
import {
  CLOUD_PIN_INDEX_CRON_BUDGET_MS,
  CLOUD_PIN_SEARCH_BUDGET_MS,
  CLOUD_PIN_SEARCH_MAX_SESSIONS,
  cloudOwnerPinIndexStore,
  runCloudPinIndexCron,
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

function migratedDatabase() {
  const db = new Database(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  const directory = new URL("../../../../migrations/", import.meta.url);
  for (const file of readdirSync(directory).filter((name) => name.endsWith(".sql")).sort()) {
    db.exec(readFileSync(new URL(file, directory), "utf8"));
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

function insertComment(db: Database, id: string, sessionId: string, pinId: string, body: string, createdAt: string) {
  db.query(
    "INSERT INTO pin_comments (id, capture_id, pin_id, actor_id, actor_label, actor_type, body, created_at) VALUES (?, ?, ?, 'usr_owner', 'Owner', 'human', ?, ?)",
  ).run(id, sessionId, pinId, body, createdAt);
}

function pinIndexRows(db: Database) {
  return db.query("SELECT session_id, pin_id, owner_id, model, caption FROM pin_index ORDER BY session_id, pin_id").all() as Array<{
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
function fakeAppliance(options: { turn?: (body: Record<string, any>) => Response; vision?: boolean } = {}) {
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
          { id: "mock", modalities: { input: options.vision ? ["text", "image"] : ["text"] }, type: "chat" },
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
      ["production", { DEPLOYMENT_ENV: "production" }],
      ["no base URL", { AI_BASE_URL: undefined }],
      ["no key", { AI_API_KEY: undefined }],
      ["no model", { AI_MODEL: undefined }],
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
      assert.equal((await turn(cloudEnv(db, { DEPLOYMENT_ENV: "production" }), pro.cookie)).status, 503);
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
    const realFetch = globalThis.fetch;
    globalThis.fetch = appliance.fetch;
    try {
      const response = await handleCloudApiRequest(new Request("https://pinar.test/api/assistant/turn", {
        body: JSON.stringify({ text: "onde falei de contraste?" }),
        headers: { cookie: collab.cookie, "content-type": "application/json" },
        method: "POST",
      }), cloudEnv(db));
      assert.equal(response.status, 200);
      assert.ok((await response.text()).includes("Achei."));
    } finally {
      globalThis.fetch = realFetch;
    }
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

  test("a new conversation comment makes the session stale again", async () => {
    insertUser(db, "usr_pro", "pro");
    insertCollection(db, "col_pro", "usr_pro");
    insertSession(db, "session_one", "usr_pro", "col_pro", [{ comment: "Botão principal", number: 1, pinId: "p1" }]);
    const appliance = fakeAppliance();
    const env = cloudEnv(db);
    await searchAs(env, principal("usr_pro"), "botão", appliance.fetch);
    const embeddingsBefore = appliance.embeddings().length;
    setCloudNowForTests("2026-10-02T12:00:00.000Z");
    insertComment(db, "cmt_1", "session_one", "p1", "O tom de azul falha no contraste", "2026-10-02T11:00:00.000Z");
    const hits = await searchAs(env, principal("usr_pro"), "tom de azul", appliance.fetch);
    assert.equal(hits[0]?.sessionId, "session_one");
    const documents = appliance.embeddings().slice(embeddingsBefore).filter((call) => call.body?.prompt_name === "document");
    assert.equal(documents.length, 1, "the session was reindexed once");
    assert.ok(String(documents[0]!.body!.input[0]).includes("O tom de azul falha no contraste"));
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

describe("Cloud pin index cron", () => {
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

  test("with the deployment gate off it reads no owner and fetches nothing", async () => {
    insertUser(db, "usr_pro", "pro");
    insertCollection(db, "col_pro", "usr_pro");
    insertSession(db, "session_one", "usr_pro", "col_pro", [{ comment: "Nota", number: 1, pinId: "p1" }]);
    const appliance = fakeAppliance();
    for (const overrides of [{ ASSISTANT_ENABLED: undefined }, { DEPLOYMENT_ENV: "production" as const }, { AI_MODEL: undefined }]) {
      const log: QueryLog = [];
      const result = await indexPinSearch(cloudEnv(db, overrides, log), { fetch: appliance.fetch });
      assert.deepEqual(result, { failed: 0, indexed: 0, owners: 0, remaining: false });
      assert.deepEqual(log, [], JSON.stringify(overrides));
    }
    assert.deepEqual(appliance.calls, []);
    assert.deepEqual(pinIndexRows(db), []);
  });

  test("indexes, for each owner on a plan with AI, only that owner's own sessions", async () => {
    sharedWorld(db);
    insertUser(db, "usr_free", "free");
    insertCollection(db, "col_free", "usr_free");
    insertSession(db, "session_free", "usr_free", "col_free", [{ comment: "Nota sem IA", number: 1, pinId: "p1" }]);
    const result = await indexPinSearch(cloudEnv(db), { fetch: fakeAppliance().fetch });
    assert.deepEqual(result, { failed: 0, indexed: 4, owners: 3, remaining: false });
    assert.deepEqual(pinIndexRows(db).map((row) => [row.session_id, row.owner_id]), [
      ["ses_collab", "usr_collab"],
      ["ses_private", "usr_owner"],
      ["ses_shared", "usr_owner"],
      ["ses_third", "usr_third"],
    ]);
    assert.deepEqual(await indexPinSearch(cloudEnv(db), { fetch: fakeAppliance().fetch }), { failed: 0, indexed: 0, owners: 3, remaining: false }, "nothing stale on the next run");
  });

  test("keeps to one 60 s budget for the whole run, with a fake clock", async () => {
    assert.equal(CLOUD_PIN_INDEX_CRON_BUDGET_MS, 60_000);
    let clock = 0;
    const started: string[] = [];
    // Each session read moves the clock 25 s: owner A spends 50 s, owner B
    // gets the 10 s left (one session), owner C never starts.
    const data = (ownerId: string): CloudPinSourceData => {
      started.push(ownerId);
      const sessions = [1, 2].map((index): CloudPinSourceSession => ({
        createdAt: `2026-09-0${index}T00:00:00.000Z`,
        id: `${ownerId}_${index}`,
        page: { title: "T", url: "https://u.example" },
        pins: [{ comment: `Nota ${index}`, coords: { x: 0, y: 0 }, number: 1, pinId: "p1", type: "point" }],
      }));
      return {
        async comments() { return []; },
        async latestCommentAt() { return new Map(); },
        async ownedSessions() { return sessions.map((session) => ({ createdAt: session.createdAt, id: session.id, ownerId })).reverse(); },
        async session(id) { clock += 25_000; return sessions.find((session) => session.id === id) ?? null; },
        async sharedSessions() { return []; },
        async shot() { return null; },
      };
    };
    const result = await runCloudPinIndexCron({
      env: { AI_API_KEY: "sk-ai-test", AI_BASE_URL: BASE_URL, AI_MODEL: "mock" },
      fetch: fakeAppliance().fetch,
      now: () => new Date(Date.parse(NOW) + clock),
      ownerData: data,
      owners: ["usr_a", "usr_b", "usr_c"],
    });
    assert.deepEqual(started, ["usr_a", "usr_b"], "no owner starts after the budget");
    assert.deepEqual(result, { failed: 0, indexed: 3, owners: 2, remaining: true });
    assert.equal((await cloudPinIndexStore({}, "usr_b").entries("usr_b_1")).length, 0, "B's older session waits for the next run");
    assert.equal((await cloudPinIndexStore({}, "usr_b").entries("usr_b_2")).length, 1);
  });

  test("an owner that fails does not stop the others", async () => {
    const data = (ownerId: string): CloudPinSourceData => ({
      async comments() { return []; },
      async latestCommentAt() { return new Map(); },
      async ownedSessions() {
        if (ownerId === "usr_b") throw new Error("database unavailable for B");
        return [{ createdAt: "2026-09-01T00:00:00.000Z", id: `${ownerId}_1`, ownerId }];
      },
      async session(id) {
        return { createdAt: "2026-09-01T00:00:00.000Z", id, page: { title: "T", url: "https://u.example" }, pins: [{ comment: "Nota", coords: { x: 0, y: 0 }, number: 1, pinId: "p1", type: "point" }] };
      },
      async sharedSessions() { return []; },
      async shot() { return null; },
    });
    const result = await runCloudPinIndexCron({
      env: { AI_API_KEY: "sk-ai-test", AI_BASE_URL: BASE_URL, AI_MODEL: "mock" },
      fetch: fakeAppliance().fetch,
      ownerData: data,
      owners: ["usr_a", "usr_b", "usr_c"],
    });
    assert.deepEqual(result, { failed: 1, indexed: 2, owners: 2, remaining: true });
    assert.equal((await cloudPinIndexStore({}, "usr_a").entries("usr_a_1")).length, 1);
    assert.equal((await cloudPinIndexStore({}, "usr_c").entries("usr_c_1")).length, 1);
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

  test("alone, without the AI group, it neither completes the group nor fails", () => {
    const env = edgerCloudEnv(read({ AI_EMBEDDING_MODEL: "embeddinggemma-300m" }));
    assert.equal(env.AI, undefined);
    assert.equal(env.AI_BASE_URL, undefined);
    assert.equal(env.AI_EMBEDDING_MODEL, undefined);
    assert.throws(() => edgerCloudEnv(read({ AI_EMBEDDING_MODEL: "embeddinggemma-300m", AI_MODEL: "chat-model" })), /incomplete AI configuration: missing AI_API_KEY, AI_BASE_URL, AI_TRANSCRIPTION_MODEL/);
  });
});
