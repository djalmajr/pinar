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

const NOW = "2026-09-26T12:00:00.000Z";
const LATER = "2026-10-01T12:00:00.000Z";
const TOKEN = `pak_${"m".repeat(43)}`;
const MANAGE_TOKEN = `pak_${"n".repeat(43)}`;
const SHARE_TOKEN = `pak_${"s".repeat(43)}`;

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
      const results = [];
      for (const statement of statements) results.push(await statement.run());
      return results;
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

function request(body: Record<string, unknown>, token = TOKEN) {
  return new Request("https://pinar.test/api/mcp", {
    body: JSON.stringify(body),
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    method: "POST",
  });
}

async function jsonBody(response: Response) {
  return response.json() as Promise<Record<string, unknown>>;
}

async function callTool(env: CloudEnv, name: string, argumentsValue: Record<string, unknown>, token = TOKEN) {
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
});
