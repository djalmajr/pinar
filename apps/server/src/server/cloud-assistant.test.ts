// Cloud assistant (F1/S3b): the Cloud MCP read tools running as the
// logged-in web user (no agent key) and the /api/assistant/* routes served
// by handleCloudApiRequest (the A3 gate, account isolation, the
// collaborator read and the turn rate limit).
//
// The D1 shim is the same SQLite-as-D1 model cloud-mcp.test.ts uses: the
// migrations are applied in order and batch() runs inside a transaction.

import assert from "node:assert/strict";
import { Database } from "bun:sqlite";
import { readdirSync, readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, test } from "node:test";
import {
  cloudAssistantToolHost,
  handleCloudApiRequest,
  resetCloudMemoryStateForTests,
  seedCloudWebSessionForTests,
  setCloudNowForTests,
  type CloudEnv,
  type Principal,
} from "./cloud-api";
import type { AssistantToolHost } from "./assistant/tools";

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

function insertSession(db: Database, id: string, userId: string, collectionId: string, pins: unknown[]) {
  db.query(
    "INSERT INTO sessions (id, url, title, shot_id, shot_url, pin_count, pins_json, created_at, user_id, plan, is_permanent, byte_size, collection_id, position) "
      + "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pro', 1, 1, ?, 0)",
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

      const host = userHost(db, "usr_a", "a@example.test");
      const writes: Array<[string, Record<string, unknown>]> = [
        ["pinar.rename_project", { name: "Nope", projectId: "project_a" }],
        ["pinar.add_pin_comment", { body: "comment", pinId: "pin_a", sessionId: "session_a" }],
        ["pinar.publish_share", { resourceId: "session_a", resourceType: "session" }],
      ];
      for (const [name, args] of writes) {
        await assert.rejects(host.callTool(name, args), new RegExp(WRITE_UNAVAILABLE.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
      }
      // Nothing was written.
      assert.equal(String(db.query("SELECT name FROM projects WHERE id = 'project_a'").get()?.name), "Project project_a");
      assert.equal(db.query("SELECT COUNT(*) AS count FROM pin_comments").get()?.count, 0);
      assert.equal(db.query("SELECT COUNT(*) AS count FROM share_tokens").get()?.count, 0);
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
