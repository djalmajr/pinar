import assert from "node:assert/strict";
import { Database } from "bun:sqlite";
import { readdirSync, readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, test } from "node:test";
import { authenticateAgentKey, createAgentKey, listAgentKeys, revokeAgentKey } from "./agent-keys";
import {
  type CloudEnv,
  handleCloudApiRequest,
  handleCloudPublicRequest,
  resetCloudMemoryStateForTests,
  setCloudNowForTests,
} from "./cloud-api";

const NOW = "2026-09-26T12:00:00.000Z";
const LATER = "2026-10-01T12:00:00.000Z";

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
      for (const item of statements) results.push(await item.run());
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

function envFor(db: Database): CloudEnv {
  return { DB: sqliteD1(db), DEPLOYMENT_ENV: "production" };
}

function api(env: CloudEnv, path: string, init: RequestInit = {}) {
  return handleCloudApiRequest(new Request(`https://pinar.test${path}`, init), env);
}

function publicApi(env: CloudEnv, path: string, init: RequestInit = {}) {
  return handleCloudPublicRequest(new Request(`https://pinar.test${path}`, init), env);
}

async function sha256(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function webCookie(db: Database, accountId: string, suffix: string) {
  const token = `pws_${suffix.repeat(43).slice(0, 43)}`;
  const hash = await sha256(token);
  db.query(
    "INSERT INTO web_sessions (token_hash, owner_type, owner_id, expires_at, revoked_at, created_at) VALUES (?, 'account', ?, ?, NULL, ?)",
  ).run(hash, accountId, "2027-09-26T12:00:00.000Z", NOW);
  return `pinar_session=${token}`;
}

function insertUser(db: Database, id: string, email: string, plan: "free" | "pro") {
  db.query(
    "INSERT INTO users (id, email, plan, ever_paid, billing_status, created_at, updated_at) VALUES (?, ?, ?, ?, 'active', ?, ?)",
  ).run(id, email, plan, plan === "pro" ? 1 : 0, NOW, NOW);
}

function insertSession(db: Database, id: string, userId: string, collectionId: string, batchId: string | null = null) {
  db.query(
    "INSERT INTO sessions (id, url, title, shot_id, shot_url, pin_count, pins_json, created_at, user_id, plan, is_permanent, byte_size, collection_id, position, batch_id) "
      + "VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?, 'pro', 1, 1, ?, 0, ?)",
  ).run(
    id,
    `https://example.test/${id}`,
    id,
    id,
    `https://pinar.test/shots/${id}.png`,
    JSON.stringify([{ comment: "private note", number: 1 }]),
    NOW,
    userId,
    collectionId,
    batchId,
  );
}

async function jsonBody(response: Response) {
  const body: unknown = await response.json();
  assert.equal(typeof body, "object");
  assert.notEqual(body, null);
  return body as Record<string, unknown>;
}

describe("cloud agent API keys", () => {
  beforeEach(() => {
    resetCloudMemoryStateForTests();
    setCloudNowForTests(NOW);
  });

  afterEach(() => {
    resetCloudMemoryStateForTests();
  });

  test("stores distinct prefixes and last use while enforcing expiry and revocation", async () => {
    const db = migratedDatabase();
    try {
      insertUser(db, "usr_key_owner", "owner@example.test", "pro");
      const env = envFor(db);
      const first = await createAgentKey(env, {
        accountId: "usr_key_owner", expiresAt: LATER, id: "pak_first", name: "Reader", now: NOW,
        permission: "read", resourceId: null, resourceType: "account",
      });
      const second = await createAgentKey(env, {
        accountId: "usr_key_owner", expiresAt: LATER, id: "pak_second", name: "Publisher", now: NOW,
        permission: "share", resourceId: null, resourceType: "account",
      });
      assert.ok(first);
      assert.ok(second);
      assert.notEqual(first.key.prefix, second.key.prefix);
      assert.equal(first.key.prefix, first.token.slice(0, 12));
      assert.equal((await listAgentKeys(env, "usr_key_owner"))[0]?.lastUsedAt, null);
      const authenticated = await authenticateAgentKey(env, second.token, NOW);
      assert.equal(authenticated?.permission, "share");
      assert.equal(authenticated?.lastUsedAt, NOW);
      const keys = await listAgentKeys(env, "usr_key_owner");
      assert.equal(keys.find((key) => key.id === second.key.id)?.lastUsedAt, NOW);
      assert.equal(keys.find((key) => key.id === first.key.id)?.lastUsedAt, null);
      assert.equal(await authenticateAgentKey(env, second.token, "2026-10-02T12:00:00.000Z"), null);
      assert.equal(await revokeAgentKey(env, "usr_key_owner", first.key.id, NOW), true);
      assert.equal(await authenticateAgentKey(env, first.token, NOW), null);
    } finally {
      db.close();
    }
  });

  test("creates a hashed read key, reads Markdown, and rejects the revoked key even with a cookie", async () => {
    // Mutation captured: falling back to the cookie after revocation would make this private read succeed.
    const db = migratedDatabase();
    try {
      insertUser(db, "usr_key_owner", "owner@example.test", "pro");
      db.query(
        "INSERT INTO projects (id, owner_id, name, created_at, updated_at) VALUES ('project_key', 'usr_key_owner', 'Project', ?, ?)",
      ).run(NOW, NOW);
      db.query(
        "INSERT INTO collections (id, project_id, owner_id, name, created_at, updated_at) VALUES ('collection_key', 'project_key', 'usr_key_owner', 'Collection', ?, ?)",
      ).run(NOW, NOW);
      insertSession(db, "session_key", "usr_key_owner", "collection_key");
      const env = envFor(db);
      const cookie = await webCookie(db, "usr_key_owner", "o");
      const created = await api(env, "/api/agent-keys", {
        body: JSON.stringify({ expiresAt: LATER, resourceType: "session", resourceId: "session_key" }),
        headers: { cookie, "content-type": "application/json", origin: "https://pinar.test" },
        method: "POST",
      });
      assert.equal(created.status, 201);
      const createdBody = await jsonBody(created);
      const token = String(createdBody.key || "");
      assert.match(token, /^pak_[A-Za-z0-9_-]{43}$/);
      const key = createdBody.metadata as Record<string, unknown>;
      const keyId = String(key.id);
      const stored = db.query<{ token_hash: string }, [string]>("SELECT token_hash FROM agent_api_keys WHERE id = ?").get(keyId);
      assert.ok(stored);
      assert.notEqual(stored.token_hash, token);
      assert.equal(stored.token_hash, await sha256(token));

      const markdown = await publicApi(env, "/v/session_key.md", { headers: { authorization: `Bearer ${token}` } });
      assert.equal(markdown.status, 200);
      assert.match(await markdown.text(), /private note/);

      const listed = await api(env, "/api/agent-keys", { headers: { cookie }, method: "GET" });
      assert.equal(listed.status, 200);
      const listedBody = await jsonBody(listed);
      assert.equal((listedBody.keys as unknown[]).length, 1);

      const revoked = await api(env, "/api/agent-keys", {
        body: JSON.stringify({ id: keyId }),
        headers: { cookie, "content-type": "application/json", origin: "https://pinar.test" },
        method: "DELETE",
      });
      assert.equal(revoked.status, 200);
      const afterRevoke = await publicApi(env, "/v/session_key.md", {
        headers: { authorization: `Bearer ${token}`, cookie },
      });
      assert.equal(afterRevoke.status, 404);
    } finally {
      db.close();
    }
  });

  test("an explicit agent key never falls back to a valid browser cookie for mutations", async () => {
    const db = migratedDatabase();
    try {
      insertUser(db, "usr_key_owner", "owner@example.test", "pro");
      const env = envFor(db);
      const cookie = await webCookie(db, "usr_key_owner", "m");
      const key = await createAgentKey(env, {
        accountId: "usr_key_owner", expiresAt: LATER, id: "pak_exclusive", name: "Reader",
        now: NOW, permission: "read", resourceId: null, resourceType: "account",
      });
      assert.ok(key);
      const before = Number((db.query("SELECT COUNT(*) AS count FROM projects WHERE owner_id = ?").get("usr_key_owner") as { count: number }).count);
      const denied = await api(env, "/api/projects", {
        body: JSON.stringify({ name: "Forbidden" }),
        headers: { authorization: `Bearer ${key.token}`, cookie, "content-type": "application/json", origin: "https://pinar.test" },
        method: "POST",
      });
      assert.equal(denied.status, 401);
      const after = Number((db.query("SELECT COUNT(*) AS count FROM projects WHERE owner_id = ?").get("usr_key_owner") as { count: number }).count);
      assert.equal(after, before);

      const browserOnly = await api(env, "/api/projects", {
        body: JSON.stringify({ name: "Allowed" }),
        headers: { cookie, "content-type": "application/json", origin: "https://pinar.test" },
        method: "POST",
      });
      assert.equal(browserOnly.status, 201);
      assert.equal(await revokeAgentKey(env, "usr_key_owner", key.key.id, NOW), true);
      const revoked = await api(env, "/api/projects", {
        body: JSON.stringify({ name: "Still forbidden" }),
        headers: { authorization: `Bearer ${key.token}`, cookie, "content-type": "application/json", origin: "https://pinar.test" },
        method: "POST",
      });
      assert.equal(revoked.status, 401);
    } finally {
      db.close();
    }
  });

  test("private project Markdown is not cacheable and nonexistent scopes cannot consume a key", async () => {
    const db = migratedDatabase();
    try {
      insertUser(db, "usr_key_owner", "owner@example.test", "pro");
      insertUser(db, "usr_foreign", "foreign@example.test", "pro");
      db.query("INSERT INTO projects (id, owner_id, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)")
        .run("project_private", "usr_key_owner", "Private project", NOW, NOW);
      db.query("INSERT INTO projects (id, owner_id, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)")
        .run("project_foreign", "usr_foreign", "Foreign project", NOW, NOW);
      db.query("INSERT INTO collections (id, project_id, owner_id, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)")
        .run("collection_private", "project_private", "usr_key_owner", "Private collection", NOW, NOW);
      insertSession(db, "session_private", "usr_key_owner", "collection_private");
      const env = envFor(db);
      const cookie = await webCookie(db, "usr_key_owner", "p");
      const missing = await api(env, "/api/agent-keys", {
        body: JSON.stringify({ expiresAt: LATER, resourceType: "project", resourceId: "project_missing" }),
        headers: { cookie, "content-type": "application/json", origin: "https://pinar.test" },
        method: "POST",
      });
      assert.equal(missing.status, 404);
      const foreign = await api(env, "/api/agent-keys", {
        body: JSON.stringify({ expiresAt: LATER, resourceType: "project", resourceId: "project_foreign" }),
        headers: { cookie, "content-type": "application/json", origin: "https://pinar.test" },
        method: "POST",
      });
      assert.equal(foreign.status, 404);
      assert.equal((db.query("SELECT COUNT(*) AS count FROM agent_api_keys").get() as { count: number }).count, 0);
      const key = await createAgentKey(env, {
        accountId: "usr_key_owner", expiresAt: LATER, id: "pak_private", name: "Private reader",
        now: NOW, permission: "read", resourceId: "project_private", resourceType: "project",
      });
      assert.ok(key);
      const markdown = await publicApi(env, "/p/project_private.md", {
        headers: { authorization: `Bearer ${key.token}` },
      });
      assert.equal(markdown.status, 200);
      assert.equal(markdown.headers.get("cache-control"), "private, no-store");
      assert.match(await markdown.text(), /Private project/);
    } finally {
      db.close();
    }
  });

  test("requires Pro on every read and rechecks collaborator access after the key is issued", async () => {
    // Mutation captured: checking the plan or ACL only when the key is created would keep this read alive after downgrade/revoke.
    const db = migratedDatabase();
    try {
      insertUser(db, "usr_key_owner", "owner@example.test", "pro");
      insertUser(db, "usr_key_guest", "guest@example.test", "pro");
      db.query(
        "INSERT INTO projects (id, owner_id, name, created_at, updated_at) VALUES ('project_shared', 'usr_key_owner', 'Project', ?, ?)",
      ).run(NOW, NOW);
      db.query(
        "INSERT INTO collections (id, project_id, owner_id, name, created_at, updated_at) VALUES ('collection_shared', 'project_shared', 'usr_key_owner', 'Collection', ?, ?)",
      ).run(NOW, NOW);
      insertSession(db, "session_shared", "usr_key_owner", "collection_shared");
      db.query(
        "INSERT INTO collection_collaborators (id, collection_id, owner_id, email, user_id, status, created_at, updated_at, accepted_at) VALUES ('collab_key', 'collection_shared', 'usr_key_owner', 'guest@example.test', 'usr_key_guest', 'accepted', ?, ?, ?)",
      ).run(NOW, NOW, NOW);
      const env = envFor(db);
      const guestCookie = await webCookie(db, "usr_key_guest", "g");
      const created = await api(env, "/api/agent-keys", {
        body: JSON.stringify({ expiresAt: LATER, resourceType: "collection", resourceId: "collection_shared" }),
        headers: { cookie: guestCookie, "content-type": "application/json", origin: "https://pinar.test" },
        method: "POST",
      });
      assert.equal(created.status, 201);
      const token = String((await jsonBody(created)).key);
      const allowed = await api(env, "/api/sessions/session_shared/markdown", {
        headers: { authorization: `Bearer ${token}` },
      });
      assert.equal(allowed.status, 200);

      db.query("UPDATE users SET plan = 'free' WHERE id = 'usr_key_owner'").run();
      const suspended = await api(env, "/api/sessions/session_shared/markdown", {
        headers: { authorization: `Bearer ${token}` },
      });
      assert.equal(suspended.status, 403);

      db.query("UPDATE users SET plan = 'pro' WHERE id = 'usr_key_owner'").run();
      db.query("UPDATE collection_collaborators SET status = 'revoked', revoked_at = ? WHERE id = 'collab_key'").run(LATER);
      const revoked = await api(env, "/api/sessions/session_shared/markdown", {
        headers: { authorization: `Bearer ${token}` },
      });
      assert.equal(revoked.status, 404);
      const cannotCreateAfterRevocation = await api(env, "/api/agent-keys", {
        body: JSON.stringify({ expiresAt: LATER, resourceType: "collection", resourceId: "collection_shared" }),
        headers: { cookie: guestCookie, "content-type": "application/json", origin: "https://pinar.test" },
        method: "POST",
      });
      assert.equal(cannotCreateAfterRevocation.status, 404);
    } finally {
      db.close();
    }
  });

  test("shared resources list active collections with sessions, then hides them after revocation", async () => {
    const db = migratedDatabase();
    try {
      insertUser(db, "usr_owner_active", "active-owner@example.test", "pro");
      insertUser(db, "usr_owner_free", "free-owner@example.test", "free");
      insertUser(db, "usr_guest_pro", "pro-guest@example.test", "pro");
      db.query(
        "INSERT INTO projects (id, owner_id, name, created_at, updated_at) VALUES ('project_active', 'usr_owner_active', 'Active project', ?, ?)",
      ).run(NOW, NOW);
      db.query(
        "INSERT INTO collections (id, project_id, owner_id, name, created_at, updated_at) VALUES ('collection_active', 'project_active', 'usr_owner_active', 'Active shared', ?, ?)",
      ).run(NOW, NOW);
      insertSession(db, "session_active", "usr_owner_active", "collection_active");
      for (let index = 1; index <= 201; index += 1) {
        const id = `session_active_${String(index).padStart(3, "0")}`;
        insertSession(db, id, "usr_owner_active", "collection_active");
      }
      db.query(
        "INSERT INTO projects (id, owner_id, name, created_at, updated_at) VALUES ('project_free', 'usr_owner_free', 'Free project', ?, ?)",
      ).run(NOW, NOW);
      db.query(
        "INSERT INTO collections (id, project_id, owner_id, name, created_at, updated_at) VALUES ('collection_suspended', 'project_free', 'usr_owner_free', 'Suspended shared', ?, ?)",
      ).run(NOW, NOW);
      insertSession(db, "session_suspended", "usr_owner_free", "collection_suspended");
      db.query(
        "INSERT INTO collection_collaborators (id, collection_id, owner_id, email, user_id, status, created_at, updated_at, accepted_at) VALUES ('collab_active', 'collection_active', 'usr_owner_active', 'pro-guest@example.test', 'usr_guest_pro', 'accepted', ?, ?, ?)",
      ).run(NOW, NOW, NOW);
      db.query(
        "INSERT INTO collection_collaborators (id, collection_id, owner_id, email, user_id, status, created_at, updated_at, accepted_at) VALUES ('collab_suspended', 'collection_suspended', 'usr_owner_free', 'pro-guest@example.test', 'usr_guest_pro', 'accepted', ?, ?, ?)",
      ).run(NOW, NOW, NOW);
      const env = envFor(db);
      const guestCookie = await webCookie(db, "usr_guest_pro", "s");

      const first = await api(env, "/api/agent-key-shared-resources", {
        headers: { cookie: guestCookie },
        method: "GET",
      });
      assert.equal(first.status, 200);
      const firstBody = await jsonBody(first);
      const firstShared = firstBody.shared as Array<Record<string, unknown>>;
      assert.ok(Array.isArray(firstShared));
      const active = firstShared.find((entry) => entry.id === "collection_active");
      assert.ok(active);
      const activeSessions = active.sessions as Array<Record<string, unknown>>;
      assert.equal(activeSessions.length, 202);
      assert.ok(activeSessions.some((session) => session.id === "session_active_201"));
      assert.equal(firstShared.some((entry) => entry.id === "collection_suspended"), false);

      const guestKey = await api(env, "/api/agent-keys", {
        body: JSON.stringify({ expiresAt: LATER, resourceType: "account" }),
        headers: { cookie: guestCookie, "content-type": "application/json", origin: "https://pinar.test" },
        method: "POST",
      });
      assert.equal(guestKey.status, 201);
      const guestToken = String((await jsonBody(guestKey)).key);
      assert.ok(guestToken.startsWith("pak_"));
      const keyAccess = await api(env, "/api/agent-key-shared-resources", {
        headers: { authorization: `Bearer ${guestToken}` },
        method: "GET",
      });
      assert.equal(keyAccess.status, 401);

      db.query("UPDATE collection_collaborators SET status = 'revoked', revoked_at = ? WHERE id = 'collab_active'").run(LATER);
      const second = await api(env, "/api/agent-key-shared-resources", {
        headers: { cookie: guestCookie },
        method: "GET",
      });
      assert.equal(second.status, 200);
      assert.deepEqual((await jsonBody(second)).shared, []);

      const forged = await api(env, "/api/agent-keys", {
        body: JSON.stringify({ expiresAt: LATER, resourceType: "session", resourceId: "session_active_201" }),
        headers: { cookie: guestCookie, "content-type": "application/json", origin: "https://pinar.test" },
        method: "POST",
      });
      assert.equal(forged.status, 404);
    } finally {
      db.close();
    }
  });
});
