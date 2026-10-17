// Cloud assistant (F1/S3b, F2/S3b): the Cloud MCP tools running as the
// logged-in web user (no agent key) and the /api/assistant/* routes served
// by handleCloudApiRequest (the A3 gate, account isolation, the
// collaborator read, the turn rate limit, and the F2 proposals confirmed
// and undone as the person).
//
// The D1 shim is the same SQLite-as-D1 model cloud-mcp.test.ts uses: the
// migrations are applied in order and batch() runs inside a transaction.

import assert from "node:assert/strict";
import { Database } from "bun:sqlite";
import { readdirSync, readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, test } from "node:test";
import { createEdgerFetch } from "../edger-server-entry";
import {
  cloudAssistantStateReader,
  cloudAssistantToolHost,
  cloudAssistantTurnMeter,
  handleCloudApiRequest,
  refundStaleAiReservations,
  resetCloudMemoryStateForTests,
  seedCloudWebSessionForTests,
  setCloudNowForTests,
  type CloudEnv,
  type Principal,
} from "./cloud-api";
import type { AssistantToolHost } from "./assistant/tools";
import { ASSISTANT_TOOL_POLICY } from "./assistant/tool-policy";

const NOW = "2026-10-01T12:00:00.000Z";
const WRITE_UNAVAILABLE = "This action is not available to the assistant yet";

// ---------- D1 shim (same model as cloud-mcp.test.ts) ----------

function sqliteD1(db: Database): NonNullable<CloudEnv["DB"]> {
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
    async batch(statements) {
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
    },
    prepare(query: string) {
      return statement(query);
    },
  };
}

function migratedDatabase() {
  const db = new Database(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  const directory = new URL("../../migrations/", import.meta.url);
  for (const file of readdirSync(directory).filter((name) => name.endsWith(".sql")).sort()) {
    db.exec(readFileSync(new URL(file, directory), "utf8"));
  }
  return db;
}

// ---------- seed helpers ----------

function insertUser(db: Database, id: string, email: string, plan: "free" | "pro") {
  db.query(
    "INSERT INTO users (id, email, plan, ever_paid, billing_status, created_at, updated_at) VALUES (?, ?, ?, 1, 'active', ?, ?)",
  ).run(id, email, plan, NOW, NOW);
}

function insertProject(db: Database, id: string, ownerId: string) {
  db.query(
    "INSERT INTO projects (id, owner_id, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
  ).run(id, ownerId, `Project ${id}`, NOW, NOW);
}

function insertCollection(db: Database, id: string, projectId: string, ownerId: string) {
  db.query(
    "INSERT INTO collections (id, project_id, owner_id, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
  ).run(id, projectId, ownerId, `Collection ${id}`, NOW, NOW);
}

function insertSession(db: Database, id: string, userId: string, collectionId: string, pins: unknown[], position = 0) {
  db.query(
    "INSERT INTO sessions (id, url, title, shot_id, shot_url, pin_count, pins_json, created_at, user_id, plan, is_permanent, byte_size, collection_id, position) "
      + "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pro', 1, 1, ?, ?)",
  ).run(
    id,
    `https://example.test/${id}`,
    id,
    id,
    `https://pinar.test/shots/${id}.png`,
    pins.length,
    JSON.stringify(pins),
    NOW,
    userId,
    collectionId,
    position,
  );
}

function acceptCollaborator(db: Database, id: string, collectionId: string, ownerId: string, email: string, userId: string) {
  db.query(
    "INSERT INTO collection_collaborators (id, collection_id, owner_id, email, user_id, status, created_at, updated_at, accepted_at) "
      + "VALUES (?, ?, ?, ?, ?, 'accepted', ?, ?, ?)",
  ).run(id, collectionId, ownerId, email, userId, NOW, NOW, NOW);
}

function assistantEnv(db: Database, overrides: Partial<CloudEnv> = {}): CloudEnv {
  return {
    AI_API_KEY: "sk-ai-test",
    AI_BASE_URL: "http://127.0.0.1:9/v1",
    AI_MODEL: "mock",
    ASSISTANT_ENABLED: "true",
    DB: sqliteD1(db),
    DEPLOYMENT_ENV: "staging",
    ...overrides,
  };
}

function principalFor(id: string, email: string, plan: "free" | "pro"): Principal {
  return { email, id, isPermanent: plan === "pro", kind: "account", plan };
}

// The assistant's view of the Cloud MCP as the logged-in web user.
function userHost(db: Database, id: string, email: string, plan: "free" | "pro" = "pro"): AssistantToolHost {
  return cloudAssistantToolHost(assistantEnv(db), principalFor(id, email, plan), "https://pinar.test");
}

// The fake OpenAI-compatible endpoint of the staging env: it answers the
// chat completions call with a two-chunk SSE stream and nothing else.
function fakeAiServer() {
  const chunks = [{ content: "Duas" }, { content: " sessões." }];
  const lines = [
    ...chunks.flatMap((delta, index) => [
      `data: ${JSON.stringify({
        choices: [{ delta: { content: delta.content, ...(index === 0 ? { role: "assistant" } : {}) }, finish_reason: null, index: 0 }],
        created: 1,
        id: "c1",
        model: "mock",
        object: "chat.completion.chunk",
      })}`,
      "",
    ]),
    `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: "stop", index: 0 }], created: 1, id: "c1", model: "mock", object: "chat.completion.chunk" })}`,
    "",
    "data: [DONE]",
    "",
  ];
  return Bun.serve({
    fetch: (incoming) => {
      const url = new URL(incoming.url);
      if (incoming.method === "POST" && url.pathname === "/v1/chat/completions") {
        return new Response(lines.join("\n"), { headers: { "content-type": "text/event-stream" } });
      }
      return new Response("not found", { status: 404 });
    },
    port: 0,
  });
}

// Every row of the tables a write could touch, to prove nothing changed.
function tableSnapshot(db: Database) {
  const tables = ["projects", "collections", "sessions", "pin_comments", "pin_reviews", "pin_review_events", "share_tokens", "batches"];
  return Object.fromEntries(tables.map((table) => [table, db.query(`SELECT * FROM ${table} ORDER BY rowid`).all()]));
}

// ---------- MCP actor: the logged-in web user ----------

describe("cloud assistant MCP actor (the logged-in web user)", () => {
  beforeEach(() => {
    resetCloudMemoryStateForTests();
    setCloudNowForTests(NOW);
  });

  afterEach(() => resetCloudMemoryStateForTests());

  test("lists own sessions and does not see another account's sessions", async () => {
    const db = migratedDatabase();
    try {
      insertUser(db, "usr_a", "a@example.test", "pro");
      insertUser(db, "usr_b", "b@example.test", "pro");
      insertProject(db, "project_a", "usr_a");
      insertCollection(db, "collection_a", "project_a", "usr_a");
      insertSession(db, "session_a", "usr_a", "collection_a", [{ comment: "only A's pin", number: 1 }]);

      const hostA = userHost(db, "usr_a", "a@example.test");
      const listedA = (await hostA.callTool("pinar.list_sessions", {})) as { sessions: Array<{ id: string }> };
      assert.deepEqual(listedA.sessions.map((session) => session.id), ["session_a"]);

      const hostB = userHost(db, "usr_b", "b@example.test");
      const listedB = (await hostB.callTool("pinar.list_sessions", {})) as { sessions: Array<{ id: string }> };
      assert.deepEqual(listedB.sessions, []);

      // The pins of the other account are not readable either.
      await assert.rejects(
        hostB.callTool("pinar.list_pins", { sessionId: "session_a" }),
        /Resource not found/,
      );
    } finally {
      db.close();
    }
  });

  test("an agent key of the collaborator keeps the owner-only pin reads it always had", async () => {
    // Review finding (rev-f1 S3b #1): the accessible-session lookup is for
    // the web user only. A collection key of an accepted guest must not
    // start reading the owner's pins through the three pin tools.
    const db = migratedDatabase();
    try {
      insertUser(db, "usr_owner", "owner@example.test", "pro");
      insertUser(db, "usr_guest", "guest@example.test", "pro");
      insertProject(db, "project_owner", "usr_owner");
      insertCollection(db, "collection_shared", "project_owner", "usr_owner");
      insertSession(db, "session_shared", "usr_owner", "collection_shared", [
        { comment: "first shared note", number: 1, pinId: "pin_1" },
      ]);
      acceptCollaborator(db, "collab_shared", "collection_shared", "usr_owner", "guest@example.test", "usr_guest");
      const token = `pak_${"g".repeat(43)}`;
      const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
      const tokenHash = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
      db.query(
        "INSERT INTO agent_api_keys (id, account_id, name, token_hash, token_prefix, resource_type, resource_id, permission, expires_at, created_at) "
          + "VALUES ('key_guest', 'usr_guest', 'Guest reader', ?, ?, 'collection', 'collection_shared', 'read', '2027-01-01T00:00:00.000Z', ?)",
      ).run(tokenHash, token.slice(0, 12), NOW);
      const env = assistantEnv(db);
      const accept = "application/json, text/event-stream";
      const initialized = await handleCloudApiRequest(new Request("https://pinar.test/api/mcp", {
        body: JSON.stringify({
          id: 0,
          jsonrpc: "2.0",
          method: "initialize",
          params: { capabilities: {}, clientInfo: { name: "pinar-cloud-test", version: "0.0.0" }, protocolVersion: "2025-11-25" },
        }),
        headers: { accept, authorization: `Bearer ${token}`, "content-type": "application/json" },
        method: "POST",
      }), env);
      assert.equal(initialized.status, 200);
      const session = initialized.headers.get("mcp-session-id");
      assert.ok(session);
      for (const [name, args] of [
        ["pinar.list_pins", { sessionId: "session_shared" }],
        ["pinar.get_pin", { pinId: "pin_1", sessionId: "session_shared" }],
        ["pinar.list_pin_comments", { pinId: "pin_1", sessionId: "session_shared" }],
      ] as const) {
        const response = await handleCloudApiRequest(new Request("https://pinar.test/api/mcp", {
          body: JSON.stringify({ id: 1, jsonrpc: "2.0", method: "tools/call", params: { arguments: args, name } }),
          headers: { accept, authorization: `Bearer ${token}`, "content-type": "application/json", "mcp-session-id": session },
          method: "POST",
        }), env);
        const body = await response.json() as { result: { content: Array<{ text: string }>; isError?: boolean } };
        assert.equal(body.result.isError, true, name);
        assert.equal(body.result.content[0].text, "Resource not found", name);
      }
    } finally {
      db.close();
    }
  });

  test("reads the pins of a session in a collection where it is an accepted collaborator", async () => {
    const db = migratedDatabase();
    try {
      insertUser(db, "usr_owner", "owner@example.test", "pro");
      insertUser(db, "usr_guest", "guest@example.test", "pro");
      insertProject(db, "project_owner", "usr_owner");
      insertCollection(db, "collection_shared", "project_owner", "usr_owner");
      insertSession(db, "session_shared", "usr_owner", "collection_shared", [
        { comment: "first shared note", number: 1, pinId: "pin_1" },
        { comment: "second shared note", number: 2, pinId: "pin_2" },
      ]);
      acceptCollaborator(db, "collab_shared", "collection_shared", "usr_owner", "guest@example.test", "usr_guest");

      // Both actors read the same pins: the owner as the owner, the guest
      // through the accepted collaboration.
      for (const [id, email] of [["usr_owner", "owner@example.test"], ["usr_guest", "guest@example.test"]] as const) {
        const host = userHost(db, id, email);
        const listed = (await host.callTool("pinar.list_pins", { sessionId: "session_shared" })) as {
          limit: number;
          offset: number;
          pins: Array<{ comment: string; id: string; number: number }>;
        };
        assert.equal(listed.limit, 100);
        assert.equal(listed.offset, 0);
        assert.deepEqual(
          listed.pins.map((pin) => [pin.id, pin.number, pin.comment]),
          [["pin_1", 1, "first shared note"], ["pin_2", 2, "second shared note"]],
        );
        const got = (await host.callTool("pinar.get_pin", { pinId: "pin_1", sessionId: "session_shared" })) as {
          ok: boolean;
          pin: { comment: string; id: string; number: number; reviewStatus: string };
        };
        assert.equal(got.ok, true);
        assert.equal(got.pin.id, "pin_1");
        assert.equal(got.pin.comment, "first shared note");
        assert.equal(got.pin.number, 1);
        assert.equal(got.pin.reviewStatus, "open");
        const comments = (await host.callTool("pinar.list_pin_comments", {
          pinId: "pin_1",
          sessionId: "session_shared",
        })) as { comments: unknown[]; ok: boolean };
        assert.equal(comments.ok, true);
        assert.deepEqual(comments.comments, []);
      }
    } finally {
      db.close();
    }
  });

  test("does not read a session of an owner that does not share it with it", async () => {
    const db = migratedDatabase();
    try {
      insertUser(db, "usr_owner", "owner@example.test", "pro");
      insertUser(db, "usr_guest", "guest@example.test", "pro");
      insertProject(db, "project_owner", "usr_owner");
      insertCollection(db, "collection_shared", "project_owner", "usr_owner");
      insertCollection(db, "collection_private", "project_owner", "usr_owner");
      insertSession(db, "session_shared", "usr_owner", "collection_shared", [{ comment: "shared", number: 1, pinId: "pin_s" }]);
      insertSession(db, "session_private", "usr_owner", "collection_private", [{ comment: "private", number: 1, pinId: "pin_p" }]);
      acceptCollaborator(db, "collab_shared", "collection_shared", "usr_owner", "guest@example.test", "usr_guest");

      const host = userHost(db, "usr_guest", "guest@example.test");
      await assert.rejects(host.callTool("pinar.list_pins", { sessionId: "session_private" }), /Resource not found/);
      for (const name of ["pinar.get_pin", "pinar.list_pin_comments"]) {
        await assert.rejects(host.callTool(name, { pinId: "pin_p", sessionId: "session_private" }), /Resource not found/);
      }
    } finally {
      db.close();
    }
  });

  test("refuses every write of the user actor", async () => {
    const db = migratedDatabase();
    try {
      insertUser(db, "usr_a", "a@example.test", "pro");
      insertProject(db, "project_a", "usr_a");
      insertCollection(db, "collection_a", "project_a", "usr_a");
      insertSession(db, "session_a", "usr_a", "collection_a", [{ comment: "note", number: 1, pinId: "pin_a" }]);

      db.query("INSERT INTO batches (id, user_id, label, started_at) VALUES ('batch_a', 'usr_a', 'Sprint', ?)").run(NOW);
      const before = tableSnapshot(db);
      // The default host is the turn's: writes false.
      const host = userHost(db, "usr_a", "a@example.test");
      const writes: Record<string, Record<string, unknown>> = {
        "pinar.add_pin_comment": { body: "comment", pinId: "pin_a", sessionId: "session_a" },
        "pinar.conclude_pin": { pinId: "pin_a", sessionId: "session_a" },
        "pinar.create_batch": { label: "Nope" },
        "pinar.create_collection": { name: "Nope", projectId: "project_a" },
        "pinar.create_pin": { comment: "Nope", sessionId: "session_a" },
        "pinar.create_project": { name: "Nope" },
        "pinar.create_session": { page: { title: "Nope", url: "https://example.test/nope" } },
        "pinar.delete_batch": { batchId: "batch_a" },
        "pinar.delete_collection": { collectionId: "collection_a" },
        "pinar.delete_pin": { pinId: "pin_a", sessionId: "session_a" },
        "pinar.delete_pin_comment": { commentId: "comment_a", pinId: "pin_a", sessionId: "session_a" },
        "pinar.delete_project": { projectId: "project_a" },
        "pinar.delete_session": { sessionId: "session_a" },
        "pinar.edit_pin_comment": { body: "Nope", commentId: "comment_a", pinId: "pin_a", sessionId: "session_a" },
        "pinar.edit_pin_note": { comment: "Nope", pinId: "pin_a", sessionId: "session_a" },
        "pinar.finish_batch": { batchId: "batch_a" },
        "pinar.move_session": { collectionId: "collection_a", sessionId: "session_a" },
        "pinar.publish_share": { resourceId: "session_a", resourceType: "session" },
        "pinar.reopen_pin": { pinId: "pin_a", sessionId: "session_a" },
        "pinar.reorder_collections": { items: [{ id: "collection_a", parentId: null }], projectId: "project_a" },
        "pinar.reorder_projects": { ids: ["project_a"] },
        "pinar.reorder_sessions": { collectionId: "collection_a", ids: ["session_a"] },
        "pinar.rename_batch": { batchId: "batch_a", label: "Nope" },
        "pinar.rename_collection": { collectionId: "collection_a", name: "Nope" },
        "pinar.rename_project": { name: "Nope", projectId: "project_a" },
        "pinar.revoke_share": { resourceId: "session_a", resourceType: "session" },
        "pinar.update_session": { page: { title: "Nope" }, sessionId: "session_a" },
      };
      const policyWrites = Object.entries(ASSISTANT_TOOL_POLICY).filter(([, policy]) => policy.kind === "write").map(([name]) => name);
      assert.equal(policyWrites.length, 27);
      assert.deepEqual(Object.keys(writes).sort(), policyWrites.sort(), "every write of the policy is exercised");
      for (const [name, args] of Object.entries(writes)) {
        await assert.rejects(host.callTool(name, args), new RegExp(WRITE_UNAVAILABLE.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), name);
      }
      // Nothing was written.
      assert.deepEqual(tableSnapshot(db), before);
    } finally {
      db.close();
    }
  });
});

// ---------- /api/assistant/* routes ----------

describe("cloud assistant routes", () => {
  beforeEach(() => {
    resetCloudMemoryStateForTests();
    setCloudNowForTests(NOW);
  });

  afterEach(() => resetCloudMemoryStateForTests());

  async function seedAccounts(db: Database) {
    insertUser(db, "usr_a", "a@example.test", "pro");
    insertUser(db, "usr_b", "b@example.test", "pro");
    insertUser(db, "usr_free", "free@example.test", "free");
    return {
      a: await seedCloudWebSessionForTests({ email: "a@example.test", id: "usr_a", plan: "pro" }, assistantEnv(db)),
      b: await seedCloudWebSessionForTests({ email: "b@example.test", id: "usr_b", plan: "pro" }, assistantEnv(db)),
      free: await seedCloudWebSessionForTests({ email: "free@example.test", id: "usr_free", plan: "free" }, assistantEnv(db)),
    };
  }

  function route(path: string, env: CloudEnv, init: RequestInit = {}) {
    return handleCloudApiRequest(new Request(`https://pinar.test${path}`, init), env);
  }

  function turn(env: CloudEnv, cookie: string, body: Record<string, unknown>) {
    return route("/api/assistant/turn", env, {
      body: JSON.stringify(body),
      headers: { cookie, "content-type": "application/json" },
      method: "POST",
    });
  }

  test("without a principal the status is 401", async () => {
    const db = migratedDatabase();
    try {
      const response = await route("/api/assistant/status", assistantEnv(db));
      assert.equal(response.status, 401);
      assert.deepEqual(await response.json(), { code: "unauthorized", error: "Unauthorized" });
    } finally {
      db.close();
    }
  });

  test("a Free account gets requires_pro and a 403 turn", async () => {
    const db = migratedDatabase();
    try {
      const { free } = await seedAccounts(db);
      const env = assistantEnv(db);

      const status = await route("/api/assistant/status", env, { headers: { cookie: free.cookie } });
      assert.equal(status.status, 200);
      assert.deepEqual(await status.json(), { available: false, reason: "requires_pro", surface: "cloud" });

      const denied = await turn(env, free.cookie, { text: "Quantas sessões?" });
      assert.equal(denied.status, 403);
      assert.deepEqual(await denied.json(), { code: "assistant_requires_pro", error: "The assistant requires a Pro plan" });
    } finally {
      db.close();
    }
  });

  test("a Pro account with the switch off gets disabled and a 503 turn", async () => {
    const db = migratedDatabase();
    try {
      const { a } = await seedAccounts(db);
      for (const assistantEnabled of ["false", undefined]) {
        const env = assistantEnv(db, { ASSISTANT_ENABLED: assistantEnabled });
        const status = await route("/api/assistant/status", env, { headers: { cookie: a.cookie } });
        assert.equal(status.status, 200);
        assert.deepEqual(await status.json(), { available: false, reason: "disabled", surface: "cloud" });
        const denied = await turn(env, a.cookie, { text: "Quantas sessões?" });
        assert.equal(denied.status, 503);
        assert.equal((await denied.json() as { code: string }).code, "assistant_unavailable");
      }
    } finally {
      db.close();
    }
  });

  test("a failure while preparing the route answers the sanitized 503 and is not logged", async () => {
    // Review finding (rev-f1 S3b #3): the web session resolves, then the
    // account lookup fails; the error must not escape handleCloudApiRequest.
    const db = migratedDatabase();
    try {
      const { a } = await seedAccounts(db);
      const env = assistantEnv(db);
      const base = env.DB!;
      const secret = "PRIVATE_ACCOUNT_DB_SENTINEL";
      env.DB = {
        ...base,
        prepare(sql: string) {
          if (/FROM users\b/i.test(sql)) throw new Error(secret);
          return base.prepare(sql);
        },
      } as typeof base;
      const logged: unknown[] = [];
      const original = { error: console.error, log: console.log, warn: console.warn };
      console.error = (...args: unknown[]) => { logged.push(args); };
      console.warn = (...args: unknown[]) => { logged.push(args); };
      console.log = (...args: unknown[]) => { logged.push(args); };
      try {
        for (const [path, init] of [
          ["/api/assistant/status", {}],
          ["/api/assistant/threads", {}],
          ["/api/assistant/turn", {
            body: JSON.stringify({ text: "oi" }),
            headers: { "content-type": "application/json", origin: "https://pinar.test" },
            method: "POST",
          }],
        ] as const) {
          const headers = { ...("headers" in init ? init.headers : {}), cookie: a.cookie };
          const response = await route(path, env, { ...init, headers });
          assert.equal(response.status, 503, path);
          assert.equal(response.headers.get("cache-control"), "no-store", path);
          const text = await response.text();
          assert.deepEqual(JSON.parse(text), { code: "assistant_unavailable", error: "The assistant is unavailable" });
          assert.ok(!text.includes(secret));
        }
      } finally {
        Object.assign(console, original);
      }
      assert.ok(!JSON.stringify(logged).includes(secret), "nothing about the failure is logged");
    } finally {
      db.close();
    }
  });

  test("a Pro account in production gets disabled even with everything on", async () => {
    const db = migratedDatabase();
    try {
      const { a } = await seedAccounts(db);
      const env = assistantEnv(db, { DEPLOYMENT_ENV: "production" });
      const status = await route("/api/assistant/status", env, { headers: { cookie: a.cookie } });
      assert.equal(status.status, 200);
      assert.deepEqual(await status.json(), { available: false, reason: "disabled", surface: "cloud" });
      const denied = await turn(env, a.cookie, { text: "Quantas sessões?" });
      assert.equal(denied.status, 503);
      assert.equal((await denied.json() as { code: string }).code, "assistant_unavailable");
    } finally {
      db.close();
    }
  });

  test("in staging a Pro turn streams from the fake appliance, stores both messages, and stays isolated per account", async () => {
    const db = migratedDatabase();
    const fake = fakeAiServer();
    try {
      const { a, b } = await seedAccounts(db);
      const env = assistantEnv(db, { AI_BASE_URL: `http://127.0.0.1:${fake.port}/v1` });

      const status = await route("/api/assistant/status", env, { headers: { cookie: a.cookie } });
      assert.deepEqual(await status.json(), { available: true, reason: null, surface: "cloud" });

      const response = await turn(env, a.cookie, { text: "Quantas sessões?" });
      assert.equal(response.status, 200);
      assert.match(response.headers.get("content-type") ?? "", /text\/event-stream/);
      const sse = await response.text();
      const firstLine = sse.split("\n").find((line) => line.startsWith("data: "));
      assert.ok(firstLine, "the stream starts with a data part");
      const firstPart = JSON.parse(firstLine.slice(6)) as { data: { id: string; title: string }; type: string };
      assert.equal(firstPart.type, "data-thread");
      assert.equal(firstPart.data.title, "Quantas sessões?");
      assert.ok(sse.includes("Duas") && sse.includes("sessões."), "the model text reaches the stream");
      const threadId = firstPart.data.id;

      // The assistant answer is persisted when the outcome settles; poll
      // briefly so the read never races the persistence.
      const deadline = Date.now() + 5_000;
      let messages: Array<Record<string, unknown>> = [];
      for (;;) {
        const detail = await route(`/api/assistant/threads/${threadId}`, env, { headers: { cookie: a.cookie } });
        assert.equal(detail.status, 200);
        const body = (await detail.json()) as { messages: Array<Record<string, unknown>>; thread: { title: string } };
        if (body.messages.length === 2) {
          messages = body.messages;
          assert.equal(body.thread.title, "Quantas sessões?");
          break;
        }
        if (Date.now() > deadline) throw new Error("timed out waiting for the assistant messages");
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      assert.equal(messages[0].role, "user");
      assert.equal(messages[0].text, "Quantas sessões?");
      assert.equal(messages[1].role, "assistant");
      assert.equal(messages[1].status, "final");
      assert.ok(String(messages[1].text).includes("Duas sessões."));

      // Account B never sees A's threads.
      const threadsB = await route("/api/assistant/threads", env, { headers: { cookie: b.cookie } });
      assert.equal(threadsB.status, 200);
      assert.deepEqual(await threadsB.json(), { threads: [] });
      const stolen = await route(`/api/assistant/threads/${threadId}`, env, { headers: { cookie: b.cookie } });
      assert.equal(stolen.status, 404);
      assert.equal((await stolen.json() as { code: string }).code, "thread_not_found");
    } finally {
      fake.stop();
      db.close();
    }
  });

  test("the turn rate limit allows 20 turns in the window and 429s the 21st", async () => {
    const db = migratedDatabase();
    const fake = fakeAiServer();
    try {
      const { a } = await seedAccounts(db);
      const env = assistantEnv(db, { AI_BASE_URL: `http://127.0.0.1:${fake.port}/v1` });

      for (let index = 1; index <= 20; index += 1) {
        const allowed = await turn(env, a.cookie, { text: `Sessão ${index}` });
        assert.equal(allowed.status, 200, `turn ${index} must be admitted`);
        await allowed.text();
      }
      const limited = await turn(env, a.cookie, { text: "Sessão 21" });
      assert.equal(limited.status, 429);
      assert.deepEqual(await limited.json(), { code: "assistant_rate_limited", error: "Too many questions in a short time" });
    } finally {
      fake.stop();
      db.close();
    }
  });
});

// ---------- F2: proposals confirmed and undone as the person ----------

type AiReply = { text: string } | { args: Record<string, unknown>; tool: string };

// A fake OpenAI-compatible appliance that answers each chat completions
// call with the next scripted reply (a tool call or text) and records the
// request bodies, so a test can read the tool results the model got.
function scriptedAiServer(replies: AiReply[]) {
  const requests: string[] = [];
  const chunk = (delta: Record<string, unknown>, finishReason: string | null) =>
    `data: ${JSON.stringify({ choices: [{ delta, finish_reason: finishReason, index: 0 }], created: 1, id: "c1", model: "mock", object: "chat.completion.chunk" })}\n\n`;
  const server = Bun.serve({
    fetch: async (incoming) => {
      const url = new URL(incoming.url);
      if (incoming.method !== "POST" || url.pathname !== "/v1/chat/completions") return new Response("not found", { status: 404 });
      requests.push(await incoming.text());
      const reply = replies[Math.min(requests.length - 1, replies.length - 1)];
      const body = "tool" in reply
        ? chunk({
          role: "assistant",
          tool_calls: [{ function: { arguments: JSON.stringify(reply.args), name: reply.tool }, id: `call_${requests.length}`, index: 0, type: "function" }],
        }, null) + chunk({}, "tool_calls")
        : chunk({ content: reply.text, role: "assistant" }, null) + chunk({}, "stop");
      return new Response(`${body}data: [DONE]\n\n`, { headers: { "content-type": "text/event-stream" } });
    },
    port: 0,
  });
  return { requests, server };
}

describe("cloud assistant proposals", () => {
  beforeEach(() => {
    resetCloudMemoryStateForTests();
    setCloudNowForTests(NOW);
  });

  afterEach(() => resetCloudMemoryStateForTests());

  function route(path: string, env: CloudEnv, init: RequestInit = {}) {
    return handleCloudApiRequest(new Request(`https://pinar.test${path}`, init), env);
  }

  // A owns project_a with collection_a (sessions 1..3, in order) and
  // collection_a2 (session 4); B owns project_b / collection_b.
  async function seedWorkspace(db: Database) {
    insertUser(db, "usr_a", "a@example.test", "pro");
    insertUser(db, "usr_b", "b@example.test", "pro");
    insertProject(db, "project_a", "usr_a");
    insertCollection(db, "collection_a", "project_a", "usr_a");
    insertCollection(db, "collection_a2", "project_a", "usr_a");
    insertSession(db, "session_a1", "usr_a", "collection_a", [{ comment: "first note", number: 1, pinId: "pin_a1" }], 0);
    insertSession(db, "session_a2", "usr_a", "collection_a", [], 1);
    insertSession(db, "session_a3", "usr_a", "collection_a", [], 2);
    insertSession(db, "session_a4", "usr_a", "collection_a2", [], 0);
    insertProject(db, "project_b", "usr_b");
    insertCollection(db, "collection_b", "project_b", "usr_b");
    return {
      a: await seedCloudWebSessionForTests({ email: "a@example.test", id: "usr_a", plan: "pro" }, assistantEnv(db)),
      b: await seedCloudWebSessionForTests({ email: "b@example.test", id: "usr_b", plan: "pro" }, assistantEnv(db)),
    };
  }

  // One turn: the stream's data parts, its proposals and the thread id;
  // waits for the assistant message so nothing writes after the test.
  async function proposingTurn(env: CloudEnv, cookie: string, text: string) {
    const response = await route("/api/assistant/turn", env, {
      body: JSON.stringify({ text }),
      headers: { cookie, "content-type": "application/json" },
      method: "POST",
    });
    assert.equal(response.status, 200);
    const parts = (await response.text())
      .split("\n")
      .filter((line) => line.startsWith("data: ") && line.slice(6) !== "[DONE]")
      .map((line) => JSON.parse(line.slice(6)) as { data?: Record<string, any>; type: string });
    const threadId = String(parts[0].data?.id);
    const deadline = Date.now() + 5_000;
    for (;;) {
      const detail = await route(`/api/assistant/threads/${threadId}`, env, { headers: { cookie } });
      if (((await detail.json()) as { messages: unknown[] }).messages.length === 2) break;
      if (Date.now() > deadline) throw new Error("timed out waiting for the assistant message");
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    return { parts, proposals: parts.filter((part) => part.type === "data-proposal").map((part) => part.data!), threadId };
  }

  async function act(env: CloudEnv, cookie: string, id: string, action: "confirm" | "reject" | "undo") {
    const response = await route(`/api/assistant/proposals/${id}/${action}`, env, { headers: { cookie }, method: "POST" });
    return { body: (await response.json()) as { code?: string; proposal?: Record<string, any> }, status: response.status };
  }

  const order = (db: Database, collectionId: string) =>
    (db.query("SELECT id FROM sessions WHERE collection_id = ? ORDER BY position ASC").all(collectionId) as Array<{ id: string }>).map((row) => row.id);

  test("end to end: a proposed move changes nothing until confirm, confirm moves it, undo restores collection and order", async () => {
    const db = migratedDatabase();
    const ai = scriptedAiServer([
      { args: { collectionId: "collection_a2", sessionId: "session_a2" }, tool: "pinar_move_session" },
      { text: "Propus mover a sessão; confirme no cartão." },
    ]);
    try {
      const { a } = await seedWorkspace(db);
      const env = assistantEnv(db, { AI_BASE_URL: `http://127.0.0.1:${ai.server.port}/v1` });
      const turn = await proposingTurn(env, a.cookie, "Mova a session_a2 para a collection_a2");
      assert.equal(turn.proposals.length, 1, JSON.stringify(turn.parts.map((part) => part.type)));
      const [proposal] = turn.proposals;
      assert.equal(proposal.status, "proposed");
      assert.deepEqual(proposal.display, { action: "move_session", params: { collection: "Collection collection_a2", session: "session_a2" } });
      assert.deepEqual(order(db, "collection_a"), ["session_a1", "session_a2", "session_a3"], "the turn wrote nothing");

      const confirmed = await act(env, a.cookie, proposal.id, "confirm");
      assert.equal(confirmed.status, 200, JSON.stringify(confirmed.body));
      assert.equal(confirmed.body.proposal?.status, "executed");
      assert.equal(confirmed.body.proposal?.errorCode, null);
      assert.deepEqual(order(db, "collection_a"), ["session_a1", "session_a3"]);
      assert.deepEqual(order(db, "collection_a2"), ["session_a4", "session_a2"], "the session moved in the database");

      const undone = await act(env, a.cookie, proposal.id, "undo");
      assert.equal(undone.status, 200, JSON.stringify(undone.body));
      assert.equal(undone.body.proposal?.status, "undone");
      assert.deepEqual(order(db, "collection_a"), ["session_a1", "session_a2", "session_a3"], "back in the same collection and order");
      assert.deepEqual(order(db, "collection_a2"), ["session_a4"]);
    } finally {
      ai.server.stop(true);
      db.close();
    }
  });

  test("credits: the proposing turn costs 3 credits, confirming and undoing it cost nothing", async () => {
    const db = migratedDatabase();
    const ai = scriptedAiServer([
      { args: { collectionId: "collection_a2", sessionId: "session_a2" }, tool: "pinar_move_session" },
      { text: "Propus mover a sessão; confirme no cartão." },
    ]);
    try {
      const { a } = await seedWorkspace(db);
      const env = assistantEnv(db, { AI_BASE_URL: `http://127.0.0.1:${ai.server.port}/v1` });
      const turnUsages = () => db.query("SELECT status FROM ai_credit_usages WHERE feature = 'assistant_turn'").all();
      const balance = () => db.query("SELECT SUM(credits - consumed_credits) AS balance FROM ai_credit_grants WHERE owner_id = 'usr_a'").get();
      const turn = await proposingTurn(env, a.cookie, "Mova a session_a2 para a collection_a2");
      const deadline = Date.now() + 5_000;
      while (JSON.stringify(turnUsages()) !== JSON.stringify([{ status: "succeeded" }])) {
        if (Date.now() > deadline) throw new Error(`the turn was not charged: ${JSON.stringify(turnUsages())}`);
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      assert.deepEqual(balance(), { balance: 497 });
      const [proposal] = turn.proposals;
      assert.equal((await act(env, a.cookie, proposal.id, "confirm")).status, 200);
      assert.equal((await act(env, a.cookie, proposal.id, "undo")).status, 200);
      assert.deepEqual(turnUsages(), [{ status: "succeeded" }]);
      assert.deepEqual(balance(), { balance: 497 });
      assert.equal(db.query("SELECT COUNT(*) AS count FROM ai_credit_usages").get()!.count, 1);
    } finally {
      ai.server.stop(true);
      db.close();
    }
  });

  test("authorship: a confirmed add_pin_comment is the person's comment, field for field like the web route", async () => {
    const db = migratedDatabase();
    const ai = scriptedAiServer([
      { args: { body: "Resposta proposta", pinId: "pin_a1", sessionId: "session_a1" }, tool: "pinar_add_pin_comment" },
      { text: "Propus o comentário." },
    ]);
    try {
      const { a } = await seedWorkspace(db);
      const env = assistantEnv(db, { AI_BASE_URL: `http://127.0.0.1:${ai.server.port}/v1` });
      const turn = await proposingTurn(env, a.cookie, "Responda no pin 1");
      assert.equal(turn.proposals.length, 1);
      const confirmed = await act(env, a.cookie, turn.proposals[0].id, "confirm");
      assert.equal(confirmed.status, 200, JSON.stringify(confirmed.body));
      assert.equal(confirmed.body.proposal?.status, "executed");

      const web = await route("/api/sessions/session_a1/pins/pin_a1/comments", env, {
        body: JSON.stringify({ body: "Pela web" }),
        headers: { cookie: a.cookie, "content-type": "application/json" },
        method: "POST",
      });
      assert.equal(web.status, 200);
      const author = (body: string) =>
        db.query("SELECT actor_id, actor_label, actor_type FROM pin_comments WHERE body = ?").get(body) as Record<string, unknown>;
      assert.deepEqual(author("Resposta proposta"), author("Pela web"), "same author fields as the web route");
      assert.deepEqual(author("Resposta proposta"), { actor_id: "usr_a", actor_label: "a@example.test", actor_type: "human" });
      assert.equal(db.query("SELECT COUNT(*) AS count FROM pin_comments WHERE actor_type = 'agent'").get()?.count, 0);

      // Undo deletes the person's own human comment, and only it.
      const undone = await act(env, a.cookie, turn.proposals[0].id, "undo");
      assert.equal(undone.status, 200, JSON.stringify(undone.body));
      assert.equal(undone.body.proposal?.status, "undone");
      assert.deepEqual((db.query("SELECT body FROM pin_comments ORDER BY created_at").all() as Array<{ body: string }>).map((row) => row.body), ["Pela web"]);
    } finally {
      ai.server.stop(true);
      db.close();
    }
  });

  test("the writing user edits and deletes only their own human comments, and reviews as a human action", async () => {
    const db = migratedDatabase();
    try {
      const { a } = await seedWorkspace(db);
      const env = assistantEnv(db);
      const insertComment = (id: string, actorId: string, actorType: "agent" | "human") =>
        db.query("INSERT INTO pin_comments (id, capture_id, pin_id, actor_id, actor_label, actor_type, body, created_at) VALUES (?, 'session_a1', 'pin_a1', ?, 'label', ?, 'original', ?)")
          .run(id, actorId, actorType, NOW);
      insertComment("comment_own", "usr_a", "human");
      insertComment("comment_agent", "key_1", "agent");
      insertComment("comment_other", "usr_b", "human");
      const host = cloudAssistantToolHost(env, principalFor("usr_a", "a@example.test", "pro"), "https://pinar.test", { writes: true });
      const edited = (await host.callTool("pinar.edit_pin_comment", { body: "edited", commentId: "comment_own", pinId: "pin_a1", sessionId: "session_a1" })) as { comment: { body: string } };
      assert.equal(edited.comment.body, "edited");
      for (const commentId of ["comment_agent", "comment_other"]) {
        await assert.rejects(host.callTool("pinar.edit_pin_comment", { body: "x", commentId, pinId: "pin_a1", sessionId: "session_a1" }), /Resource not found/, commentId);
        await assert.rejects(host.callTool("pinar.delete_pin_comment", { commentId, pinId: "pin_a1", sessionId: "session_a1" }), /Resource not found/, commentId);
      }
      await host.callTool("pinar.delete_pin_comment", { commentId: "comment_own", pinId: "pin_a1", sessionId: "session_a1" });
      assert.deepEqual((db.query("SELECT id FROM pin_comments ORDER BY id").all() as Array<{ id: string }>).map((row) => row.id), ["comment_agent", "comment_other"]);

      // Concluding through the host is recorded like the web review route.
      await host.callTool("pinar.conclude_pin", { pinId: "pin_a1", sessionId: "session_a1" });
      const reopened = await route("/api/sessions/session_a1/pins/pin_a1/review", env, {
        body: JSON.stringify({ action: "reopen" }),
        headers: { cookie: a.cookie, "content-type": "application/json" },
        method: "POST",
      });
      assert.equal(reopened.status, 200);
      const events = db.query("SELECT actor_id, actor_type, origin, to_status FROM pin_review_events WHERE pin_id = 'pin_a1' ORDER BY created_at, rowid").all() as Array<Record<string, unknown>>;
      assert.deepEqual(events.map((event) => event.to_status), ["accepted", "reopened"]);
      assert.deepEqual(
        events.map(({ actor_id, actor_type, origin }) => ({ actor_id, actor_type, origin })),
        [{ actor_id: "usr_a", actor_type: "human", origin: "human" }, { actor_id: "usr_a", actor_type: "human", origin: "human" }],
      );
    } finally {
      db.close();
    }
  });

  test("isolation: B cannot confirm, reject or undo A's proposal; a session only shared with B is invalid_arguments in B's turn", async () => {
    const db = migratedDatabase();
    const aiA = scriptedAiServer([
      { args: { collectionId: "collection_a2", sessionId: "session_a2" }, tool: "pinar_move_session" },
      { text: "Propus." },
    ]);
    const aiB = scriptedAiServer([
      { args: { collectionId: "collection_b", sessionId: "session_a1" }, tool: "pinar_move_session" },
      { text: "Não consegui." },
    ]);
    try {
      const { a, b } = await seedWorkspace(db);
      acceptCollaborator(db, "collab_ab", "collection_a", "usr_a", "b@example.test", "usr_b");
      const envA = assistantEnv(db, { AI_BASE_URL: `http://127.0.0.1:${aiA.server.port}/v1` });
      const turnA = await proposingTurn(envA, a.cookie, "Mova a session_a2");
      const id = turnA.proposals[0].id as string;
      for (const action of ["confirm", "reject", "undo"] as const) {
        const stolen = await act(envA, b.cookie, id, action);
        assert.equal(stolen.status, 404, action);
        assert.equal(stolen.body.code, "proposal_not_found", action);
      }
      assert.deepEqual(order(db, "collection_a"), ["session_a1", "session_a2", "session_a3"]);
      const detail = await route(`/api/assistant/threads/${turnA.threadId}`, envA, { headers: { cookie: a.cookie } });
      assert.equal(((await detail.json()) as { proposals: Array<{ status: string }> }).proposals[0].status, "proposed");

      // B reads session_a1 through the collaboration, but cannot write it.
      const envB = assistantEnv(db, { AI_BASE_URL: `http://127.0.0.1:${aiB.server.port}/v1` });
      const turnB = await proposingTurn(envB, b.cookie, "Traga a session_a1 para a minha coleção");
      assert.deepEqual(turnB.proposals, [], "no proposal over a session only shared with B");
      assert.equal(aiB.requests.length, 2);
      assert.ok(aiB.requests[1].includes("invalid_arguments") && aiB.requests[1].includes("session not found"), aiB.requests[1].slice(-400));
      assert.deepEqual(order(db, "collection_a"), ["session_a1", "session_a2", "session_a3"]);
      assert.deepEqual(order(db, "collection_b"), []);
    } finally {
      aiA.server.stop(true);
      aiB.server.stop(true);
      db.close();
    }
  });

  test("publish_share by proposal: a Pro confirms it, the link is published and the reader sees it active", async () => {
    const db = migratedDatabase();
    const ai = scriptedAiServer([
      { args: { resourceId: "collection_a", resourceType: "collection" }, tool: "pinar_publish_share" },
      { text: "Propus publicar o link." },
    ]);
    try {
      const { a } = await seedWorkspace(db);
      const env = assistantEnv(db, { AI_BASE_URL: `http://127.0.0.1:${ai.server.port}/v1` });
      const reader = cloudAssistantStateReader(env, principalFor("usr_a", "a@example.test", "pro"));
      assert.deepEqual(await reader.share("collection", "collection_a"), { active: false, name: "Collection collection_a" });
      const turn = await proposingTurn(env, a.cookie, "Publique a collection_a");
      assert.equal(turn.proposals.length, 1);
      assert.equal(turn.proposals[0].risk, "external");
      assert.deepEqual(turn.proposals[0].display, { action: "publish_share", params: { kind: "collection", resource: "Collection collection_a" } });
      assert.equal(db.query("SELECT COUNT(*) AS count FROM share_tokens").get()?.count, 0, "nothing published during the turn");
      const confirmed = await act(env, a.cookie, turn.proposals[0].id, "confirm");
      assert.equal(confirmed.status, 200, JSON.stringify(confirmed.body));
      assert.equal(confirmed.body.proposal?.status, "executed");
      assert.deepEqual(db.query("SELECT resource_type, resource_id, owner_id, status FROM share_tokens").all(), [
        { owner_id: "usr_a", resource_id: "collection_a", resource_type: "collection", status: "active" },
      ]);
      assert.deepEqual(await reader.share("collection", "collection_a"), { active: true, name: "Collection collection_a" });
      const undo = await act(env, a.cookie, turn.proposals[0].id, "undo");
      assert.equal(undo.status, 409);
      assert.equal(undo.body.code, "undo_unavailable");
    } finally {
      ai.server.stop(true);
      db.close();
    }
  });

  test("the Cloud reader matches the MCP reads for the owner and is null for anyone else, collaborators included", async () => {
    const db = migratedDatabase();
    try {
      await seedWorkspace(db);
      acceptCollaborator(db, "collab_ab", "collection_a", "usr_a", "b@example.test", "usr_b");
      db.query("INSERT INTO batches (id, user_id, label, started_at) VALUES ('batch_a', 'usr_a', 'Sprint 12', ?)").run(NOW);
      db.query("UPDATE sessions SET batch_id = 'batch_a' WHERE id IN ('session_a1', 'session_a3')").run();
      db.query("INSERT INTO pin_comments (id, capture_id, pin_id, actor_id, actor_label, actor_type, body, created_at) VALUES ('comment_1', 'session_a1', 'pin_a1', 'usr_a', 'a@example.test', 'human', 'Looks off', ?)").run(NOW);
      const env = assistantEnv(db);
      const principalA = principalFor("usr_a", "a@example.test", "pro");
      const reader = cloudAssistantStateReader(env, principalA);
      const host = cloudAssistantToolHost(env, principalA, "https://pinar.test");
      const call = async (name: string, args: Record<string, unknown>) => (await host.callTool(name, args)) as Record<string, any>;

      const projects = (await call("pinar.list_projects", {})).projects as Array<{ id: string; name: string }>;
      assert.deepEqual(await reader.projectOrder(), projects.map((project) => project.id));
      const collections = (await call("pinar.list_collections", { projectId: "project_a" })).collections as Array<{ id: string; name: string; parentId: string | null }>;
      assert.deepEqual(await reader.project("project_a"), { collectionCount: collections.length, id: "project_a", name: "Project project_a" });
      assert.deepEqual(await reader.collectionPlacements("project_a"), collections.map((item) => ({ id: item.id, parentId: item.parentId ?? null })));
      for (const collection of collections) {
        const sessions = (await call("pinar.list_sessions", { collectionId: collection.id })).sessions as Array<Record<string, any>>;
        assert.deepEqual(await reader.collection(collection.id), {
          id: collection.id,
          name: collection.name,
          parentId: collection.parentId ?? null,
          projectId: "project_a",
          sessionCount: sessions.length,
        });
        assert.deepEqual(await reader.sessionOrder(collection.id), sessions.map((session) => session.id));
        for (const session of sessions) {
          assert.deepEqual(await reader.session(session.id), {
            batchId: session.batchId,
            collectionId: session.collectionId,
            id: session.id,
            pinCount: session.pinCount,
            title: session.title,
          });
        }
      }
      const pin = (await call("pinar.get_pin", { pinId: "pin_a1", sessionId: "session_a1" })).pin;
      const comments = (await call("pinar.list_pin_comments", { pinId: "pin_a1", sessionId: "session_a1" })).comments as Array<{ body: string; id: string }>;
      assert.deepEqual(await reader.pin("session_a1", "pin_a1"), { comment: pin.comment, commentCount: comments.length, id: "pin_a1", number: pin.number });
      assert.deepEqual(await reader.comment("session_a1", "pin_a1", "comment_1"), { body: "Looks off", id: "comment_1" });
      const batch = ((await call("pinar.list_batches", {})).batches as Array<Record<string, any>>).find((item) => item.id === "batch_a")!;
      assert.deepEqual(await reader.batch("batch_a"), { finishedAt: batch.finishedAt, id: "batch_a", label: "Sprint 12", sessionCount: batch.sessionCount });
      assert.equal(batch.sessionCount, 2);
      assert.deepEqual(await reader.share("session", "session_a1"), { active: false, name: "session_a1" });

      // B: another account's entities read as null, even where B collaborates.
      const readerB = cloudAssistantStateReader(env, principalFor("usr_b", "b@example.test", "pro"));
      const hostB = cloudAssistantToolHost(env, principalFor("usr_b", "b@example.test", "pro"), "https://pinar.test");
      assert.ok(((await hostB.callTool("pinar.list_pins", { sessionId: "session_a1" })) as { pins: unknown[] }).pins.length > 0, "B reads it through the collaboration");
      assert.equal(await readerB.session("session_a1"), null);
      assert.equal(await readerB.collection("collection_a"), null);
      assert.equal(await readerB.sessionOrder("collection_a"), null);
      assert.equal(await readerB.collectionPlacements("project_a"), null);
      assert.equal(await readerB.project("project_a"), null);
      assert.equal(await readerB.pin("session_a1", "pin_a1"), null);
      assert.equal(await readerB.comment("session_a1", "pin_a1", "comment_1"), null);
      assert.equal(await readerB.batch("batch_a"), null);
      assert.equal(await readerB.share("collection", "collection_a"), null);
      assert.ok(!(await readerB.projectOrder()).includes("project_a"));
    } finally {
      db.close();
    }
  });
});

// ---------- F4/S1: the model chain, the production gate and the health ----------

const GATEWAY_KEY = "gw-live-key-SENTINEL-7781";
const HAIKU = "anthropic/claude-haiku-5.5";
const DEEPSEEK = "deepseek/deepseek-v4.1-flash";

// A production env with a valid gateway chain: no appliance strings at all.
function productionEnv(db: Database, overrides: Partial<CloudEnv> = {}): CloudEnv {
  return {
    AI_GATEWAY_API_KEY: GATEWAY_KEY,
    ASSISTANT_CHAIN: `gateway:${HAIKU},gateway:${DEEPSEEK}`,
    ASSISTANT_ENABLED: "true",
    DB: sqliteD1(db),
    DEPLOYMENT_ENV: "production",
    ...overrides,
  };
}

type GatewayCall = { body: Record<string, unknown>; headers: Headers; model: string; url: string };

// Replaces the global fetch with a fake Vercel AI Gateway for one test: each
// model answers with its scripted status or a text stream. Restored by the
// returned function, always called in a finally.
function fakeGatewayFetch(replies: Record<string, number | string>) {
  const calls: GatewayCall[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    const model = headers.get("ai-language-model-id") ?? "";
    calls.push({ body: JSON.parse(String(init?.body ?? "{}")), headers, model, url: String(input) });
    const reply = replies[model];
    if (typeof reply === "number") {
      return Response.json({ error: { message: `upstream ${GATEWAY_KEY}`, type: "rate_limit_exceeded" } }, { status: reply });
    }
    const parts = [
      { type: "stream-start", warnings: [] },
      { id: "t1", type: "text-start" },
      { delta: reply ?? "", id: "t1", type: "text-delta" },
      { id: "t1", type: "text-end" },
      {
        finishReason: { raw: "stop", unified: "stop" },
        providerMetadata: { gateway: { cost: "0.0045405" } },
        type: "finish",
        usage: { inputTokens: { total: 12 }, outputTokens: { total: 4 } },
      },
    ];
    return new Response(parts.map((part) => `data: ${JSON.stringify(part)}\n\n`).join(""), { headers: { "content-type": "text/event-stream" } });
  }) as typeof fetch;
  return { calls, restore: () => { globalThis.fetch = original; } };
}

// Collects every console line of a block (restored in a finally).
async function capturingLogs<T>(run: () => Promise<T>): Promise<{ logged: string; result: T }> {
  const lines: unknown[] = [];
  const original = { error: console.error, info: console.info, log: console.log, warn: console.warn };
  console.error = (...args: unknown[]) => { lines.push(args); };
  console.info = (...args: unknown[]) => { lines.push(args); };
  console.log = (...args: unknown[]) => { lines.push(args); };
  console.warn = (...args: unknown[]) => { lines.push(args); };
  try {
    const result = await run();
    return { logged: JSON.stringify(lines), result };
  } finally {
    Object.assign(console, original);
  }
}

describe("cloud assistant chain (F4/S1)", () => {
  beforeEach(() => {
    resetCloudMemoryStateForTests();
    setCloudNowForTests(NOW);
  });

  afterEach(() => resetCloudMemoryStateForTests());

  function route(path: string, env: CloudEnv, init: RequestInit = {}) {
    return handleCloudApiRequest(new Request(`https://pinar.test${path}`, init), env);
  }

  async function seedPro(db: Database, env: CloudEnv) {
    insertUser(db, "usr_a", "a@example.test", "pro");
    return seedCloudWebSessionForTests({ email: "a@example.test", id: "usr_a", plan: "pro" }, env);
  }

  async function statusOf(env: CloudEnv, cookie: string) {
    return (await route("/api/assistant/status", env, { headers: { cookie } })).json();
  }

  function turn(env: CloudEnv, cookie: string, text: string) {
    return route("/api/assistant/turn", env, {
      body: JSON.stringify({ text }),
      headers: { cookie, "content-type": "application/json" },
      method: "POST",
    });
  }

  async function health(env: CloudEnv) {
    const response = await route("/api/health", env);
    assert.equal(response.status, 200);
    const text = await response.text();
    assert.ok(!text.includes(GATEWAY_KEY), "the health never shows the key");
    return JSON.parse(text) as { hasAssistant: unknown };
  }

  async function assistantMessage(env: CloudEnv, cookie: string, threadId: string) {
    const deadline = Date.now() + 5_000;
    for (;;) {
      const detail = await route(`/api/assistant/threads/${threadId}`, env, { headers: { cookie } });
      const text = await detail.text();
      const body = JSON.parse(text) as { messages: Array<Record<string, unknown>> };
      if (body.messages.length === 2) return { message: body.messages[1], text };
      if (Date.now() > deadline) throw new Error("timed out waiting for the assistant message");
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }

  test("gate: staging without a chain keeps appliance:<AI_MODEL> and the rule of before", async () => {
    const db = migratedDatabase();
    try {
      const env = assistantEnv(db);
      const a = await seedPro(db, env);
      assert.deepEqual(await statusOf(env, a.cookie), { available: true, reason: null, surface: "cloud" });
      assert.equal((await health(env)).hasAssistant, true);
      // Without the appliance strings staging stays off, chain or not.
      for (const overrides of [{ AI_BASE_URL: undefined }, { AI_BASE_URL: undefined, ASSISTANT_CHAIN: `gateway:${HAIKU}`, AI_GATEWAY_API_KEY: GATEWAY_KEY }]) {
        const off = assistantEnv(db, overrides);
        assert.deepEqual(await statusOf(off, a.cookie), { available: false, reason: "disabled", surface: "cloud" });
        assert.equal((await health(off)).hasAssistant, false);
      }
    } finally {
      db.close();
    }
  });

  test("gate: production refuses an appliance link (or the appliance default), logged once without values", async () => {
    const db = migratedDatabase();
    try {
      const appliances: Array<Partial<CloudEnv>> = [
        { AI_API_KEY: "sk-ai-test", AI_BASE_URL: "https://appliance.test/v1", AI_MODEL: "qwen-private-model", ASSISTANT_CHAIN: undefined },
        { ASSISTANT_CHAIN: `gateway:${HAIKU},appliance:qwen-private-model` },
      ];
      for (const overrides of appliances) {
        resetCloudMemoryStateForTests();
        const env = productionEnv(db, overrides);
        const a = await seedPro(db, env);
        const { logged } = await capturingLogs(async () => {
          assert.deepEqual(await statusOf(env, a.cookie), { available: false, reason: "disabled", surface: "cloud" });
          assert.equal((await health(env)).hasAssistant, false);
          const denied = await turn(env, a.cookie, "oi");
          assert.equal(denied.status, 503);
          assert.equal((await denied.json() as { code: string }).code, "assistant_unavailable");
        });
        const lines = logged.match(/assistant_chain_config_error/g) ?? [];
        assert.equal(lines.length, 1, "logged once per process");
        assert.ok(logged.includes("appliance_in_production"));
        for (const value of ["qwen-private-model", HAIKU, GATEWAY_KEY, "appliance.test", "sk-ai-test"]) assert.ok(!logged.includes(value), value);
        db.exec("DELETE FROM web_sessions; DELETE FROM users");
      }
    } finally {
      db.close();
    }
  });

  test("gate: production without AI_GATEWAY_API_KEY is off, without a config error", async () => {
    const db = migratedDatabase();
    try {
      const env = productionEnv(db, { AI_GATEWAY_API_KEY: undefined });
      const a = await seedPro(db, env);
      const { logged } = await capturingLogs(async () => {
        assert.deepEqual(await statusOf(env, a.cookie), { available: false, reason: "disabled", surface: "cloud" });
        assert.equal((await health(env)).hasAssistant, false);
      });
      assert.ok(!logged.includes("assistant_chain_config_error"));
      // And the switch is still required.
      const off = productionEnv(db, { ASSISTANT_ENABLED: undefined });
      assert.deepEqual(await statusOf(off, a.cookie), { available: false, reason: "disabled", surface: "cloud" });
    } finally {
      db.close();
    }
  });

  test("gate: production with a gateway-only chain and the key is on, and a turn goes through the gateway", async () => {
    const db = migratedDatabase();
    const gateway = fakeGatewayFetch({ [HAIKU]: "Do gateway." });
    try {
      const env = productionEnv(db);
      const a = await seedPro(db, env);
      const { logged, result } = await capturingLogs(async () => {
        assert.deepEqual(await statusOf(env, a.cookie), { available: true, reason: null, surface: "cloud" });
        assert.equal((await health(env)).hasAssistant, true);
        const response = await turn(env, a.cookie, "Quantas sessões?");
        assert.equal(response.status, 200);
        const sse = await response.text();
        const thread = JSON.parse(sse.split("\n").find((line) => line.startsWith("data: "))!.slice(6)) as { data: { id: string } };
        return { sse, threadId: thread.data.id, ...(await assistantMessage(env, a.cookie, thread.data.id)) };
      });
      assert.ok(result.sse.includes("Do gateway."));
      assert.equal(result.message.status, "final");
      assert.equal(result.message.text, "Do gateway.");
      assert.deepEqual(gateway.calls.map((call) => call.model), [HAIKU]);
      const call = gateway.calls[0];
      assert.equal(call.url, "https://ai-gateway.vercel.sh/v4/ai/language-model");
      assert.equal(call.headers.get("authorization"), `Bearer ${GATEWAY_KEY}`);
      assert.deepEqual(call.body.providerOptions, {
        gateway: { caching: "auto", disallowPromptTraining: true, sessionId: result.threadId },
      });
      for (const text of [result.sse, result.text, logged]) assert.ok(!text.includes(GATEWAY_KEY), "the key never leaves the server");
    } finally {
      gateway.restore();
      db.close();
    }
  });

  test("a route turn falls back to the second link, and AI_GATEWAY_ZERO_DATA_RETENTION=true adds the ZDR option", async () => {
    const db = migratedDatabase();
    const gateway = fakeGatewayFetch({ [DEEPSEEK]: "Da reserva.", [HAIKU]: 429 });
    try {
      const env = productionEnv(db, { AI_GATEWAY_ZERO_DATA_RETENTION: "true" });
      const a = await seedPro(db, env);
      const { logged, result } = await capturingLogs(async () => {
        const response = await turn(env, a.cookie, "oi");
        assert.equal(response.status, 200);
        return response.text();
      });
      assert.ok(result.includes("Da reserva."));
      assert.deepEqual(gateway.calls.map((call) => call.model), [HAIKU, DEEPSEEK]);
      for (const call of gateway.calls) {
        assert.equal((call.body.providerOptions as { gateway: { zeroDataRetention?: boolean } }).gateway.zeroDataRetention, true);
      }
      assert.ok(!result.includes(GATEWAY_KEY) && !logged.includes(GATEWAY_KEY));
    } finally {
      gateway.restore();
      db.close();
    }
  });

  test("the breaker is one per process: 3 failed turns open the only link and the next turn is assistant_unavailable", async () => {
    const db = migratedDatabase();
    const gateway = fakeGatewayFetch({ [HAIKU]: 503 });
    try {
      const env = productionEnv(db, { ASSISTANT_CHAIN: `gateway:${HAIKU}` });
      const a = await seedPro(db, env);
      for (let index = 0; index < 3; index++) {
        const failed = await turn(env, a.cookie, `oi ${index}`);
        assert.equal(failed.status, 200);
        const sse = await failed.text();
        assert.ok(sse.includes("ASSISTANT_STREAM_FAILED"));
        assert.ok(!sse.includes(GATEWAY_KEY));
      }
      assert.equal(gateway.calls.length, 3);
      const unavailable = await turn(env, a.cookie, "de novo");
      assert.equal(unavailable.status, 503);
      assert.deepEqual(await unavailable.json(), { code: "assistant_unavailable", error: "The assistant is unavailable" });
      assert.equal(gateway.calls.length, 3, "no request while every link is open");
      // The deployment is still enabled: the breaker is about the links.
      assert.equal((await health(env)).hasAssistant, true);
    } finally {
      gateway.restore();
      db.close();
    }
  });

  const invalid: Array<[string, string]> = [
    ["openai:gpt-secret", "unknown_hub"],
    [`gateway:${HAIKU},gateway:${HAIKU}`, "duplicate_link"],
    ["gateway:a,gateway:b,gateway:c,gateway:d,gateway:e", "too_many_links"],
    ["gateway:", "malformed_link"],
  ];
  for (const [csv, reason] of invalid) {
    test(`an invalid ASSISTANT_CHAIN (${reason}) turns the assistant off and logs only the reason`, async () => {
      const db = migratedDatabase();
      try {
        for (const deployment of ["production", "staging"] as const) {
          resetCloudMemoryStateForTests();
          const env = deployment === "production"
            ? productionEnv(db, { ASSISTANT_CHAIN: csv })
            : assistantEnv(db, { AI_GATEWAY_API_KEY: GATEWAY_KEY, ASSISTANT_CHAIN: csv });
          const a = await seedPro(db, env);
          const { logged } = await capturingLogs(async () => {
            assert.deepEqual(await statusOf(env, a.cookie), { available: false, reason: "disabled", surface: "cloud" });
            assert.equal((await health(env)).hasAssistant, false);
          });
          assert.deepEqual(JSON.parse(JSON.parse(logged)[0][0]), { message: "assistant_chain_config_error", reason });
          for (const value of [csv, "gpt-secret", HAIKU, GATEWAY_KEY]) assert.ok(!logged.includes(value), value);
          db.exec("DELETE FROM web_sessions; DELETE FROM users");
        }
      } finally {
        db.close();
      }
    });
  }

  test("/api/health reports hasAssistant as a plain boolean", async () => {
    const db = migratedDatabase();
    try {
      assert.equal((await health({})).hasAssistant, false);
      assert.equal((await health(productionEnv(db))).hasAssistant, true);
      assert.equal((await health(productionEnv(db, { ASSISTANT_ENABLED: "false" }))).hasAssistant, false);
    } finally {
      db.close();
    }
  });
});

// ---------- F4/S2: 3 credits per Cloud turn ----------

describe("cloud assistant credits (F4/S2)", () => {
  beforeEach(() => {
    resetCloudMemoryStateForTests();
    setCloudNowForTests(NOW);
  });

  afterEach(() => resetCloudMemoryStateForTests());

  function route(path: string, env: CloudEnv, init: RequestInit = {}) {
    return handleCloudApiRequest(new Request(`https://pinar.test${path}`, init), env);
  }

  function turn(env: CloudEnv, cookie: string, text: string) {
    return route("/api/assistant/turn", env, {
      body: JSON.stringify({ text }),
      headers: { cookie, "content-type": "application/json" },
      method: "POST",
    });
  }

  async function seedPro(db: Database, env: CloudEnv) {
    insertUser(db, "usr_a", "a@example.test", "pro");
    const session = await seedCloudWebSessionForTests({ email: "a@example.test", id: "usr_a", plan: "pro" }, env);
    // The entitlements read grants the initial Pro credits (500).
    assert.equal((await route("/api/account/entitlements", env, { headers: { cookie: session.cookie } })).status, 200);
    return session;
  }

  const balance = (db: Database) =>
    (db.query("SELECT SUM(credits - consumed_credits) AS balance FROM ai_credit_grants WHERE owner_id = 'usr_a'").get() as { balance: number }).balance;

  const turnUsages = (db: Database) => db.query(
    "SELECT request_id, resource_id, model, credits, status, input_tokens, output_tokens, cost_usd_micros, result_json, error_code "
      + "FROM ai_credit_usages WHERE feature = 'assistant_turn' ORDER BY created_at, rowid",
  ).all() as Array<Record<string, unknown>>;

  async function settledUsages(db: Database, count = 1) {
    const deadline = Date.now() + 5_000;
    for (;;) {
      const rows = turnUsages(db);
      if (rows.length === count && rows.every((row) => row.status !== "reserved")) return rows;
      if (Date.now() > deadline) throw new Error(`timed out waiting for the turn's credits: ${JSON.stringify(rows)}`);
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }

  function threadOf(sse: string) {
    return (JSON.parse(sse.split("\n").find((line) => line.startsWith("data: "))!.slice(6)) as { data: { id: string } }).data.id;
  }

  async function assistantMessageId(db: Database, threadId: string) {
    const deadline = Date.now() + 5_000;
    for (;;) {
      const row = db.query("SELECT id FROM assistant_messages WHERE thread_id = ? AND role = 'assistant'").get(threadId) as { id: string } | null;
      if (row) return row.id;
      if (Date.now() > deadline) throw new Error("timed out waiting for the assistant message");
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }

  test("a final turn consumes 3 credits with the model that answered, its tokens and cost", async () => {
    const db = migratedDatabase();
    const gateway = fakeGatewayFetch({ [HAIKU]: "Duas sessões." });
    try {
      const env = productionEnv(db);
      const a = await seedPro(db, env);
      assert.equal(balance(db), 500);
      const response = await turn(env, a.cookie, "Quantas sessões?");
      assert.equal(response.status, 200);
      const threadId = threadOf(await response.text());
      const [usage] = await settledUsages(db);
      const messageId = await assistantMessageId(db, threadId);
      assert.deepEqual(usage, {
        cost_usd_micros: 4541,
        credits: 3,
        error_code: null,
        input_tokens: 12,
        model: `gateway:${HAIKU}`,
        output_tokens: 4,
        request_id: `turn:${messageId}`,
        resource_id: `assistant:${threadId}`,
        result_json: JSON.stringify({ costSource: "gateway", fallback: false, link: 0 }),
        status: "succeeded",
      });
      assert.equal(balance(db), 497);
    } finally {
      gateway.restore();
      db.close();
    }
  });

  test("a fallback answer records the second link and fallback in result_json", async () => {
    const db = migratedDatabase();
    const gateway = fakeGatewayFetch({ [DEEPSEEK]: "Da reserva.", [HAIKU]: 429 });
    try {
      const env = productionEnv(db);
      const a = await seedPro(db, env);
      await (await turn(env, a.cookie, "oi")).text();
      const [usage] = await settledUsages(db);
      assert.equal(usage.model, `gateway:${DEEPSEEK}`);
      assert.equal(usage.result_json, JSON.stringify({ costSource: "gateway", fallback: true, link: 1 }));
      assert.equal(balance(db), 497);
    } finally {
      gateway.restore();
      db.close();
    }
  });

  const refunds: Array<[string, Record<string, number | string>, string]> = [
    ["a missing final", { [HAIKU]: "Vou verificar." }, "ASSISTANT_TURN_INCOMPLETE"],
    ["a provider error", { [HAIKU]: 401 }, "ASSISTANT_STREAM_FAILED"],
  ];
  for (const [name, replies, code] of refunds) {
    test(`${name} gives the 3 credits back (${code})`, async () => {
      const db = migratedDatabase();
      const gateway = fakeGatewayFetch(replies);
      try {
        const env = productionEnv(db);
        const a = await seedPro(db, env);
        await (await turn(env, a.cookie, "oi")).text();
        const [usage] = await settledUsages(db);
        assert.deepEqual([usage.status, usage.error_code, usage.credits], ["refunded", code, 3]);
        assert.equal(balance(db), 500);
      } finally {
        gateway.restore();
        db.close();
      }
    });
  }

  test("without enough credits: 402 with the balance, no model call and no assistant message", async () => {
    const db = migratedDatabase();
    const gateway = fakeGatewayFetch({ [HAIKU]: "nunca" });
    try {
      const env = productionEnv(db);
      const a = await seedPro(db, env);
      db.exec("UPDATE ai_credit_grants SET consumed_credits = credits - 2 WHERE owner_id = 'usr_a'");
      const response = await turn(env, a.cookie, "oi");
      assert.equal(response.status, 402);
      const body = (await response.json()) as { aiCredits: { balance: number }; code: string; creditsRequired: number; error: string };
      assert.equal(body.code, "insufficient_ai_credits");
      assert.equal(body.aiCredits.balance, 2);
      assert.equal(body.creditsRequired, 3);
      assert.equal(gateway.calls.length, 0);
      assert.deepEqual(db.query("SELECT role FROM assistant_messages").all(), [{ role: "user" }]);
      assert.deepEqual(turnUsages(db), []);
      assert.equal(balance(db), 2);
    } finally {
      gateway.restore();
      db.close();
    }
  });

  test("idempotency: two instances racing on the same assistant message reserve once (UNIQUE owner + request id)", async () => {
    const db = migratedDatabase();
    try {
      const base = productionEnv(db);
      await seedPro(db, base);
      // Both instances read "no usage yet" before either inserts: each
      // INSERT waits until the two lookups are done, so the UNIQUE is what
      // keeps the second one out.
      let lookups = 0;
      let bothLooked!: () => void;
      const barrier = new Promise<void>((resolve) => {
        bothLooked = resolve;
      });
      const shared = base.DB!;
      const racing: NonNullable<CloudEnv["DB"]> = {
        ...shared,
        prepare(sql: string) {
          const statement = shared.prepare(sql);
          const lookup = /^SELECT \* FROM ai_credit_usages WHERE owner_type = \? AND owner_id = \? AND request_id = \?$/.test(sql.trim());
          const insert = /INSERT INTO ai_credit_usages/.test(sql);
          if (!lookup && !insert) return statement;
          const wrapped = {
            ...statement,
            bind(...values: unknown[]) {
              statement.bind(...values);
              return wrapped;
            },
            async first() {
              const row = await statement.first();
              if (lookup && ++lookups === 2) bothLooked();
              return row;
            },
            async run() {
              await barrier;
              return statement.run();
            },
          };
          return wrapped as typeof statement;
        },
      };
      const principal = { email: "a@example.test", id: "usr_a", isPermanent: true, kind: "account" as const, plan: "pro" as const };
      const first = cloudAssistantTurnMeter({ ...base, DB: racing }, principal, `gateway:${HAIKU}`);
      const second = cloudAssistantTurnMeter({ ...base, DB: racing }, principal, `gateway:${HAIKU}`);
      const turnRef = { messageId: "amsg_race_000000000000000000", threadId: "ath_race_0000000000000000000" };
      const [one, two] = await Promise.all([first(turnRef), second(turnRef)]);
      assert.equal(lookups >= 2, true);
      assert.equal(one.reserved && two.reserved, true);
      assert.equal(turnUsages(db).length, 1);
      assert.equal(balance(db), 497, "charged once");
      // The two handles settle the same reservation: the second ending is a no-op.
      if (!one.reserved || !two.reserved) throw new Error("unreachable");
      await one.consume({ costUsdMicros: 10, inputTokens: 1, model: `gateway:${HAIKU}`, outputTokens: 1, resultJson: "{}" });
      await two.refund("ASSISTANT_STREAM_FAILED").catch(() => {});
      assert.equal(turnUsages(db)[0].status, "succeeded");
      assert.equal(balance(db), 497);
    } finally {
      db.close();
    }
  });

  test("sweeper: a turn reservation 6 minutes old is refunded by the frequent cron, and the late answer does not charge it again", async () => {
    const db = migratedDatabase();
    let release!: () => void;
    const hold = new Promise<void>((resolve) => {
      release = resolve;
    });
    const original = globalThis.fetch;
    globalThis.fetch = (async () => {
      await hold;
      const parts = [
        { id: "t1", type: "text-start" },
        { delta: "Tarde demais.", id: "t1", type: "text-delta" },
        { id: "t1", type: "text-end" },
        { finishReason: { raw: "stop", unified: "stop" }, providerMetadata: { gateway: { cost: "0.0001" } }, type: "finish", usage: { inputTokens: { total: 5 }, outputTokens: { total: 2 } } },
      ];
      return new Response(parts.map((part) => `data: ${JSON.stringify(part)}\n\n`).join(""), { headers: { "content-type": "text/event-stream" } });
    }) as typeof fetch;
    try {
      const env = productionEnv(db);
      const a = await seedPro(db, env);
      const response = await turn(env, a.cookie, "oi");
      assert.equal(response.status, 200);
      assert.deepEqual(turnUsages(db).map((row) => row.status), ["reserved"]);
      assert.equal(balance(db), 497);
      const cron = createEdgerFetch({
        frequentJobs: [{ name: "refundStaleAiReservations", run: () => refundStaleAiReservations(env) }],
        jobs: [],
        log: () => {},
        tanstackFetch: async () => new Response("tanstack"),
      });
      const tick = () => cron(new Request("https://pinar.test/_internal/cron/frequent", { headers: { "x-edger-internal": "true" }, method: "POST" }));

      // At 4 minutes the reservation stays.
      setCloudNowForTests(new Date(Date.parse(NOW) + 4 * 60_000).toISOString());
      assert.equal((await tick()).status, 200);
      assert.deepEqual(turnUsages(db).map((row) => row.status), ["reserved"]);

      // At 6 minutes the cron gives it back.
      setCloudNowForTests(new Date(Date.parse(NOW) + 6 * 60_000).toISOString());
      const swept = await tick();
      assert.equal(swept.status, 200);
      assert.deepEqual(await swept.json(), { jobs: [{ job: "refundStaleAiReservations", ok: true }], ok: true });
      assert.deepEqual(turnUsages(db).map((row) => [row.status, row.error_code]), [["refunded", "reservation_timeout"]]);
      assert.equal(balance(db), 500);

      // The answer arrives late: it is stored, and the credits stay refunded.
      release();
      const threadId = threadOf(await response.text());
      await assistantMessageId(db, threadId);
      await new Promise((resolve) => setTimeout(resolve, 50));
      assert.deepEqual(turnUsages(db).map((row) => row.status), ["refunded"]);
      assert.equal(balance(db), 500);
    } finally {
      release();
      globalThis.fetch = original;
      db.close();
    }
  });

  test("the usage history shows the voice pin and the assistant turn, without model or resource", async () => {
    const db = migratedDatabase();
    const gateway = fakeGatewayFetch({ [HAIKU]: "ok" });
    try {
      const env = productionEnv(db);
      const a = await seedPro(db, env);
      const grant = (db.query("SELECT id FROM ai_credit_grants WHERE owner_id = 'usr_a'").get() as { id: string }).id;
      db.query(
        "INSERT INTO ai_credit_usages (id, request_id, owner_type, owner_id, grant_id, feature, resource_id, model, credits, status, created_at, completed_at) "
          + "VALUES ('aiu_voice', 'voice-1', 'account', 'usr_a', ?, 'voice_pin', 'pin-1', 'whisper', 1, 'succeeded', '2026-09-30T12:00:00.000Z', '2026-09-30T12:00:01.000Z')",
      ).run(grant);
      await (await turn(env, a.cookie, "oi")).text();
      await settledUsages(db);
      const response = await route("/api/account/entitlements", env, { headers: { cookie: a.cookie } });
      const text = await response.text();
      const body = JSON.parse(text) as { aiUsage: Array<Record<string, unknown>> };
      assert.deepEqual(body.aiUsage.map((entry) => [entry.feature, entry.credits, entry.status]), [
        ["assistant_turn", 3, "succeeded"],
        ["voice_pin", 1, "succeeded"],
      ]);
      for (const entry of body.aiUsage) assert.deepEqual(Object.keys(entry).sort(), ["completedAt", "createdAt", "credits", "feature", "status"]);
      assert.ok(!text.includes(HAIKU) && !text.includes("assistant:"), "no model or resource reaches the browser");
    } finally {
      gateway.restore();
      db.close();
    }
  });
});
