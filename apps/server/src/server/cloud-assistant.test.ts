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
import { cloudAssistantStore } from "./assistant/store-cloud";
import type { AssistantToolHost } from "./assistant/tools";
import { byokCrypto } from "./byok/crypto";
import { ByokEgressUnavailableError, setByokEgressForTests } from "./byok/fetch";
import { resetByokConcurrencyForTests } from "./byok/route";
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
// chat completions call with a two-chunk SSE stream and nothing else, and
// counts its calls (the BYOK test proves the gateway is not called).
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
  let calls = 0;
  const server = Bun.serve({
    fetch: (incoming) => {
      const url = new URL(incoming.url);
      if (incoming.method === "POST" && url.pathname === "/v1/chat/completions") {
        calls += 1;
        return new Response(lines.join("\n"), { headers: { "content-type": "text/event-stream" } });
      }
      return new Response("not found", { status: 404 });
    },
    port: 0,
  });
  return { calls: () => calls, port: server.port, stop: () => server.stop(true) };
}

// The scripted BYOK egress: the next scripted reply per call (a tool call
// or text), with the request's auth and body recorded — the tool's result
// the model got is read from the second request's body.
function scriptedByokEgress(replies: AiReply[]) {
  const calls: Array<{ auth: string | null; body: string; url: string }> = [];
  const chunk = (delta: Record<string, unknown>, finishReason: string | null) =>
    `data: ${JSON.stringify({ choices: [{ delta, finish_reason: finishReason, index: 0 }], created: 1, id: "c1", model: "mock", object: "chat.completion.chunk" })}\n\n`;
  setByokEgressForTests(async (url, init) => {
    calls.push({ auth: new Headers(init?.headers ?? {}).get("authorization"), body: String(init?.body ?? ""), url });
    const reply = replies[Math.min(calls.length - 1, replies.length - 1)];
    const body = "text" in reply
      ? chunk({ content: reply.text, role: "assistant" }, null) + chunk({}, "stop")
      : chunk({ role: "assistant", tool_calls: [{ function: { arguments: JSON.stringify(reply.args), name: reply.tool }, id: `call_${calls.length}`, index: 0, type: "function" }] }, null) + chunk({}, "tool_calls");
    return new Response(`${body}data: [DONE]\n\n`, { headers: { "content-type": "text/event-stream" }, status: 200 });
  });
  return calls;
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

  afterEach(() => {
    resetCloudMemoryStateForTests();
    setByokEgressForTests(null);
    resetByokConcurrencyForTests();
  });

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

  test("a Pro account in production is disabled without the chain's hub configuration", async () => {
    const db = migratedDatabase();
    try {
      const { a } = await seedAccounts(db);
      // A46: the default appliance chain is valid in production, so it is
      // the appliance configuration that decides it off here.
      const env = assistantEnv(db, { AI_API_KEY: undefined, AI_BASE_URL: undefined, DEPLOYMENT_ENV: "production" });
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
      assert.deepEqual(await status.json(), { available: true, byok: { chat: false }, reason: null, surface: "cloud" });

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

  // F5/S3: the BYOK route of the turn. With tools and chat tested ok the
  // turn runs on the user's endpoint — one link, no fallback to the
  // gateway, no credits; the status reports the route; useCredits: true
  // opts the request out and returns to today's path.
  test("S3: with an ok BYOK route the turn runs on the user's endpoint (no fallback, no credits, source byok)", async () => {
    const db = migratedDatabase();
    const fake = fakeAiServer();
    const byokKey = Buffer.alloc(32, 11).toString("base64");
    const BYOK_KEY = "sk-byok-assistant-test-9876";
    const byokCalls: Array<{ auth: string | null; body: string; url: string }> = [];
    try {
      const { a } = await seedAccounts(db);
      const env = assistantEnv(db, {
        AI_BASE_URL: `http://127.0.0.1:${fake.port}/v1`,
        BYOK_MASTER_KEY: byokKey,
      });
      // The row the S2 test route would have written: chat and tools ok.
      const cryptoObj = (await byokCrypto(byokKey))!;
      const ciphertext = await cryptoObj.encrypt(BYOK_KEY);
      const capabilities = JSON.stringify({
        chat: { error: null, ok: true, testedAt: NOW },
        embeddings: { dims: null, error: null, ok: null, testedAt: null },
        tools: { error: null, ok: true, testedAt: NOW },
        transcription: { error: null, ok: null, testedAt: null },
        vision: { error: null, ok: null, testedAt: null },
      });
      db.query(
        `INSERT INTO byok_endpoints (owner_id, base_url, key_ciphertext, key_last4, key_id, chat_model,
           embedding_model, transcription_model, capabilities_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run("usr_a", "https://byok-user.test/v1", ciphertext, "9876", cryptoObj.keyId, "chat-1", "", "", capabilities, NOW, NOW);

      // The user's endpoint (the fake the tests inject): the same SSE as the
      // gateway, with the BYOK model.
      const lines = [
        `data: ${JSON.stringify({ choices: [{ delta: { content: "Duas", role: "assistant" }, finish_reason: null, index: 0 }], created: 1, id: "c1", model: "chat-1", object: "chat.completion.chunk" })}`,
        "",
        `data: ${JSON.stringify({ choices: [{ delta: { content: " sessões." }, finish_reason: null, index: 0 }], created: 1, id: "c1", model: "chat-1", object: "chat.completion.chunk" })}`,
        "",
        `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: "stop", index: 0 }], created: 1, id: "c1", model: "chat-1", object: "chat.completion.chunk" })}`,
        "",
        "data: [DONE]",
        "",
      ].join("\n");
      setByokEgressForTests(async (url, init) => {
        byokCalls.push({ auth: new Headers(init?.headers ?? {}).get("authorization"), body: String(init?.body ?? ""), url });
        return new Response(lines, { headers: { "content-type": "text/event-stream" }, status: 200 });
      });

      // The status reports the route (never the key, no concurrency slot).
      const status = await route("/api/assistant/status", env, { headers: { cookie: a.cookie } });
      assert.deepEqual(await status.json(), { available: true, byok: { chat: true }, reason: null, surface: "cloud" });

      // The owner's balance before the BYOK turn (no grant yet: the meter
      // creates it, and the BYOK route never calls the meter).
      const balanceOf = () =>
        db.query("SELECT SUM(credits - consumed_credits) AS balance FROM ai_credit_grants WHERE owner_id = 'usr_a'").get();
      const balanceBefore = balanceOf();

      // The turn runs on the user's endpoint: one call, the decrypted key in
      // the Authorization header (never the body), no fallback to the
      // gateway, no credits, and the origin in the first part.
      const response = await turn(env, a.cookie, { text: "Quantas sessões?" });
      assert.equal(response.status, 200);
      const sse = await response.text();
      assert.ok(sse.includes("Duas") && sse.includes("sessões."), "the BYOK answer reaches the stream");
      const firstLine = sse.split("\n").find((line) => line.startsWith("data: "));
      assert.ok(firstLine);
      const firstPart = JSON.parse(firstLine.slice(6)) as { data: { source?: string; title: string }; type: string };
      assert.equal(firstPart.type, "data-thread");
      assert.equal(firstPart.data.source, "byok");

      assert.equal(byokCalls.length, 1, "exactly one BYOK call: no retry, no fallback");
      assert.ok(byokCalls[0].url.startsWith("https://byok-user.test/v1/chat/completions"), byokCalls[0].url);
      assert.equal(byokCalls[0].auth, `Bearer ${BYOK_KEY}`, "the decrypted key, only in the header");
      assert.ok(!byokCalls[0].body.includes(BYOK_KEY), "the key never goes in the body");
      assert.equal(fake.calls(), 0, "the gateway is not called");

      // The credits were not touched: nothing reserved, nothing used, the
      // balance is the same as before the turn (the control is the
      // useCredits turn below, which drops the grant by 3).
      assert.deepEqual(db.query("SELECT id FROM ai_credit_usages").all(), [], "no credit usage of the BYOK turn");
      assert.deepEqual(balanceOf(), balanceBefore, "the balance did not move");

      // useCredits: true opts the request out of the BYOK route: the
      // gateway answers and the origin is pinar.
      const withCredits = await turn(env, a.cookie, { text: "Quantas sessões?", useCredits: true });
      assert.equal(withCredits.status, 200);
      const sse2 = await withCredits.text();
      const secondLine = sse2.split("\n").find((line) => line.startsWith("data: "));
      assert.ok(secondLine);
      const secondPart = JSON.parse(secondLine.slice(6)) as { data: { source?: string }; type: string };
      assert.equal(secondPart.type, "data-thread");
      assert.equal(secondPart.data.source, "pinar");
      assert.equal(fake.calls(), 1, "useCredits returns to the gateway path");
      assert.equal(byokCalls.length, 1, "and the BYOK endpoint gets no second call");
      // That turn was billed (the credits settle when the outcome settles).
      const usages = () => db.query("SELECT status FROM ai_credit_usages WHERE feature = 'assistant_turn'").all();
      const deadline = Date.now() + 5_000;
      while (JSON.stringify(usages()) !== JSON.stringify([{ status: "succeeded" }])) {
        if (Date.now() > deadline) throw new Error(`the useCredits turn was not billed: ${JSON.stringify(usages())}`);
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      // The control: the gateway turn billed 3, so the balance measurement
      // above (unchanged on the BYOK turn) is not vacuous.
      assert.deepEqual(balanceOf(), { balance: 497 }, "the control turn billed 3");
    } finally {
      setByokEgressForTests(null);
      fake.stop();
      db.close();
    }
  });

  // F5/S3: the failing BYOK turn, end to end. The table runs every case of
  // the common cause table through the real turn route: the stream ends
  // with a data-byok-error part (the cause, canUseCredits, the retryAfter
  // when there is one) before the error part (errorText byok_error); the
  // gateway is never called, the credits never move, the key and the
  // provider's body never cross the stream or a log, and the cases run
  // back to back — with the concurrency cap of 2, a leaked slot would
  // rate_limit the third case instead of answering it.
  test("S3: a failing BYOK turn ends with byok_error, the cause of the common table (no gateway, no credit, slot freed)", async () => {
    const db = migratedDatabase();
    const fake = fakeAiServer();
    const byokKey = Buffer.alloc(32, 13).toString("base64");
    const BYOK_KEY = "sk-byok-fail-test-5678";
    try {
      const { a } = await seedAccounts(db);
      const env = assistantEnv(db, {
        AI_BASE_URL: `http://127.0.0.1:${fake.port}/v1`,
        BYOK_MASTER_KEY: byokKey,
      });
      // An ok row (chat, tools): the turn takes the BYOK route and fails
      // on the egress.
      const cryptoObj = (await byokCrypto(byokKey))!;
      const ciphertext = await cryptoObj.encrypt(BYOK_KEY);
      const capabilities = JSON.stringify({
        chat: { error: null, ok: true, testedAt: NOW },
        embeddings: { dims: null, error: null, ok: null, testedAt: null },
        tools: { error: null, ok: true, testedAt: NOW },
        transcription: { error: null, ok: null, testedAt: null },
        vision: { error: null, ok: null, testedAt: null },
      });
      db.query(
        `INSERT INTO byok_endpoints (owner_id, base_url, key_ciphertext, key_last4, key_id, chat_model,
           embedding_model, transcription_model, capabilities_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run("usr_a", "https://byok-user.test/v1", ciphertext, "5678", cryptoObj.keyId, "chat-1", "", "", capabilities, NOW, NOW);

      const usages = () => db.query("SELECT id FROM ai_credit_usages").all();
      const balanceOf = () =>
        db.query("SELECT SUM(credits - consumed_credits) AS balance FROM ai_credit_grants WHERE owner_id = 'usr_a'").get();
      const balanceBefore = balanceOf();

      // The console is spied (the key and the provider's body must not
      // reach a log); the spy still logs, so a failure stays visible.
      const consoleCalls: string[] = [];
      const spy =
        (original: (...args: unknown[]) => void) =>
        (...args: unknown[]) => {
          consoleCalls.push(args.map((arg) => String(arg)).join(" "));
          original(...args);
        };
      const realError = console.error;
      const realWarn = console.warn;
      const realInfo = console.info;
      const realLog = console.log;
      console.error = spy(realError);
      console.warn = spy(realWarn);
      console.info = spy(realInfo);
      console.log = spy(realLog);

      const jsonBody = (marker: string, status: number, headers: Record<string, string> = {}) =>
        new Response(JSON.stringify({ error: { message: marker } }), {
          headers: { "content-type": "application/json", ...headers },
          status,
        });
      const cases: Array<{
        cause: string;
        label: string;
        marker: string;
        respond?: () => Response;
        throwName?: string;
        refusal?: boolean;
        retryAfter?: number;
      }> = [
        { cause: "key_rejected", label: "401", marker: "PROVIDER-BODY-401", respond: () => jsonBody("PROVIDER-BODY-401", 401) },
        {
          cause: "model_not_found",
          label: "404 with the model marker",
          marker: "PROVIDER-BODY-404",
          respond: () => new Response(JSON.stringify({ error: { code: "model_not_found", message: "PROVIDER-BODY-404" } }), { headers: { "content-type": "application/json" }, status: 404 }),
        },
        {
          cause: "rate_limited",
          label: "429 with Retry-After: 7",
          marker: "PROVIDER-BODY-429",
          respond: () => jsonBody("PROVIDER-BODY-429", 429, { "retry-after": "7" }),
          retryAfter: 7,
        },
        { cause: "unavailable", label: "503", marker: "PROVIDER-BODY-503", respond: () => jsonBody("PROVIDER-BODY-503", 503) },
        { cause: "timeout", label: "the deadline", marker: "PROVIDER-BODY-TIMEOUT", throwName: "TimeoutError" },
        { cause: "egress_unavailable", label: "the egress refusal", marker: "", refusal: true },
        {
          cause: "endpoint_blocked",
          label: "EGRESS_HOST_BLOCKED",
          marker: "PROVIDER-BODY-HOST-BLOCKED",
          respond: () =>
            new Response("PROVIDER-BODY-HOST-BLOCKED", { headers: { "x-edger-egress-error": "EGRESS_HOST_BLOCKED" }, status: 502 }),
        },
      ];
      for (const c of cases) {
        setByokEgressForTests(async () => {
          if (c.refusal) throw new ByokEgressUnavailableError();
          if (c.throwName) throw Object.assign(new Error(c.marker || "the provider timed out"), { name: c.throwName });
          return c.respond!();
        });
        const response = await turn(env, a.cookie, { text: `Sessão ${c.label}` });
        // 200 and streamed: not the 429 rate_limited body — with the cap of
        // 2, a slot leaked by a previous case would show up here (case 3+).
        assert.equal(response.status, 200, `${c.label}: the failing turn still streams (no rate_limited)`);
        const sse = await response.text();
        const parts = sse.split("\n").filter((line) => line.startsWith("data: ") && line.slice(6).trim() !== "[DONE]").map((line) => JSON.parse(line.slice(6)) as Record<string, unknown>);
        const byokErrorPart = parts.find((part) => part.type === "data-byok-error");
        assert.ok(byokErrorPart, `${c.label}: the data-byok-error part is in the stream`);
        const data = byokErrorPart.data as { canUseCredits?: unknown; cause?: string; retryAfter?: number };
        assert.equal(data.cause, c.cause, `${c.label}: the cause`);
        assert.equal(data.canUseCredits, true, `${c.label}: canUseCredits`);
        assert.equal(data.retryAfter, c.retryAfter ?? undefined, `${c.label}: the retryAfter (only the 429)`);
        const errorPart = parts.find((part) => part.type === "error") as { errorText?: string } | undefined;
        assert.equal(errorPart?.errorText, "byok_error", `${c.label}: the errorText`);
        assert.ok(parts.indexOf(byokErrorPart) < parts.indexOf(errorPart!), `${c.label}: the data part precedes the error part`);
        assert.equal(fake.calls(), 0, `${c.label}: the gateway is not called`);
        assert.deepEqual(usages(), [], `${c.label}: no credit usage`);
        assert.deepEqual(balanceOf(), balanceBefore, `${c.label}: the balance is the same as before the turn`);
        assert.ok(!sse.includes(BYOK_KEY), `${c.label}: the key is not in the stream`);
        assert.ok(c.marker === "" || !sse.includes(c.marker), `${c.label}: the provider's body is not in the stream`);
        assert.ok(
          !consoleCalls.some((call) => call.includes(BYOK_KEY) || (c.marker !== "" && call.includes(c.marker))),
          `${c.label}: the key and the body do not reach a log`,
        );
        consoleCalls.length = 0;
      }
      // Every case answered a turn (no rate_limited among them): the slot
      // was freed after each failing turn.
      assert.equal(fake.calls(), 0, "across the table, the gateway was never called");
      console.error = realError;
      console.warn = realWarn;
      console.info = realInfo;
      console.log = realLog;
    } finally {
      setByokEgressForTests(null);
      fake.stop();
      db.close();
    }
  });

  // F5/S3: production without an injected egress (byokFetch refuses). The
  // spy on globalThis.fetch proves what leaves the server: the gateway's
  // own calls (the fake, on loopback) and nothing for the BYOK host.
  test("S3: without an injected egress, an egress_unavailable row goes to the gateway (billed) and a stale ok row ends with byok_error (unbilled)", async () => {
    const db = migratedDatabase();
    const fake = fakeAiServer();
    const byokKey = Buffer.alloc(32, 17).toString("base64");
    const BYOK_KEY = "sk-byok-nofetch-test-9012";
    const fetchUrls: string[] = [];
    const realFetch = globalThis.fetch;
    try {
      globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
        fetchUrls.push(typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url);
        return realFetch(input, init);
      }) as typeof fetch;
      const { a } = await seedAccounts(db);
      const env = assistantEnv(db, {
        AI_BASE_URL: `http://127.0.0.1:${fake.port}/v1`,
        BYOK_MASTER_KEY: byokKey,
      });
      const cryptoObj = (await byokCrypto(byokKey))!;
      const ciphertext = await cryptoObj.encrypt(BYOK_KEY);
      const rowQuery = `INSERT INTO byok_endpoints (owner_id, base_url, key_ciphertext, key_last4, key_id, chat_model,
         embedding_model, transcription_model, capabilities_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
      const usages = () => db.query("SELECT status FROM ai_credit_usages WHERE feature = 'assistant_turn'").all();
      const balanceOf = () =>
        db.query("SELECT SUM(credits - consumed_credits) AS balance FROM ai_credit_grants WHERE owner_id = 'usr_a'").get();

      // (a) The row S2 would store in production: byokFetch refused, every
      // capability ok: false with the egress_unavailable cause.
      db.query(rowQuery).run(
        "usr_a",
        "https://byok-user.test/v1",
        ciphertext,
        "9012",
        cryptoObj.keyId,
        "chat-1",
        "",
        "",
        JSON.stringify({
          chat: { error: "egress_unavailable", ok: false, testedAt: NOW },
          embeddings: { dims: null, error: "egress_unavailable", ok: false, testedAt: NOW },
          tools: { error: "egress_unavailable", ok: false, testedAt: NOW },
          transcription: { error: "egress_unavailable", ok: false, testedAt: NOW },
          vision: { error: "egress_unavailable", ok: false, testedAt: NOW },
        }),
        NOW,
        NOW,
      );
      const status = await route("/api/assistant/status", env, { headers: { cookie: a.cookie } });
      assert.deepEqual(await status.json(), { available: true, byok: { chat: false }, reason: null, surface: "cloud" });

      const response = await turn(env, a.cookie, { text: "Quantas sessões?" });
      assert.equal(response.status, 200);
      const sse = await response.text();
      assert.ok(sse.includes("Duas") && sse.includes("sessões."), "the gateway answers");
      const firstLine = sse.split("\n").find((line) => line.startsWith("data: "));
      assert.ok(firstLine);
      const firstPart = JSON.parse(firstLine.slice(6)) as { data: { source?: string }; type: string };
      assert.equal(firstPart.type, "data-thread");
      assert.equal(firstPart.data.source, "pinar");
      assert.ok(!fetchUrls.some((url) => url.includes("byok-user.test")), "no URL of the BYOK host leaves the server");
      // The turn was billed (3 credits; the grant is created by the meter).
      const deadline = Date.now() + 5_000;
      while (JSON.stringify(usages()) !== JSON.stringify([{ status: "succeeded" }])) {
        if (Date.now() > deadline) throw new Error(`the gateway turn was not billed: ${JSON.stringify(usages())}`);
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      assert.deepEqual(balanceOf(), { balance: 497 });

      // (b) A stale ok row (an old test, before the egress existed): the
      // turn ends with byok_error egress_unavailable, nothing goes to the
      // BYOK host and nothing is billed.
      db.query("UPDATE byok_endpoints SET capabilities_json = ? WHERE owner_id = 'usr_a'").run(
        JSON.stringify({
          chat: { error: null, ok: true, testedAt: NOW },
          embeddings: { dims: null, error: null, ok: null, testedAt: null },
          tools: { error: null, ok: true, testedAt: NOW },
          transcription: { error: null, ok: null, testedAt: null },
          vision: { error: null, ok: null, testedAt: null },
        }),
      );
      const balanceBefore = balanceOf();
      const second = await turn(env, a.cookie, { text: "Quantas sessões de novo?" });
      assert.equal(second.status, 200);
      const sse2 = await second.text();
      const parts2 = sse2.split("\n").filter((line) => line.startsWith("data: ") && line.slice(6).trim() !== "[DONE]").map((line) => JSON.parse(line.slice(6)) as Record<string, unknown>);
      const byokPart = parts2.find((part) => part.type === "data-byok-error");
      assert.ok(byokPart, "the data-byok-error part is in the stream");
      assert.equal((byokPart.data as { cause?: string }).cause, "egress_unavailable");
      assert.equal((byokPart.data as { canUseCredits?: unknown }).canUseCredits, true);
      assert.equal((parts2.find((part) => part.type === "error") as { errorText?: string } | undefined)?.errorText, "byok_error");
      assert.ok(!sse2.includes(BYOK_KEY), "the key is not in the stream");
      assert.equal(fake.calls(), 1, "the gateway was not called again (no fallback)");
      assert.ok(!fetchUrls.some((url) => url.includes("byok-user.test")), "nothing left for the BYOK host");
      assert.deepEqual(usages(), [{ status: "succeeded" }], "no new charge on the BYOK turn");
      assert.deepEqual(balanceOf(), balanceBefore, "the balance did not move");
    } finally {
      globalThis.fetch = realFetch;
      setByokEgressForTests(null);
      fake.stop();
      db.close();
    }
  });

  // F5/S3: useCredits of a wrong type is an invalid request, answered at
  // the body validation — before the thread exists or any message is
  // stored, so nothing is written.
  test("S3: a useCredits of the wrong type answers 400 invalid_request and stores nothing", async () => {
    const db = migratedDatabase();
    const fake = fakeAiServer();
    try {
      const { a } = await seedAccounts(db);
      const env = assistantEnv(db, { AI_BASE_URL: `http://127.0.0.1:${fake.port}/v1` });
      const counts = () => ({
        messages: (db.query("SELECT COUNT(*) AS n FROM assistant_messages WHERE owner_id = 'usr_a'").get() as { n: number }).n,
        threads: (db.query("SELECT COUNT(*) AS n FROM assistant_threads WHERE owner_id = 'usr_a'").get() as { n: number }).n,
      });
      const before = counts();
      for (const useCredits of ["true", 1, null]) {
        const response = await turn(env, a.cookie, { text: "Quantas sessões?", useCredits });
        assert.equal(response.status, 400, JSON.stringify(useCredits));
        const body = (await response.json()) as { code: string; error: string };
        assert.equal(body.code, "invalid_request");
        assert.equal(body.error, "Invalid request body");
      }
      assert.deepEqual(counts(), before, "no thread, no message stored");
      assert.equal(fake.calls(), 0, "no model call");
    } finally {
      fake.stop();
      db.close();
    }
  });

  // F5/S3: a BYOK turn calls pinar_pins_search: the search is the text-only
  // ranking over the entries the index already has — no hub detection, no
  // indexing, no captions, no query embedding, no gateway call at all
  // (contract §5, A53). The useCredits turn keeps the gateway's search.
  test("S3: a BYOK turn's pinar_pins_search is text-only (no gateway call, no indexing, no index cost); useCredits keeps the gateway's search", async () => {
    const db = migratedDatabase();
    const scripted = scriptedAiServer([
      { args: { limit: 5, query: "deploy" }, tool: "pinar_pins_search" },
      { text: "Achei." },
    ]);
    const byokKey = Buffer.alloc(32, 21).toString("base64");
    const BYOK_KEY = "sk-byok-search-test-3456";
    const fetchUrls: string[] = [];
    const realFetch = globalThis.fetch;
    try {
      globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
        fetchUrls.push(typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url);
        return realFetch(input, init);
      }) as typeof fetch;
      const { a } = await seedAccounts(db);
      // The session's pins, and the index entries they already have (text-
      // only: no vector, as the local app or a past gateway turn wrote).
      insertProject(db, "project_a", "usr_a");
      insertCollection(db, "collection_a", "project_a", "usr_a");
      insertSession(db, "session_a1", "usr_a", "collection_a", [
        { comment: "nota sobre o deploy", number: 1, pinId: "pin_a1" },
        { comment: "outro assunto", number: 2, pinId: "pin_a2" },
      ]);
      const seedEntry = (pinId: string, number: number, docText: string) =>
        db.query(
          `INSERT INTO pin_index (session_id, pin_id, owner_id, number, model, vector, doc_text, doc_hash, truncated, caption, ocr, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).run("session_a1", pinId, "usr_a", number, "", null, docText, `hash-${pinId}`, 0, null, null, NOW);
      seedEntry("pin_a1", 1, "Page: session_a1\nPin #1: nota sobre o deploy");
      seedEntry("pin_a2", 2, "Page: session_a1\nPin #2: outro assunto");
      const entries = () => db.query("SELECT doc_text FROM pin_index WHERE owner_id = 'usr_a' ORDER BY pin_id").all();
      const indexCosts = () => db.query("SELECT id FROM assistant_index_costs").all();

      const env = assistantEnv(db, {
        AI_BASE_URL: `http://127.0.0.1:${scripted.server.port}/v1`,
        BYOK_MASTER_KEY: byokKey,
      });
      const cryptoObj = (await byokCrypto(byokKey))!;
      const ciphertext = await cryptoObj.encrypt(BYOK_KEY);
      db.query(
        `INSERT INTO byok_endpoints (owner_id, base_url, key_ciphertext, key_last4, key_id, chat_model,
           embedding_model, transcription_model, capabilities_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        "usr_a",
        "https://byok-user.test/v1",
        ciphertext,
        "3456",
        cryptoObj.keyId,
        "chat-1",
        "",
        "",
        JSON.stringify({
          chat: { error: null, ok: true, testedAt: NOW },
          embeddings: { dims: null, error: null, ok: null, testedAt: null },
          tools: { error: null, ok: true, testedAt: NOW },
          transcription: { error: null, ok: null, testedAt: null },
          vision: { error: null, ok: null, testedAt: null },
        }),
        NOW,
        NOW,
      );

      const byokCalls = scriptedByokEgress([
        { args: { limit: 5, query: "deploy" }, tool: "pinar_pins_search" },
        { text: "Achei." },
      ]);

      // The BYOK turn: the model (the user's endpoint) calls the tool and
      // the tool answers with the text ranking over the seeded entries.
      const response = await turn(env, a.cookie, { text: "Onde está a nota de deploy?" });
      assert.equal(response.status, 200);
      const sse = await response.text();
      assert.ok(sse.includes("Achei."), "the BYOK answer reaches the stream");
      assert.equal(byokCalls.length, 2, "the tool's round trip, on the user's endpoint");
      assert.ok(
        byokCalls[1].body.includes("pin_a1") && byokCalls[1].body.includes("nota sobre o deploy"),
        "the hit (the text ranking) is the tool result the model got",
      );
      assert.ok(byokCalls[1].body.includes("score"), "the ranking's score");
      assert.ok(!byokCalls[1].body.includes("outro assunto"), "the non-matching pin is not a hit");

      // No gateway at all: no chat completions, no /models probe, no
      // embedding — nothing left for the gateway's host.
      assert.equal(scripted.requests.length, 0, "the gateway's chat completions is not called");
      assert.ok(!fetchUrls.some((url) => url.includes(`127.0.0.1:${scripted.server.port}`)), "no URL of the gateway host leaves the server");
      // No indexing on the BYOK turn: the entries are untouched, no cost.
      assert.deepEqual(
        entries(),
        [
          { doc_text: "Page: session_a1\nPin #1: nota sobre o deploy" },
          { doc_text: "Page: session_a1\nPin #2: outro assunto" },
        ],
        "the pin index entries are untouched",
      );
      assert.deepEqual(indexCosts(), [], "no row of assistant_index_costs");

      // The useCredits turn keeps today's path: the gateway's model, the
      // gateway's search (the detection probe leaves for the gateway's
      // host), and the charge.
      fetchUrls.length = 0;
      const withCredits = await turn(env, a.cookie, { text: "Onde está a nota de deploy?", useCredits: true });
      assert.equal(withCredits.status, 200);
      const sse2 = await withCredits.text();
      assert.ok(sse2.includes("Achei."), "the gateway's answer reaches the stream");
      assert.equal(scripted.requests.length, 2, "the gateway's model answered the tool's round trip");
      assert.ok(fetchUrls.some((url) => url.includes(`127.0.0.1:${scripted.server.port}`)), "the search's detection leaves for the gateway (as today)");
      const usages = () => db.query("SELECT status FROM ai_credit_usages WHERE feature = 'assistant_turn'").all();
      const deadline = Date.now() + 5_000;
      while (JSON.stringify(usages()) !== JSON.stringify([{ status: "succeeded" }])) {
        if (Date.now() > deadline) throw new Error(`the useCredits turn was not billed: ${JSON.stringify(usages())}`);
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
    } finally {
      globalThis.fetch = realFetch;
      setByokEgressForTests(null);
      scripted.server.stop(true);
      db.close();
    }
  });

  // F5/S3: the 2xx cut mid-stream (contract §4 "Streaming"): the guard
  // cuts the body by size or time, or the network drops — the read's
  // exception becomes the caused byok_error, and the partial text is never
  // a final answer.
  test("S3: a 2xx cut mid-stream ends with byok_error, the cause of the cut (no charge, no gateway, slot freed)", async () => {
    const db = migratedDatabase();
    const fake = fakeAiServer();
    const byokKey = Buffer.alloc(32, 23).toString("base64");
    const BYOK_KEY = "sk-byok-cut-test-7890";
    try {
      const { a } = await seedAccounts(db);
      const env = assistantEnv(db, {
        AI_BASE_URL: `http://127.0.0.1:${fake.port}/v1`,
        BYOK_MASTER_KEY: byokKey,
      });
      const cryptoObj = (await byokCrypto(byokKey))!;
      const ciphertext = await cryptoObj.encrypt(BYOK_KEY);
      db.query(
        `INSERT INTO byok_endpoints (owner_id, base_url, key_ciphertext, key_last4, key_id, chat_model,
           embedding_model, transcription_model, capabilities_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        "usr_a",
        "https://byok-user.test/v1",
        ciphertext,
        "7890",
        cryptoObj.keyId,
        "chat-1",
        "",
        "",
        JSON.stringify({
          chat: { error: null, ok: true, testedAt: NOW },
          embeddings: { dims: null, error: null, ok: null, testedAt: null },
          tools: { error: null, ok: true, testedAt: NOW },
          transcription: { error: null, ok: null, testedAt: null },
          vision: { error: null, ok: null, testedAt: null },
        }),
        NOW,
        NOW,
      );

      const usages = () => db.query("SELECT id FROM ai_credit_usages").all();
      const balanceOf = () =>
        db.query("SELECT SUM(credits - consumed_credits) AS balance FROM ai_credit_grants WHERE owner_id = 'usr_a'").get();
      const balanceBefore = balanceOf();

      // A 2xx body: one valid SSE chunk, then the failure on the read.
      const cutBody = (error: unknown) => {
        const encoder = new TextEncoder();
        const sse = encoder.encode(
          `data: ${JSON.stringify({ choices: [{ delta: { content: "Parcial", role: "assistant" }, finish_reason: null, index: 0 }], created: 1, id: "c1", model: "mock", object: "chat.completion.chunk" })}\n\n`,
        );
        let reads = 0;
        return new ReadableStream<Uint8Array>({
          pull(controller) {
            if (reads++ === 0) controller.enqueue(sse);
            else controller.error(error);
          },
        });
      };
      const cases: Array<{ cause: string; error: unknown; label: string }> = [
        { cause: "timeout", error: Object.assign(new Error("the guard cut the stream by time"), { name: "TimeoutError" }), label: "the deadline" },
        { cause: "endpoint_unreachable", error: new Error("socket destroyed"), label: "the network" },
      ];
      for (const c of cases) {
        setByokEgressForTests(async () => new Response(cutBody(c.error), { headers: { "content-type": "text/event-stream" }, status: 200 }));
        const response = await turn(env, a.cookie, { text: `Corte ${c.label}` });
        // 200 and streamed: the cut is an error of the stream, not the
        // rate_limited body (the slot of the previous case was freed).
        assert.equal(response.status, 200, `${c.label}: the cut still streams (no rate_limited)`);
        const sse = await response.text();
        const parts = sse.split("\n").filter((line) => line.startsWith("data: ") && line.slice(6).trim() !== "[DONE]").map((line) => JSON.parse(line.slice(6)) as Record<string, unknown>);
        const byokPart = parts.find((part) => part.type === "data-byok-error");
        assert.ok(byokPart, `${c.label}: the data-byok-error part is in the stream`);
        const data = byokPart.data as { canUseCredits?: unknown; cause?: string };
        assert.equal(data.cause, c.cause, `${c.label}: the cause of the cut`);
        assert.equal(data.canUseCredits, true, `${c.label}: canUseCredits`);
        const errorPart = parts.find((part) => part.type === "error") as { errorText?: string } | undefined;
        assert.equal(errorPart?.errorText, "byok_error", `${c.label}: the class reached onStreamError`);
        assert.ok(!sse.includes("text-end"), `${c.label}: the partial text is never a final answer`);
        assert.ok(!sse.includes(BYOK_KEY), `${c.label}: the key is not in the stream`);
        const stored = db.query("SELECT status, text FROM assistant_messages WHERE role = 'assistant' AND owner_id = 'usr_a' ORDER BY rowid DESC").get() as { status: string; text: string };
        assert.equal(stored.status, "error", `${c.label}: the stored answer is the error`);
        assert.equal(stored.text, "", `${c.label}: the partial text is not the stored answer`);
        assert.equal(fake.calls(), 0, `${c.label}: the gateway is not called`);
        assert.deepEqual(usages(), [], `${c.label}: no charge`);
        assert.deepEqual(balanceOf(), balanceBefore, `${c.label}: the balance did not move`);
      }
    } finally {
      setByokEgressForTests(null);
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

  test("gate: the per-hub rule outside production: the default appliance chain needs the appliance strings, and a gateway chain needs the gateway key (A46)", async () => {
    const db = migratedDatabase();
    try {
      const env = assistantEnv(db);
      const a = await seedPro(db, env);
      assert.deepEqual(await statusOf(env, a.cookie), { available: true, byok: { chat: false }, reason: null, surface: "cloud" });
      assert.equal((await health(env)).hasAssistant, true);
      // Without the appliance strings the default appliance chain stays off.
      for (const overrides of [{ AI_BASE_URL: undefined }, { AI_API_KEY: undefined }]) {
        const off = assistantEnv(db, overrides);
        assert.deepEqual(await statusOf(off, a.cookie), { available: false, reason: "disabled", surface: "cloud" }, JSON.stringify(overrides));
        assert.equal((await health(off)).hasAssistant, false, JSON.stringify(overrides));
      }
      // A gateway chain without its key is off even with the appliance strings.
      const noKey = assistantEnv(db, { ASSISTANT_CHAIN: `gateway:${HAIKU}`, AI_GATEWAY_API_KEY: undefined });
      assert.deepEqual(await statusOf(noKey, a.cookie), { available: false, reason: "disabled", surface: "cloud" });
      // ...and with the key it is on, the appliance strings or not.
      for (const overrides of [{}, { AI_API_KEY: undefined, AI_BASE_URL: undefined, AI_MODEL: undefined }]) {
        const on = assistantEnv(db, { ...overrides, ASSISTANT_CHAIN: `gateway:${HAIKU}`, AI_GATEWAY_API_KEY: GATEWAY_KEY });
        assert.deepEqual(await statusOf(on, a.cookie), { available: true, byok: { chat: false }, reason: null, surface: "cloud" }, JSON.stringify(overrides));
        assert.equal((await health(on)).hasAssistant, true, JSON.stringify(overrides));
      }
    } finally {
      db.close();
    }
  });

  test("gate: production with ASSISTANT_CHAIN=appliance:qwen3.8-27b and the appliance configuration is on, Pro only (A46)", async () => {
    const db = migratedDatabase();
    try {
      const env = productionEnv(db, {
        AI_API_KEY: "sk-ai-test",
        AI_BASE_URL: "https://appliance.test/v1",
        AI_GATEWAY_API_KEY: undefined, // the appliance chain never needs the gateway
        AI_MODEL: "qwen3.8-27b",
        ASSISTANT_CHAIN: "appliance:qwen3.8-27b",
      });
      const a = await seedPro(db, env);
      insertUser(db, "usr_free", "free@example.test", "free");
      const free = await seedCloudWebSessionForTests({ email: "free@example.test", id: "usr_free", plan: "free" }, env);
      const { logged } = await capturingLogs(async () => {
        assert.deepEqual(await statusOf(env, a.cookie), { available: true, byok: { chat: false }, reason: null, surface: "cloud" });
        assert.deepEqual(await statusOf(env, free.cookie), { available: false, reason: "requires_pro", surface: "cloud" });
        assert.equal((await health(env)).hasAssistant, true);
      });
      assert.ok(!logged.includes("assistant_chain_config_error"), "the chain is valid; nothing is logged");
      const denied = await turn(env, free.cookie, "oi");
      assert.equal(denied.status, 403);
      assert.equal((await denied.json() as { code: string }).code, "assistant_requires_pro");
    } finally {
      db.close();
    }
  });

  test("gate: the same appliance chain without AI_BASE_URL or without AI_API_KEY is off (A46)", async () => {
    const db = migratedDatabase();
    try {
      for (const overrides of [{ AI_BASE_URL: undefined }, { AI_API_KEY: undefined }] as Array<Partial<CloudEnv>>) {
        resetCloudMemoryStateForTests();
        const env = productionEnv(db, { AI_API_KEY: "sk-ai-test", AI_BASE_URL: "https://appliance.test/v1", AI_GATEWAY_API_KEY: undefined, AI_MODEL: "qwen3.8-27b", ASSISTANT_CHAIN: "appliance:qwen3.8-27b", ...overrides });
        const a = await seedPro(db, env);
        const { logged } = await capturingLogs(async () => {
          assert.deepEqual(await statusOf(env, a.cookie), { available: false, reason: "disabled", surface: "cloud" }, JSON.stringify(overrides));
          assert.equal((await health(env)).hasAssistant, false, JSON.stringify(overrides));
          const denied = await turn(env, a.cookie, "oi");
          assert.equal(denied.status, 503, JSON.stringify(overrides));
          assert.equal((await denied.json() as { code: string }).code, "assistant_unavailable", JSON.stringify(overrides));
        });
        assert.ok(!logged.includes("assistant_chain_config_error"), "a missing hub configuration is not a config error");
        db.exec("DELETE FROM web_sessions; DELETE FROM users");
      }
    } finally {
      db.close();
    }
  });

  test("gate: a mixed gateway:...,appliance:... chain needs both hub configurations (A46)", async () => {
    const db = migratedDatabase();
    try {
      const mixed = `gateway:${HAIKU},appliance:qwen-private-model`;
      const withBoth: Partial<CloudEnv> = { AI_API_KEY: "sk-ai-test", AI_BASE_URL: "https://appliance.test/v1", ASSISTANT_CHAIN: mixed };
      for (const overrides of [{ ...withBoth, AI_GATEWAY_API_KEY: undefined }, { ...withBoth, AI_API_KEY: undefined, AI_BASE_URL: undefined }]) {
        resetCloudMemoryStateForTests();
        const env = productionEnv(db, overrides);
        const a = await seedPro(db, env);
        assert.deepEqual(await statusOf(env, a.cookie), { available: false, reason: "disabled", surface: "cloud" }, JSON.stringify(overrides));
        assert.equal((await health(env)).hasAssistant, false, JSON.stringify(overrides));
        db.exec("DELETE FROM web_sessions; DELETE FROM users");
      }
      resetCloudMemoryStateForTests();
      const on = productionEnv(db, withBoth);
      const a = await seedPro(db, on);
      assert.deepEqual(await statusOf(on, a.cookie), { available: true, byok: { chat: false }, reason: null, surface: "cloud" });
      assert.equal((await health(on)).hasAssistant, true);
    } finally {
      db.close();
    }
  });

  test("gate: the same chain and the same configuration answer the same in production, staging and development (A46)", async () => {
    const db = migratedDatabase();
    try {
      for (const deployment of ["production", "staging", undefined] as const) {
        // undefined is the development (local) environment: CloudEnv has no
        // "development" value.
        resetCloudMemoryStateForTests();
        const base: Partial<CloudEnv> = { ASSISTANT_ENABLED: "true", DB: sqliteD1(db), DEPLOYMENT_ENV: deployment };
        const appliance: CloudEnv = { AI_API_KEY: "sk-ai-test", AI_BASE_URL: "https://appliance.test/v1", AI_GATEWAY_API_KEY: undefined, AI_MODEL: "qwen3.8-27b", ASSISTANT_CHAIN: "appliance:qwen3.8-27b", ...base };
        const gateway: CloudEnv = { AI_GATEWAY_API_KEY: GATEWAY_KEY, ASSISTANT_CHAIN: `gateway:${HAIKU}`, ...base };
        insertUser(db, "usr_a", "a@example.test", "pro");
        insertUser(db, "usr_free", "free@example.test", "free");
        const a = await seedCloudWebSessionForTests({ email: "a@example.test", id: "usr_a", plan: "pro" }, appliance);
        const free = await seedCloudWebSessionForTests({ email: "free@example.test", id: "usr_free", plan: "free" }, appliance);
        for (const env of [appliance, gateway]) {
          assert.deepEqual(await statusOf(env, a.cookie), { available: true, byok: { chat: false }, reason: null, surface: "cloud" }, String(deployment ?? "development"));
          assert.deepEqual(await statusOf(env, free.cookie), { available: false, reason: "requires_pro", surface: "cloud" }, String(deployment ?? "development"));
          assert.equal((await health(env)).hasAssistant, true, String(deployment ?? "development"));
        }
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
        assert.deepEqual(await statusOf(env, a.cookie), { available: true, byok: { chat: false }, reason: null, surface: "cloud" });
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
      // A46: the appliance chain is a valid production chain.
      assert.equal((await health(productionEnv(db, { AI_API_KEY: "sk-ai-test", AI_BASE_URL: "https://appliance.test/v1", AI_MODEL: "qwen3.8-27b", ASSISTANT_CHAIN: "appliance:qwen3.8-27b" }))).hasAssistant, true);
      assert.equal((await health(productionEnv(db, { AI_GATEWAY_API_KEY: undefined, AI_MODEL: "qwen3.8-27b", ASSISTANT_CHAIN: "appliance:qwen3.8-27b" }))).hasAssistant, false);
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

  // Both runs read "no usage yet" before either inserts: each INSERT waits
  // until two lookups are done, so the UNIQUE is what keeps the second one
  // out. With `requestId`, every turn's request id is replaced by it, so two
  // route turns (each with its own assistant message) race on one key; the
  // batches are queued, as one D1 connection would run them.
  function racingUsages(shared: NonNullable<CloudEnv["DB"]>, requestId?: string) {
    let lookups = 0;
    let bothLooked!: () => void;
    const barrier = new Promise<void>((resolve) => {
      bothLooked = resolve;
    });
    let queue: Promise<unknown> = Promise.resolve();
    const racing: NonNullable<CloudEnv["DB"]> = {
      ...shared,
      batch(statements) {
        const run = queue.then(() => shared.batch(statements));
        queue = run.catch(() => {});
        return run;
      },
      prepare(sql: string) {
        const statement = shared.prepare(sql);
        const lookup = /^SELECT \* FROM ai_credit_usages WHERE owner_type = \? AND owner_id = \? AND request_id = \?$/.test(sql.trim());
        const insert = /INSERT INTO ai_credit_usages/.test(sql);
        if (!lookup && !insert) return statement;
        const wrapped = {
          ...statement,
          bind(...values: unknown[]) {
            statement.bind(...values.map((value) => (requestId && typeof value === "string" && value.startsWith("turn:") ? requestId : value)));
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
    return { db: racing, lookups: () => lookups };
  }

  // Fails the first `times` writes whose SQL matches `pattern` (a transient
  // database error) and counts them.
  function failingWrites(shared: NonNullable<CloudEnv["DB"]>, pattern: RegExp, times: number) {
    let failures = 0;
    const failing: NonNullable<CloudEnv["DB"]> = {
      ...shared,
      prepare(sql: string) {
        const statement = shared.prepare(sql);
        if (!pattern.test(sql)) return statement;
        const wrapped = {
          ...statement,
          bind(...values: unknown[]) {
            statement.bind(...values);
            return wrapped;
          },
          async run() {
            if (failures < times) {
              failures += 1;
              throw new Error("D1_ERROR: database is locked");
            }
            return statement.run();
          },
        };
        return wrapped as typeof statement;
      },
    };
    return { db: failing, failures: () => failures };
  }

  const HTTP_CONSUME = /SET status = 'succeeded', result_json = \?, input_tokens/;
  const REFUND = /SET status = 'refunded'/;

  async function waitUntil(done: () => boolean, what: string) {
    const deadline = Date.now() + 5_000;
    while (!done()) {
      if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }

  const answerOf = (db: Database, threadId: string) =>
    db.query("SELECT status FROM assistant_messages WHERE thread_id = ? AND role = 'assistant'").get(threadId) as { status: string } | null;

  test("idempotency: of two instances racing on the same assistant message, only the one that created the reservation settles it", async () => {
    const db = migratedDatabase();
    try {
      const base = productionEnv(db);
      await seedPro(db, base);
      const race = racingUsages(base.DB!);
      const principal = { email: "a@example.test", id: "usr_a", isPermanent: true, kind: "account" as const, plan: "pro" as const };
      const first = cloudAssistantTurnMeter({ ...base, DB: race.db }, principal, `gateway:${HAIKU}`);
      const second = cloudAssistantTurnMeter({ ...base, DB: race.db }, principal, `gateway:${HAIKU}`);
      const turnRef = { messageId: "amsg_race_000000000000000000", threadId: "ath_race_0000000000000000000" };
      const results = await Promise.all([first(turnRef), second(turnRef)]);
      assert.equal(race.lookups() >= 2, true);
      assert.equal(turnUsages(db).length, 1);
      assert.equal(balance(db), 497, "charged once");
      // The loser holds no ending: it can neither consume nor refund.
      const winners = results.filter((result) => result.reserved);
      assert.equal(winners.length, 1);
      assert.deepEqual(results.filter((result) => !result.reserved), [{ inProgress: true, reserved: false }]);
      const [winner] = winners;
      if (!winner.reserved) throw new Error("unreachable");
      await winner.consume({ costUsdMicros: 10, inputTokens: 1, model: `gateway:${HAIKU}`, outputTokens: 1, resultJson: "{}" });
      assert.equal(turnUsages(db)[0].status, "succeeded");
      assert.equal(balance(db), 497);
    } finally {
      db.close();
    }
  });

  test("idempotency over the route: the run that finds the reservation answers 409 assistant_turn_in_progress without the model, the other consumes", async () => {
    const db = migratedDatabase();
    const gateway = fakeGatewayFetch({ [HAIKU]: "Só uma vez." });
    try {
      const base = productionEnv(db);
      const a = await seedPro(db, base);
      const race = racingUsages(base.DB!, "turn:amsg_shared_000000000000000");
      const env = { ...base, DB: race.db };
      const responses = await Promise.all([turn(env, a.cookie, "um"), turn(env, a.cookie, "dois")]);
      assert.deepEqual(responses.map((response) => response.status).sort(), [200, 409]);
      const loser = responses.find((response) => response.status === 409)!;
      assert.equal(loser.headers.get("cache-control"), "no-store");
      assert.deepEqual(await loser.json(), { code: "assistant_turn_in_progress", error: "This turn is already running" });
      const winner = responses.find((response) => response.status === 200)!;
      assert.ok((await winner.text()).includes("Só uma vez."));
      const [usage] = await settledUsages(db);
      assert.deepEqual([usage.status, usage.request_id, usage.cost_usd_micros], ["succeeded", "turn:amsg_shared_000000000000000", 4541]);
      assert.equal(balance(db), 497);
      assert.equal(gateway.calls.length, 1, "the loser never calls the model");
      // Both user messages stay; only the winner answers.
      assert.deepEqual(db.query("SELECT role FROM assistant_messages ORDER BY role").all(), [{ role: "assistant" }, { role: "user" }, { role: "user" }]);
    } finally {
      gateway.restore();
      db.close();
    }
  });

  test("a settlement write that fails once is tried again: the final answer is charged with its cost", async () => {
    const db = migratedDatabase();
    const gateway = fakeGatewayFetch({ [HAIKU]: "Resposta entregue." });
    try {
      const base = productionEnv(db);
      const a = await seedPro(db, base);
      const failing = failingWrites(base.DB!, HTTP_CONSUME, 1);
      const response = await turn({ ...base, DB: failing.db }, a.cookie, "oi");
      assert.ok((await response.text()).includes("Resposta entregue."));
      const [usage] = await settledUsages(db);
      assert.equal(failing.failures(), 1);
      assert.deepEqual([usage.status, usage.cost_usd_micros, usage.error_code], ["succeeded", 4541, null]);
      assert.equal(balance(db), 497);
    } finally {
      gateway.restore();
      db.close();
    }
  });

  test("sweeper: a delivered final whose settlement kept failing is consumed by the sweeper, with no cost", async () => {
    const db = migratedDatabase();
    const gateway = fakeGatewayFetch({ [HAIKU]: "Resposta entregue." });
    try {
      const base = productionEnv(db);
      const a = await seedPro(db, base);
      const failing = failingWrites(base.DB!, HTTP_CONSUME, 2);
      const env = { ...base, DB: failing.db };
      const response = await turn(env, a.cookie, "oi");
      const threadId = threadOf(await response.text());
      await waitUntil(() => failing.failures() === 2, "both settlement attempts");
      await new Promise((resolve) => setTimeout(resolve, 20));
      assert.deepEqual(turnUsages(db).map((row) => row.status), ["reserved"]);
      assert.deepEqual(answerOf(db, threadId), { status: "final" });
      assert.equal(balance(db), 497);

      setCloudNowForTests(new Date(Date.parse(NOW) + 6 * 60_000).toISOString());
      assert.deepEqual(await refundStaleAiReservations(env), { consumedReservations: 1, refundedReservations: 0 });
      const [usage] = turnUsages(db);
      assert.deepEqual(
        [usage.status, usage.cost_usd_micros, usage.error_code, usage.result_json],
        ["succeeded", null, null, JSON.stringify({ costSource: "none", fallback: false, link: 0 })],
      );
      assert.equal(balance(db), 497);
    } finally {
      gateway.restore();
      db.close();
    }
  });

  test("sweeper: an error answer whose refund kept failing is refunded as reservation_timeout", async () => {
    const db = migratedDatabase();
    const gateway = fakeGatewayFetch({ [HAIKU]: 401 });
    try {
      const base = productionEnv(db);
      const a = await seedPro(db, base);
      const failing = failingWrites(base.DB!, REFUND, 2);
      const env = { ...base, DB: failing.db };
      const { logged, result: threadId } = await capturingLogs(async () => {
        const id = threadOf(await (await turn(env, a.cookie, "oi")).text());
        await waitUntil(() => failing.failures() === 2, "both refund attempts");
        await new Promise((resolve) => setTimeout(resolve, 20));
        return id;
      });
      assert.equal(logged.split("ai_credit_refund_failed").length - 1, 2, "each failed refund is logged");
      assert.deepEqual(answerOf(db, threadId), { status: "error" });
      assert.deepEqual(turnUsages(db).map((row) => row.status), ["reserved"]);

      setCloudNowForTests(new Date(Date.parse(NOW) + 6 * 60_000).toISOString());
      assert.deepEqual(await refundStaleAiReservations(env), { consumedReservations: 0, refundedReservations: 1 });
      assert.deepEqual(turnUsages(db).map((row) => [row.status, row.error_code]), [["refunded", "reservation_timeout"]]);
      assert.equal(balance(db), 500);
    } finally {
      gateway.restore();
      db.close();
    }
  });

  test("sweeper: only a final assistant message of the reservation's own owner consumes it", async () => {
    const db = migratedDatabase();
    try {
      const env = productionEnv(db);
      await seedPro(db, env);
      insertUser(db, "usr_b", "b@example.test", "pro");
      const grant = (db.query("SELECT id FROM ai_credit_grants WHERE owner_id = 'usr_a'").get() as { id: string }).id;
      const thread = (id: string, owner: string) =>
        db.query("INSERT INTO assistant_threads (id, owner_id, title, created_at, updated_at) VALUES (?, ?, 't', ?, ?)").run(id, owner, NOW, NOW);
      const message = (id: string, threadId: string, owner: string, role: string, status: string) =>
        db.query("INSERT INTO assistant_messages (id, thread_id, owner_id, role, text, status, created_at) VALUES (?, ?, ?, ?, 'x', ?, ?)")
          .run(id, threadId, owner, role, status, NOW);
      const reserve = (id: string, requestId: string, feature: string, resourceId: string) =>
        db.query(
          "INSERT INTO ai_credit_usages (id, request_id, owner_type, owner_id, grant_id, feature, resource_id, model, credits, status, created_at) "
            + "VALUES (?, ?, 'account', 'usr_a', ?, ?, ?, 'm', 3, 'reserved', ?)",
        ).run(id, requestId, grant, feature, resourceId, NOW);
      thread("ath_a", "usr_a");
      thread("ath_b", "usr_b");
      message("amsg_mine", "ath_a", "usr_a", "assistant", "final");
      message("amsg_theirs", "ath_b", "usr_b", "assistant", "final");
      message("amsg_question", "ath_a", "usr_a", "user", "final");
      reserve("aiu_mine", "turn:amsg_mine", "assistant_turn", "assistant:ath_a");
      reserve("aiu_theirs", "turn:amsg_theirs", "assistant_turn", "assistant:ath_b");
      reserve("aiu_question", "turn:amsg_question", "assistant_turn", "assistant:ath_a");
      reserve("aiu_voice", "amsg_mine", "voice_pin", "pin-1");
      assert.equal(balance(db), 488);

      setCloudNowForTests(new Date(Date.parse(NOW) + 6 * 60_000).toISOString());
      assert.deepEqual(await refundStaleAiReservations(env), { consumedReservations: 1, refundedReservations: 3 });
      assert.deepEqual(
        db.query("SELECT id, status, error_code FROM ai_credit_usages ORDER BY id").all(),
        [
          { error_code: null, id: "aiu_mine", status: "succeeded" },
          { error_code: "reservation_timeout", id: "aiu_question", status: "refunded" },
          { error_code: "reservation_timeout", id: "aiu_theirs", status: "refunded" },
          { error_code: "reservation_timeout", id: "aiu_voice", status: "refunded" },
        ],
      );
      assert.equal(balance(db), 497);
    } finally {
      db.close();
    }
  });

  test("sweeper without a database: the in-memory reservations follow the stored answer and its owner", async () => {
    const env: CloudEnv = {};
    const a = await seedCloudWebSessionForTests({ email: "m@example.test", id: "usr_m", plan: "pro" }, env);
    const entitlements = async () =>
      (await (await route("/api/account/entitlements", env, { headers: { cookie: a.cookie } })).json()) as {
        aiCredits: { balance: number };
        aiUsage: Array<{ status: string }>;
      };
    assert.equal((await entitlements()).aiCredits.balance, 500);
    const meter = cloudAssistantTurnMeter(env, a.principal, `gateway:${HAIKU}`);
    const mine = cloudAssistantStore(env, "usr_m");
    const theirs = cloudAssistantStore(env, "usr_other");
    await mine.createThread({ id: "ath_m", now: NOW, title: "t" });
    await theirs.createThread({ id: "ath_o", now: NOW, title: "t" });
    const answer = (store: typeof mine, id: string, threadId: string, status: "error" | "final") =>
      store.appendMessage({ ask: null, createdAt: NOW, errorCode: status === "error" ? "ASSISTANT_STREAM_FAILED" : null, id, role: "assistant", status, text: "x", threadId });
    await answer(mine, "amsg_final", "ath_m", "final");
    await answer(mine, "amsg_error", "ath_m", "error");
    await answer(theirs, "amsg_theirs", "ath_o", "final");
    for (const [messageId, threadId] of [["amsg_final", "ath_m"], ["amsg_error", "ath_m"], ["amsg_missing", "ath_m"], ["amsg_theirs", "ath_o"]]) {
      assert.equal((await meter({ messageId, threadId })).reserved, true);
    }
    assert.equal((await entitlements()).aiCredits.balance, 488);

    setCloudNowForTests(new Date(Date.parse(NOW) + 6 * 60_000).toISOString());
    assert.deepEqual(await refundStaleAiReservations(env), { consumedReservations: 1, refundedReservations: 3 });
    const after = await entitlements();
    assert.equal(after.aiCredits.balance, 497);
    assert.deepEqual(after.aiUsage.map((entry) => entry.status).sort(), ["refunded", "refunded", "refunded", "succeeded"]);
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
