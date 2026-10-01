import assert from "node:assert/strict";
import { Database } from "bun:sqlite";
import { readdirSync, readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, test } from "node:test";
import {
  handleCloudApiRequest,
  handleCloudPublicRequest,
  type CloudEnv,
  resetCloudMemoryStateForTests,
  setCloudNowForTests,
} from "./cloud-api";
import { PAID_STORAGE_BYTES } from "../lib/entitlements";

const NOW = "2026-09-26T12:00:00.000Z";
const LATER = "2026-10-01T12:00:00.000Z";
const LATER2 = "2026-09-27T12:00:00.000Z";
const LATER3 = "2026-09-28T12:00:00.000Z";
const LATER4 = "2026-09-29T12:00:00.000Z";
const TOKEN = `pak_${"m".repeat(43)}`;
const MANAGE_TOKEN = `pak_${"n".repeat(43)}`;
const SHARE_TOKEN = `pak_${"s".repeat(43)}`;

// SQLite-as-D1 model: batch() runs inside a transaction and rolls back on
// error, exactly as D1 does, and an optional failWhen hook injects a
// statement fault (borrowed from the reviewer-verified pins-matrix probe).
function sqliteD1(db: Database, failWhen?: (sql: string) => boolean): NonNullable<CloudEnv["DB"]> {
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
        if (failWhen?.(query)) throw new Error("injected D1 failure");
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

async function sha256(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function envFor(db: Database): CloudEnv {
  return { DB: sqliteD1(db), DEPLOYMENT_ENV: "production" };
}

async function seedMcpWorkspace(db: Database) {
  db.query("INSERT INTO users (id, email, plan, ever_paid, billing_status, created_at, updated_at) VALUES (?, ?, 'pro', 1, 'active', ?, ?)")
    .run("usr_mcp", "mcp@example.test", NOW, NOW);
  db.query("INSERT INTO projects (id, owner_id, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)")
    .run("project_mcp", "usr_mcp", "MCP project", NOW, NOW);
  db.query("INSERT INTO collections (id, project_id, owner_id, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)")
    .run("collection_mcp", "project_mcp", "usr_mcp", "MCP collection", NOW, NOW);
  db.query("INSERT INTO collections (id, project_id, owner_id, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)")
    .run("collection_target", "project_mcp", "usr_mcp", "Target collection", NOW, NOW);
  db.query(
    "INSERT INTO sessions (id, url, title, shot_id, shot_url, pin_count, pins_json, created_at, user_id, plan, is_permanent, byte_size, collection_id, position) "
      + "VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?, 'pro', 1, 1, ?, 0)",
  ).run(
    "session_mcp",
    "https://example.test/mcp",
    "Private MCP page",
    "session_mcp",
    "https://pinar.test/shots/session_mcp.png",
    JSON.stringify([{ comment: "private MCP note", number: 1 }]),
    NOW,
    "usr_mcp",
    "collection_mcp",
  );
  db.query(
    "INSERT INTO agent_api_keys (id, account_id, name, token_hash, token_prefix, resource_type, resource_id, permission, expires_at, created_at) "
      + "VALUES (?, ?, ?, ?, ?, 'account', NULL, 'read', ?, ?)",
  ).run("key_mcp", "usr_mcp", "MCP read", await sha256(TOKEN), TOKEN.slice(0, 12), LATER, NOW);
  db.query(
    "INSERT INTO agent_api_keys (id, account_id, name, token_hash, token_prefix, resource_type, resource_id, permission, expires_at, created_at) "
      + "VALUES (?, ?, ?, ?, ?, 'account', NULL, 'manage', ?, ?)",
  ).run("key_manage", "usr_mcp", "MCP manage", await sha256(MANAGE_TOKEN), MANAGE_TOKEN.slice(0, 12), LATER, NOW);
  db.query(
    "INSERT INTO agent_api_keys (id, account_id, name, token_hash, token_prefix, resource_type, resource_id, permission, expires_at, created_at) "
      + "VALUES (?, ?, ?, ?, ?, 'account', NULL, 'share', ?, ?)",
  ).run("key_share", "usr_mcp", "MCP share", await sha256(SHARE_TOKEN), SHARE_TOKEN.slice(0, 12), LATER, NOW);
  return envFor(db);
}

const MCP_ACCEPT = "application/json, text/event-stream";
const INITIALIZE_PARAMS = { capabilities: {}, clientInfo: { name: "pinar-cloud-test", version: "0.0.0" }, protocolVersion: "2025-11-25" };

const mcpSessions = new Map<string, string>();

function mcpSessionHeaders(token: string): Record<string, string> {
  const session = mcpSessions.get(token);
  return { accept: MCP_ACCEPT, ...(session ? { "mcp-session-id": session } : {}) };
}

function request(body: Record<string, unknown>, token = TOKEN) {
  return new Request("https://pinar.test/api/mcp", {
    body: JSON.stringify(body),
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json", ...mcpSessionHeaders(token) },
    method: "POST",
  });
}

async function ensureMcpSession(env: CloudEnv, token: string) {
  if (mcpSessions.has(token)) return;
  const response = await handleCloudApiRequest(new Request("https://pinar.test/api/mcp", {
    body: JSON.stringify({ id: 0, jsonrpc: "2.0", method: "initialize", params: INITIALIZE_PARAMS }),
    headers: { authorization: `Bearer ${token}`, accept: MCP_ACCEPT, "content-type": "application/json" },
    method: "POST",
  }), env);
  if (response.status !== 200) throw new Error(`MCP initialize failed (${token.slice(0, 8)}…): HTTP ${response.status}`);
  const session = response.headers.get("mcp-session-id");
  if (!session) throw new Error("MCP initialize did not return a session id");
  mcpSessions.set(token, session);
}

async function jsonBody(response: Response) {
  return response.json() as Promise<Record<string, unknown>>;
}

async function callTool(env: CloudEnv, name: string, argumentsValue: Record<string, unknown>, token = TOKEN) {
  await ensureMcpSession(env, token);
  const response = await handleCloudApiRequest(request({
    id: 1,
    jsonrpc: "2.0",
    method: "tools/call",
    params: { arguments: argumentsValue, name },
  }, token), env);
  const body = await jsonBody(response);
  const result = body.result as Record<string, unknown>;
  const content = result.content as Array<Record<string, unknown>>;
  return { body, response, result, text: String(content[0]?.text || "") };
}

describe("cloud MCP endpoint", () => {
  beforeEach(() => {
    mcpSessions.clear();
    resetCloudMemoryStateForTests();
    setCloudNowForTests(NOW);
  });

  afterEach(() => resetCloudMemoryStateForTests());

  test("reads private Markdown, rejects a read-only mutation, and stops after key revocation", async () => {
    const db = migratedDatabase();
    try {
      const env = await seedMcpWorkspace(db);

      const markdown = await callTool(env, "pinar.get_session_markdown", { sessionId: "session_mcp" });
      assert.equal(markdown.response.status, 200);
      assert.match(markdown.text, /private MCP note/);

      const mutation = await callTool(env, "pinar.rename_project", { name: "Nope", projectId: "project_mcp" });
      assert.equal(mutation.result.isError, true);
      assert.equal(mutation.text, "manage permission required");

      db.query("UPDATE agent_api_keys SET revoked_at = ? WHERE id = ?").run(LATER, "key_mcp");
      const revoked = await handleCloudApiRequest(request({ id: 2, jsonrpc: "2.0", method: "tools/list" }), env);
      assert.equal(revoked.status, 401);
    } finally {
      db.close();
    }
  });

  test("reveals a narrowly scoped key's own resource ID and paginates metadata without pins", async () => {
    const db = migratedDatabase();
    try {
      const env = await seedMcpWorkspace(db);
      const scopedToken = `pak_${"c".repeat(43)}`;
      db.query(
        "INSERT INTO agent_api_keys (id, account_id, name, token_hash, token_prefix, resource_type, resource_id, permission, expires_at, created_at) "
          + "VALUES (?, ?, ?, ?, ?, 'collection', ?, 'read', ?, ?)",
      ).run("key_collection", "usr_mcp", "Collection read", await sha256(scopedToken), scopedToken.slice(0, 12), "collection_mcp", LATER, NOW);

      const scope = await callTool(env, "pinar.key_scope", {}, scopedToken);
      assert.deepEqual(JSON.parse(scope.text), {
        permission: "read",
        resourceId: "collection_mcp",
        resourceType: "collection",
      });
      const sessions = await callTool(env, "pinar.list_sessions", { collectionId: "collection_mcp", limit: 1, offset: 0 }, scopedToken);
      const listed = JSON.parse(sessions.text) as { sessions: Array<Record<string, unknown>> };
      assert.equal(listed.sessions.length, 1);
      assert.equal(listed.sessions[0]?.id, "session_mcp");
      assert.equal(Object.hasOwn(listed.sessions[0] || {}, "pins"), false);
      const emptyPage = await callTool(env, "pinar.list_sessions", { collectionId: "collection_mcp", limit: 1, offset: 1 }, scopedToken);
      assert.equal((JSON.parse(emptyPage.text) as { sessions: unknown[] }).sessions.length, 0);
    } finally {
      db.close();
    }
  });

  test("rejects oversized session Markdown before loading its pins", async () => {
    const db = migratedDatabase();
    try {
      const env = await seedMcpWorkspace(db);
      db.query("UPDATE sessions SET pins_json = ? WHERE id = ?")
        .run(JSON.stringify([{ comment: "x".repeat(600_000), number: 1 }]), "session_mcp");
      const markdown = await callTool(env, "pinar.get_session_markdown", { sessionId: "session_mcp" });
      assert.equal(markdown.result.isError, true);
      assert.match(markdown.text, /Aggregate is too large/);
    } finally {
      db.close();
    }
  });

  test("manage keys rename projects and move sessions with persisted state", async () => {
    const db = migratedDatabase();
    try {
      const env = await seedMcpWorkspace(db);
      const renamed = await callTool(env, "pinar.rename_project", { name: "Renamed MCP project", projectId: "project_mcp" }, MANAGE_TOKEN);
      assert.equal(renamed.result.isError, undefined);
      assert.equal((JSON.parse(renamed.text).project as Record<string, unknown>).name, "Renamed MCP project");
      const storedProject = db.query("SELECT name FROM projects WHERE id = ?").get("project_mcp") as { name: string };
      assert.equal(storedProject.name, "Renamed MCP project");

      const moved = await callTool(env, "pinar.move_session", { collectionId: "collection_target", sessionId: "session_mcp" }, MANAGE_TOKEN);
      assert.equal(moved.result.isError, undefined);
      const movedRow = db.query("SELECT collection_id FROM sessions WHERE id = ?").get("session_mcp") as { collection_id: string };
      assert.equal(movedRow.collection_id, "collection_target");
    } finally {
      db.close();
    }
  });

  test("share keys publish and revoke links with persisted state", async () => {
    const db = migratedDatabase();
    try {
      const env = await seedMcpWorkspace(db);
      const published = await callTool(env, "pinar.publish_share", { resourceId: "session_mcp", resourceType: "session" }, SHARE_TOKEN);
      assert.equal(published.result.isError, undefined);
      const publishedToken = JSON.parse(published.text) as Record<string, unknown>;
      assert.match(String(publishedToken.token), /^sh_/);
      const activeShare = db.query("SELECT status FROM share_tokens WHERE resource_id = ?").get("session_mcp") as { status: string };
      assert.equal(activeShare.status, "active");

      const revoked = await callTool(env, "pinar.revoke_share", { resourceId: "session_mcp", resourceType: "session" }, SHARE_TOKEN);
      assert.equal(revoked.result.isError, undefined);
      const revokedShare = db.query("SELECT status FROM share_tokens WHERE resource_id = ?").get("session_mcp") as { status: string };
      assert.equal(revokedShare.status, "revoked");
    } finally {
      db.close();
    }
  });

  test("a published project remains readable with its own share token and stops after revocation", async () => {
    const db = migratedDatabase();
    try {
      const env = await seedMcpWorkspace(db);
      const published = await callTool(env, "pinar.publish_share", { resourceId: "project_mcp", resourceType: "project" }, SHARE_TOKEN);
      assert.equal(published.result.isError, undefined);
      const token = String((JSON.parse(published.text) as Record<string, unknown>).token);
      const url = `https://pinar.test/api/public/projects/project_mcp?token=${encodeURIComponent(token)}`;
      const visible = await handleCloudApiRequest(new Request(url), env);
      assert.equal(visible.status, 200);
      const project = (await jsonBody(visible)).project as Record<string, unknown>;
      assert.equal((project.collections as unknown[]).length, 2);
      const markdown = await handleCloudPublicRequest(new Request(`https://pinar.test/p/project_mcp.md?token=${encodeURIComponent(token)}`), env);
      assert.equal(markdown.status, 200);
      assert.match(await markdown.text(), /MCP project/);

      const revoked = await callTool(env, "pinar.revoke_share", { resourceId: "project_mcp", resourceType: "project" }, SHARE_TOKEN);
      assert.equal(revoked.result.isError, undefined);
      const hidden = await handleCloudApiRequest(new Request(url), env);
      assert.equal(hidden.status, 404);
    } finally {
      db.close();
    }
  });

  test("ancestor share tokens authorize nested viewers, Markdown, and shots only", async () => {
    const db = migratedDatabase();
    try {
      const baseEnv = await seedMcpWorkspace(db);
      db.query("INSERT INTO projects (id, owner_id, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)")
        .run("project_other", "usr_mcp", "Other project", NOW, NOW);
      db.query("INSERT INTO collections (id, project_id, owner_id, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)")
        .run("collection_other", "project_other", "usr_mcp", "Other collection", NOW, NOW);
      db.query(
        "INSERT INTO sessions (id, url, title, shot_id, shot_url, pin_count, pins_json, created_at, user_id, plan, is_permanent, byte_size, collection_id, position) "
          + "VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?, 'pro', 1, 1, ?, 0)",
      ).run(
        "session_other",
        "https://example.test/other",
        "Other session",
        "session_other",
        "https://pinar.test/shots/session_other.png",
        JSON.stringify([{ comment: "private other note", number: 1 }]),
        NOW,
        "usr_mcp",
        "collection_other",
      );
      db.query("INSERT INTO batches (id, user_id, label, started_at) VALUES (?, ?, ?, ?)")
        .run("batch_mcp", "usr_mcp", "MCP batch", NOW);
      db.query("UPDATE sessions SET batch_id = ? WHERE id = ?").run("batch_mcp", "session_mcp");

      const bucket = {
        async get(key: string) {
          if (key !== "shots/session_mcp.png") return null;
          return {
            body: new Response("png").body,
            httpEtag: "etag-session-mcp",
            writeHttpMetadata() {},
          };
        },
      } as unknown as NonNullable<CloudEnv["PINAR_BUCKET"]>;
      const env = { ...baseEnv, PINAR_BUCKET: bucket };
      const publish = async (resourceType: string, resourceId: string) => {
        const response = await callTool(env, "pinar.publish_share", { resourceId, resourceType }, SHARE_TOKEN);
        assert.equal(response.result.isError, undefined);
        return String((JSON.parse(response.text) as Record<string, unknown>).token);
      };
      const projectToken = await publish("project", "project_mcp");
      const collectionToken = await publish("collection", "collection_mcp");
      const batchToken = await publish("batch", "batch_mcp");
      const tokenQuery = (token: string) => `token=${encodeURIComponent(token)}`;

      const projectResponse = await handleCloudApiRequest(
        new Request(`https://pinar.test/api/public/projects/project_mcp?${tokenQuery(projectToken)}`),
        env,
      );
      assert.equal(projectResponse.status, 200);
      const projectBody = await jsonBody(projectResponse);
      const project = projectBody.project as Record<string, unknown>;
      const projectCollections = project.collections as Array<Record<string, unknown>>;
      assert.equal(projectCollections.some((collection) => (
        (collection.sessions as Array<Record<string, unknown>>).some((session) => session.id === "session_mcp")
      )), true);

      const nestedApi = await handleCloudApiRequest(
        new Request(`https://pinar.test/api/sessions/session_mcp?${tokenQuery(projectToken)}`),
        env,
      );
      assert.equal(nestedApi.status, 200);
      const nestedViewer = await handleCloudPublicRequest(
        new Request(`https://pinar.test/v/session_mcp.md?${tokenQuery(projectToken)}`),
        env,
      );
      assert.equal(nestedViewer.status, 200);
      assert.match(await nestedViewer.text(), /private MCP note/);
      const nestedShot = await handleCloudPublicRequest(
        new Request(`https://pinar.test/shots/session_mcp.png?${tokenQuery(projectToken)}`),
        env,
      );
      assert.equal(nestedShot.status, 200);

      const projectMarkdown = await handleCloudPublicRequest(
        new Request(`https://pinar.test/p/project_mcp.md?${tokenQuery(projectToken)}`),
        env,
      );
      assert.equal(projectMarkdown.status, 200);
      const projectMarkdownText = await projectMarkdown.text();
      assert.match(projectMarkdownText, new RegExp(`/c/collection_mcp\\?${tokenQuery(projectToken)}`));
      assert.match(projectMarkdownText, new RegExp(`/v/session_mcp\\?${tokenQuery(projectToken)}`));
      assert.match(projectMarkdownText, new RegExp(`/shots/session_mcp\\.png\\?${tokenQuery(projectToken)}`));

      for (const token of [collectionToken, batchToken]) {
        const child = await handleCloudPublicRequest(
          new Request(`https://pinar.test/v/session_mcp.md?${tokenQuery(token)}`),
          env,
        );
        assert.equal(child.status, 200);
      }
      const collectionMarkdown = await handleCloudPublicRequest(
        new Request(`https://pinar.test/c/collection_mcp.md?${tokenQuery(collectionToken)}`),
        env,
      );
      assert.equal(collectionMarkdown.status, 200);
      assert.match(await collectionMarkdown.text(), new RegExp(`/v/session_mcp\\?${tokenQuery(collectionToken)}`));
      const batchMarkdown = await handleCloudPublicRequest(
        new Request(`https://pinar.test/b/batch_mcp.md?${tokenQuery(batchToken)}`),
        env,
      );
      assert.equal(batchMarkdown.status, 200);
      assert.match(await batchMarkdown.text(), new RegExp(`/v/session_mcp\\.md\\?${tokenQuery(batchToken)}`));

      for (const token of [projectToken, collectionToken, batchToken]) {
        const unrelated = await handleCloudPublicRequest(
          new Request(`https://pinar.test/v/session_other.md?${tokenQuery(token)}`),
          env,
        );
        assert.equal(unrelated.status, 404);
      }

      const revoked = await callTool(
        env,
        "pinar.revoke_share",
        { resourceId: "project_mcp", resourceType: "project" },
        SHARE_TOKEN,
      );
      assert.equal(revoked.result.isError, undefined);
      for (const path of [
        `/api/public/projects/project_mcp?${tokenQuery(projectToken)}`,
        `/api/sessions/session_mcp?${tokenQuery(projectToken)}`,
        `/v/session_mcp.md?${tokenQuery(projectToken)}`,
        `/shots/session_mcp.png?${tokenQuery(projectToken)}`,
      ]) {
        const hidden = path.startsWith("/api/")
          ? await handleCloudApiRequest(new Request(`https://pinar.test${path}`), env)
          : await handleCloudPublicRequest(new Request(`https://pinar.test${path}`), env);
        assert.equal(hidden.status, 404);
      }
    } finally {
      db.close();
    }
  });

  test("does not authorize the MCP route from a web cookie", async () => {
    const db = migratedDatabase();
    try {
      const env = envFor(db);
      const response = await handleCloudApiRequest(new Request("https://pinar.test/api/mcp", {
        body: JSON.stringify({ id: 1, jsonrpc: "2.0", method: "tools/list" }),
        headers: { cookie: "pinar_session=web-only", "content-type": "application/json" },
        method: "POST",
      }), env);
      assert.equal(response.status, 401);
    } finally {
      db.close();
    }
  });

  test("migration 0026 preserves a human comment and accepts an agent row", async () => {
    const db = new Database(":memory:");
    db.exec("PRAGMA foreign_keys = ON");
    const directory = new URL("../../migrations/", import.meta.url);
    for (const file of readdirSync(directory).filter((name) => name.endsWith(".sql") && name < "0026_pin_comment_agents.sql").sort()) {
      db.exec(readFileSync(new URL(file, directory), "utf8"));
    }
    db.query(
      "INSERT INTO users (id, email, plan, ever_paid, billing_status, created_at, updated_at) VALUES (?, ?, 'pro', 1, 'active', ?, ?)",
    ).run("usr_mig", "mig@example.test", NOW, NOW);
    db.query(
      "INSERT INTO sessions (id, url, title, shot_id, shot_url, pin_count, pins_json, created_at, user_id, plan, is_permanent, byte_size, collection_id, position) "
        + "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pro', 1, 1, NULL, 0)",
    ).run(
      "session_mig",
      "https://example.test/mig",
      "Migrated",
      "session_mig",
      "",
      1,
      JSON.stringify([{ id: "pin_mig", comment: "Original" }]),
      NOW,
      "usr_mig",
    );
    db.query(
      "INSERT INTO pin_comments (id, capture_id, pin_id, actor_id, actor_label, actor_type, body, created_at) VALUES (?, ?, ?, ?, ?, 'human', ?, ?)",
    ).run("comment_mig", "session_mig", "pin_mig", "usr_mig", "Mig", "Before migration", NOW);
    db.exec(readFileSync(new URL("0026_pin_comment_agents.sql", directory), "utf8"));

    const preserved = db.query("SELECT * FROM pin_comments WHERE id = 'comment_mig'").get() as { actor_type: string; body: string };
    assert.equal(preserved.body, "Before migration");
    assert.equal(preserved.actor_type, "human");
    const index = db.query("SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_pin_comments_capture'").get();
    assert.ok(index);
    const schema = db.query("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'pin_comments'").get() as { sql: string };
    assert.ok(schema.sql.includes("CHECK (actor_type IN ('agent', 'human'))"));

    db.query(
      "INSERT INTO pin_comments (id, capture_id, pin_id, actor_id, actor_label, actor_type, body, created_at) VALUES (?, ?, ?, ?, ?, 'agent', ?, ?)",
    ).run("comment_mig_agent", "session_mig", "pin_mig", "key_mig", "Mig key", "Agent comment", NOW);
    const agentRow = db.query("SELECT * FROM pin_comments WHERE id = 'comment_mig_agent'").get() as { actor_type: string };
    assert.equal(agentRow.actor_type, "agent");
    db.close();
  });

  test("pin comment conversation: key-derived authorship, edit own, scopes, and HTTP auth", async () => {
    const db = migratedDatabase();
    try {
      const env = await seedMcpWorkspace(db);
      db.query(
        "INSERT INTO sessions (id, url, title, shot_id, shot_url, pin_count, pins_json, created_at, user_id, plan, is_permanent, byte_size, collection_id, position) "
          + "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pro', 1, 1, ?, 0)",
      ).run(
        "session_conv",
        "https://example.test/conv",
        "Conversation page",
        "session_conv",
        "https://pinar.test/shots/session_conv.png",
        1,
        JSON.stringify([{ id: "pin_conv", comment: "Original note" }]),
        NOW,
        "usr_mcp",
        "collection_mcp",
      );
      db.query(
        "INSERT INTO sessions (id, url, title, shot_id, shot_url, pin_count, pins_json, created_at, user_id, plan, is_permanent, byte_size, collection_id, position) "
          + "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pro', 1, 1, ?, 0)",
      ).run(
        "session_other",
        "https://example.test/other",
        "Other page",
        "session_other",
        "https://pinar.test/shots/session_other.png",
        1,
        JSON.stringify([{ id: "pin_other", comment: "Other note" }]),
        NOW,
        "usr_other",
        "collection_target",
      );
      db.query(
        "INSERT INTO users (id, email, plan, ever_paid, billing_status, created_at, updated_at) VALUES (?, ?, 'pro', 1, 'active', ?, ?)",
      ).run("usr_other", "other@example.test", NOW, NOW);

      await ensureMcpSession(env, TOKEN);
      const list = await handleCloudApiRequest(request({ id: 1, jsonrpc: "2.0", method: "tools/list" }), env);
      const toolNames = ((await jsonBody(list)).result as { tools: Array<{ name: string }> }).tools.map((tool) => tool.name);
      for (const name of ["pinar.list_pin_comments", "pinar.add_pin_comment", "pinar.edit_pin_comment", "pinar.edit_pin_note"]) {
        assert.ok(toolNames.includes(name), `missing tool ${name}`);
      }

      const emptyList = await callTool(env, "pinar.list_pin_comments", { pinId: "pin_conv", sessionId: "session_conv" }, TOKEN);
      assert.equal(emptyList.response.status, 200);
      assert.deepEqual(JSON.parse(emptyList.text), { comments: [], ok: true });

      const readDenied = await callTool(env, "pinar.add_pin_comment", {
        body: "Cannot", pinId: "pin_conv", sessionId: "session_conv",
      }, TOKEN);
      assert.equal(readDenied.result.isError, true);
      assert.equal(readDenied.text, "manage permission required");
      const shareDenied = await callTool(env, "pinar.edit_pin_note", {
        comment: "Cannot", pinId: "pin_conv", sessionId: "session_conv",
      }, SHARE_TOKEN);
      assert.equal(shareDenied.result.isError, true);
      assert.equal(shareDenied.text, "manage permission required");

      // The author is derived from the key; caller-supplied actor fields are ignored.
      const added = await callTool(env, "pinar.add_pin_comment", {
        actorId: "spoof",
        actorLabel: "Evil",
        agentName: "Evil",
        body: "Investigating the CTA",
        pinId: "pin_conv",
        sessionId: "session_conv",
      }, MANAGE_TOKEN);
      assert.equal(added.response.status, 200);
      const addedComment = (JSON.parse(added.text) as { comment: Record<string, unknown> }).comment;
      assert.equal(addedComment.actorId, "key_manage");
      assert.equal(addedComment.actorLabel, "MCP manage");
      assert.equal(addedComment.actorType, "agent");
      assert.equal(addedComment.body, "Investigating the CTA");
      const addedId = String(addedComment.id);
      const addedAt = String(addedComment.createdAt);

      const emptyBody = await callTool(env, "pinar.add_pin_comment", {
        body: "   ", pinId: "pin_conv", sessionId: "session_conv",
      }, MANAGE_TOKEN);
      assert.equal(emptyBody.result.isError, true);
      assert.equal(emptyBody.text, "body is invalid");
      const overlongBody = await callTool(env, "pinar.add_pin_comment", {
        body: "x".repeat(2001), pinId: "pin_conv", sessionId: "session_conv",
      }, MANAGE_TOKEN);
      assert.equal(overlongBody.result.isError, true);
      assert.equal(overlongBody.text, "body is invalid");

      const edited = await callTool(env, "pinar.edit_pin_comment", {
        body: "Investigating the CTA (v2)",
        commentId: addedId,
        pinId: "pin_conv",
        sessionId: "session_conv",
      }, MANAGE_TOKEN);
      const editedComment = (JSON.parse(edited.text) as { comment: Record<string, unknown> }).comment;
      assert.equal(editedComment.id, addedId);
      assert.equal(editedComment.createdAt, addedAt);
      assert.equal(editedComment.body, "Investigating the CTA (v2)");
      assert.equal(editedComment.actorId, "key_manage");

      // A key cannot edit a comment another key authored.
      const secondKeyToken = `pak_${"g".repeat(43)}`;
      db.query(
        "INSERT INTO agent_api_keys (id, account_id, name, token_hash, token_prefix, resource_type, resource_id, permission, expires_at, created_at) "
          + "VALUES (?, ?, ?, ?, ?, 'account', NULL, 'manage', ?, ?)",
      ).run("key_manage_2", "usr_mcp", "Second manage", await sha256(secondKeyToken), secondKeyToken.slice(0, 12), LATER, NOW);
      const foreignEdit = await callTool(env, "pinar.edit_pin_comment", {
        body: "Nope", commentId: addedId, pinId: "pin_conv", sessionId: "session_conv",
      }, secondKeyToken);
      assert.equal(foreignEdit.result.isError, true);
      assert.equal(foreignEdit.text, "Resource not found");

      // Cross-pin and cross-session references are refused.
      const crossPin = await callTool(env, "pinar.edit_pin_comment", {
        body: "Nope", commentId: addedId, pinId: "pin_other", sessionId: "session_conv",
      }, MANAGE_TOKEN);
      assert.equal(crossPin.result.isError, true);
      assert.equal(crossPin.text, "Resource not found");
      const crossSession = await callTool(env, "pinar.add_pin_comment", {
        body: "Nope", pinId: "pin_other", sessionId: "session_other",
      }, MANAGE_TOKEN);
      assert.equal(crossSession.result.isError, true);
      assert.equal(crossSession.text, "Resource not found");

      const note = await callTool(env, "pinar.edit_pin_note", {
        comment: "Edited original note",
        pinId: "pin_conv",
        sessionId: "session_conv",
      }, MANAGE_TOKEN);
      const noteBody = JSON.parse(note.text) as { ok: boolean; pin: Record<string, unknown> };
      assert.equal(noteBody.ok, true);
      assert.equal(noteBody.pin.comment, "Edited original note");
      const markdown = await callTool(env, "pinar.get_session_markdown", { sessionId: "session_conv" }, TOKEN);
      assert.match(markdown.text, /Edited original note/);
      const missingPinNote = await callTool(env, "pinar.edit_pin_note", {
        comment: "Nope", pinId: "pin_missing", sessionId: "session_conv",
      }, MANAGE_TOKEN);
      assert.equal(missingPinNote.result.isError, true);
      assert.equal(missingPinNote.text, "Pin not found");

      // Resource-scoped keys: the covering collection may mutate, another may not.
      const coveringToken = `pak_${"d".repeat(43)}`;
      db.query(
        "INSERT INTO agent_api_keys (id, account_id, name, token_hash, token_prefix, resource_type, resource_id, permission, expires_at, created_at) "
          + "VALUES (?, ?, ?, ?, ?, 'collection', ?, 'manage', ?, ?)",
      ).run("key_coll_manage", "usr_mcp", "Covering manage", await sha256(coveringToken), coveringToken.slice(0, 12), "collection_mcp", LATER, NOW);
      const coveringAdd = await callTool(env, "pinar.add_pin_comment", {
        body: "Scoped comment", pinId: "pin_conv", sessionId: "session_conv",
      }, coveringToken);
      assert.equal(coveringAdd.result.isError, undefined);
      assert.equal((JSON.parse(coveringAdd.text) as { comment: Record<string, unknown> }).comment.actorId, "key_coll_manage");

      const outsideToken = `pak_${"f".repeat(43)}`;
      db.query(
        "INSERT INTO agent_api_keys (id, account_id, name, token_hash, token_prefix, resource_type, resource_id, permission, expires_at, created_at) "
          + "VALUES (?, ?, ?, ?, ?, 'collection', ?, 'manage', ?, ?)",
      ).run("key_coll_outside", "usr_mcp", "Outside manage", await sha256(outsideToken), outsideToken.slice(0, 12), "collection_target", LATER, NOW);
      const outsideDenied = await callTool(env, "pinar.add_pin_comment", {
        body: "Nope", pinId: "pin_conv", sessionId: "session_conv",
      }, outsideToken);
      assert.equal(outsideDenied.result.isError, true);
      assert.equal(outsideDenied.text, "Resource not found");

      // HTTP: the human owner posts and edits their own comment.
      const webToken = `pws_${"w".repeat(43)}`;
      db.query(
        "INSERT INTO web_sessions (token_hash, owner_type, owner_id, expires_at, created_at) VALUES (?, 'account', 'usr_mcp', ?, ?)",
      ).run(await sha256(webToken), LATER, NOW);
      const humanPost = await handleCloudApiRequest(new Request(
        "https://pinar.test/api/sessions/session_conv/pins/pin_conv/comments",
        {
          body: JSON.stringify({ body: "Human note" }),
          headers: { "content-type": "application/json", cookie: `pinar_session=${webToken}` },
          method: "POST",
        },
      ), env);
      assert.equal(humanPost.status, 200);
      const humanComment = ((await jsonBody(humanPost)).comment as Record<string, unknown>);
      assert.equal(humanComment.actorType, "human");
      assert.equal(humanComment.actorId, "usr_mcp");
      const humanId = String(humanComment.id);

      const unauthorizedEdit = await handleCloudApiRequest(new Request(
        `https://pinar.test/api/sessions/session_conv/pins/pin_conv/comments/${humanId}`,
        { body: JSON.stringify({ body: "Anon" }), headers: { "content-type": "application/json" }, method: "PATCH" },
      ), env);
      assert.equal(unauthorizedEdit.status, 401);

      const selfEdit = await handleCloudApiRequest(new Request(
        `https://pinar.test/api/sessions/session_conv/pins/pin_conv/comments/${humanId}`,
        {
          body: JSON.stringify({ body: "Human note v2" }),
          headers: { "content-type": "application/json", cookie: `pinar_session=${webToken}` },
          method: "PATCH",
        },
      ), env);
      assert.equal(selfEdit.status, 200);
      const selfBody = await jsonBody(selfEdit);
      assert.equal(selfBody.ok, true);
      const selfComment = selfBody.comment as Record<string, unknown>;
      assert.equal(selfComment.id, humanId);
      assert.equal(selfComment.body, "Human note v2");

      // Another account cannot edit the comment (cross-tenant).
      const otherToken = `pws_${"o".repeat(43)}`;
      db.query(
        "INSERT INTO web_sessions (token_hash, owner_type, owner_id, expires_at, created_at) VALUES (?, 'account', 'usr_other', ?, ?)",
      ).run(await sha256(otherToken), LATER, NOW);
      const otherEdit = await handleCloudApiRequest(new Request(
        `https://pinar.test/api/sessions/session_conv/pins/pin_conv/comments/${humanId}`,
        {
          body: JSON.stringify({ body: "Not yours" }),
          headers: { "content-type": "application/json", cookie: `pinar_session=${otherToken}` },
          method: "PATCH",
        },
      ), env);
      assert.equal(otherEdit.status, 404);

      // A key cannot edit a human comment, even its own session.
      const keyHumanEdit = await callTool(env, "pinar.edit_pin_comment", {
        body: "Nope", commentId: humanId, pinId: "pin_conv", sessionId: "session_conv",
      }, MANAGE_TOKEN);
      assert.equal(keyHumanEdit.result.isError, true);
      assert.equal(keyHumanEdit.text, "Resource not found");

      // HTTP note edit: owner writes, no-auth is refused.
      const notePatch = await handleCloudApiRequest(new Request(
        "https://pinar.test/api/sessions/session_conv/pins/pin_conv",
        {
          body: JSON.stringify({ comment: "Owner edited note" }),
          headers: { "content-type": "application/json", cookie: `pinar_session=${webToken}` },
          method: "PATCH",
        },
      ), env);
      assert.equal(notePatch.status, 200);
      const notePatchBody = await jsonBody(notePatch);
      assert.equal(notePatchBody.ok, true);
      assert.equal((notePatchBody.pin as Record<string, unknown>).comment, "Owner edited note");
      const noteUnauth = await handleCloudApiRequest(new Request(
        "https://pinar.test/api/sessions/session_conv/pins/pin_conv",
        { body: JSON.stringify({ comment: "Nope" }), headers: { "content-type": "application/json" }, method: "PATCH" },
      ), env);
      assert.equal(noteUnauth.status, 401);
      const noteCrossTenant = await handleCloudApiRequest(new Request(
        "https://pinar.test/api/sessions/session_conv/pins/pin_conv",
        {
          body: JSON.stringify({ comment: "Not yours" }),
          headers: { "content-type": "application/json", cookie: `pinar_session=${otherToken}` },
          method: "PATCH",
        },
      ), env);
      assert.equal(noteCrossTenant.status, 404);
      const noteEmpty = await handleCloudApiRequest(new Request(
        "https://pinar.test/api/sessions/session_conv/pins/pin_conv",
        {
          body: JSON.stringify({ comment: "" }),
          headers: { "content-type": "application/json", cookie: `pinar_session=${webToken}` },
          method: "PATCH",
        },
      ), env);
      assert.equal(noteEmpty.status, 400);

      // The session PATCH contract for viewer pin fields is untouched.
      const sessionPatch = await handleCloudApiRequest(new Request(
        "https://pinar.test/api/sessions/session_conv",
        {
          body: JSON.stringify({ pins: [{
            diagnosis: {
              cause: "Confirmed cause",
              confidence: "medium",
              fix: "button.pay { padding: 8px 16px; }",
              properties: ["padding"],
              version: 1,
            },
            pinId: "pin_conv",
          }] }),
          headers: { "content-type": "application/json", cookie: `pinar_session=${webToken}` },
          method: "PATCH",
        },
      ), env);
      assert.equal(sessionPatch.status, 200);
      const sessionPatchBody = await jsonBody(sessionPatch);
      assert.equal(
        (sessionPatchBody.session as { pins: Array<{ diagnosis?: { cause?: string } }> }).pins[0]?.diagnosis?.cause,
        "Confirmed cause",
      );
    } finally {
      db.close();
    }
  });

  test("manage keys delete projects, moving sessions to the default Inbox", async () => {
    const db = migratedDatabase();
    try {
      const env = await seedMcpWorkspace(db);

      const readDenied = await callTool(env, "pinar.delete_project", { projectId: "project_mcp" }, TOKEN);
      assert.equal(readDenied.result.isError, true);
      assert.equal(readDenied.text, "manage permission required");

      const deleted = await callTool(env, "pinar.delete_project", { projectId: "project_mcp" }, MANAGE_TOKEN);
      assert.equal(deleted.result.isError, undefined);
      assert.deepEqual(JSON.parse(deleted.text), { ok: true, projectId: "project_mcp" });
      assert.equal(db.query("SELECT * FROM projects WHERE id = ?").get("project_mcp"), null);
      assert.equal(db.query("SELECT * FROM collections WHERE id = ?").get("collection_mcp"), null);
      const inbox = db.query("SELECT id FROM collections WHERE owner_id = ? AND is_protected = 1").get("usr_mcp") as { id: string };
      assert.ok(inbox);
      const moved = db.query("SELECT collection_id FROM sessions WHERE id = ?").get("session_mcp") as { collection_id: string };
      assert.equal(moved.collection_id, inbox.id);

      const missing = await callTool(env, "pinar.delete_project", { projectId: "project_mcp" }, MANAGE_TOKEN);
      assert.equal(missing.result.isError, true);
      assert.equal(missing.text, "Project not found");
    } finally {
      db.close();
    }
  });

  test("manage keys delete collections and batches, keeping and detaching sessions", async () => {
    const db = migratedDatabase();
    try {
      const env = await seedMcpWorkspace(db);
      db.query("INSERT INTO batches (id, user_id, label, started_at) VALUES (?, ?, ?, ?)")
        .run("batch_del", "usr_mcp", "Delete me", NOW);
      db.query("UPDATE sessions SET batch_id = ? WHERE id = ?").run("batch_del", "session_mcp");

      const finished = await callTool(env, "pinar.finish_batch", { batchId: "batch_del" }, MANAGE_TOKEN);
      assert.equal(finished.result.isError, undefined);
      const finishedRow = db.query("SELECT finished_at FROM batches WHERE id = ?").get("batch_del") as { finished_at: string };
      assert.equal(finishedRow.finished_at, NOW);

      const collectionDeleted = await callTool(env, "pinar.delete_collection", { collectionId: "collection_mcp" }, MANAGE_TOKEN);
      assert.equal(collectionDeleted.result.isError, undefined);
      assert.deepEqual(JSON.parse(collectionDeleted.text), { ok: true, collectionId: "collection_mcp" });
      assert.equal(db.query("SELECT * FROM collections WHERE id = ?").get("collection_mcp"), null);
      const inbox = db.query("SELECT id FROM collections WHERE owner_id = ? AND is_protected = 1").get("usr_mcp") as { id: string };
      const moved = db.query("SELECT collection_id FROM sessions WHERE id = ?").get("session_mcp") as { collection_id: string };
      assert.equal(moved.collection_id, inbox.id);

      const readDenied = await callTool(env, "pinar.delete_batch", { batchId: "batch_del" }, TOKEN);
      assert.equal(readDenied.result.isError, true);
      assert.equal(readDenied.text, "manage permission required");

      const batchDeleted = await callTool(env, "pinar.delete_batch", { batchId: "batch_del" }, MANAGE_TOKEN);
      assert.equal(batchDeleted.result.isError, undefined);
      assert.deepEqual(JSON.parse(batchDeleted.text), { ok: true, batchId: "batch_del" });
      assert.equal(db.query("SELECT * FROM batches WHERE id = ?").get("batch_del"), null);
      const detached = db.query("SELECT batch_id, collection_id FROM sessions WHERE id = ?").get("session_mcp") as { batch_id: string | null; collection_id: string | null };
      assert.equal(detached.batch_id, null);
      assert.equal(detached.collection_id, inbox.id);
    } finally {
      db.close();
    }
  });

  test("finish_batch records the server timestamp, rejects a caller timestamp, and preserves start and membership", async () => {
    const db = migratedDatabase();
    try {
      const env = await seedMcpWorkspace(db);
      db.query("INSERT INTO batches (id, user_id, label, started_at) VALUES (?, ?, ?, ?)")
        .run("batch_fin", "usr_mcp", "Finish me", NOW);
      db.query("UPDATE sessions SET batch_id = ? WHERE id = ?").run("batch_fin", "session_mcp");

      const finished = await callTool(env, "pinar.finish_batch", { batchId: "batch_fin" }, MANAGE_TOKEN);
      assert.equal(finished.result.isError, undefined);
      const after = db.query("SELECT started_at, finished_at FROM batches WHERE id = ?").get("batch_fin") as { started_at: string; finished_at: string };
      assert.equal(after.started_at, NOW);
      assert.equal(after.finished_at, NOW);
      const membership = db.query("SELECT batch_id FROM sessions WHERE id = ?").get("session_mcp") as { batch_id: string };
      assert.equal(membership.batch_id, "batch_fin");

      const rejected = await callTool(env, "pinar.finish_batch", { batchId: "batch_fin", finishedAt: "not-a-date" }, MANAGE_TOKEN);
      assert.equal(rejected.result.isError, true);
      assert.equal(rejected.text, "finishedAt is not accepted");
      const afterReject = db.query("SELECT finished_at FROM batches WHERE id = ?").get("batch_fin") as { finished_at: string };
      assert.equal(afterReject.finished_at, NOW);

      const readDenied = await callTool(env, "pinar.finish_batch", { batchId: "batch_fin" }, TOKEN);
      assert.equal(readDenied.result.isError, true);
      assert.equal(readDenied.text, "manage permission required");
    } finally {
      db.close();
    }
  });

  test("create_batch and rename_batch complete a lifecycle with stable id, start time and membership", async () => {
    const db = migratedDatabase();
    try {
      const env = await seedMcpWorkspace(db);

      await ensureMcpSession(env, MANAGE_TOKEN);
      const listed = await handleCloudApiRequest(request({ id: 2, jsonrpc: "2.0", method: "tools/list" }, MANAGE_TOKEN), env);
      const tools = (JSON.parse(await listed.text()).result as { tools: Array<{ name: string }> }).tools;
      assert.equal(tools.length, 39);
      assert.ok(tools.some((tool) => tool.name === "pinar.create_batch"));
      assert.ok(tools.some((tool) => tool.name === "pinar.rename_batch"));
      assert.ok(tools.some((tool) => tool.name === "pinar.create_session"));
      assert.ok(tools.some((tool) => tool.name === "pinar.update_session"));
      assert.ok(tools.some((tool) => tool.name === "pinar.list_pins"));
      assert.ok(tools.some((tool) => tool.name === "pinar.get_pin"));
      assert.ok(tools.some((tool) => tool.name === "pinar.create_pin"));
      assert.ok(tools.some((tool) => tool.name === "pinar.delete_pin"));

      const created = await callTool(env, "pinar.create_batch", { label: "  MCP batch one  " }, MANAGE_TOKEN);
      assert.equal(created.result.isError, undefined);
      const createdBatch = JSON.parse(created.text).batch as Record<string, unknown>;
      const batchId = String(createdBatch.id);
      assert.equal(createdBatch.label, "MCP batch one");
      assert.equal(createdBatch.startedAt, NOW);
      assert.equal(createdBatch.finishedAt, null);
      assert.equal(createdBatch.sessionCount, 0);
      assert.match(batchId, /^[A-Za-z0-9_-]{12}$/);
      const createdRow = db.query("SELECT user_id, label, started_at, finished_at FROM batches WHERE id = ?").get(batchId) as Record<string, unknown>;
      assert.equal(createdRow.user_id, "usr_mcp");
      assert.equal(createdRow.label, "MCP batch one");
      assert.equal(createdRow.started_at, NOW);
      assert.equal(createdRow.finished_at, null);

      const listedBatches = await callTool(env, "pinar.list_batches", {}, MANAGE_TOKEN);
      const page = JSON.parse(listedBatches.text) as { batches: Array<Record<string, unknown>> };
      const visible = page.batches.find((batch) => batch.id === batchId);
      assert.equal(visible?.label, "MCP batch one");
      assert.equal(visible?.sessionCount, 0);

      db.query("UPDATE sessions SET batch_id = ? WHERE id = ?").run(batchId, "session_mcp");
      const markdown = await callTool(env, "pinar.get_batch_markdown", { batchId }, MANAGE_TOKEN);
      assert.equal(markdown.result.isError, undefined);
      assert.match(markdown.text, /private MCP note/);

      // Advance the clock so a mutation that rewrites started_at on rename
      // (or any other timestamp no-op) cannot hide behind the frozen NOW.
      // The steps stay before LATER, the seeded keys' expiry.
      setCloudNowForTests(LATER2);
      const renamed = await callTool(env, "pinar.rename_batch", { batchId, label: "Batch two" }, MANAGE_TOKEN);
      assert.equal(renamed.result.isError, undefined);
      const renamedBatch = JSON.parse(renamed.text).batch as Record<string, unknown>;
      assert.equal(renamedBatch.id, batchId);
      assert.equal(renamedBatch.label, "Batch two");
      assert.equal(renamedBatch.startedAt, NOW);
      assert.equal(renamedBatch.finishedAt, null);
      assert.equal(renamedBatch.sessionCount, 1);
      const renamedRow = db.query("SELECT label, started_at FROM batches WHERE id = ?").get(batchId) as { label: string; started_at: string };
      assert.equal(renamedRow.label, "Batch two");
      assert.equal(renamedRow.started_at, NOW);
      const membership = db.query("SELECT batch_id FROM sessions WHERE id = ?").get("session_mcp") as { batch_id: string };
      assert.equal(membership.batch_id, batchId);

      setCloudNowForTests(LATER3);
      const finished = await callTool(env, "pinar.finish_batch", { batchId }, MANAGE_TOKEN);
      assert.equal(finished.result.isError, undefined);
      const finishedRow = db.query("SELECT started_at, finished_at FROM batches WHERE id = ?").get(batchId) as { started_at: string; finished_at: string };
      assert.equal(finishedRow.started_at, NOW);
      assert.equal(finishedRow.finished_at, LATER3);

      setCloudNowForTests(LATER4);
      const renamedAgain = await callTool(env, "pinar.rename_batch", { batchId, label: "Batch three" }, MANAGE_TOKEN);
      assert.equal(renamedAgain.result.isError, undefined);
      const afterFinish = db.query("SELECT label, started_at, finished_at FROM batches WHERE id = ?").get(batchId) as { label: string; started_at: string; finished_at: string };
      assert.equal(afterFinish.label, "Batch three");
      assert.equal(afterFinish.started_at, NOW);
      assert.equal(afterFinish.finished_at, LATER3);
      const stillMember = db.query("SELECT batch_id FROM sessions WHERE id = ?").get("session_mcp") as { batch_id: string };
      assert.equal(stillMember.batch_id, batchId);

      const finalRead = await callTool(env, "pinar.get_batch_markdown", { batchId }, MANAGE_TOKEN);
      assert.equal(finalRead.result.isError, undefined);
      assert.match(finalRead.text, /private MCP note/);

      const deleted = await callTool(env, "pinar.delete_batch", { batchId }, MANAGE_TOKEN);
      assert.equal(deleted.result.isError, undefined);
      assert.equal(db.query("SELECT * FROM batches WHERE id = ?").get(batchId), null);
      const detached = db.query("SELECT batch_id FROM sessions WHERE id = ?").get("session_mcp") as { batch_id: string | null };
      assert.equal(detached.batch_id, null);
    } finally {
      db.close();
    }
  });

  test("create_batch and rename_batch reject invalid labels, unknown ids and extra arguments without writes", async () => {
    const db = migratedDatabase();
    try {
      const env = await seedMcpWorkspace(db);
      db.query("INSERT INTO batches (id, user_id, label, started_at) VALUES (?, ?, ?, ?)")
        .run("batch_val", "usr_mcp", "Valid", NOW);

      const empty = await callTool(env, "pinar.create_batch", { label: "   " }, MANAGE_TOKEN);
      assert.equal(empty.result.isError, true);
      assert.equal(empty.text, "label is invalid");
      const tooLong = await callTool(env, "pinar.create_batch", { label: "x".repeat(201) }, MANAGE_TOKEN);
      assert.equal(tooLong.result.isError, true);
      assert.equal(tooLong.text, "label is invalid");
      const missing = await callTool(env, "pinar.create_batch", {}, MANAGE_TOKEN);
      assert.equal(missing.result.isError, true);
      assert.match(missing.text, /Input validation error/);
      assert.match(missing.text, /'label'/);
      const extra = await callTool(env, "pinar.create_batch", { label: "Created", extra: 1 }, MANAGE_TOKEN);
      assert.equal(extra.result.isError, true);
      assert.equal(extra.text, "Unexpected argument");

      const noId = await callTool(env, "pinar.rename_batch", { label: "Renamed" }, MANAGE_TOKEN);
      assert.equal(noId.result.isError, true);
      assert.match(noId.text, /Input validation error/);
      assert.match(noId.text, /'batchId'/);
      const malformed = await callTool(env, "pinar.rename_batch", { batchId: "../escapes", label: "Renamed" }, MANAGE_TOKEN);
      assert.equal(malformed.result.isError, true);
      assert.equal(malformed.text, "batchId is invalid");
      const unknown = await callTool(env, "pinar.rename_batch", { batchId: "batch_ghost", label: "Renamed" }, MANAGE_TOKEN);
      assert.equal(unknown.result.isError, true);
      assert.equal(unknown.text, "Batch not found");
      const extraRename = await callTool(env, "pinar.rename_batch", { batchId: "batch_val", label: "Renamed", finishedAt: "2026-01-01T00:00:00.000Z" }, MANAGE_TOKEN);
      assert.equal(extraRename.result.isError, true);
      assert.equal(extraRename.text, "Unexpected argument");

      const count = db.query("SELECT COUNT(*) AS n FROM batches").get() as { n: number };
      assert.equal(count.n, 1);
      const row = db.query("SELECT label FROM batches WHERE id = ?").get("batch_val") as { label: string };
      assert.equal(row.label, "Valid");
    } finally {
      db.close();
    }
  });

  test("create_batch and rename_batch are gated to the account manage key and the batch owner", async () => {
    const db = migratedDatabase();
    try {
      const env = await seedMcpWorkspace(db);
      db.query("INSERT INTO batches (id, user_id, label, started_at) VALUES (?, ?, ?, ?)")
        .run("batch_perm", "usr_mcp", "Permission", NOW);

      const readOnly = await callTool(env, "pinar.rename_batch", { batchId: "batch_perm", label: "Nope" }, TOKEN);
      assert.equal(readOnly.result.isError, true);
      assert.equal(readOnly.text, "manage permission required");
      const shareOnly = await callTool(env, "pinar.create_batch", { label: "Nope" }, SHARE_TOKEN);
      assert.equal(shareOnly.result.isError, true);
      assert.equal(shareOnly.text, "manage permission required");

      const scoped = `pak_${"b".repeat(43)}`;
      db.query(
        "INSERT INTO agent_api_keys (id, account_id, name, token_hash, token_prefix, resource_type, resource_id, permission, expires_at, created_at) "
          + "VALUES (?, ?, ?, ?, ?, 'batch', ?, 'manage', ?, ?)",
      ).run("key_batch_scope", "usr_mcp", "Batch manage", await sha256(scoped), scoped.slice(0, 12), "batch_perm", LATER, NOW);
      const scopedDenied = await callTool(env, "pinar.rename_batch", { batchId: "batch_perm", label: "Nope" }, scoped);
      assert.equal(scopedDenied.result.isError, true);
      assert.equal(scopedDenied.text, "Mutations require an account-scoped key");

      const other = `pak_${"e".repeat(43)}`;
      db.query("INSERT INTO users (id, email, plan, ever_paid, billing_status, created_at, updated_at) VALUES (?, ?, 'pro', 1, 'active', ?, ?)")
        .run("usr_mcp3", "mcp3@example.test", NOW, NOW);
      db.query(
        "INSERT INTO agent_api_keys (id, account_id, name, token_hash, token_prefix, resource_type, resource_id, permission, expires_at, created_at) "
          + "VALUES (?, ?, ?, ?, ?, 'account', NULL, 'manage', ?, ?)",
      ).run("key_mcp3", "usr_mcp3", "MCP manage 3", await sha256(other), other.slice(0, 12), LATER, NOW);
      const crossOwner = await callTool(env, "pinar.rename_batch", { batchId: "batch_perm", label: "Nope" }, other);
      assert.equal(crossOwner.result.isError, true);
      assert.equal(crossOwner.text, "Batch not found");

      const revoked = `pak_${"t".repeat(43)}`;
      db.query(
        "INSERT INTO agent_api_keys (id, account_id, name, token_hash, token_prefix, resource_type, resource_id, permission, expires_at, created_at) "
          + "VALUES (?, ?, ?, ?, ?, 'account', NULL, 'manage', ?, ?)",
      ).run("key_batch_revoked", "usr_mcp", "Revoked manage", await sha256(revoked), revoked.slice(0, 12), LATER, NOW);
      db.query("UPDATE agent_api_keys SET revoked_at = ? WHERE id = ?").run(NOW, "key_batch_revoked");
      const revokedResponse = await handleCloudApiRequest(request({
        id: 3,
        jsonrpc: "2.0",
        method: "tools/call",
        params: { arguments: { batchId: "batch_perm", label: "Nope" }, name: "pinar.rename_batch" },
      }, revoked), env);
      assert.equal(revokedResponse.status, 401);

      const rows = db.query("SELECT label FROM batches WHERE user_id = ?").all("usr_mcp") as { label: string }[];
      assert.deepEqual(rows, [{ label: "Permission" }]);
    } finally {
      db.close();
    }
  });

  test("protected projects and collections survive MCP deletion", async () => {
    const db = migratedDatabase();
    try {
      const env = await seedMcpWorkspace(db);
      db.query("INSERT INTO projects (id, owner_id, name, icon, position, is_protected, created_at, updated_at) VALUES (?, ?, 'Personal', ?, 0, 1, ?, ?)")
        .run("project_prot", "usr_mcp", "personal", NOW, NOW);
      db.query("INSERT INTO collections (id, project_id, owner_id, parent_id, name, position, is_protected, created_at, updated_at) VALUES (?, ?, ?, NULL, 'Inbox', 0, 1, ?, ?)")
        .run("collection_prot", "project_prot", "usr_mcp", NOW, NOW);

      const projectDenied = await callTool(env, "pinar.delete_project", { projectId: "project_prot" }, MANAGE_TOKEN);
      assert.equal(projectDenied.result.isError, true);
      assert.equal(projectDenied.text, "Project not found");
      assert.ok(db.query("SELECT * FROM projects WHERE id = ?").get("project_prot"));

      const collectionDenied = await callTool(env, "pinar.delete_collection", { collectionId: "collection_prot" }, MANAGE_TOKEN);
      assert.equal(collectionDenied.result.isError, true);
      assert.equal(collectionDenied.text, "Collection not found");
      assert.ok(db.query("SELECT * FROM collections WHERE id = ?").get("collection_prot"));
    } finally {
      db.close();
    }
  });

  test("manage keys delete sessions with their pinned content and enforce ownership", async () => {
    const db = migratedDatabase();
    try {
      const env = await seedMcpWorkspace(db);
      db.query("INSERT INTO pin_reviews (capture_id, pin_id, status, updated_at) VALUES (?, ?, 'open', ?)")
        .run("session_mcp", "pin_mcp", NOW);
      db.query("INSERT INTO pin_comments (id, capture_id, pin_id, actor_id, actor_label, actor_type, body, created_at) VALUES (?, ?, ?, ?, ?, 'human', ?, ?)")
        .run("comment_del", "session_mcp", "pin_mcp", "usr_mcp", "Owner", "Note", NOW);
      db.query(
        "INSERT INTO agent_executions (id, idempotency_key, capture_id, agent, created_at, owner_id, payload_hash) VALUES (?, ?, ?, 'cursor', ?, ?, 'hash')",
      ).run("exec_del", "idemp_del", "session_mcp", NOW, "usr_mcp");

      const readDenied = await callTool(env, "pinar.delete_session", { sessionId: "session_mcp" }, TOKEN);
      assert.equal(readDenied.result.isError, true);
      assert.equal(readDenied.text, "manage permission required");

      db.query("INSERT INTO users (id, email, plan, ever_paid, billing_status, created_at, updated_at) VALUES (?, ?, 'pro', 1, 'active', ?, ?)")
        .run("usr_other", "other@example.test", NOW, NOW);
      db.query(
        "INSERT INTO sessions (id, url, title, shot_id, shot_url, pin_count, pins_json, created_at, user_id, plan, is_permanent, byte_size, collection_id, position) "
          + "VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?, 'pro', 1, 1, ?, 0)",
      ).run(
        "session_other",
        "https://example.test/other",
        "Other",
        "session_other",
        "https://pinar.test/shots/session_other.png",
        JSON.stringify([{ id: "pin_other", comment: "Other" }]),
        NOW,
        "usr_other",
        "collection_target",
      );
      const foreign = await callTool(env, "pinar.delete_session", { sessionId: "session_other" }, MANAGE_TOKEN);
      assert.equal(foreign.result.isError, true);
      assert.equal(foreign.text, "Session not found");
      assert.ok(db.query("SELECT * FROM sessions WHERE id = ?").get("session_other"));

      const deleted = await callTool(env, "pinar.delete_session", { sessionId: "session_mcp" }, MANAGE_TOKEN);
      assert.equal(deleted.result.isError, undefined);
      assert.deepEqual(JSON.parse(deleted.text), { ok: true, sessionId: "session_mcp" });
      assert.equal(db.query("SELECT * FROM sessions WHERE id = ?").get("session_mcp"), null);
      assert.equal(db.query("SELECT * FROM pin_reviews WHERE capture_id = ?").get("session_mcp"), null);
      assert.equal(db.query("SELECT * FROM pin_comments WHERE capture_id = ?").get("session_mcp"), null);
      assert.equal(db.query("SELECT * FROM agent_executions WHERE capture_id = ?").get("session_mcp"), null);
    } finally {
      db.close();
    }
  });

  test("manage keys delete only their own pin comments, validating pin and authorship", async () => {
    const db = migratedDatabase();
    try {
      const env = await seedMcpWorkspace(db);
      db.query(
        "INSERT INTO sessions (id, url, title, shot_id, shot_url, pin_count, pins_json, created_at, user_id, plan, is_permanent, byte_size, collection_id, position) "
          + "VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?, 'pro', 1, 1, ?, 0)",
      ).run(
        "session_dc",
        "https://example.test/dc",
        "Del comment",
        "session_dc",
        "https://pinar.test/shots/session_dc.png",
        JSON.stringify([{ id: "pin_dc", comment: "Note" }]),
        NOW,
        "usr_mcp",
        "collection_mcp",
      );
      db.query("INSERT INTO pin_comments (id, capture_id, pin_id, actor_id, actor_label, actor_type, body, created_at) VALUES (?, ?, ?, ?, ?, 'agent', ?, ?)")
        .run("comment_mine", "session_dc", "pin_dc", "key_manage", "MCP manage", "Investigating", NOW);
      db.query("INSERT INTO pin_comments (id, capture_id, pin_id, actor_id, actor_label, actor_type, body, created_at) VALUES (?, ?, ?, ?, ?, 'human', ?, ?)")
        .run("comment_human", "session_dc", "pin_dc", "usr_mcp", "Owner", "Human note", NOW);

      const readDenied = await callTool(env, "pinar.delete_pin_comment", { commentId: "comment_mine", pinId: "pin_dc", sessionId: "session_dc" }, TOKEN);
      assert.equal(readDenied.result.isError, true);
      assert.equal(readDenied.text, "manage permission required");

      const humanDenied = await callTool(env, "pinar.delete_pin_comment", { commentId: "comment_human", pinId: "pin_dc", sessionId: "session_dc" }, MANAGE_TOKEN);
      assert.equal(humanDenied.result.isError, true);
      assert.equal(humanDenied.text, "Resource not found");
      assert.ok(db.query("SELECT * FROM pin_comments WHERE id = ?").get("comment_human"));

      const wrongPin = await callTool(env, "pinar.delete_pin_comment", { commentId: "comment_mine", pinId: "pin_wrong", sessionId: "session_dc" }, MANAGE_TOKEN);
      assert.equal(wrongPin.result.isError, true);
      assert.equal(wrongPin.text, "Resource not found");
      assert.ok(db.query("SELECT * FROM pin_comments WHERE id = ?").get("comment_mine"));

      const deleted = await callTool(env, "pinar.delete_pin_comment", { commentId: "comment_mine", pinId: "pin_dc", sessionId: "session_dc" }, MANAGE_TOKEN);
      assert.equal(deleted.result.isError, undefined);
      assert.deepEqual(JSON.parse(deleted.text), { commentId: "comment_mine", ok: true });
      assert.equal(db.query("SELECT * FROM pin_comments WHERE id = ?").get("comment_mine"), null);
      assert.ok(db.query("SELECT * FROM pin_comments WHERE id = ?").get("comment_human"));
    } finally {
      db.close();
    }
  });

  test("manage keys drive pin review transitions as the agent actor", async () => {
    const db = migratedDatabase();
    try {
      const env = await seedMcpWorkspace(db);
      db.query(
        "INSERT INTO sessions (id, url, title, shot_id, shot_url, pin_count, pins_json, created_at, user_id, plan, is_permanent, byte_size, collection_id, position) "
          + "VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?, 'pro', 1, 1, ?, 0)",
      ).run(
        "session_rev",
        "https://example.test/rev",
        "Review",
        "session_rev",
        "https://pinar.test/shots/session_rev.png",
        JSON.stringify([{ id: "pin_rev", comment: "Note" }]),
        NOW,
        "usr_mcp",
        "collection_mcp",
      );

      const readDenied = await callTool(env, "pinar.conclude_pin", { pinId: "pin_rev", sessionId: "session_rev" }, TOKEN);
      assert.equal(readDenied.result.isError, true);
      assert.equal(readDenied.text, "manage permission required");
      const shareDenied = await callTool(env, "pinar.reopen_pin", { pinId: "pin_rev", sessionId: "session_rev" }, SHARE_TOKEN);
      assert.equal(shareDenied.result.isError, true);
      assert.equal(shareDenied.text, "manage permission required");

      const concluded = await callTool(env, "pinar.conclude_pin", { pinId: "pin_rev", sessionId: "session_rev" }, MANAGE_TOKEN);
      assert.equal(concluded.result.isError, undefined);
      const concludedBody = JSON.parse(concluded.text) as { changed: boolean; review: { status: string } };
      assert.equal(concludedBody.changed, true);
      assert.equal(concludedBody.review.status, "accepted");
      const accepted = db.query("SELECT status FROM pin_reviews WHERE capture_id = ? AND pin_id = ?").get("session_rev", "pin_rev") as { status: string };
      assert.equal(accepted.status, "accepted");
      const event = db.query(
        "SELECT actor_type, actor_id, origin, from_status, to_status FROM pin_review_events WHERE capture_id = ? AND pin_id = ?",
      ).get("session_rev", "pin_rev") as Record<string, string>;
      assert.equal(event.actor_type, "agent");
      assert.equal(event.actor_id, "key_manage");
      assert.equal(event.origin, "agent_result");
      assert.equal(event.from_status, "open");
      assert.equal(event.to_status, "accepted");

      const twice = await callTool(env, "pinar.conclude_pin", { pinId: "pin_rev", sessionId: "session_rev" }, MANAGE_TOKEN);
      assert.equal(twice.result.isError, true);
      assert.equal(twice.text, "Invalid pin review transition");

      const reopened = await callTool(env, "pinar.reopen_pin", { pinId: "pin_rev", sessionId: "session_rev" }, MANAGE_TOKEN);
      assert.equal(reopened.result.isError, undefined);
      const reopenedBody = JSON.parse(reopened.text) as { changed: boolean; review: { status: string } };
      assert.equal(reopenedBody.changed, true);
      assert.equal(reopenedBody.review.status, "reopened");
      const reopenedRow = db.query("SELECT status FROM pin_reviews WHERE capture_id = ? AND pin_id = ?").get("session_rev", "pin_rev") as { status: string };
      assert.equal(reopenedRow.status, "reopened");

      const reopenedTwice = await callTool(env, "pinar.reopen_pin", { pinId: "pin_rev", sessionId: "session_rev" }, MANAGE_TOKEN);
      assert.equal(reopenedTwice.result.isError, true);
      assert.equal(reopenedTwice.text, "Invalid pin review transition");
    } finally {
      db.close();
    }
  });

  test("scoped keys are barred from organization mutations but may act on their own session", async () => {
    const db = migratedDatabase();
    try {
      const env = await seedMcpWorkspace(db);
      db.query(
        "INSERT INTO sessions (id, url, title, shot_id, shot_url, pin_count, pins_json, created_at, user_id, plan, is_permanent, byte_size, collection_id, position) "
          + "VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?, 'pro', 1, 1, ?, 0)",
      ).run(
        "session_scope",
        "https://example.test/scope",
        "Scoped",
        "session_scope",
        "https://pinar.test/shots/session_scope.png",
        JSON.stringify([{ id: "pin_scope", comment: "Note" }]),
        NOW,
        "usr_mcp",
        "collection_mcp",
      );
      const orgScoped = `pak_${"p".repeat(43)}`;
      db.query(
        "INSERT INTO agent_api_keys (id, account_id, name, token_hash, token_prefix, resource_type, resource_id, permission, expires_at, created_at) "
          + "VALUES (?, ?, ?, ?, ?, 'project', ?, 'manage', ?, ?)",
      ).run("key_org_scope", "usr_mcp", "Org manage", await sha256(orgScoped), orgScoped.slice(0, 12), "project_mcp", LATER, NOW);
      const sessionScoped = `pak_${"d".repeat(43)}`;
      db.query(
        "INSERT INTO agent_api_keys (id, account_id, name, token_hash, token_prefix, resource_type, resource_id, permission, expires_at, created_at) "
          + "VALUES (?, ?, ?, ?, ?, 'session', ?, 'manage', ?, ?)",
      ).run("key_session_scope", "usr_mcp", "Session manage", await sha256(sessionScoped), sessionScoped.slice(0, 12), "session_scope", LATER, NOW);

      const orgDenied = await callTool(env, "pinar.delete_project", { projectId: "project_mcp" }, orgScoped);
      assert.equal(orgDenied.result.isError, true);
      assert.equal(orgDenied.text, "Mutations require an account-scoped key");
      assert.ok(db.query("SELECT * FROM projects WHERE id = ?").get("project_mcp"));

      const batchDenied = await callTool(env, "pinar.finish_batch", { batchId: "batch_del" }, orgScoped);
      assert.equal(batchDenied.result.isError, true);
      assert.equal(batchDenied.text, "Mutations require an account-scoped key");

      const sessionDenied = await callTool(env, "pinar.delete_project", { projectId: "project_mcp" }, sessionScoped);
      assert.equal(sessionDenied.result.isError, true);
      assert.equal(sessionDenied.text, "Mutations require an account-scoped key");

      const scoped = await callTool(env, "pinar.conclude_pin", { pinId: "pin_scope", sessionId: "session_scope" }, sessionScoped);
      assert.equal(scoped.result.isError, undefined);
      const status = db.query("SELECT status FROM pin_reviews WHERE capture_id = ? AND pin_id = ?").get("session_scope", "pin_scope") as { status: string };
      assert.equal(status.status, "accepted");
    } finally {
      db.close();
    }
  });

  test("a revoked key cannot invoke the new mutation tools", async () => {
    const db = migratedDatabase();
    try {
      const env = await seedMcpWorkspace(db);
      const revokedToken = `pak_${"r".repeat(43)}`;
      db.query(
        "INSERT INTO agent_api_keys (id, account_id, name, token_hash, token_prefix, resource_type, resource_id, permission, expires_at, created_at) "
          + "VALUES (?, ?, ?, ?, ?, 'account', NULL, 'manage', ?, ?)",
      ).run("key_revoked", "usr_mcp", "Revoked manage", await sha256(revokedToken), revokedToken.slice(0, 12), LATER, NOW);
      db.query("UPDATE agent_api_keys SET revoked_at = ? WHERE id = ?").run(NOW, "key_revoked");

      const response = await handleCloudApiRequest(request({
        id: 1,
        jsonrpc: "2.0",
        method: "tools/call",
        params: { arguments: { projectId: "project_mcp" }, name: "pinar.delete_project" },
      }, revokedToken), env);
      assert.equal(response.status, 401);
      assert.ok(db.query("SELECT * FROM projects WHERE id = ?").get("project_mcp"));
    } finally {
      db.close();
    }
  });

  test("interleaved principals keep isolated views under fresh per-request gates", async () => {
    const db = migratedDatabase();
    try {
      const env = await seedMcpWorkspace(db);
      const otherToken = `pak_${"q".repeat(43)}`;
      db.query("INSERT INTO users (id, email, plan, ever_paid, billing_status, created_at, updated_at) VALUES (?, ?, 'pro', 1, 'active', ?, ?)").run("usr_mcp2", "mcp2@example.test", NOW, NOW);
      db.query("INSERT INTO projects (id, owner_id, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)").run("project_mcp2", "usr_mcp2", "MCP project 2", NOW, NOW);
      db.query(
        "INSERT INTO agent_api_keys (id, account_id, name, token_hash, token_prefix, resource_type, resource_id, permission, expires_at, created_at) "
          + "VALUES (?, ?, ?, ?, ?, 'account', NULL, 'read', ?, ?)",
      ).run("key_mcp2", "usr_mcp2", "MCP read 2", await sha256(otherToken), otherToken.slice(0, 12), LATER, NOW);

      const projectNames = (result: Awaited<ReturnType<typeof callTool>>) =>
        JSON.parse(result.text).projects.map((project: { name: string }) => project.name);

      for (let round = 0; round < 3; round++) {
        const first = await callTool(env, "pinar.list_projects", {}, TOKEN);
        assert.equal(first.response.status, 200);
        assert.ok(projectNames(first).includes("MCP project"), `round ${round}: principal one must see its project`);
        assert.ok(!projectNames(first).includes("MCP project 2"), `round ${round}: principal one must not see principal two's project`);
        const second = await callTool(env, "pinar.list_projects", {}, otherToken);
        assert.equal(second.response.status, 200);
        assert.ok(projectNames(second).includes("MCP project 2"), `round ${round}: principal two must see its project`);
        assert.ok(!projectNames(second).includes("MCP project"), `round ${round}: principal two must not see principal one's project`);
      }

      const crossRead = await callTool(env, "pinar.get_session_markdown", { sessionId: "session_mcp" }, otherToken);
      assert.equal(crossRead.response.status, 200);
      assert.equal(crossRead.result.isError, true, "cross-principal reads must be denied on the request, not the session");
    } finally {
      db.close();
    }
  });

  test("create_session and update_session complete a metadata-only lifecycle with preserved immutables", async () => {
    const db = migratedDatabase();
    try {
      const env = await seedMcpWorkspace(db);

      const created = await callTool(env, "pinar.create_session", {
        collectionId: "collection_mcp",
        page: { description: "Agent note", title: "Agent session", url: "https://example.test/agent" },
      }, MANAGE_TOKEN);
      assert.equal(created.result.isError, undefined);
      const createdSession = JSON.parse(created.text).session as Record<string, unknown>;
      const sessionId = String(createdSession.id);
      assert.match(sessionId, /^[A-Za-z0-9_-]{12}$/);
      assert.equal(createdSession.includeScreenshot, false);
      assert.equal(createdSession.byteSize, 0);
      const createdPage = createdSession.page as Record<string, unknown>;
      assert.equal(createdPage.title, "Agent session");
      assert.equal(createdPage.description, "Agent note");
      assert.equal(createdPage.url, "https://example.test/agent");
      const createdRow = db.query("SELECT * FROM sessions WHERE id = ?").get(sessionId) as Record<string, unknown>;
      assert.equal(createdRow.byte_size, 0);
      assert.equal(createdRow.include_screenshot, 0);
      assert.equal(createdRow.shot_url, "");
      assert.equal(createdRow.user_id, "usr_mcp");
      assert.equal(createdRow.plan, "pro");
      assert.equal(createdRow.collection_id, "collection_mcp");
      assert.equal(createdRow.created_at, NOW);
      const createdCapture = JSON.parse(String(createdRow.pins_json)) as Record<string, unknown>;
      assert.equal((createdCapture.screenshot as Record<string, unknown>).missing, true);
      assert.equal((createdCapture.screenshot as Record<string, unknown>).url, null);
      assert.ok((createdCapture.warnings as string[]).includes("screenshot_missing"));
      assert.deepEqual((createdCapture.privacy as Record<string, unknown>).redacted, ["unevaluated"]);
      assert.equal((createdCapture.privacy as Record<string, unknown>).unevaluated, true);
      assert.ok(!String(createdRow.pins_json).includes("data:image"), "no screenshot evidence is fabricated");

      const defaulted = await callTool(env, "pinar.create_session", { page: { title: "Defaulted session", url: "https://example.test/default" } }, MANAGE_TOKEN);
      assert.equal(defaulted.result.isError, undefined, "an omitted collectionId still lands in the default destination");
      const defaultedId = String(JSON.parse(defaulted.text).session.id);
      const defaultedRow = db.query("SELECT c.name FROM sessions s JOIN collections c ON c.id = s.collection_id WHERE s.id = ?").get(defaultedId) as { name: string };
      assert.equal(defaultedRow.name, "Inbox", "the default destination is the owner's protected Inbox");

      const listed = await callTool(env, "pinar.list_sessions", { query: "Agent session" }, MANAGE_TOKEN);
      const listedPage = JSON.parse(listed.text) as { sessions: Array<Record<string, unknown>> };
      assert.ok(listedPage.sessions.some((item) => item.id === sessionId), "the new session is listed");

      const markdown = await callTool(env, "pinar.get_session_markdown", { sessionId }, MANAGE_TOKEN);
      assert.equal(markdown.result.isError, undefined);
      assert.match(markdown.text, /Agent session/);
      assert.doesNotMatch(markdown.text, /Screenshot:/, "no phantom screenshot URL as evidence");

      // The clock advances before the update: a mutation that restamps
      // created_at (or resets bytes/position/batch) must now fail.
      setCloudNowForTests(LATER2);
      const updated = await callTool(env, "pinar.update_session", {
        page: { title: "Agent session v2", url: "https://example.test/agent?token=secrettoken123" },
        reproduction: { steps: [{ at: NOW, kind: "navigate", url: "https://example.test/agent" }], version: 1 },
        sessionId,
      }, MANAGE_TOKEN);
      assert.equal(updated.result.isError, undefined);
      const updatedRow = db.query("SELECT * FROM sessions WHERE id = ?").get(sessionId) as Record<string, unknown>;
      assert.equal(updatedRow.title, "Agent session v2");
      assert.equal(decodeURIComponent(String(updatedRow.url)), "https://example.test/agent?token=[redacted]");
      assert.equal(updatedRow.created_at, NOW);
      assert.equal(updatedRow.byte_size, 0);
      assert.equal(updatedRow.include_screenshot, 0);
      assert.equal(updatedRow.shot_url, "");
      assert.equal(updatedRow.plan, "pro");
      const updatedCapture = JSON.parse(String(updatedRow.pins_json)) as Record<string, unknown>;
      assert.equal((updatedCapture.page as Record<string, unknown>).description, "Agent note");
      assert.deepEqual((updatedCapture.privacy as Record<string, unknown>).redacted, ["secret-query", "unevaluated"]);
      assert.equal((updatedCapture.privacy as Record<string, unknown>).unevaluated, true);
      assert.ok((updatedCapture.reproduction as Record<string, unknown>).steps, "the reproduction is persisted through shared validation");
      assert.ok(!String(updatedRow.pins_json).includes("secrettoken123"), "secret values are never stored");

      // A measured session (real screenshot, bytes, position != 0 and batch
      // membership) must keep every creation/owner/storage/screenshot/batch
      // invariant across the update.
      const measuredBatch = await callTool(env, "pinar.create_batch", { label: "Measured batch" }, MANAGE_TOKEN);
      assert.equal(measuredBatch.result.isError, undefined);
      const measuredBatchId = String(JSON.parse(measuredBatch.text).batch.id);
      db.query(
        "INSERT INTO sessions (id, url, title, shot_id, shot_url, pin_count, pins_json, created_at, user_id, plan, is_permanent, byte_size, collection_id, position, include_screenshot, batch_id) "
          + "VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?, 'pro', 1, 4321, ?, 3, 1, ?)",
      ).run(
        "session_meas",
        "https://example.test/measured",
        "Measured page",
        "shot_meas",
        "https://pinar.test/shots/meas.png",
        JSON.stringify({
          captureId: "session_meas",
          page: { title: "Measured page", url: "https://example.test/measured" },
          pins: [{ comment: "Measured note", number: 1, selector: "#submit" }],
          schemaVersion: 1,
          screenshot: { id: "shot_meas", mimeType: "image/png", missing: false, url: "https://pinar.test/shots/meas.png" },
          warnings: [],
        }),
        NOW,
        "usr_mcp",
        "collection_mcp",
        measuredBatchId,
      );
      const measuredUpdate = await callTool(env, "pinar.update_session", { page: { title: "Measured v2" }, sessionId: "session_meas" }, MANAGE_TOKEN);
      assert.equal(measuredUpdate.result.isError, undefined);
      const measuredRow = db.query("SELECT * FROM sessions WHERE id = ?").get("session_meas") as Record<string, unknown>;
      assert.equal(measuredRow.title, "Measured v2");
      assert.equal(measuredRow.created_at, NOW, "the clock has advanced; created_at is not restamped");
      assert.equal(measuredRow.byte_size, 4321, "stored bytes are not reset");
      assert.equal(measuredRow.position, 3, "position is not reset");
      assert.equal(measuredRow.batch_id, measuredBatchId, "batch membership survives the update");
      assert.equal(measuredRow.shot_url, "https://pinar.test/shots/meas.png");
      assert.equal(measuredRow.include_screenshot, 1);
      assert.equal(measuredRow.user_id, "usr_mcp");
      assert.equal(measuredRow.plan, "pro");

      const scopedToken = `pak_${"z".repeat(43)}`;
      db.query(
        "INSERT INTO agent_api_keys (id, account_id, name, token_hash, token_prefix, resource_type, resource_id, permission, expires_at, created_at) "
          + "VALUES (?, ?, ?, ?, ?, 'session', ?, 'manage', ?, ?)",
      ).run("key_session_update", "usr_mcp", "Session update", await sha256(scopedToken), scopedToken.slice(0, 12), sessionId, LATER, NOW);
      const scopedUpdate = await callTool(env, "pinar.update_session", { page: { title: "Scoped title" }, sessionId }, scopedToken);
      assert.equal(scopedUpdate.result.isError, undefined, "a session-scoped manage key may update its covered session like edit_pin_note");
      const scopedRow = db.query("SELECT title, created_at, byte_size FROM sessions WHERE id = ?").get(sessionId) as Record<string, unknown>;
      assert.equal(scopedRow.title, "Scoped title");
      assert.equal(scopedRow.created_at, NOW);
      assert.equal(scopedRow.byte_size, 0);

      const deleted = await callTool(env, "pinar.delete_session", { sessionId }, MANAGE_TOKEN);
      assert.equal(deleted.result.isError, undefined);
      assert.equal(db.query("SELECT * FROM sessions WHERE id = ?").get(sessionId), null);
    } finally {
      db.close();
    }
  });

  test("update_session URL change merges the stored privacy report instead of discarding it", async () => {
    const db = migratedDatabase();
    try {
      const env = await seedMcpWorkspace(db);
      db.query(
        "INSERT INTO sessions (id, url, title, shot_id, shot_url, pin_count, pins_json, created_at, user_id, plan, is_permanent, byte_size, collection_id, position) "
          + "VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?, 'pro', 1, 4321, ?, 0)",
      ).run(
        "session_priv",
        "https://example.test/private?keep=1",
        "Private measured",
        "session_priv",
        "https://pinar.test/shots/session_priv.png",
        JSON.stringify({
          captureId: "session_priv",
          page: { title: "Private measured", url: "https://example.test/private?keep=1" },
          pins: [{ comment: "Secret field", number: 1, selector: "#password" }],
          privacy: { redacted: ["password", "email"], unevaluated: false },
          schemaVersion: 1,
          screenshot: { id: "session_priv", mimeType: "image/png", missing: false, url: "https://pinar.test/shots/session_priv.png" },
          warnings: [],
        }),
        NOW,
        "usr_mcp",
        "collection_mcp",
      );
      const storedPrivacy = () => {
        const row = db.query("SELECT pins_json, url FROM sessions WHERE id = ?").get("session_priv") as { pins_json: string; url: string };
        const capture = JSON.parse(row.pins_json) as Record<string, unknown>;
        return { privacy: capture.privacy as Record<string, unknown> | undefined, url: row.url };
      };
      const before = storedPrivacy();
      assert.deepEqual((before.privacy as Record<string, unknown>).redacted, ["password", "email"]);

      // A title-only update must keep the existing report untouched.
      const titleOnly = await callTool(env, "pinar.update_session", { page: { title: "Private v2" }, sessionId: "session_priv" }, MANAGE_TOKEN);
      assert.equal(titleOnly.result.isError, undefined);
      const afterTitleOnly = storedPrivacy();
      assert.deepEqual((afterTitleOnly.privacy as Record<string, unknown>).redacted, ["password", "email"], "an unchanged URL keeps the screenshot/pin redactions");
      assert.equal((afterTitleOnly.privacy as Record<string, unknown>).unevaluated, false);

      // A URL change joins the new URL's categories to the stored report; the
      // new URL is only sanitized, never inspected, so unevaluated stays true.
      const urlChange = await callTool(env, "pinar.update_session", { page: { url: "https://example.test/private?token=privtok999" }, sessionId: "session_priv" }, MANAGE_TOKEN);
      assert.equal(urlChange.result.isError, undefined);
      const afterUrl = storedPrivacy();
      assert.deepEqual([...(afterUrl.privacy as Record<string, unknown>).redacted].sort(), ["email", "password", "secret-query", "unevaluated"]);
      assert.equal((afterUrl.privacy as Record<string, unknown>).unevaluated, true);
      assert.equal(decodeURIComponent(afterUrl.url), "https://example.test/private?token=[redacted]");
      const privacyRow = db.query("SELECT pins_json FROM sessions WHERE id = ?").get("session_priv") as { pins_json: string };
      assert.ok(!privacyRow.pins_json.includes("privtok999"), "secret values are never stored");
    } finally {
      db.close();
    }
  });

  test("update_session description: explicit empty clears, absence preserves, hostile variants reject without writes", async () => {
    const db = migratedDatabase();
    try {
      const env = await seedMcpWorkspace(db);

      const created = await callTool(env, "pinar.create_session", {
        collectionId: "collection_mcp",
        page: { description: "Original description", title: "Description host", url: "https://example.test/desc" },
      }, MANAGE_TOKEN);
      assert.equal(created.result.isError, undefined);
      const sessionId = String(JSON.parse(created.text).session.id);

      const before = await callTool(env, "pinar.get_session_markdown", { sessionId }, MANAGE_TOKEN);
      assert.match(before.text, /Original description/);

      // An explicit "" clears the stored description (no silent no-op that
      // reads the clear as "no change").
      const cleared = await callTool(env, "pinar.update_session", { page: { description: "" }, sessionId }, MANAGE_TOKEN);
      assert.equal(cleared.result.isError, undefined, "an explicit empty description is a change, not a no-op");
      const clearedMarkdown = await callTool(env, "pinar.get_session_markdown", { sessionId }, MANAGE_TOKEN);
      assert.doesNotMatch(clearedMarkdown.text, /Original description/);
      const listed = await callTool(env, "pinar.list_sessions", { query: "Original description" }, MANAGE_TOKEN);
      assert.equal((JSON.parse(listed.text) as { sessions: unknown[] }).sessions.length, 0, "the cleared description is no longer searchable");

      // Absence leaves the description unchanged; a partial title-only update
      // preserves it.
      const restored = await callTool(env, "pinar.update_session", { page: { description: "Keep me", title: "Description host v2" }, sessionId }, MANAGE_TOKEN);
      assert.equal(restored.result.isError, undefined);
      const titleOnly = await callTool(env, "pinar.update_session", { page: { title: "Description host v3" }, sessionId }, MANAGE_TOKEN);
      assert.equal(titleOnly.result.isError, undefined);
      const preserved = await callTool(env, "pinar.get_session_markdown", { sessionId }, MANAGE_TOKEN);
      assert.match(preserved.text, /Keep me/);
      assert.equal((db.query("SELECT title FROM sessions WHERE id = ?").get(sessionId) as { title: string }).title, "Description host v3");

      // Hostile description variants are rejected without writes.
      const snapshot = () => {
        const row = db.query("SELECT pins_json, title FROM sessions WHERE id = ?").get(sessionId) as { pins_json: string; title: string };
        return { page: (JSON.parse(row.pins_json) as { page: unknown }).page, title: row.title };
      };
      const beforeHostile = snapshot();
      const nonString = await callTool(env, "pinar.update_session", { page: { description: 42, title: "x" }, sessionId }, MANAGE_TOKEN);
      assert.match(nonString.text, /Input validation error/, "the schema rejects a non-string description before the dispatcher");
      const control = await callTool(env, "pinar.update_session", { page: { description: "bad\u0000control", title: "x" }, sessionId }, MANAGE_TOKEN);
      assert.equal(control.text, "description is invalid");
      const oversized = await callTool(env, "pinar.update_session", { page: { description: "x".repeat(2001), title: "x" }, sessionId }, MANAGE_TOKEN);
      assert.match(oversized.text, /Input validation error/, "the schema rejects an oversized description before the dispatcher");
      const emptyPage = await callTool(env, "pinar.update_session", { page: {}, sessionId }, MANAGE_TOKEN);
      assert.equal(emptyPage.text, "No changes provided");
      assert.deepEqual(snapshot(), beforeHostile, "no rejected input may write the session");
    } finally {
      db.close();
    }
  });

  test("create_session and update_session reject invalid inputs and empty changes without writes", async () => {
    const db = migratedDatabase();
    try {
      const env = await seedMcpWorkspace(db);
      const count = () => (db.query("SELECT COUNT(*) AS count FROM sessions").get() as { count: number }).count;
      const baseline = count();
      const validPage = { title: "T", url: "https://example.test/x" };

      const badUrl = await callTool(env, "pinar.create_session", { page: { title: "T", url: "not a url" } }, MANAGE_TOKEN);
      assert.equal(badUrl.result.isError, true);
      assert.equal(badUrl.text, "page.url is invalid");
      const ftp = await callTool(env, "pinar.create_session", { page: { title: "T", url: "ftp://example.test/x" } }, MANAGE_TOKEN);
      assert.equal(ftp.text, "page.url is invalid");
      const credentialed = await callTool(env, "pinar.create_session", { page: { title: "T", url: "https://user:pass@example.test/x" } }, MANAGE_TOKEN);
      assert.equal(credentialed.text, "page.url is invalid");
      const emptyTitle = await callTool(env, "pinar.create_session", { page: { title: "   ", url: "https://example.test/x" } }, MANAGE_TOKEN);
      assert.equal(emptyTitle.text, "title is invalid");
      const longTitle = await callTool(env, "pinar.create_session", { page: { title: "x".repeat(2001), url: "https://example.test/x" } }, MANAGE_TOKEN);
      assert.match(longTitle.text, /Input validation error/);
      assert.match(longTitle.text, /title/);
      const longDescription = await callTool(env, "pinar.create_session", { page: { ...validPage, description: "x".repeat(2001) } }, MANAGE_TOKEN);
      assert.match(longDescription.text, /Input validation error/);
      assert.match(longDescription.text, /description/);
      const callerId = await callTool(env, "pinar.create_session", { id: "caller_chosen_id", page: validPage }, MANAGE_TOKEN);
      assert.equal(callerId.text, "Unexpected argument");
      const extraPageField = await callTool(env, "pinar.create_session", { page: { shotId: "x", ...validPage } }, MANAGE_TOKEN);
      assert.equal(extraPageField.text, "Unexpected argument");
      const missingTitle = await callTool(env, "pinar.create_session", { page: { url: "https://example.test/x" } }, MANAGE_TOKEN);
      assert.match(missingTitle.text, /Input validation error/);
      assert.match(missingTitle.text, /title/);
      db.query("INSERT INTO users (id, email, plan, ever_paid, billing_status, created_at, updated_at) VALUES (?, ?, 'pro', 1, 'active', ?, ?)")
        .run("usr_mcp3", "mcp3@example.test", NOW, NOW);
      db.query("INSERT INTO batches (id, user_id, label, started_at, finished_at) VALUES (?, ?, ?, ?, NULL)")
        .run("batch_other", "usr_mcp3", "Other batch", NOW);
      const unknownBatch = await callTool(env, "pinar.create_session", { batchId: "missing_batch", page: validPage }, MANAGE_TOKEN);
      assert.equal(unknownBatch.text, "Batch not found");
      const foreignBatch = await callTool(env, "pinar.create_session", { batchId: "batch_other", page: validPage }, MANAGE_TOKEN);
      assert.equal(foreignBatch.text, "Batch not found", "another account's batch is not usable even though it exists");
      db.query("INSERT INTO projects (id, owner_id, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)")
        .run("project_mcp3", "usr_mcp3", "Project three", NOW, NOW);
      db.query("INSERT INTO collections (id, project_id, owner_id, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)")
        .run("collection_mcp3", "project_mcp3", "usr_mcp3", "Foreign collection", NOW, NOW);
      const unknownCollection = await callTool(env, "pinar.create_session", { collectionId: "nope_collection_id", page: validPage }, MANAGE_TOKEN);
      assert.equal(unknownCollection.text, "Collection not found");
      const foreignCollection = await callTool(env, "pinar.create_session", { collectionId: "collection_mcp3", page: validPage }, MANAGE_TOKEN);
      assert.equal(foreignCollection.text, "Collection not found", "a foreign collection rejects before any write instead of falling back");

      const emptyUpdate = await callTool(env, "pinar.update_session", { sessionId: "session_mcp" }, MANAGE_TOKEN);
      assert.equal(emptyUpdate.text, "No changes provided");
      const emptyPageUpdate = await callTool(env, "pinar.update_session", { page: {}, sessionId: "session_mcp" }, MANAGE_TOKEN);
      assert.equal(emptyPageUpdate.text, "No changes provided");
      const unknownSession = await callTool(env, "pinar.update_session", { page: { title: "Nope" }, sessionId: "nope_session_id" }, MANAGE_TOKEN);
      assert.equal(unknownSession.text, "Session not found");
      const stringReproduction = await callTool(env, "pinar.update_session", { reproduction: "nope", sessionId: "session_mcp" }, MANAGE_TOKEN);
      assert.match(stringReproduction.text, /Input validation error/);
      const badReproductionVersion = await callTool(env, "pinar.update_session", { reproduction: { steps: [{ at: NOW, kind: "navigate" }], version: 9 }, sessionId: "session_mcp" }, MANAGE_TOKEN);
      assert.equal(badReproductionVersion.text, "reproduction is invalid");
      const emptyReproduction = await callTool(env, "pinar.update_session", { reproduction: { steps: [], version: 1 }, sessionId: "session_mcp" }, MANAGE_TOKEN);
      assert.equal(emptyReproduction.text, "reproduction is invalid");
      const badUpdateUrl = await callTool(env, "pinar.update_session", { page: { url: "https://user:pass@example.test/x" }, sessionId: "session_mcp" }, MANAGE_TOKEN);
      assert.equal(badUpdateUrl.text, "page.url is invalid");
      const extraUpdateArg = await callTool(env, "pinar.update_session", { batchId: "batch_other", sessionId: "session_mcp" }, MANAGE_TOKEN);
      assert.equal(extraUpdateArg.text, "Unexpected argument");

      assert.equal(count(), baseline, "no rejected input may write a session");
      assert.equal((db.query("SELECT COUNT(*) AS count FROM sessions WHERE collection_id = ?").get("collection_mcp") as { count: number }).count, 1, "the existing destination is unchanged");
      assert.equal((db.query("SELECT COUNT(*) AS count FROM collections WHERE owner_id = ? AND is_protected = 1").get("usr_mcp") as { count: number }).count, 0, "no silent Inbox fallback may be created");
      const mcpRow = db.query("SELECT title, url FROM sessions WHERE id = ?").get("session_mcp") as { title: string; url: string };
      assert.equal(mcpRow.title, "Private MCP page");
      assert.equal(mcpRow.url, "https://example.test/mcp");
    } finally {
      db.close();
    }
  });

  test("create_session and update_session reject an explicit empty destination or title without writes", async () => {
    const db = migratedDatabase();
    try {
      const env = await seedMcpWorkspace(db);

      const created = await callTool(env, "pinar.create_session", {
        collectionId: "collection_mcp",
        page: { description: "Original description", title: "Original title", url: "https://example.test/orig" },
      }, MANAGE_TOKEN);
      assert.equal(created.result.isError, undefined);
      const sessionId = String(JSON.parse(created.text).session.id);

      const state = () => JSON.stringify({
        sessions: db.query("SELECT * FROM sessions ORDER BY id").all(),
        batches: db.query("SELECT * FROM batches ORDER BY id").all(),
        reviews: db.query("SELECT * FROM pin_reviews ORDER BY capture_id, pin_id").all(),
        events: db.query("SELECT * FROM pin_review_events ORDER BY id").all(),
      });
      const pageOf = () => {
        const row = db.query("SELECT pins_json FROM sessions WHERE id = ?").get(sessionId) as { pins_json: string };
        return (JSON.parse(row.pins_json) as { page: Record<string, unknown> }).page;
      };

      // update_session: an explicit "" title rejects the whole update even
      // though a valid description is also present; nothing is written.
      const beforeUpdate = state();
      const emptyTitle = await callTool(env, "pinar.update_session", { page: { description: "Changed description", title: "" }, sessionId }, MANAGE_TOKEN);
      assert.equal(emptyTitle.result.isError, true);
      assert.equal(emptyTitle.text, "title is invalid");
      assert.equal(state(), beforeUpdate, "the rejected update writes nothing");
      assert.deepEqual(pageOf(), { description: "Original description", title: "Original title", url: "https://example.test/orig" });

      // Controls: whitespace still rejects, null is a schema error, and the
      // rejected variants still write nothing.
      const blankTitle = await callTool(env, "pinar.update_session", { page: { description: "Changed via blank", title: "   " }, sessionId }, MANAGE_TOKEN);
      assert.equal(blankTitle.result.isError, true);
      assert.equal(blankTitle.text, "title is invalid");
      const nullTitle = await callTool(env, "pinar.update_session", { page: { description: "Changed via null", title: null }, sessionId }, MANAGE_TOKEN);
      assert.equal(nullTitle.result.isError, true);
      assert.match(nullTitle.text, /Input validation error/);
      assert.match(nullTitle.text, /title/);
      assert.equal(state(), beforeUpdate, "whitespace and null titles write nothing");

      // Controls: an omitted title still applies the description, and a
      // valid title still updates.
      const omittedTitle = await callTool(env, "pinar.update_session", { page: { description: "Only description" }, sessionId }, MANAGE_TOKEN);
      assert.equal(omittedTitle.result.isError, undefined, "an omitted title still applies the description");
      assert.equal(pageOf().description, "Only description");
      assert.equal(pageOf().title, "Original title");
      const validTitle = await callTool(env, "pinar.update_session", { page: { title: "New title" }, sessionId }, MANAGE_TOKEN);
      assert.equal(validTitle.result.isError, undefined, "a valid title still updates");
      assert.equal(pageOf().title, "New title");

      // create_session: explicit "" collectionId / batchId reject before any
      // write instead of falling back to the default destination.
      const beforeCreate = state();
      const emptyCollection = await callTool(env, "pinar.create_session", { collectionId: "", page: { title: "T empty collection", url: "https://example.test/x" } }, MANAGE_TOKEN);
      assert.equal(emptyCollection.result.isError, true);
      assert.equal(emptyCollection.text, "collectionId is invalid");
      const emptyBatch = await callTool(env, "pinar.create_session", { batchId: "", page: { title: "T empty batch", url: "https://example.test/x" } }, MANAGE_TOKEN);
      assert.equal(emptyBatch.result.isError, true);
      assert.equal(emptyBatch.text, "batchId is invalid");
      const blankCollection = await callTool(env, "pinar.create_session", { collectionId: "   ", page: { title: "T blank collection", url: "https://example.test/x" } }, MANAGE_TOKEN);
      assert.equal(blankCollection.result.isError, true);
      assert.equal(blankCollection.text, "collectionId is invalid");
      const nullCollection = await callTool(env, "pinar.create_session", { collectionId: null, page: { title: "T null collection", url: "https://example.test/x" } }, MANAGE_TOKEN);
      assert.equal(nullCollection.result.isError, true);
      assert.match(nullCollection.text, /Input validation error/);
      assert.match(nullCollection.text, /collectionId/);
      const nullBatch = await callTool(env, "pinar.create_session", { batchId: null, page: { title: "T null batch", url: "https://example.test/x" } }, MANAGE_TOKEN);
      assert.equal(nullBatch.result.isError, true);
      assert.match(nullBatch.text, /Input validation error/);
      assert.match(nullBatch.text, /batchId/);
      assert.equal(state(), beforeCreate, "no empty destination may create a session");

      // Control: only omitted destinations use the default collection and no
      // batch.
      const noDestination = await callTool(env, "pinar.create_session", { page: { title: "T omitted", url: "https://example.test/x" } }, MANAGE_TOKEN);
      assert.equal(noDestination.result.isError, undefined, "an omitted destination still uses the default");
      const noDestinationRow = db.query("SELECT collection_id, batch_id FROM sessions WHERE id = ?").get(String(JSON.parse(noDestination.text).session.id)) as { collection_id: string; batch_id: string | null };
      assert.ok(noDestinationRow.collection_id);
      assert.equal(noDestinationRow.batch_id, null);
      const collectionOnly = await callTool(env, "pinar.create_session", { collectionId: "collection_mcp", page: { title: "T omitted batch", url: "https://example.test/x" } }, MANAGE_TOKEN);
      assert.equal(collectionOnly.result.isError, undefined, "an omitted batch still creates the session without a batch");
      assert.equal((db.query("SELECT batch_id FROM sessions WHERE id = ?").get(String(JSON.parse(collectionOnly.text).session.id)) as { batch_id: string | null }).batch_id, null);
    } finally {
      db.close();
    }
  });

  test("create_session and update_session enforce the organization and session scopes", async () => {
    const db = migratedDatabase();
    try {
      const env = await seedMcpWorkspace(db);
      db.query(
        "INSERT INTO sessions (id, url, title, shot_id, shot_url, pin_count, pins_json, created_at, user_id, plan, is_permanent, byte_size, collection_id, position) "
          + "VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?, 'pro', 1, 1, ?, 0)",
      ).run(
        "session_scope_two",
        "https://example.test/scope-two",
        "Scope two",
        "session_scope_two",
        "https://pinar.test/shots/session_scope_two.png",
        JSON.stringify([{ id: "pin_scope_two", comment: "Note" }]),
        NOW,
        "usr_mcp",
        "collection_mcp",
      );
      const sessionGateToken = `pak_${"g".repeat(43)}`;
      db.query(
        "INSERT INTO agent_api_keys (id, account_id, name, token_hash, token_prefix, resource_type, resource_id, permission, expires_at, created_at) "
          + "VALUES (?, ?, ?, ?, ?, 'session', ?, 'manage', ?, ?)",
      ).run("key_session_gate", "usr_mcp", "Session gate", await sha256(sessionGateToken), sessionGateToken.slice(0, 12), "session_mcp", LATER, NOW);
      const foreignToken = `pak_${"f".repeat(43)}`;
      db.query("INSERT INTO users (id, email, plan, ever_paid, billing_status, created_at, updated_at) VALUES (?, ?, 'pro', 1, 'active', ?, ?)")
        .run("usr_mcp4", "mcp4@example.test", NOW, NOW);
      db.query(
        "INSERT INTO agent_api_keys (id, account_id, name, token_hash, token_prefix, resource_type, resource_id, permission, expires_at, created_at) "
          + "VALUES (?, ?, ?, ?, ?, 'account', NULL, 'manage', ?, ?)",
      ).run("key_foreign", "usr_mcp4", "Foreign manage", await sha256(foreignToken), foreignToken.slice(0, 12), LATER, NOW);

      const validPage = { title: "T", url: "https://example.test/x" };
      const readDenied = await callTool(env, "pinar.create_session", { page: validPage }, TOKEN);
      assert.equal(readDenied.text, "manage permission required");
      const shareDenied = await callTool(env, "pinar.create_session", { page: validPage }, SHARE_TOKEN);
      assert.equal(shareDenied.text, "manage permission required");
      const scopedCreate = await callTool(env, "pinar.create_session", { page: validPage }, sessionGateToken);
      assert.equal(scopedCreate.text, "Mutations require an account-scoped key");

      const updateReadDenied = await callTool(env, "pinar.update_session", { page: { title: "Nope" }, sessionId: "session_mcp" }, TOKEN);
      assert.equal(updateReadDenied.text, "manage permission required");
      const crossScoped = await callTool(env, "pinar.update_session", { page: { title: "Nope" }, sessionId: "session_scope_two" }, sessionGateToken);
      assert.equal(crossScoped.text, "Resource not found");
      const foreignDenied = await callTool(env, "pinar.update_session", { page: { title: "Nope" }, sessionId: "session_mcp" }, foreignToken);
      assert.equal(foreignDenied.text, "Session not found", "another account's key is scoped out by the owner lookup");

      assert.equal((db.query("SELECT COUNT(*) AS count FROM sessions").get() as { count: number }).count, 2, "denied calls must not write");
      assert.equal((db.query("SELECT title FROM sessions WHERE id = ?").get("session_mcp") as { title: string }).title, "Private MCP page");

      const scopedUpdate = await callTool(env, "pinar.update_session", { page: { title: "Scoped title" }, sessionId: "session_mcp" }, sessionGateToken);
      assert.equal(scopedUpdate.result.isError, undefined, "a session-scoped manage key may update its covered session");
      assert.equal((db.query("SELECT title FROM sessions WHERE id = ?").get("session_mcp") as { title: string }).title, "Scoped title");

      const revokedToken = `pak_${"w".repeat(43)}`;
      db.query(
        "INSERT INTO agent_api_keys (id, account_id, name, token_hash, token_prefix, resource_type, resource_id, permission, expires_at, created_at) "
          + "VALUES (?, ?, ?, ?, ?, 'account', NULL, 'manage', ?, ?)",
      ).run("key_revoked_session", "usr_mcp", "Revoked session", await sha256(revokedToken), revokedToken.slice(0, 12), LATER, NOW);
      db.query("UPDATE agent_api_keys SET revoked_at = ? WHERE id = ?").run(NOW, "key_revoked_session");
      const revokedResponse = await handleCloudApiRequest(request({
        id: 1,
        jsonrpc: "2.0",
        method: "tools/call",
        params: { arguments: { page: validPage }, name: "pinar.create_session" },
      }, revokedToken), env);
      assert.equal(revokedResponse.status, 401, "a revoked key is barred before dispatch");
      assert.equal((db.query("SELECT COUNT(*) AS count FROM sessions").get() as { count: number }).count, 2);
    } finally {
      db.close();
    }
  });

  test("MCP keys are pro-gated at the endpoint; the quota gate blocks create and zero-byte updates pass", async () => {
    const freeDb = migratedDatabase();
    const quotaDb = migratedDatabase();
    try {
      // A free account with an expired trial cannot reach the MCP endpoint at
      // all: authenticateAgentKeyContext requires the pro plan, and the trial
      // window only gates free-plan uploads. The blocked-trial branch is
      // therefore unreachable through MCP; this asserts the observed 401.
      const freeToken = `pak_${"t".repeat(43)}`;
      freeDb.query(
        "INSERT INTO users (id, email, plan, ever_paid, billing_status, cloud_trial_started_at, cloud_trial_ends_at, created_at, updated_at) "
          + "VALUES (?, ?, 'free', 0, 'active', ?, ?, ?, ?)",
      ).run("usr_trial", "trial@example.test", "2026-09-01T00:00:00.000Z", "2026-09-15T00:00:00.000Z", NOW, NOW);
      freeDb.query(
        "INSERT INTO agent_api_keys (id, account_id, name, token_hash, token_prefix, resource_type, resource_id, permission, expires_at, created_at) "
          + "VALUES (?, ?, ?, ?, ?, 'account', NULL, 'manage', ?, ?)",
      ).run("key_trial", "usr_trial", "Trial manage", await sha256(freeToken), freeToken.slice(0, 12), LATER, NOW);
      const freeEnv: CloudEnv = { CLOUD_TRIAL_ENABLED: "true", DB: sqliteD1(freeDb), DEPLOYMENT_ENV: "production" };
      const denied = await handleCloudApiRequest(request({ id: 0, jsonrpc: "2.0", method: "initialize", params: INITIALIZE_PARAMS }, freeToken), freeEnv);
      assert.equal(denied.status, 401, "a free account's agent key is barred from the MCP endpoint");
      assert.equal((freeDb.query("SELECT COUNT(*) AS count FROM sessions").get() as { count: number }).count, 0);

      // Pro account with an expired trial window: the trial never gates a
      // paid plan, so the write goes through and the quota is the real gate.
      const quotaToken = `pak_${"q".repeat(43)}`;
      quotaDb.query(
        "INSERT INTO users (id, email, plan, ever_paid, billing_status, cloud_trial_started_at, cloud_trial_ends_at, created_at, updated_at) "
          + "VALUES (?, ?, 'pro', 1, 'active', ?, ?, ?, ?)",
      ).run("usr_quota", "quota@example.test", "2026-09-01T00:00:00.000Z", "2026-09-15T00:00:00.000Z", NOW, NOW);
      quotaDb.query("INSERT INTO projects (id, owner_id, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)")
        .run("project_quota", "usr_quota", "Quota project", NOW, NOW);
      quotaDb.query("INSERT INTO collections (id, project_id, owner_id, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)")
        .run("collection_quota", "project_quota", "usr_quota", "Quota collection", NOW, NOW);
      quotaDb.query(
        "INSERT INTO sessions (id, url, title, shot_id, shot_url, pin_count, pins_json, created_at, user_id, plan, is_permanent, byte_size, collection_id, position) "
          + "VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?, 'pro', 1, ?, ?, 0)",
      ).run(
        "session_big",
        "https://example.test/big",
        "Big",
        "session_big",
        "https://pinar.test/shots/session_big.png",
        "[]",
        NOW,
        "usr_quota",
        PAID_STORAGE_BYTES + 1,
        "collection_quota",
      );
      quotaDb.query(
        "INSERT INTO agent_api_keys (id, account_id, name, token_hash, token_prefix, resource_type, resource_id, permission, expires_at, created_at) "
          + "VALUES (?, ?, ?, ?, ?, 'account', NULL, 'manage', ?, ?)",
      ).run("key_quota", "usr_quota", "Quota manage", await sha256(quotaToken), quotaToken.slice(0, 12), LATER, NOW);
      const quotaEnv = envFor(quotaDb);

      const quotaDenied = await callTool(quotaEnv, "pinar.create_session", { page: { title: "T", url: "https://example.test/quota" } }, quotaToken);
      assert.equal(quotaDenied.text, "Storage quota exceeded");
      assert.equal((quotaDb.query("SELECT COUNT(*) AS count FROM sessions WHERE user_id = ?").get("usr_quota") as { count: number }).count, 1);

      const quotaUpdate = await callTool(quotaEnv, "pinar.update_session", { page: { title: "Big v2" }, sessionId: "session_big" }, quotaToken);
      assert.equal(quotaUpdate.result.isError, undefined, "a zero-byte metadata update does not consume storage");
      assert.equal((quotaDb.query("SELECT title FROM sessions WHERE id = ?").get("session_big") as { title: string }).title, "Big v2");
    } finally {
      freeDb.close();
      quotaDb.close();
    }
  });

  test("pin tools complete a note lifecycle from an agent-created session", async () => {
    const db = migratedDatabase();
    try {
      const env = await seedMcpWorkspace(db);

      // The lifecycle starts from an actual agent-created metadata session.
      const session = await callTool(env, "pinar.create_session", {
        collectionId: "collection_mcp",
        page: { title: "Pin host", url: "https://example.test/pins" },
      }, MANAGE_TOKEN);
      assert.equal(session.result.isError, undefined);
      const sessionId = String(JSON.parse(session.text).session.id);
      const before = db.query("SELECT position FROM sessions WHERE id = ?").get(sessionId) as { position: number };

      const first = await callTool(env, "pinar.create_pin", {
        comment: "First note",
        locator: { innerText: "Save" },
        sessionId,
      }, MANAGE_TOKEN);
      assert.equal(first.result.isError, undefined);
      const firstPin = (JSON.parse(first.text) as { pin: Record<string, unknown> }).pin;
      assert.match(String(firstPin.id), /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/, "server-generated UUID");
      assert.equal(firstPin.number, 1);
      assert.equal(firstPin.comment, "First note");
      assert.equal((firstPin.location as Record<string, unknown>).confidence, "unresolved", "no measured geometry is claimed");
      assert.equal((firstPin.location as Record<string, unknown>).strategy, "none");
      assert.equal((firstPin.location as Record<string, unknown>).score, 0);
      assert.equal((firstPin.locator as Record<string, unknown>).innerText, "Save");
      assert.equal(firstPin.reviewStatus, "open");
      assert.ok(!first.text.includes("data:"));
      const firstId = String(firstPin.id);

      const second = await callTool(env, "pinar.create_pin", {
        comment: "Second note",
        locator: { cssSelector: "#save", domPath: "html > body > button" },
        sessionId,
      }, MANAGE_TOKEN);
      assert.equal(second.result.isError, undefined);
      const secondPin = (JSON.parse(second.text) as { pin: Record<string, unknown> }).pin;
      const secondId = String(secondPin.id);
      assert.notEqual(secondId, firstId, "ids are stable and unique");
      assert.equal(secondPin.number, 2);
      const storedCapture = JSON.parse(String((db.query("SELECT pins_json FROM sessions WHERE id = ?").get(sessionId) as { pins_json: string }).pins_json)) as { pins: Array<Record<string, unknown>> } | Array<Record<string, unknown>>;
      const storedPins = Array.isArray(storedCapture) ? storedCapture : storedCapture.pins;
      assert.equal(storedPins.find((pin) => pin.number === 1)?.color, "#0069A8", "the palette color at the number is assigned when it does not collide");

      const listed = await callTool(env, "pinar.list_pins", { sessionId }, TOKEN);
      assert.equal(listed.result.isError, undefined);
      const listedBody = JSON.parse(listed.text) as { limit: number; offset: number; pins: Array<Record<string, unknown>> };
      assert.equal(listedBody.pins.length, 2);
      assert.deepEqual(Object.keys(listedBody.pins[0]).sort(), ["comment", "id", "location", "locator", "number", "reviewStatus"]);
      assert.ok(!listed.text.includes("data:"));
      assert.equal(listedBody.pins[0].reviewStatus, "open");

      const paged = await callTool(env, "pinar.list_pins", { limit: 1, offset: 1, sessionId }, TOKEN);
      const pagedBody = JSON.parse(paged.text) as { pins: Array<Record<string, unknown>> };
      assert.equal(pagedBody.pins.length, 1);
      assert.equal(pagedBody.pins[0].id, secondId);

      const got = await callTool(env, "pinar.get_pin", { pinId: firstId, sessionId }, TOKEN);
      assert.equal(got.result.isError, undefined);
      const gotPin = (JSON.parse(got.text) as { pin: Record<string, unknown> }).pin;
      assert.equal(gotPin.id, firstId);
      assert.equal(gotPin.comment, "First note");

      // Conversation and review on pin one, plus an execution audit that
      // references it, then delete pin one: its current reviews, events and
      // comments go with it; the audit and the remaining pin survive.
      const comment = await callTool(env, "pinar.add_pin_comment", { body: "On the first note", pinId: firstId, sessionId }, MANAGE_TOKEN);
      assert.equal(comment.result.isError, undefined);
      const concluded = await callTool(env, "pinar.conclude_pin", { pinId: firstId, sessionId }, MANAGE_TOKEN);
      assert.equal((JSON.parse(concluded.text) as { changed: boolean }).changed, true);
      db.query(
        "INSERT INTO agent_executions (id, idempotency_key, capture_id, agent, created_at, owner_id, payload_hash) VALUES (?, ?, ?, ?, ?, ?, ?)",
      ).run("exec_pins_1", "idem_pins_1", sessionId, "cursor", NOW, "usr_mcp", "hash_pins_1");
      db.query(
        "INSERT INTO agent_pin_results (id, execution_id, pin_id, status, summary, files_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      ).run("res_pins_1", "exec_pins_1", firstId, "changed", "Fixed the note", "[]", NOW);

      const deleted = await callTool(env, "pinar.delete_pin", { pinId: firstId, sessionId }, MANAGE_TOKEN);
      assert.equal(deleted.result.isError, undefined);
      assert.equal((db.query("SELECT COUNT(*) AS count FROM pin_reviews WHERE capture_id = ? AND pin_id = ?").get(sessionId, firstId) as { count: number }).count, 0);
      assert.equal((db.query("SELECT COUNT(*) AS count FROM pin_review_events WHERE capture_id = ? AND pin_id = ?").get(sessionId, firstId) as { count: number }).count, 0);
      assert.equal((db.query("SELECT COUNT(*) AS count FROM pin_comments WHERE capture_id = ? AND pin_id = ?").get(sessionId, firstId) as { count: number }).count, 0);
      assert.equal((db.query("SELECT COUNT(*) AS count FROM agent_pin_results WHERE pin_id = ?").get(firstId) as { count: number }).count, 1, "the execution audit is preserved");

      const afterDelete = await callTool(env, "pinar.list_pins", { sessionId }, TOKEN);
      const afterBody = JSON.parse(afterDelete.text) as { pins: Array<Record<string, unknown>> };
      assert.equal(afterBody.pins.length, 1);
      assert.equal(afterBody.pins[0].id, secondId);
      assert.equal(afterBody.pins[0].number, 2, "remaining numbers are preserved, not renumbered");
      const row = db.query("SELECT * FROM sessions WHERE id = ?").get(sessionId) as Record<string, unknown>;
      assert.equal(row.pin_count, 1);
      assert.ok(!String(row.pins_json).includes("First note"));
      assert.ok(!String(row.pins_json).includes(firstId));
      assert.equal(row.user_id, "usr_mcp");
      assert.equal(row.plan, "pro");
      assert.equal(row.byte_size, 0);
      assert.equal(row.collection_id, "collection_mcp");
      assert.equal(row.created_at, NOW);
      assert.equal(row.position, before.position);

      const goneRead = await callTool(env, "pinar.get_pin", { pinId: firstId, sessionId }, TOKEN);
      assert.equal(goneRead.text, "Resource not found");
      const goneNote = await callTool(env, "pinar.edit_pin_note", { comment: "Late note", pinId: firstId, sessionId }, MANAGE_TOKEN);
      assert.equal(goneNote.text, "Pin not found");
      const goneComment = await callTool(env, "pinar.add_pin_comment", { body: "Late comment", pinId: firstId, sessionId }, MANAGE_TOKEN);
      assert.equal(goneComment.text, "Pin not found");

      const markdown = await callTool(env, "pinar.get_session_markdown", { sessionId }, MANAGE_TOKEN);
      assert.equal(markdown.result.isError, undefined);
      assert.match(markdown.text, /Second note/);
      assert.doesNotMatch(markdown.text, /First note/, "the deleted pin does not reappear in the live pin blocks");
      assert.match(markdown.text, /## Agent results/, "the execution audit still renders");
      assert.doesNotMatch(markdown.text, /Screenshot:/, "the honest absence is preserved after deletion");
    } finally {
      db.close();
    }
  });

  test("legacy captureId:pN pin ids work across every pin operation", async () => {
    const db = migratedDatabase();
    try {
      const env = await seedMcpWorkspace(db);
      db.query(
        "INSERT INTO sessions (id, url, title, shot_id, shot_url, pin_count, pins_json, created_at, user_id, plan, is_permanent, byte_size, collection_id, position) "
          + "VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?, 'pro', 1, 1, ?, 0)",
      ).run(
        "session_legacy",
        "https://example.test/legacy",
        "Legacy",
        "session_legacy",
        "https://pinar.test/shots/session_legacy.png",
        JSON.stringify([{ comment: "Legacy note", number: 1 }]),
        NOW,
        "usr_mcp",
        "collection_mcp",
      );

      const listed = await callTool(env, "pinar.list_pins", { sessionId: "session_legacy" }, TOKEN);
      const listedBody = JSON.parse(listed.text) as { pins: Array<Record<string, unknown>> };
      assert.equal(listedBody.pins[0].id, "session_legacy:p1", "the shared parser's legacy id is the pin identity");

      const note = await callTool(env, "pinar.edit_pin_note", { comment: "Edited legacy note", pinId: "session_legacy:p1", sessionId: "session_legacy" }, MANAGE_TOKEN);
      assert.equal(note.result.isError, undefined);

      const added = await callTool(env, "pinar.add_pin_comment", { body: "Legacy comment", pinId: "session_legacy:p1", sessionId: "session_legacy" }, MANAGE_TOKEN);
      assert.equal(added.result.isError, undefined);
      const commentId = String((JSON.parse(added.text) as { comment: { id: string } }).comment.id);
      const listedComments = await callTool(env, "pinar.list_pin_comments", { pinId: "session_legacy:p1", sessionId: "session_legacy" }, TOKEN);
      assert.equal((JSON.parse(listedComments.text) as { comments: unknown[] }).comments.length, 1);
      const editedComment = await callTool(env, "pinar.edit_pin_comment", { body: "Legacy comment v2", commentId, pinId: "session_legacy:p1", sessionId: "session_legacy" }, MANAGE_TOKEN);
      assert.equal(editedComment.result.isError, undefined);
      const deletedComment = await callTool(env, "pinar.delete_pin_comment", { commentId, pinId: "session_legacy:p1", sessionId: "session_legacy" }, MANAGE_TOKEN);
      assert.equal(deletedComment.result.isError, undefined);

      const concluded = await callTool(env, "pinar.conclude_pin", { pinId: "session_legacy:p1", sessionId: "session_legacy" }, MANAGE_TOKEN);
      assert.equal((JSON.parse(concluded.text) as { changed: boolean }).changed, true);
      const reopened = await callTool(env, "pinar.reopen_pin", { pinId: "session_legacy:p1", sessionId: "session_legacy" }, MANAGE_TOKEN);
      assert.equal((JSON.parse(reopened.text) as { changed: boolean }).changed, true);

      const got = await callTool(env, "pinar.get_pin", { pinId: "session_legacy:p1", sessionId: "session_legacy" }, TOKEN);
      const gotBody = JSON.parse(got.text) as { pin: Record<string, unknown> };
      assert.equal(gotBody.pin.id, "session_legacy:p1");
      assert.equal(gotBody.pin.reviewStatus, "reopened");

      const deletedPin = await callTool(env, "pinar.delete_pin", { pinId: "session_legacy:p1", sessionId: "session_legacy" }, MANAGE_TOKEN);
      assert.equal(deletedPin.result.isError, undefined);
      assert.equal((db.query("SELECT COUNT(*) AS count FROM pin_reviews WHERE capture_id = ? AND pin_id = ?").get("session_legacy", "session_legacy:p1") as { count: number }).count, 0);
      const afterDelete = await callTool(env, "pinar.list_pins", { sessionId: "session_legacy" }, TOKEN);
      assert.equal((JSON.parse(afterDelete.text) as { pins: unknown[] }).pins.length, 0);

      // Color: when the palette color at the next number is already used by
      // another pin, the new pin omits the color rather than duplicating the
      // extension palette.
      db.query(
        "INSERT INTO sessions (id, url, title, shot_id, shot_url, pin_count, pins_json, created_at, user_id, plan, is_permanent, byte_size, collection_id, position) "
          + "VALUES (?, ?, ?, ?, ?, 2, ?, ?, ?, 'pro', 1, 1, ?, 0)",
      ).run(
        "session_colors",
        "https://example.test/colors",
        "Colors",
        "session_colors",
        "https://pinar.test/shots/session_colors.png",
        JSON.stringify([{ comment: "a", number: 1 }, { comment: "b", number: 2, color: "#0F766E" }]),
        NOW,
        "usr_mcp",
        "collection_mcp",
      );
      const colorPin = await callTool(env, "pinar.create_pin", { comment: "Collision note", sessionId: "session_colors" }, MANAGE_TOKEN);
      assert.equal(colorPin.result.isError, undefined);
      assert.equal((JSON.parse(colorPin.text) as { pin: Record<string, unknown> }).pin.number, 3);
      const colorRow = db.query("SELECT pins_json FROM sessions WHERE id = ?").get("session_colors") as { pins_json: string };
      const colorCapture = JSON.parse(colorRow.pins_json) as { pins: Array<Record<string, unknown>> } | Array<Record<string, unknown>>;
      const colorPins = Array.isArray(colorCapture) ? colorCapture : colorCapture.pins;
      assert.equal(colorPins.find((pin) => pin.number === 3)?.color, undefined, "the colliding palette color is omitted, not duplicated");

      // Membership is still enforced for the legacy form: a syntactically valid
      // id from another capture is rejected, and malformed numbers are not
      // parsed permissively. Session-scoped resources stay strict.
      const foreign = await callTool(env, "pinar.get_pin", { pinId: "other_capture_id:p1", sessionId: "session_legacy" }, TOKEN);
      assert.equal(foreign.text, "Resource not found");
      const badNumber = await callTool(env, "pinar.conclude_pin", { pinId: "session_legacy:p1x", sessionId: "session_legacy" }, MANAGE_TOKEN);
      assert.equal(badNumber.text, "pinId is invalid");
      const longNumber = await callTool(env, "pinar.get_pin", { pinId: "session_legacy:p1234567", sessionId: "session_legacy" }, TOKEN);
      assert.equal(longNumber.text, "pinId is invalid");
      const strictComment = await callTool(env, "pinar.edit_pin_comment", { body: "x", commentId: `${commentId}:p1`, pinId: "session_legacy:p1", sessionId: "session_legacy" }, MANAGE_TOKEN);
      assert.equal(strictComment.text, "commentId is invalid");
    } finally {
      db.close();
    }
  });

  test("pin tools enforce read/manage gates, scoped keys and ownership", async () => {
    const db = migratedDatabase();
    try {
      const env = await seedMcpWorkspace(db);
      db.query("INSERT INTO users (id, email, plan, ever_paid, billing_status, created_at, updated_at) VALUES (?, ?, 'pro', 1, 'active', ?, ?)")
        .run("usr_pins3", "pins3@example.test", NOW, NOW);
      db.query("INSERT INTO projects (id, owner_id, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)")
        .run("project_pins3", "usr_pins3", "Pins project three", NOW, NOW);
      db.query("INSERT INTO collections (id, project_id, owner_id, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)")
        .run("collection_pins3", "project_pins3", "usr_pins3", "Pins collection three", NOW, NOW);
      db.query(
        "INSERT INTO sessions (id, url, title, shot_id, shot_url, pin_count, pins_json, created_at, user_id, plan, is_permanent, byte_size, collection_id, position) "
          + "VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?, 'pro', 1, 1, ?, 0)",
      ).run(
        "session_pins3",
        "https://example.test/pins3",
        "Foreign pins",
        "session_pins3",
        "https://pinar.test/shots/session_pins3.png",
        JSON.stringify([{ comment: "foreign note", number: 1 }]),
        NOW,
        "usr_pins3",
        "collection_pins3",
      );

      // Reads need read permission: share keys are barred, reads are scoped to
      // the owner.
      const shareRead = await callTool(env, "pinar.list_pins", { sessionId: "session_mcp" }, SHARE_TOKEN);
      assert.equal(shareRead.text, "read permission required");
      const readOk = await callTool(env, "pinar.list_pins", { sessionId: "session_mcp" }, TOKEN);
      assert.equal(readOk.result.isError, undefined);
      const foreignRead = await callTool(env, "pinar.get_pin", { pinId: "session_pins3:p1", sessionId: "session_pins3" }, TOKEN);
      assert.equal(foreignRead.text, "Resource not found");

      // Mutations need manage: a read key is barred, a foreign owner's session
      // is not writable, and nothing is written.
      const readCreate = await callTool(env, "pinar.create_pin", { comment: "x", sessionId: "session_mcp" }, TOKEN);
      assert.equal(readCreate.text, "manage permission required");
      const foreignCreate = await callTool(env, "pinar.create_pin", { comment: "x", sessionId: "session_pins3" }, MANAGE_TOKEN);
      assert.equal(foreignCreate.text, "Session not found");
      const foreignDelete = await callTool(env, "pinar.delete_pin", { pinId: "session_pins3:p1", sessionId: "session_pins3" }, MANAGE_TOKEN);
      assert.equal(foreignDelete.text, "Session not found");
      assert.equal((db.query("SELECT pin_count FROM sessions WHERE id = ?").get("session_pins3") as { pin_count: number }).pin_count, 1);

      // A session-scoped manage key acts on its covered session only,
      // consistent with the existing edit_pin_note semantics.
      const scopedToken = `pak_${"z".repeat(43)}`;
      db.query(
        "INSERT INTO agent_api_keys (id, account_id, name, token_hash, token_prefix, resource_type, resource_id, permission, expires_at, created_at) "
          + "VALUES (?, ?, ?, ?, ?, 'session', ?, 'manage', ?, ?)",
      ).run("key_pins_scope", "usr_mcp", "Pins scoped", await sha256(scopedToken), scopedToken.slice(0, 12), "session_mcp", LATER, NOW);
      const scopedCreate = await callTool(env, "pinar.create_pin", { comment: "Scoped note", sessionId: "session_mcp" }, scopedToken);
      assert.equal(scopedCreate.result.isError, undefined);
      const scopedPinId = String((JSON.parse(scopedCreate.text) as { pin: Record<string, unknown> }).pin.id);
      const scopedElsewhere = await callTool(env, "pinar.delete_pin", { pinId: "session_mcp:p1", sessionId: "session_pins3" }, scopedToken);
      assert.equal(scopedElsewhere.text, "Resource not found");
      const scopedDelete = await callTool(env, "pinar.delete_pin", { pinId: scopedPinId, sessionId: "session_mcp" }, scopedToken);
      assert.equal(scopedDelete.result.isError, undefined);

      // A revoked key stops before the tool dispatch.
      const revokedToken = `pak_${"r".repeat(43)}`;
      db.query(
        "INSERT INTO agent_api_keys (id, account_id, name, token_hash, token_prefix, resource_type, resource_id, permission, expires_at, created_at) "
          + "VALUES (?, ?, ?, ?, ?, 'account', NULL, 'manage', ?, ?)",
      ).run("key_pins_revoked", "usr_mcp", "Pins revoked", await sha256(revokedToken), revokedToken.slice(0, 12), LATER, NOW);
      db.query("UPDATE agent_api_keys SET revoked_at = ? WHERE id = ?").run(NOW, "key_pins_revoked");
      const revoked = await handleCloudApiRequest(request({
        id: 1,
        jsonrpc: "2.0",
        method: "tools/call",
        params: { arguments: { comment: "x", sessionId: "session_mcp" }, name: "pinar.create_pin" },
      }, revokedToken), env);
      assert.equal(revoked.status, 401);
    } finally {
      db.close();
    }
  });

  test("create_pin rejects unknown and hostile inputs without writes", async () => {
    const db = migratedDatabase();
    try {
      const env = await seedMcpWorkspace(db);
      const reviewCount = () => (db.query("SELECT COUNT(*) AS count FROM pin_reviews WHERE capture_id = ?").get("session_mcp") as { count: number }).count;
      const baseline = reviewCount();

      const extra = await callTool(env, "pinar.create_pin", { comment: "x", pinId: "caller-pick", sessionId: "session_mcp" }, MANAGE_TOKEN);
      assert.equal(extra.text, "Unexpected argument");
      const geometry = await callTool(env, "pinar.create_pin", { comment: "x", geometry: { box: { x: 0, y: 0, height: 1, width: 1 } }, sessionId: "session_mcp" }, MANAGE_TOKEN);
      assert.equal(geometry.text, "Unexpected argument");
      const screenshot = await callTool(env, "pinar.create_pin", { comment: "x", screenshot: "data:image/png;base64,AAAA", sessionId: "session_mcp" }, MANAGE_TOKEN);
      assert.equal(screenshot.text, "Unexpected argument");
      const locatorExtra = await callTool(env, "pinar.create_pin", { comment: "x", locator: { innerText: "x", x: 1 }, sessionId: "session_mcp" }, MANAGE_TOKEN);
      assert.equal(locatorExtra.text, "locator is invalid");
      const locatorType = await callTool(env, "pinar.create_pin", { comment: "x", locator: "innerText", sessionId: "session_mcp" }, MANAGE_TOKEN);
      assert.match(locatorType.text, /Input validation error/, "the schema rejects a non-object locator before the dispatcher");
      const longLocator = await callTool(env, "pinar.create_pin", { comment: "x", locator: { cssSelector: "x".repeat(257) }, sessionId: "session_mcp" }, MANAGE_TOKEN);
      assert.equal(longLocator.text, "cssSelector is invalid");
      const emptyComment = await callTool(env, "pinar.create_pin", { comment: "   ", sessionId: "session_mcp" }, MANAGE_TOKEN);
      assert.equal(emptyComment.text, "comment is invalid");
      const longComment = await callTool(env, "pinar.create_pin", { comment: "x".repeat(2001), sessionId: "session_mcp" }, MANAGE_TOKEN);
      assert.equal(longComment.text, "comment is invalid");
      const missingComment = await callTool(env, "pinar.create_pin", { sessionId: "session_mcp" }, MANAGE_TOKEN);
      assert.match(missingComment.text, /Input validation error.*comment/, "the schema requires the comment before the dispatcher runs");
      const missingSession = await callTool(env, "pinar.create_pin", { comment: "x", sessionId: "missing_session_id" }, MANAGE_TOKEN);
      assert.equal(missingSession.text, "Session not found");
      const legacySession = await callTool(env, "pinar.create_pin", { comment: "x", sessionId: "session_mcp:p1" }, MANAGE_TOKEN);
      assert.equal(legacySession.text, "sessionId is invalid");

      assert.equal(reviewCount(), baseline, "no rejected input may write a pin");
      assert.equal((db.query("SELECT pin_count FROM sessions WHERE id = ?").get("session_mcp") as { pin_count: number }).pin_count, 1);
    } finally {
      db.close();
    }
  });

  test("create_pin is a zero-byte write: an over-quota session still accepts note pins", async () => {
    const db = migratedDatabase();
    try {
      const token = `pak_${"k".repeat(43)}`;
      db.query("INSERT INTO users (id, email, plan, ever_paid, billing_status, created_at, updated_at) VALUES (?, ?, 'pro', 1, 'active', ?, ?)")
        .run("usr_pins_q", "pinsq@example.test", NOW, NOW);
      db.query("INSERT INTO projects (id, owner_id, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)")
        .run("project_pins_q", "usr_pins_q", "Pins quota project", NOW, NOW);
      db.query("INSERT INTO collections (id, project_id, owner_id, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)")
        .run("collection_pins_q", "project_pins_q", "usr_pins_q", "Pins quota collection", NOW, NOW);
      db.query(
        "INSERT INTO sessions (id, url, title, shot_id, shot_url, pin_count, pins_json, created_at, user_id, plan, is_permanent, byte_size, collection_id, position) "
          + "VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?, 'pro', 1, ?, ?, 0)",
      ).run(
        "session_pins_q",
        "https://example.test/pinsq",
        "Pins quota",
        "session_pins_q",
        "https://pinar.test/shots/session_pins_q.png",
        "[]",
        NOW,
        "usr_pins_q",
        PAID_STORAGE_BYTES + 1,
        "collection_pins_q",
      );
      db.query(
        "INSERT INTO agent_api_keys (id, account_id, name, token_hash, token_prefix, resource_type, resource_id, permission, expires_at, created_at) "
          + "VALUES (?, ?, ?, ?, ?, 'account', NULL, 'manage', ?, ?)",
      ).run("key_pins_q", "usr_pins_q", "Pins quota manage", await sha256(token), token.slice(0, 12), LATER, NOW);
      const env = envFor(db);

      const created = await callTool(env, "pinar.create_pin", { comment: "Over-quota note", sessionId: "session_pins_q" }, token);
      assert.equal(created.result.isError, undefined, "a note pin stores zero image bytes and does not consume quota");
      assert.equal((db.query("SELECT byte_size FROM sessions WHERE id = ?").get("session_pins_q") as { byte_size: number }).byte_size, PAID_STORAGE_BYTES + 1, "the session's stored bytes are unchanged");
      const listed = await callTool(env, "pinar.list_pins", { sessionId: "session_pins_q" }, token);
      assert.equal((JSON.parse(listed.text) as { pins: unknown[] }).pins.length, 1);
    } finally {
      db.close();
    }
  });

  test("list_pins, get_pin and delete_pin reject unknown arguments without writes", async () => {
    const db = migratedDatabase();
    try {
      const env = await seedMcpWorkspace(db);
      db.query(
        "INSERT INTO sessions (id, url, title, shot_id, shot_url, pin_count, pins_json, created_at, user_id, plan, is_permanent, byte_size, collection_id, position) "
          + "VALUES (?, ?, ?, ?, ?, 2, ?, ?, ?, 'pro', 1, 1, ?, 0)",
      ).run(
        "session_pinargs",
        "https://example.test/pinargs",
        "Pin args",
        "session_pinargs",
        "https://pinar.test/shots/session_pinargs.png",
        JSON.stringify([{ comment: "first", number: 1 }, { comment: "second", number: 2 }]),
        NOW,
        "usr_mcp",
        "collection_mcp",
      );
      const state = () => JSON.stringify({
        row: db.query("SELECT * FROM sessions WHERE id = ?").get("session_pinargs"),
        reviews: db.query("SELECT * FROM pin_reviews WHERE capture_id = ? ORDER BY capture_id, pin_id").all("session_pinargs"),
        events: db.query("SELECT * FROM pin_review_events WHERE capture_id = ? ORDER BY id").all("session_pinargs"),
        comments: db.query("SELECT * FROM pin_comments WHERE capture_id = ? ORDER BY id").all("session_pinargs"),
      });
      const baseline = state();

      const listSnapshot = await callTool(env, "pinar.list_pins", { sessionId: "session_pinargs", snapshot: true }, TOKEN);
      assert.equal(listSnapshot.text, "Unexpected argument");
      const listForce = await callTool(env, "pinar.list_pins", { force: true, sessionId: "session_pinargs" }, TOKEN);
      assert.equal(listForce.text, "Unexpected argument");
      const getSnapshot = await callTool(env, "pinar.get_pin", { includeSnapshot: true, pinId: "session_pinargs:p1", sessionId: "session_pinargs" }, TOKEN);
      assert.equal(getSnapshot.text, "Unexpected argument");
      const getGeometry = await callTool(env, "pinar.get_pin", { box: { x: 0, y: 0 }, pinId: "session_pinargs:p1", sessionId: "session_pinargs" }, TOKEN);
      assert.equal(getGeometry.text, "Unexpected argument");
      const deleteForce = await callTool(env, "pinar.delete_pin", { force: true, pinId: "session_pinargs:p1", sessionId: "session_pinargs" }, MANAGE_TOKEN);
      assert.equal(deleteForce.text, "Unexpected argument", "an unsupported force flag is rejected, not honored");
      const deleteHard = await callTool(env, "pinar.delete_pin", { hard: "now", pinId: "session_pinargs:p1", sessionId: "session_pinargs" }, MANAGE_TOKEN);
      assert.equal(deleteHard.text, "Unexpected argument");

      assert.equal(state(), baseline, "no unknown argument may write anything");
      assert.equal((db.query("SELECT pin_count FROM sessions WHERE id = ?").get("session_pinargs") as { pin_count: number }).pin_count, 2, "force:true did not delete the pin");

      // The narrow allow-lists keep the declared argument shapes working.
      const listed = await callTool(env, "pinar.list_pins", { limit: 1, offset: 1, sessionId: "session_pinargs" }, TOKEN);
      assert.equal(listed.result.isError, undefined);
      assert.equal((JSON.parse(listed.text) as { pins: unknown[] }).pins.length, 1);
      const got = await callTool(env, "pinar.get_pin", { pinId: "session_pinargs:p1", sessionId: "session_pinargs" }, TOKEN);
      assert.equal(got.result.isError, undefined);
      const deleted = await callTool(env, "pinar.delete_pin", { pinId: "session_pinargs:p1", sessionId: "session_pinargs" }, MANAGE_TOKEN);
      assert.equal(deleted.result.isError, undefined);
      assert.equal((db.query("SELECT pin_count FROM sessions WHERE id = ?").get("session_pinargs") as { pin_count: number }).pin_count, 1);
      const remaining = JSON.parse(String((db.query("SELECT pins_json FROM sessions WHERE id = ?").get("session_pinargs") as { pins_json: string }).pins_json)) as { pins?: Array<Record<string, unknown>> } | Array<Record<string, unknown>>;
      const remainingPins = Array.isArray(remaining) ? remaining : remaining.pins ?? [];
      assert.equal(remainingPins.length, 1);
      assert.equal(remainingPins[0].number, 2, "the surviving pin keeps its number");
    } finally {
      db.close();
    }
  });

  test("permission gates run before the unknown-argument allow-lists on the pin tools", async () => {
    const db = migratedDatabase();
    try {
      const env = await seedMcpWorkspace(db);
      db.query(
        "INSERT INTO sessions (id, url, title, shot_id, shot_url, pin_count, pins_json, created_at, user_id, plan, is_permanent, byte_size, collection_id, position) "
          + "VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?, 'pro', 1, 1, ?, 0)",
      ).run(
        "session_gate_other",
        "https://example.test/gate-other",
        "Gate other",
        "session_gate_other",
        "https://pinar.test/shots/session_gate_other.png",
        JSON.stringify([{ comment: "gated note", number: 1 }]),
        NOW,
        "usr_mcp",
        "collection_mcp",
      );
      const scopedToken = `pak_${"e".repeat(43)}`;
      db.query(
        "INSERT INTO agent_api_keys (id, account_id, name, token_hash, token_prefix, resource_type, resource_id, permission, expires_at, created_at) "
          + "VALUES (?, ?, ?, ?, ?, 'session', ?, 'manage', ?, ?)",
      ).run("key_gate_scope", "usr_mcp", "Gate scoped", await sha256(scopedToken), scopedToken.slice(0, 12), "session_mcp", LATER, NOW);

      const state = () => JSON.stringify({
        mcp: db.query("SELECT * FROM sessions WHERE id = ?").get("session_mcp"),
        other: db.query("SELECT * FROM sessions WHERE id = ?").get("session_gate_other"),
        reviews: db.query("SELECT * FROM pin_reviews ORDER BY capture_id, pin_id").all(),
        events: db.query("SELECT * FROM pin_review_events ORDER BY id").all(),
        comments: db.query("SELECT * FROM pin_comments ORDER BY id").all(),
      });
      const baseline = state();

      // delete_pin: the manage gate fires before the allow-list rejects the
      // unknown force flag, for read and share keys alike.
      const readDelete = await callTool(env, "pinar.delete_pin", { force: true, pinId: "session_mcp:p1", sessionId: "session_mcp" }, TOKEN);
      assert.equal(readDelete.result.isError, true);
      assert.equal(readDelete.text, "manage permission required");
      const shareDelete = await callTool(env, "pinar.delete_pin", { force: true, pinId: "session_mcp:p1", sessionId: "session_mcp" }, SHARE_TOKEN);
      assert.equal(shareDelete.result.isError, true);
      assert.equal(shareDelete.text, "manage permission required");

      // A session-scoped key outside its coverage gets the gate's
      // "Resource not found" before the allow-list sees the extra arguments.
      const scopedList = await callTool(env, "pinar.list_pins", { sessionId: "session_gate_other", snapshot: true }, scopedToken);
      assert.equal(scopedList.result.isError, true);
      assert.equal(scopedList.text, "Resource not found");
      const scopedGet = await callTool(env, "pinar.get_pin", { box: { x: 0, y: 0 }, pinId: "session_gate_other:p1", sessionId: "session_gate_other" }, scopedToken);
      assert.equal(scopedGet.result.isError, true);
      assert.equal(scopedGet.text, "Resource not found");

      assert.equal(state(), baseline, "no gated request may write anything");
      assert.equal((db.query("SELECT pin_count FROM sessions WHERE id = ?").get("session_mcp") as { pin_count: number }).pin_count, 1, "force:true did not delete the pin");

      // The gates stay first with valid arguments: the scoped key still reads
      // its covered session, and reads of the uncovered session fail the
      // same scope gate.
      const scopedRead = await callTool(env, "pinar.list_pins", { sessionId: "session_mcp" }, scopedToken);
      assert.equal(scopedRead.result.isError, undefined, "the scoped key still acts on its covered session");
      const scopedElsewhere = await callTool(env, "pinar.get_pin", { pinId: "session_gate_other:p1", sessionId: "session_gate_other" }, scopedToken);
      assert.equal(scopedElsewhere.text, "Resource not found", "valid arguments still hit the scope gate");
    } finally {
      db.close();
    }
  });

  test("delete_pin rolls back the whole batch on an injected D1 fault and stays healthy after", async () => {
    const db = migratedDatabase();
    try {
      await seedMcpWorkspace(db);
      let failWhen: ((sql: string) => boolean) | null = null;
      const env: CloudEnv = { DB: sqliteD1(db, (sql) => (failWhen ? failWhen(sql) : false)), DEPLOYMENT_ENV: "production" };

      const session = await callTool(env, "pinar.create_session", {
        collectionId: "collection_mcp",
        page: { title: "Atomic pins", url: "https://example.test/atomic" },
      }, MANAGE_TOKEN);
      assert.equal(session.result.isError, undefined);
      const sessionId = String(JSON.parse(session.text).session.id);
      const doomed = await callTool(env, "pinar.create_pin", { comment: "to delete", sessionId }, MANAGE_TOKEN);
      assert.equal(doomed.result.isError, undefined);
      const doomedId = String((JSON.parse(doomed.text) as { pin: { id: string } }).pin.id);
      const keeper = await callTool(env, "pinar.create_pin", { comment: "to keep", sessionId }, MANAGE_TOKEN);
      assert.equal(keeper.result.isError, undefined);
      const keeperId = String((JSON.parse(keeper.text) as { pin: { id: string } }).pin.id);
      const doomedComment = await callTool(env, "pinar.add_pin_comment", { body: "on doomed", pinId: doomedId, sessionId }, MANAGE_TOKEN);
      assert.equal(doomedComment.result.isError, undefined);
      const keeperComment = await callTool(env, "pinar.add_pin_comment", { body: "on keeper", pinId: keeperId, sessionId }, MANAGE_TOKEN);
      assert.equal(keeperComment.result.isError, undefined);
      const concluded = await callTool(env, "pinar.conclude_pin", { pinId: doomedId, sessionId }, MANAGE_TOKEN);
      assert.equal((JSON.parse(concluded.text) as { changed: boolean }).changed, true);

      const state = () => JSON.stringify({
        row: db.query("SELECT * FROM sessions WHERE id = ?").get(sessionId),
        reviews: db.query("SELECT * FROM pin_reviews WHERE capture_id = ? ORDER BY capture_id, pin_id").all(sessionId),
        events: db.query("SELECT * FROM pin_review_events WHERE capture_id = ? ORDER BY id").all(sessionId),
        comments: db.query("SELECT * FROM pin_comments WHERE capture_id = ? ORDER BY id").all(sessionId),
      });
      const keeperRows = () => JSON.stringify({
        comments: db.query("SELECT * FROM pin_comments WHERE capture_id = ? AND pin_id = ? ORDER BY id").all(sessionId, keeperId),
        reviews: db.query("SELECT * FROM pin_reviews WHERE capture_id = ? AND pin_id = ? ORDER BY capture_id, pin_id").all(sessionId, keeperId),
        events: db.query("SELECT * FROM pin_review_events WHERE capture_id = ? AND pin_id = ? ORDER BY id").all(sessionId, keeperId),
      });
      const baseline = state();

      const faults: Array<[string, RegExp]> = [
        ["fail-on-session-upsert", /INSERT INTO sessions/],
        ["fail-on-comment-delete", /DELETE FROM pin_comments/],
        ["fail-on-review-delete", /DELETE FROM pin_reviews WHERE/],
      ];
      for (const [label, pattern] of faults) {
        failWhen = (sql) => pattern.test(sql);
        const failed = await callTool(env, "pinar.delete_pin", { pinId: doomedId, sessionId }, MANAGE_TOKEN);
        failWhen = null;
        assert.equal(failed.result.isError, true, `${label}: the fault surfaces as a tool error`);
        assert.equal(failed.text, "Tool failed", `${label}: the injected statement fault is not swallowed`);
        assert.equal(state(), baseline, `${label}: the transactional rollback leaves the entire state identical`);
      }

      // Healthy after the faults: the retry deletes the pin and only its rows.
      const keeperBefore = keeperRows();
      const deleted = await callTool(env, "pinar.delete_pin", { pinId: doomedId, sessionId }, MANAGE_TOKEN);
      assert.equal(deleted.result.isError, undefined, "the call after the faults succeeds");
      assert.equal((db.query("SELECT COUNT(*) AS count FROM pin_reviews WHERE capture_id = ? AND pin_id = ?").get(sessionId, doomedId) as { count: number }).count, 0);
      assert.equal((db.query("SELECT COUNT(*) AS count FROM pin_comments WHERE capture_id = ? AND pin_id = ?").get(sessionId, doomedId) as { count: number }).count, 0);
      assert.equal((db.query("SELECT pin_count FROM sessions WHERE id = ?").get(sessionId) as { pin_count: number }).pin_count, 1);
      assert.ok(!String(db.query("SELECT pins_json FROM sessions WHERE id = ?").get(sessionId)?.pins_json).includes(doomedId), "the deleted pin is gone from the session");
      assert.equal(keeperRows(), keeperBefore, "the other pin's comments, reviews and events are unchanged");

      // A pin without membership errors and writes nothing.
      const after = state();
      const absent = await callTool(env, "pinar.delete_pin", { pinId: "nopin", sessionId }, MANAGE_TOKEN);
      assert.equal(absent.result.isError, true);
      assert.equal(absent.text, "Pin not found", "deleting a pin the session does not have errors");
      assert.equal(state(), after, "the absent-pin delete writes nothing");
      const listed = await callTool(env, "pinar.list_pins", { sessionId }, MANAGE_TOKEN);
      const listedBody = JSON.parse(listed.text) as { pins: Array<Record<string, unknown>> };
      assert.deepEqual(listedBody.pins.map((pin) => pin.id), [keeperId]);
    } finally {
      db.close();
    }
  });
});
