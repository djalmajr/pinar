// F5/S1: the /api/byok routes served by handleCloudApiRequest. The D1 shim
// is the same SQLite-as-D1 model cloud-assistant.test.ts uses: the
// migrations are applied in order. Pro-only (like the assistant), the web
// session or an account-level agent key with a write permission, one row
// per account, the key never comes back, a database without the 0034 (or
// no master key) answers 503 byok_unavailable and nothing else breaks.

import assert from "node:assert/strict";
import { Database } from "bun:sqlite";
import { readdirSync, readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, test } from "node:test";
import {
  handleCloudApiRequest,
  resetCloudMemoryStateForTests,
  seedCloudWebSessionForTests,
  setCloudNowForTests,
  type CloudEnv,
} from "../cloud-api";
import {
  handleByokRequest,
  setByokEgressForTests,
  setByokNowForTests,
  untestedCapabilities,
  type ByokView,
} from "./api";
import { resetByokTestWindowsForTests } from "./limit";
import { resetByokMemoryStateForTests } from "./store";
import { cloudPinIndexStore, resetCloudPinIndexMemoryForTests } from "../assistant/retrieval/store-cloud";
import { pinIndexEntry } from "../assistant/retrieval/store.test-helpers";

const NOW = "2026-10-01T12:00:00.000Z";
const LATER = "2026-12-01T12:00:00.000Z";
const MASTER_KEY = Buffer.alloc(32, 7).toString("base64");
const OTHER_MASTER_KEY = Buffer.alloc(32, 9).toString("base64");
const TEST_KEY = "sk-byok-test-secret-1234";

// ---------- D1 shim (same model as cloud-assistant.test.ts) ----------

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

function migratedDatabase(withByok = true) {
  const db = new Database(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  const directory = new URL("../../../migrations/", import.meta.url);
  for (const file of readdirSync(directory).filter((name) => name.endsWith(".sql")).sort()) {
    if (file === "0035_byok_endpoints.sql" && !withByok) continue;
    db.exec(readFileSync(new URL(file, directory), "utf8"));
  }
  return db;
}

function envFor(db: Database, overrides: Partial<CloudEnv> = {}): CloudEnv {
  return {
    BYOK_MASTER_KEY: MASTER_KEY,
    DB: sqliteD1(db),
    DEPLOYMENT_ENV: "staging",
    ...overrides,
  };
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

// A web session of an account row: the cookie to call the routes with.
async function insertUser(db: Database, id: string, email: string, plan: "free" | "pro") {
  db.query(
    "INSERT INTO users (id, email, plan, ever_paid, billing_status, created_at, updated_at) VALUES (?, ?, ?, 1, 'active', ?, ?)",
  ).run(id, email, plan, NOW, NOW);
  // One distinct token per user id of this database (token_hash is unique).
  const suffix = (id.split("_").pop() ?? "x").repeat(43).slice(0, 43);
  const token = `pws_${suffix}`;
  db.query(
    "INSERT INTO web_sessions (token_hash, owner_type, owner_id, expires_at, revoked_at, created_at) VALUES (?, 'account', ?, ?, NULL, ?)",
  ).run(await sha256Hex(token), id, LATER, NOW);
  return `pinar_session=${token}`;
}

// The agent key rows authenticate by hash: insert with the precomputed one.
async function insertAgentKeyWithToken(db: Database, id: string, accountId: string, permission: string, token: string, resourceType = "account", resourceId: string | null = null) {
  db.query(
    "INSERT INTO agent_api_keys (id, account_id, name, token_hash, token_prefix, resource_type, resource_id, permission, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
  ).run(id, accountId, `key ${permission}`, await sha256Hex(token), token.slice(0, 12), resourceType, resourceId, permission, LATER, NOW);
  return token;
}

function api(method: string, path: string, env: CloudEnv, init: RequestInit = {}) {
  return handleCloudApiRequest(new Request(`https://pinar.test${path}`, { ...init, method }), env);
}

async function jsonBody(response: Response): Promise<Record<string, unknown>> {
  const body: unknown = await response.json();
  assert.equal(typeof body, "object");
  assert.ok(body !== null && !Array.isArray(body));
  return body as Record<string, unknown>;
}

function byokView(body: Record<string, unknown>): ByokView {
  return body as unknown as ByokView;
}

// The key must never appear in a console line: capture all of them.
class ConsoleCapture {
  private lines: string[] = [];
  private original: Partial<Record<"log" | "error" | "warn" | "info" | "debug", (...args: unknown[]) => void>> = {};
  active = true;

  constructor() {
    for (const name of ["log", "error", "warn", "info", "debug"] as const) {
      this.original[name] = console[name] as (...args: unknown[]) => void;
      console[name] = (...args: unknown[]) => {
        if (!this.active) return;
        this.lines.push(args.map((arg) => (typeof arg === "string" ? arg : JSON.stringify(arg))).join(" "));
      };
    }
  }

  restore() {
    this.active = false;
    for (const name of ["log", "error", "warn", "info", "debug"] as const) {
      console[name] = this.original[name] ?? console[name];
    }
  }

  assertNotLeaked(value: string) {
    assert.ok(!this.lines.some((line) => line.includes(value)), `console leaked the value:\n${this.lines.join("\n")}`);
  }
}

const UNTESTED = untestedCapabilities();

// The appliance catalog shortcut: one GET /models decides everything.
const applianceCatalog = {
  data: [
    { available: true, modalities: { input: ["image", "text"] }, scope: "llm", supported_parameters: ["stream", "tool_choice", "tools"] },
    { available: true, embedding: { dimensions: { native: 256, supported: [256, 512] } }, scope: "embeddings" },
    { available: true, scope: "audio" },
  ],
  object: "list",
};
function passingEgress() {
  return async () => Response.json(applianceCatalog);
}

// What the PUT records with the passing egress (it tests before it saves):
// every configured capability ok at the test date, and the cause
// model_not_configured on the ones without a model.
function testedWith(models: { chat?: boolean; embedding?: boolean; transcription?: boolean }, testedAt = NOW) {
  const notConfigured = { error: "model_not_configured", ok: false, testedAt };
  const passed = { error: null, ok: true, testedAt };
  return {
    chat: models.chat ? passed : notConfigured,
    embeddings: models.embedding ? { dims: 256, ...passed } : { dims: null, ...notConfigured },
    tools: models.chat ? passed : notConfigured,
    transcription: models.transcription ? passed : notConfigured,
    vision: models.chat ? passed : notConfigured,
  };
}
const TESTED_ALL = testedWith({ chat: true, embedding: true, transcription: true });
const TESTED_CHAT = testedWith({ chat: true });

describe("/api/byok (F5/S1)", () => {
  // The PUT tests before it saves: the passing fake egress lets it store.
  beforeEach(() => {
    resetCloudMemoryStateForTests();
    resetByokMemoryStateForTests();
    resetByokTestWindowsForTests();
    setByokEgressForTests(passingEgress());
    setCloudNowForTests(NOW);
    setByokNowForTests(NOW);
  });

  afterEach(() => {
    resetCloudMemoryStateForTests();
    resetByokMemoryStateForTests();
    resetByokTestWindowsForTests();
    setByokEgressForTests(null);
    setCloudNowForTests(null);
    setByokNowForTests(null);
  });

  test("a Pro account saves, reads and deletes the endpoint; the key never comes back", async () => {
    const db = migratedDatabase();
    try {
      const cookie = await insertUser(db, "usr_a", "a@example.test", "pro");
      const env = envFor(db);
      const header = { cookie };

      // Unconfigured until the PUT.
      const empty = await api("GET", "/api/byok", env, { headers: header });
      assert.equal(empty.status, 200);
      assert.deepEqual(await jsonBody(empty), {
        baseUrl: null,
        capabilities: UNTESTED,
        configured: false,
        keyLast4: null,
        models: { chat: null, embedding: null, transcription: null },
        updatedAt: null,
      });

      // The PUT tests the endpoint, then stores the normalized URL, the
      // encrypted key, the models and the result of that test.
      const put = await api("PUT", "/api/byok", env, {
        body: JSON.stringify({
          apiKey: TEST_KEY,
          baseUrl: "https://api.example.test/v1/",
          chatModel: "chat-1",
          embeddingModel: "embed-1",
          transcriptionModel: "tr-1",
        }),
        headers: { ...header, "content-type": "application/json" },
      });
      assert.equal(put.status, 200);
      const view = byokView(await jsonBody(put));
      assert.equal(view.configured, true);
      assert.equal(view.baseUrl, "https://api.example.test/v1", "normalized without the trailing slash");
      assert.equal(view.keyLast4, "1234");
      assert.deepEqual(view.models, { chat: "chat-1", embedding: "embed-1", transcription: "tr-1" });
      assert.deepEqual(view.capabilities, TESTED_ALL);
      assert.equal(view.updatedAt, NOW);

      // The row holds the ciphertext, never the key; the format is
      // v1:<key_id>:<iv b64>:<ct b64>.
      const row = db.query("SELECT * FROM byok_endpoints WHERE owner_id = 'usr_a'").get() as Record<string, unknown>;
      assert.ok(row, "the row was stored");
      assert.equal(row.base_url, "https://api.example.test/v1");
      assert.equal(row.key_last4, "1234");
      assert.match(String(row.key_ciphertext), /^v1:[0-9a-f]{8}:/, "the v1 key_id format");
      assert.ok(!JSON.stringify(row).includes(TEST_KEY), "the key is not in the row");

      // The GET reads it back without the key.
      const get = await api("GET", "/api/byok", env, { headers: header });
      assert.equal(get.status, 200);
      const getText = await get.text();
      const again = byokView(JSON.parse(getText) as unknown as ByokView);
      assert.deepEqual(again, view);
      assert.ok(!getText.includes(TEST_KEY), "the key is not in the answer");

      // An update without apiKey keeps the current key and the unmentioned
      // models; the stored ciphertext is the very same.
      const put2 = await api("PUT", "/api/byok", env, {
        body: JSON.stringify({ baseUrl: "https://api2.example.test/v1", chatModel: "chat-2" }),
        headers: { ...header, "content-type": "application/json" },
      });
      assert.equal(put2.status, 200);
      const view2 = byokView(await jsonBody(put2));
      assert.equal(view2.baseUrl, "https://api2.example.test/v1");
      assert.equal(view2.keyLast4, "1234", "the key was kept");
      assert.deepEqual(view2.models, { chat: "chat-2", embedding: "embed-1", transcription: "tr-1" });
      const row2 = db.query("SELECT * FROM byok_endpoints WHERE owner_id = 'usr_a'").get() as Record<string, unknown>;
      assert.equal(row2.key_ciphertext, row.key_ciphertext, "the ciphertext was kept, not re-encrypted");
      assert.equal(row2.chat_model, "chat-2");
      assert.equal(row2.created_at, NOW, "created_at does not move on an update");

      // The DELETE removes the row; the answer is the unconfigured view.
      const del = await api("DELETE", "/api/byok", env, { headers: header });
      assert.equal(del.status, 200);
      const after = byokView(await jsonBody(del));
      assert.equal(after.configured, false);
      assert.equal(db.query("SELECT * FROM byok_endpoints").all().length, 0);
    } finally {
      db.close();
    }
  });

  test("without Pro the route answers 403 requires_pro, like the assistant", async () => {
    const db = migratedDatabase();
    try {
      const cookie = await insertUser(db, "usr_free", "free@example.test", "free");
      const env = envFor(db);
      const header = { cookie };
      for (const method of ["GET", "PUT", "DELETE"] as const) {
        const response = await api(method, "/api/byok", env, {
          body: method === "PUT" ? JSON.stringify({ apiKey: TEST_KEY, baseUrl: "https://api.example.test/v1" }) : undefined,
          headers: header,
        });
        assert.equal(response.status, 403, `${method}`);
        assert.deepEqual(await jsonBody(response), { code: "byok_requires_pro", error: "BYOK requires a Pro plan" });
      }
      assert.equal(db.query("SELECT * FROM byok_endpoints").all().length, 0, "nothing was stored");
    } finally {
      db.close();
    }
  });

  test("without a session the route answers 401, and POST is 405", async () => {
    const db = migratedDatabase();
    try {
      const env = envFor(db);
      const anonymous = await api("GET", "/api/byok", env);
      assert.equal(anonymous.status, 401);
      assert.deepEqual(await jsonBody(anonymous), { code: "byok_unauthorized", error: "Unauthorized" });
      const cookie = await insertUser(db, "usr_a", "a@example.test", "pro");
      const post = await api("POST", "/api/byok", env, { headers: { cookie }, body: "{}" });
      assert.equal(post.status, 405);
      const postBody = await jsonBody(post);
      assert.equal(postBody.code, "method_not_allowed");
    } finally {
      db.close();
    }
  });

  test("an account-level agent key with a write permission manages the endpoint", async () => {
    const db = migratedDatabase();
    try {
      await insertUser(db, "usr_a", "a@example.test", "pro");
      const env = envFor(db);

      // manage and full are the write permissions.
      for (const permission of ["manage", "full"] as const) {
        const token = await insertAgentKeyWithToken(db, `key_${permission}`, "usr_a", permission, `pak_${permission.repeat(43).slice(0, 43)}`);
        const put = await api("PUT", "/api/byok", env, {
          body: JSON.stringify({ apiKey: TEST_KEY, baseUrl: "https://api.example.test/v1", chatModel: "chat-1" }),
          headers: { authorization: `Bearer ${token}` },
        });
        assert.equal(put.status, 200, permission);
        const get = await api("GET", "/api/byok", env, { headers: { authorization: `Bearer ${token}` } });
        assert.equal(get.status, 200, permission);
        assert.equal((await jsonBody(get)).configured, true, permission);
        const del = await api("DELETE", "/api/byok", env, { headers: { authorization: `Bearer ${token}` } });
        assert.equal(del.status, 200, permission);
      }

      // read and share are not write permissions; neither is a key scoped
      // to a collection: the endpoint is account-level.
      for (const [permission, resourceType] of [["read", "account"], ["share", "account"], ["manage", "collection"]] as const) {
        const db2 = migratedDatabase();
        try {
          await insertUser(db2, "usr_a", "a@example.test", "pro");
          if (resourceType === "collection") {
            db2.query("INSERT INTO projects (id, owner_id, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)").run("p_a", "usr_a", "P", NOW, NOW);
            db2.query("INSERT INTO collections (id, project_id, owner_id, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)").run("c_a", "p_a", "usr_a", "C", NOW, NOW);
          }
          const token = await insertAgentKeyWithToken(db2, `key_${permission}_${resourceType}`, "usr_a", permission, `pak_${(permission + resourceType).repeat(43).slice(0, 43)}`, resourceType, resourceType === "collection" ? "c_a" : null);
          const env2 = envFor(db2);
          for (const method of ["GET", "PUT", "DELETE"] as const) {
            const response = await api(method, "/api/byok", env2, {
              body: method === "PUT" ? JSON.stringify({ apiKey: TEST_KEY, baseUrl: "https://api.example.test/v1" }) : undefined,
              headers: { authorization: `Bearer ${token}` },
            });
            assert.equal(response.status, 403, `${permission}/${resourceType} ${method}`);
            assert.equal((await jsonBody(response)).code, "byok_forbidden");
          }
          assert.equal(db2.query("SELECT * FROM byok_endpoints").all().length, 0);
        } finally {
          db2.close();
        }
      }
    } finally {
      db.close();
    }
  });

  test("an account neither reads nor changes the BYOK of another", async () => {
    const db = migratedDatabase();
    try {
      const cookieA = await insertUser(db, "usr_a", "a@example.test", "pro");
      const cookieB = await insertUser(db, "usr_b", "b@example.test", "pro");
      const env = envFor(db);
      await api("PUT", "/api/byok", env, {
        body: JSON.stringify({ apiKey: TEST_KEY, baseUrl: "https://apiA.example.test/v1", chatModel: "chat-1" }),
        headers: { cookie: cookieA, "content-type": "application/json" },
      });

      // B reads nothing of A (the URL parser lowercases hosts: apiA and
      // apiB read back as apia and apib).
      const getB = await api("GET", "/api/byok", env, { headers: { cookie: cookieB } });
      const getBText = await getB.text();
      const viewB = byokView(JSON.parse(getBText) as unknown as ByokView);
      assert.equal(viewB.configured, false, "B sees no endpoint");
      assert.ok(!getBText.includes("apia"), "B's answer carries nothing of A");

      // B deletes: A's row is untouched.
      const before = db.query("SELECT * FROM byok_endpoints WHERE owner_id = 'usr_a'").get();
      const delB = await api("DELETE", "/api/byok", env, { headers: { cookie: cookieB } });
      assert.equal(delB.status, 200);
      assert.deepEqual(db.query("SELECT * FROM byok_endpoints WHERE owner_id = 'usr_a'").get(), before);

      // B saves its own: A's row is still untouched.
      const putB = await api("PUT", "/api/byok", env, {
        body: JSON.stringify({ apiKey: "sk-byok-b-other-9999", baseUrl: "https://apiB.example.test/v1", chatModel: "chat-1" }),
        headers: { cookie: cookieB, "content-type": "application/json" },
      });
      assert.equal(putB.status, 200);
      assert.deepEqual(db.query("SELECT * FROM byok_endpoints WHERE owner_id = 'usr_a'").get(), before, "A's row is untouched");
      const rowB = db.query("SELECT * FROM byok_endpoints WHERE owner_id = 'usr_b'").get() as Record<string, unknown>;
      assert.equal(rowB.base_url, "https://apib.example.test/v1", "the host is lowercased by the normalization");
      assert.equal(rowB.key_last4, "9999");
    } finally {
      db.close();
    }
  });

  test("the same behavior without a database (the in-memory deployment)", async () => {
    const env: CloudEnv = { BYOK_MASTER_KEY: MASTER_KEY };
    const a = await seedCloudWebSessionForTests({ email: "a@example.test", plan: "pro" });
    const b = await seedCloudWebSessionForTests({ email: "b@example.test", plan: "pro" });
    const header = { cookie: a.cookie };

    const empty = await api("GET", "/api/byok", env, { headers: header });
    assert.equal(empty.status, 200);
    assert.equal((await jsonBody(empty)).configured, false);

    const put = await api("PUT", "/api/byok", env, {
      body: JSON.stringify({ apiKey: TEST_KEY, baseUrl: "https://api.example.test/v1/", chatModel: "chat-1" }),
      headers: { ...header, "content-type": "application/json" },
    });
    assert.equal(put.status, 200);
    const view = byokView(await jsonBody(put));
    assert.equal(view.configured, true);
    assert.equal(view.baseUrl, "https://api.example.test/v1");
    assert.equal(view.keyLast4, "1234");
    assert.deepEqual(view.capabilities, TESTED_CHAT);

    // B does not see A's memory row.
    const getB = await api("GET", "/api/byok", env, { headers: { cookie: b.cookie } });
    assert.equal((await jsonBody(getB)).configured, false);

    // The update without apiKey keeps the key; the DELETE removes it.
    const put2 = await api("PUT", "/api/byok", env, {
      body: JSON.stringify({ baseUrl: "https://api2.example.test/v1" }),
      headers: { ...header, "content-type": "application/json" },
    });
    assert.equal(put2.status, 200);
    assert.equal(byokView(await jsonBody(put2)).keyLast4, "1234");
    const del = await api("DELETE", "/api/byok", env, { headers: header });
    assert.equal(del.status, 200);
    assert.equal((await jsonBody(del)).configured, false);
  });

  test("without a valid master key the BYOK is unavailable and the Cloud goes on", async () => {
    const db = migratedDatabase();
    try {
      const cookie = await insertUser(db, "usr_a", "a@example.test", "pro");
      const header = { cookie };
      for (const masterKey of [undefined, "", Buffer.alloc(16, 7).toString("base64"), "not-base64!!!"] as const) {
        const env = envFor(db, { BYOK_MASTER_KEY: masterKey });
        for (const method of ["GET", "PUT", "DELETE"] as const) {
          const response = await api(method, "/api/byok", env, {
            body: method === "PUT" ? JSON.stringify({ apiKey: TEST_KEY, baseUrl: "https://api.example.test/v1" }) : undefined,
            headers: header,
          });
          assert.equal(response.status, 503, `master ${String(masterKey).slice(0, 8)} ${method}`);
          assert.equal((await jsonBody(response)).code, "byok_unavailable");
        }
      }
      // The rest of the Cloud answers as usual.
      const health = await api("GET", "/api/health", envFor(db, { BYOK_MASTER_KEY: undefined }));
      assert.equal(health.status, 200);
      assert.equal(db.query("SELECT * FROM byok_endpoints").all().length, 0, "nothing was stored");
    } finally {
      db.close();
    }
  });

  test("a database without the 0034 answers 503 byok_unavailable and nothing else breaks", async () => {
    const db = migratedDatabase(false);
    try {
      const cookie = await insertUser(db, "usr_a", "a@example.test", "pro");
      const env = envFor(db);
      const header = { cookie };
      for (const method of ["GET", "PUT", "DELETE"] as const) {
        const response = await api(method, "/api/byok", env, {
          body: method === "PUT" ? JSON.stringify({ apiKey: TEST_KEY, baseUrl: "https://api.example.test/v1" }) : undefined,
          headers: header,
        });
        assert.equal(response.status, 503, method);
        assert.equal((await jsonBody(response)).code, "byok_unavailable");
      }
      // The rest of the Cloud keeps working on the same database.
      const health = await api("GET", "/api/health", env);
      assert.equal(health.status, 200);
      const session = await api("GET", "/api/auth/session", env, { headers: header });
      assert.equal(session.status, 200);
    } finally {
      db.close();
    }
  });

  test("validation errors are 400 without echoing any value", async () => {
    const db = migratedDatabase();
    try {
      const cookie = await insertUser(db, "usr_a", "a@example.test", "pro");
      const env = envFor(db);
      const header = { ...{ cookie }, "content-type": "application/json" };
      const cases: Array<[Record<string, unknown>, string, string]> = [
        [{}, "invalid_base_url", "the base URL is missing"],
        [{ baseUrl: 42 }, "invalid_base_url", "the base URL is not a string"],
        [{ baseUrl: "http://api.example.test/v1", apiKey: TEST_KEY }, "invalid_base_url", "not https"],
        [{ baseUrl: "https://api.example.test:8443/v1", apiKey: TEST_KEY }, "invalid_base_url", "the port"],
        [{ baseUrl: "https://127.0.0.1/v1", apiKey: TEST_KEY }, "invalid_base_url", "loopback"],
        [{ baseUrl: "https://2130706433/v1", apiKey: TEST_KEY }, "invalid_base_url", "the decimal spelling of 127.0.0.1"],
        [{ baseUrl: "https://[::ffff:192.168.0.1]/v1", apiKey: TEST_KEY }, "invalid_base_url", "the IPv4-mapped private"],
        [{ baseUrl: "https://localhost/v1", apiKey: TEST_KEY }, "invalid_base_url", "localhost"],
        [{ baseUrl: "https://api.example.test/v1" + "p".repeat(2100), apiKey: TEST_KEY }, "invalid_base_url", "over 2048"],
        [{ baseUrl: "https://api.example.test/v1" }, "api_key_required", "a new endpoint needs a key"],
        [{ baseUrl: "https://api.example.test/v1", apiKey: 123 }, "invalid_api_key", "a non-string key"],
        [{ baseUrl: "https://api.example.test/v1", apiKey: "k".repeat(4097) }, "invalid_api_key", "over 4096"],
        [{ baseUrl: "https://api.example.test/v1", apiKey: TEST_KEY, chatModel: "m".repeat(201) }, "invalid_model", "over 200"],
        [{ baseUrl: "https://api.example.test/v1", apiKey: TEST_KEY, chatModel: 9 }, "invalid_model", "a non-string model"],
      ];
      for (const [body, code, label] of cases) {
        const response = await api("PUT", "/api/byok", env, { body: JSON.stringify(body), headers: header });
        assert.equal(response.status, 400, label);
        const parsed = await jsonBody(response);
        assert.equal(parsed.code, code, label);
        assert.ok(typeof parsed.error === "string");
      }
      // Nothing was stored by the failed PUTs.
      assert.equal(db.query("SELECT * FROM byok_endpoints").all().length, 0);
      // The limits have inclusive edges: exactly at the cap it is accepted.
      const atCap = await api("PUT", "/api/byok", env, {
        body: JSON.stringify({ apiKey: "k".repeat(4096), baseUrl: "https://api.example.test/v1", chatModel: "m".repeat(200) }),
        headers: header,
      });
      assert.equal(atCap.status, 200, "exactly 4096 and 200 are allowed");
    } finally {
      db.close();
    }
  });

  test("the key never appears in a response body or a console line", async () => {
    const capture = new ConsoleCapture();
    const db = migratedDatabase();
    try {
      const cookie = await insertUser(db, "usr_a", "a@example.test", "pro");
      const env = envFor(db);
      const header = { ...{ cookie }, "content-type": "application/json" };

      const responses: Response[] = [];
      responses.push(await api("PUT", "/api/byok", env, { body: JSON.stringify({ apiKey: TEST_KEY, baseUrl: "https://api.example.test/v1", chatModel: "chat-1" }), headers: header }));
      responses.push(await api("GET", "/api/byok", env, { headers: { cookie } }));
      responses.push(await api("PUT", "/api/byok", env, { body: JSON.stringify({ apiKey: TEST_KEY, baseUrl: "https://api.example.test/v1", chatModel: "chat-1" }), headers: header }));
      // Errors as well: a refused URL and an unavailable BYOK.
      responses.push(await api("PUT", "/api/byok", env, { body: JSON.stringify({ apiKey: TEST_KEY, baseUrl: "https://10.0.0.1/v1" }), headers: header }));
      responses.push(await api("GET", "/api/byok", envFor(db, { BYOK_MASTER_KEY: undefined }), { headers: { cookie } }));
      responses.push(await api("DELETE", "/api/byok", env, { headers: { cookie } }));
      for (const response of responses) {
        const text = await response.text();
        assert.ok(!text.includes(TEST_KEY), `the response leaked the key (${response.status}):\n${text}`);
        assert.ok(!text.includes("sk-byok"), "no fragment of the key is returned");
      }
      // The stored ciphertext is not the key either.
      const row = db.query("SELECT * FROM byok_endpoints").get() as Record<string, unknown> | null;
      assert.equal(row, null, "the DELETE removed the row");
      capture.assertNotLeaked(TEST_KEY);
    } finally {
      db.close();
      capture.restore();
    }
  });

  test("a row written by a rotated master key does not break the route", async () => {
    const db = migratedDatabase();
    try {
      const cookie = await insertUser(db, "usr_b", "b@example.test", "pro");
      const header = { cookie };
      const first = envFor(db);
      const saved = await api("PUT", "/api/byok", first, {
        body: JSON.stringify({ apiKey: TEST_KEY, baseUrl: "https://api.example.test/v1", chatModel: "chat-1" }),
        headers: header,
      });
      assert.equal(saved.status, 200);
      // A second master key (a rotation): the route still answers. Reading
      // needs no decryption; the row is still readable.
      const rotated = envFor(db, { BYOK_MASTER_KEY: OTHER_MASTER_KEY });
      const get = await api("GET", "/api/byok", rotated, { headers: header });
      assert.equal(get.status, 200);
      assert.equal((await jsonBody(get)).configured, true);
      // And a new save under the rotated key stores the rotated key_id.
      const put = await api("PUT", "/api/byok", rotated, {
        body: JSON.stringify({ apiKey: "sk-byok-rotated-7777", baseUrl: "https://api.example.test/v1" }),
        headers: header,
      });
      assert.equal(put.status, 200);
      const { byokCrypto } = await import("./crypto");
      const row = db.query("SELECT * FROM byok_endpoints WHERE owner_id = 'usr_b'").get() as Record<string, unknown>;
      assert.equal(String(row.key_ciphertext).split(":")[1], (await byokCrypto(OTHER_MASTER_KEY))!.keyId, "the new key_id is the rotated one");
      assert.notEqual(String(row.key_ciphertext).split(":")[1], (await byokCrypto(MASTER_KEY))!.keyId);
    } finally {
      db.close();
    }
  });
});

// The handler is also importable directly (S2 and the tests of the egress
// build on it): the same answers outside handleCloudApiRequest.
describe("handleByokRequest directly", () => {
  afterEach(() => {
    resetCloudMemoryStateForTests();
    resetByokMemoryStateForTests();
    resetByokTestWindowsForTests();
    setByokEgressForTests(null);
    setCloudNowForTests(null);
    setByokNowForTests(null);
  });

  test("the memory deployment answers through the same handler", async () => {
    setCloudNowForTests(NOW);
    setByokNowForTests(NOW);
    setByokEgressForTests(passingEgress());
    const env: CloudEnv = { BYOK_MASTER_KEY: MASTER_KEY };
    const account = await seedCloudWebSessionForTests({ email: "a@example.test", plan: "pro" });
    const put = await handleByokRequest(
      new Request("https://pinar.test/api/byok", {
        body: JSON.stringify({ apiKey: TEST_KEY, baseUrl: "https://api.example.test/v1", chatModel: "chat-1" }),
        headers: { cookie: account.cookie, "content-type": "application/json" },
        method: "PUT",
      }),
      env,
    );
    assert.equal(put.status, 200);
    assert.equal((await jsonBody(put)).keyLast4, "1234");
    const get = await handleByokRequest(new Request("https://pinar.test/api/byok", { headers: { cookie: account.cookie } }), env);
    assert.equal(get.status, 200);
    assert.equal((await jsonBody(get)).configured, true);
  });
});

// The probes of the F4d security review (17/10), through the same entry
// point the probes used: handleCloudApiRequest on a migrated database.
describe("/api/byok security review probes (F4d)", () => {
  beforeEach(() => {
    resetCloudMemoryStateForTests();
    resetByokMemoryStateForTests();
    resetByokTestWindowsForTests();
    setByokEgressForTests(passingEgress());
    setCloudNowForTests(NOW);
    setByokNowForTests(NOW);
  });

  afterEach(() => {
    resetCloudMemoryStateForTests();
    resetByokMemoryStateForTests();
    resetByokTestWindowsForTests();
    setByokEgressForTests(null);
    setCloudNowForTests(null);
    setByokNowForTests(null);
  });

  test("a forbidden hostname with the DNS trailing dot is refused by the PUT and not stored", async () => {
    const db = migratedDatabase();
    try {
      const cookie = await insertUser(db, "usr_dot", "dot@example.test", "pro");
      const env = envFor(db);
      for (const baseUrl of [
        "https://LOCALHOST./v1/",
        "https://a.localhost./v1",
        "https://metadata.google.internal./v1",
        "https://foo.local./v1",
      ]) {
        const response = await api("PUT", "/api/byok", env, {
          body: JSON.stringify({ apiKey: TEST_KEY, baseUrl }),
          headers: { cookie },
        });
        assert.equal(response.status, 400, baseUrl);
        assert.equal((await jsonBody(response)).code, "invalid_base_url", baseUrl);
      }
      // Nothing was stored by the refused PUTs.
      assert.equal(db.query("SELECT * FROM byok_endpoints").all().length, 0);
    } finally {
      db.close();
    }
  });

  test("a forbidden hostname with two terminal dots is refused by the PUT and not stored", async () => {
    // The double-dot variant of the trailing-dot finding: stripping a
    // single dot would leave the forbidden one-dot form, so the PUT must
    // refuse the input itself — nothing may be stored that the validator
    // would refuse on revalidation.
    const db = migratedDatabase();
    try {
      const cookie = await insertUser(db, "usr_double", "double@example.test", "pro");
      const env = envFor(db);
      for (const baseUrl of [
        "https://localhost..",
        "https://localhost..:443/v1/",
        "https://a.localhost..",
        "https://metadata.google.internal..",
        "https://foo.local..",
      ]) {
        const response = await api("PUT", "/api/byok", env, {
          body: JSON.stringify({ apiKey: TEST_KEY, baseUrl }),
          headers: { cookie },
        });
        assert.equal(response.status, 400, baseUrl);
        assert.equal((await jsonBody(response)).code, "invalid_base_url", baseUrl);
      }
      // Nothing was stored by the refused PUTs.
      assert.equal(db.query("SELECT * FROM byok_endpoints").all().length, 0);
    } finally {
      db.close();
    }
  });

  test("every BYOK answer is no-store, including the early 401, 400 and 405", async () => {
    const db = migratedDatabase();
    try {
      const cookie = await insertUser(db, "usr_cache", "cache@example.test", "pro");
      const env = envFor(db);
      const responses = [
        await api("GET", "/api/byok", env), // anonymous: 401
        await api("PUT", "/api/byok", env, { body: "{}", headers: { cookie } }), // 400 of validation
        await api("POST", "/api/byok", env, { body: "{}", headers: { cookie } }), // 405
      ];
      assert.deepEqual(responses.map((response) => response.status), [401, 400, 405]);
      for (const response of responses) {
        assert.equal(response.headers.get("cache-control"), "no-store", `status ${response.status}`);
      }
    } finally {
      db.close();
    }
  });

  test("a hostile origin is refused and keeps the saved endpoint; a driver error is not echoed", async () => {
    const db = migratedDatabase();
    const capture = new ConsoleCapture();
    try {
      const cookie = await insertUser(db, "usr_csrf", "csrf@example.test", "pro");
      const env = envFor(db);
      const saved = await api("PUT", "/api/byok", env, {
        body: JSON.stringify({ apiKey: TEST_KEY, baseUrl: "https://api.example.test/v1", chatModel: "chat-1" }),
        headers: { cookie, origin: "https://pinar.test" },
      });
      assert.equal(saved.status, 200);
      const before = db.query("SELECT * FROM byok_endpoints").get();
      for (const method of ["PUT", "DELETE"] as const) {
        const response = await api(method, "/api/byok", env, {
          body: method === "PUT" ? JSON.stringify({ apiKey: "attacker", baseUrl: "https://hostile.example/v1" }) : undefined,
          headers: { cookie, origin: "https://hostile.example" },
        });
        assert.equal(response.status, 403, method);
        assert.deepEqual(db.query("SELECT * FROM byok_endpoints").get(), before, method);
      }
      // A driver that echoes the bound value into its error message must
      // not leak it: the catch of the route answers a generic 503.
      db.exec("CREATE TRIGGER review_fail BEFORE UPDATE ON byok_endpoints BEGIN SELECT RAISE(ABORT,'synthetic-secret-in-driver-error'); END;");
      const failed = await api("PUT", "/api/byok", env, {
        body: JSON.stringify({ apiKey: TEST_KEY, baseUrl: "https://api.example.test/v1" }),
        headers: { cookie },
      });
      assert.equal(failed.status, 503);
      assert.ok(!(await failed.text()).includes("synthetic-secret-in-driver-error"));
      capture.assertNotLeaked(TEST_KEY);
      capture.assertNotLeaked("synthetic-secret-in-driver-error");
    } finally {
      capture.restore();
      db.close();
    }
  });

  test("the saved ciphertext row cascades when the account is deleted", async () => {
    const db = migratedDatabase();
    try {
      const cookie = await insertUser(db, "usr_cascade", "cascade@example.test", "pro");
      const env = envFor(db);
      const saved = await api("PUT", "/api/byok", env, {
        body: JSON.stringify({ apiKey: TEST_KEY, baseUrl: "https://api.example.test/v1", chatModel: "chat-1" }),
        headers: { cookie },
      });
      assert.equal(saved.status, 200);
      const row = db.query("SELECT key_ciphertext FROM byok_endpoints").get() as { key_ciphertext: string } | null;
      assert.ok(row, "the row exists after the API save");
      assert.ok(!row.key_ciphertext.includes(TEST_KEY), "the ciphertext does not carry the plaintext key");
      db.exec("DELETE FROM users WHERE id='usr_cascade'");
      assert.equal(db.query("SELECT * FROM byok_endpoints").all().length, 0);
    } finally {
      db.close();
    }
  });
});

// F5/S2: POST /api/byok/test — the capability detection through the
// injectable egress (a fake in the tests, byokFetch in production, which
// refuses), the per-user limit, and the recording of the result in
// capabilities_json. The PUT also marks the owner's pin index stale when
// the embedding model (or the endpoint) changes.
describe("/api/byok/test (F5/S2)", () => {
  beforeEach(() => {
    resetCloudMemoryStateForTests();
    resetByokMemoryStateForTests();
    resetByokTestWindowsForTests();
    setByokEgressForTests(null);
    setCloudNowForTests(NOW);
    setByokNowForTests(NOW);
  });

  afterEach(() => {
    resetCloudMemoryStateForTests();
    resetByokMemoryStateForTests();
    resetByokTestWindowsForTests();
    setByokEgressForTests(null);
    setCloudNowForTests(null);
    setByokNowForTests(null);
  });

  // The PUT tests before it saves, so the save runs on the passing fake
  // egress and consumes one test of the window. These tests are about the
  // POST: the helper puts the egress back to none (production) and clears
  // the window, so each test counts only its own POSTs.
  async function saveEndpoint(db: Database, env: CloudEnv, cookie: string, baseUrl = "https://api.example.test/v1") {
    setByokEgressForTests(passingEgress());
    const response = await api("PUT", "/api/byok", env, {
      body: JSON.stringify({
        apiKey: TEST_KEY,
        baseUrl,
        chatModel: "chat-1",
        embeddingModel: "embed-1",
        transcriptionModel: "tr-1",
      }),
      headers: { cookie, "content-type": "application/json" },
    });
    assert.equal(response.status, 200);
    setByokEgressForTests(null);
    db.query("DELETE FROM auth_rate_limits WHERE action = 'byok_test'").run();
    resetByokTestWindowsForTests();
    return response;
  }

  const TESTED = {
    chat: { error: null, ok: true, testedAt: NOW },
    embeddings: { dims: 256, error: null, ok: true, testedAt: NOW },
    tools: { error: null, ok: true, testedAt: NOW },
    transcription: { error: null, ok: true, testedAt: NOW },
    vision: { error: null, ok: true, testedAt: NOW },
  };

  test("a Pro account tests the connection; the view is recorded and never carries the key", async () => {
    const db = migratedDatabase();
    try {
      const cookie = await insertUser(db, "usr_test", "test@example.test", "pro");
      const env = envFor(db);
      const header = { cookie };
      await saveEndpoint(db, env, cookie);
      setByokEgressForTests(passingEgress());

      const test = await api("POST", "/api/byok/test", env, { headers: header });
      assert.equal(test.status, 200);
      assert.equal(test.headers.get("cache-control"), "no-store");
      const testText = await test.clone().text();
      const testView = byokView(JSON.parse(testText) as unknown as ByokView);
      assert.deepEqual(testView.capabilities, TESTED);
      assert.equal(testView.updatedAt, NOW);
      assert.ok(!testText.includes(TEST_KEY), "the key is not in the answer");

      // The result is recorded in capabilities_json and comes back in the GET.
      const row = db.query("SELECT capabilities_json, updated_at FROM byok_endpoints WHERE owner_id = 'usr_test'").get() as {
        capabilities_json: string;
        updated_at: string;
      };
      assert.deepEqual(JSON.parse(row.capabilities_json), TESTED);
      assert.equal(row.updated_at, NOW);
      const get = await api("GET", "/api/byok", env, { headers: header });
      assert.equal(get.status, 200);
      assert.deepEqual(byokView(await jsonBody(get)).capabilities, TESTED);
    } finally {
      db.close();
    }
  });

  test("without BYOK configured it is 404 byok_not_configured; without the master key 503 byok_unavailable", async () => {
    const db = migratedDatabase();
    try {
      const cookie = await insertUser(db, "usr_none", "none@example.test", "pro");
      const env = envFor(db);
      const notConfigured = await api("POST", "/api/byok/test", env, { headers: { cookie } });
      assert.equal(notConfigured.status, 404);
      assert.equal(notConfigured.headers.get("cache-control"), "no-store");
      assert.deepEqual(await jsonBody(notConfigured), { code: "byok_not_configured", error: "The BYOK endpoint is not configured" });

      await saveEndpoint(db, env, cookie);
      const noMaster = await api("POST", "/api/byok/test", envFor(db, { BYOK_MASTER_KEY: undefined }), { headers: { cookie } });
      assert.equal(noMaster.status, 503);
      assert.deepEqual(await jsonBody(noMaster), { code: "byok_unavailable", error: "BYOK is not available on this deployment" });
      // Nothing was tested or recorded: the row keeps the save's own result.
      const row = db.query("SELECT capabilities_json FROM byok_endpoints").get() as { capabilities_json: string };
      assert.deepEqual(JSON.parse(row.capabilities_json), TESTED);
    } finally {
      db.close();
    }
  });

  test("in production, without an injected egress: egress_unavailable and no network call", async () => {
    const db = migratedDatabase();
    try {
      const cookie = await insertUser(db, "usr_prod", "prod@example.test", "pro");
      const env = envFor(db);
      await saveEndpoint(db, env, cookie);

      // Spy on the global fetch: byokFetch refuses before any fetch, so
      // nothing may reach the network in S2.
      const realFetch = globalThis.fetch;
      let fetchCalls = 0;
      globalThis.fetch = () => {
        fetchCalls += 1;
        return Promise.reject(new Error("the network must not be reached"));
      };
      try {
        const test = await api("POST", "/api/byok/test", env, { headers: { cookie } });
        assert.equal(test.status, 200);
        const view = byokView(await jsonBody(test));
        for (const capability of ["chat", "tools", "vision"] as const) {
          assert.deepEqual(view.capabilities[capability], { error: "egress_unavailable", ok: false, testedAt: NOW }, capability);
        }
        assert.deepEqual(view.capabilities.embeddings, { dims: null, error: "egress_unavailable", ok: false, testedAt: NOW });
        assert.deepEqual(view.capabilities.transcription, { error: "egress_unavailable", ok: false, testedAt: NOW });
        assert.equal(fetchCalls, 0, "no call reached the global fetch");
      } finally {
        globalThis.fetch = realFetch;
      }
    } finally {
      db.close();
    }
  });

  test("the limit: six tests per hour, 429 byok_test_limited, and the window restarts", async () => {
    const db = migratedDatabase();
    try {
      const cookie = await insertUser(db, "usr_limit", "limit@example.test", "pro");
      const env = envFor(db);
      await saveEndpoint(db, env, cookie);
      setByokEgressForTests(passingEgress());
      for (let index = 1; index <= 6; index += 1) {
        const response = await api("POST", "/api/byok/test", env, { headers: { cookie } });
        assert.equal(response.status, 200, `test ${index}`);
      }
      const limited = await api("POST", "/api/byok/test", env, { headers: { cookie } });
      assert.equal(limited.status, 429);
      assert.equal(limited.headers.get("cache-control"), "no-store");
      assert.deepEqual(await jsonBody(limited), {
        code: "byok_test_limited",
        error: "Too many connection tests; try again later (limit: 6 per hour)",
      });
      // The next hour restarts the window.
      setByokNowForTests(Date.parse(NOW) + 60 * 60 * 1000 + 1);
      const again = await api("POST", "/api/byok/test", env, { headers: { cookie } });
      assert.equal(again.status, 200);
    } finally {
      db.close();
    }
  });

  test("at most one test in flight: the concurrent test is 429", async () => {
    const db = migratedDatabase();
    try {
      const cookie = await insertUser(db, "usr_inflight", "inflight@example.test", "pro");
      const env = envFor(db);
      await saveEndpoint(db, env, cookie);
      const slow = async () => {
        await new Promise((resolve) => setTimeout(resolve, 50));
        return Response.json(applianceCatalog);
      };
      setByokEgressForTests(slow);
      const [first, second] = await Promise.all([
        api("POST", "/api/byok/test", env, { headers: { cookie } }),
        api("POST", "/api/byok/test", env, { headers: { cookie } }),
      ]);
      assert.deepEqual([first.status, second.status].sort((a, b) => a - b), [200, 429]);
      const limited = [first, second].find((response) => response.status === 429);
      assert.deepEqual(await jsonBody(limited!), {
        code: "byok_test_limited",
        error: "Too many connection tests; try again later (limit: 6 per hour)",
      });
      // The in-flight mark drained: a following test runs.
      const third = await api("POST", "/api/byok/test", env, { headers: { cookie } });
      assert.equal(third.status, 200);
    } finally {
      db.close();
    }
  });

  test("another account neither tests nor sees the BYOK of the first", async () => {
    const db = migratedDatabase();
    try {
      const cookieA = await insertUser(db, "usr_a", "a@example.test", "pro");
      const cookieB = await insertUser(db, "usr_b", "b@example.test", "pro");
      const env = envFor(db);
      await saveEndpoint(db, env, cookieA);
      const before = db.query("SELECT * FROM byok_endpoints WHERE owner_id = 'usr_a'").get();
      setByokEgressForTests(passingEgress());

      // B has no endpoint of its own: the test is 404, and nothing of A
      // (not even a call to A's endpoint) happens.
      const testB = await api("POST", "/api/byok/test", env, { headers: { cookie: cookieB } });
      assert.equal(testB.status, 404);
      assert.equal((await jsonBody(testB)).code, "byok_not_configured");
      assert.deepEqual(db.query("SELECT * FROM byok_endpoints WHERE owner_id = 'usr_a'").get(), before, "A's row is untouched");

      // A's test records A's row only; B still reads its own (absent) row.
      const testA = await api("POST", "/api/byok/test", env, { headers: { cookie: cookieA } });
      assert.equal(testA.status, 200);
      assert.deepEqual(db.query("SELECT * FROM byok_endpoints WHERE owner_id = 'usr_b'").all(), [], "B has no row");
      const getB = await api("GET", "/api/byok", env, { headers: { cookie: cookieB } });
      assert.equal(byokView(await jsonBody(getB)).configured, false);
    } finally {
      db.close();
    }
  });

  test("the access of the other routes: Pro, the agent key with a write permission, and the method", async () => {
    const db = migratedDatabase();
    try {
      const cookieFree = await insertUser(db, "usr_free", "free@example.test", "free");
      const env = envFor(db);
      const free = await api("POST", "/api/byok/test", env, { headers: { cookie: cookieFree } });
      assert.equal(free.status, 403);
      assert.equal((await jsonBody(free)).code, "byok_requires_pro");

      const cookiePro = await insertUser(db, "usr_a", "a@example.test", "pro");
      await saveEndpoint(db, env, cookiePro);
      const tokenRead = await insertAgentKeyWithToken(db, "key_read", "usr_a", "read", "pak_" + "r".repeat(43));
      const denied = await api("POST", "/api/byok/test", env, { headers: { authorization: `Bearer ${tokenRead}` } });
      assert.equal(denied.status, 403);
      assert.equal((await jsonBody(denied)).code, "byok_forbidden");

      const tokenManage = await insertAgentKeyWithToken(db, "key_manage", "usr_a", "manage", "pak_" + "m".repeat(43));
      setByokEgressForTests(passingEgress());
      const ok = await api("POST", "/api/byok/test", env, { headers: { authorization: `Bearer ${tokenManage}` } });
      assert.equal(ok.status, 200);

      // The method of the test route is POST; POST of the plain route stays 405.
      const get = await api("GET", "/api/byok/test", env, { headers: { cookie: cookiePro } });
      assert.equal(get.status, 405);
      assert.equal(get.headers.get("allow"), "POST");
      const postPlain = await api("POST", "/api/byok", env, { headers: { cookie: cookiePro }, body: "{}" });
      assert.equal(postPlain.status, 405);
      assert.equal(postPlain.headers.get("allow"), "DELETE, GET, PUT");
      // A hostile origin is refused, like the other mutation routes.
      const hostile = await api("POST", "/api/byok/test", env, { headers: { cookie: cookiePro, origin: "https://hostile.example" } });
      assert.equal(hostile.status, 403);
    } finally {
      db.close();
    }
  });

  // A held egress: the test enters (ready) and stays pending until release.
  function heldEgress() {
    let release: () => void = () => {};
    let entered: () => void = () => {};
    const hold = new Promise<void>((resolve) => {
      release = resolve;
    });
    const ready = new Promise<void>((resolve) => {
      entered = resolve;
    });
    setByokEgressForTests(async () => {
      entered();
      await hold;
      return Response.json(applianceCatalog);
    });
    return { release, ready };
  }

  test("a DELETE during the test is not undone: 409 byok_changed, the row stays deleted (D1)", async () => {
    const db = migratedDatabase();
    try {
      const cookie = await insertUser(db, "usr_race", "race@example.test", "pro");
      const env = envFor(db);
      const header = { cookie };
      await saveEndpoint(db, env, cookie);
      const { ready, release } = heldEgress();
      const testing = api("POST", "/api/byok/test", env, { headers: header });
      await ready;
      const del = await api("DELETE", "/api/byok", env, { headers: header });
      assert.equal(del.status, 200);
      release();
      const test = await testing;
      assert.equal(test.status, 409, "the result is discarded");
      const body = await jsonBody(test);
      assert.equal(body.code, "byok_changed");
      assert.equal((body.view as ByokView).configured, false, "the current view is the absent row");
      assert.equal(db.query("SELECT * FROM byok_endpoints WHERE owner_id = 'usr_race'").all().length, 0, "the row is not resurrected");
      const get = await api("GET", "/api/byok", env, { headers: header });
      assert.equal(byokView(await jsonBody(get)).configured, false);
    } finally {
      db.close();
    }
  });

  // The PUT shares the one test in flight, so in this process a PUT during
  // the test is refused 429; the write that lands in the middle comes from
  // another instance of the Cloud (here, straight in the table).
  test("a write during the test wins: 409 byok_changed, the new URL and its capabilities (D1)", async () => {
    const db = migratedDatabase();
    try {
      const cookie = await insertUser(db, "usr_race", "race@example.test", "pro");
      const env = envFor(db);
      const header = { cookie };
      await saveEndpoint(db, env, cookie);
      const { ready, release } = heldEgress();
      const testing = api("POST", "/api/byok/test", env, { headers: header });
      await ready;
      const put = await api("PUT", "/api/byok", env, {
        body: JSON.stringify({ baseUrl: "https://api2.example.test/v1", chatModel: "chat-1" }),
        headers: { ...header, "content-type": "application/json" },
      });
      assert.equal(put.status, 429, "the PUT shares the test in flight");
      assert.equal((await jsonBody(put)).code, "byok_test_limited");
      db.query("UPDATE byok_endpoints SET base_url = ?, chat_model = ?, capabilities_json = ? WHERE owner_id = 'usr_race'")
        .run("https://api2.example.test/v1", "chat-1", JSON.stringify(UNTESTED));
      release();
      const test = await testing;
      assert.equal(test.status, 409, "the old result is not saved over the new save");
      const body = await jsonBody(test);
      assert.equal(body.code, "byok_changed");
      const view = body.view as ByokView;
      assert.equal(view.configured, true);
      assert.equal(view.baseUrl, "https://api2.example.test/v1");
      assert.deepEqual(view.capabilities, UNTESTED, "the other write keeps its capabilities");
      const row = db.query("SELECT base_url, capabilities_json FROM byok_endpoints WHERE owner_id = 'usr_race'").get() as {
        base_url: string;
        capabilities_json: string;
      };
      assert.equal(row.base_url, "https://api2.example.test/v1");
      assert.deepEqual(JSON.parse(row.capabilities_json), UNTESTED);
      // The new configuration can be tested from scratch.
      setByokEgressForTests(passingEgress());
      const next = await api("POST", "/api/byok/test", env, { headers: header });
      assert.equal(next.status, 200);
      assert.equal((byokView(await jsonBody(next))).baseUrl, "https://api2.example.test/v1");
    } finally {
      db.close();
    }
  });

  test("the same races on the memory deployment: the test never resurrects nor clobbers", async () => {
    const env: CloudEnv = { BYOK_MASTER_KEY: MASTER_KEY };
    const account = await seedCloudWebSessionForTests({ email: "race@example.test", plan: "pro" });
    const header = { cookie: account.cookie };
    setByokEgressForTests(passingEgress());
    await handleByokRequest(
      new Request("https://pinar.test/api/byok", {
        body: JSON.stringify({ apiKey: TEST_KEY, baseUrl: "https://api.example.test/v1", chatModel: "chat-1" }),
        headers: { ...header, "content-type": "application/json" },
        method: "PUT",
      }),
      env,
    );
    // A DELETE during the test leaves the row deleted.
    let race = heldEgress();
    let testing = api("POST", "/api/byok/test", env, { headers: header });
    await race.ready;
    const del = await api("DELETE", "/api/byok", env, { headers: header });
    assert.equal(del.status, 200);
    race.release();
    const first = await testing;
    assert.equal(first.status, 409);
    const firstBody = await jsonBody(first);
    assert.equal(firstBody.code, "byok_changed");
    assert.equal((firstBody.view as ByokView).configured, false, "the current view is the absent row");
    const getAfterDelete = await api("GET", "/api/byok", env, { headers: header });
    assert.equal(byokView(await jsonBody(getAfterDelete)).configured, false, "the row is not resurrected");
    // The memory deployment is one process: a PUT during the test shares
    // the test in flight (429), and the test then records its result.
    setByokEgressForTests(passingEgress());
    await handleByokRequest(
      new Request("https://pinar.test/api/byok", {
        body: JSON.stringify({ apiKey: TEST_KEY, baseUrl: "https://api.example.test/v1", chatModel: "chat-1" }),
        headers: { ...header, "content-type": "application/json" },
        method: "PUT",
      }),
      env,
    );
    setByokNowForTests(LATER);
    race = heldEgress();
    testing = api("POST", "/api/byok/test", env, { headers: header });
    await race.ready;
    const put = await api("PUT", "/api/byok", env, {
      body: JSON.stringify({ baseUrl: "https://api2.example.test/v1" }),
      headers: { ...header, "content-type": "application/json" },
    });
    assert.equal(put.status, 429);
    assert.equal((await jsonBody(put)).code, "byok_test_limited");
    race.release();
    const second = await testing;
    assert.equal(second.status, 200);
    const secondView = byokView(await jsonBody(second));
    assert.equal(secondView.baseUrl, "https://api.example.test/v1", "the refused PUT changed nothing");
    assert.equal(secondView.capabilities.chat.testedAt, LATER);
  });

  test("the memory deployment runs the same test", async () => {
    const env: CloudEnv = { BYOK_MASTER_KEY: MASTER_KEY };
    const account = await seedCloudWebSessionForTests({ email: "a@example.test", plan: "pro" });
    const header = { cookie: account.cookie };
    const notConfigured = await api("POST", "/api/byok/test", env, { headers: header });
    assert.equal(notConfigured.status, 404);
    setByokEgressForTests(passingEgress());
    await handleByokRequest(
      new Request("https://pinar.test/api/byok", {
        body: JSON.stringify({ apiKey: TEST_KEY, baseUrl: "https://api.example.test/v1", chatModel: "chat-1" }),
        headers: { ...header, "content-type": "application/json" },
        method: "PUT",
      }),
      env,
    );
    setByokEgressForTests(passingEgress());
    const test = await api("POST", "/api/byok/test", env, { headers: header });
    assert.equal(test.status, 200);
    const view = byokView(await jsonBody(test));
    assert.equal(view.capabilities.chat.ok, true);
    assert.equal(view.capabilities.chat.testedAt, NOW);
  });
});

describe("the PUT marks the owner's pin index stale (F5/S2)", () => {
  beforeEach(() => {
    resetCloudMemoryStateForTests();
    resetByokMemoryStateForTests();
    resetByokTestWindowsForTests();
    setByokEgressForTests(passingEgress());
    setCloudNowForTests(NOW);
    setByokNowForTests(NOW);
  });

  afterEach(() => {
    resetCloudMemoryStateForTests();
    resetByokMemoryStateForTests();
    resetByokTestWindowsForTests();
    setByokEgressForTests(null);
    setCloudNowForTests(null);
    setByokNowForTests(null);
  });

  function markToken(db: Database, sessionId: string): string | null {
    const row = db.query("SELECT doc_hash FROM pin_index WHERE session_id = ? AND pin_id = ''").get(sessionId) as { doc_hash: string } | null;
    return row?.doc_hash ?? null;
  }

  test("D1: the embedding model (and the endpoint) change marks the index; another model does not", async () => {
    const db = migratedDatabase();
    try {
      const cookie = await insertUser(db, "usr_a", "a@example.test", "pro");
      const env = envFor(db);
      const header = { ...{ cookie }, "content-type": "application/json" };
      // A and B own an indexed session each.
      db.query(
        "INSERT INTO pin_index (session_id, pin_id, owner_id, number, model, vector, doc_text, doc_hash, truncated, caption, ocr, updated_at) "
          + "VALUES (?, 'pin_a', 'usr_a', 1, 'old-model', NULL, 't', 'h', 0, NULL, NULL, ?)",
      ).run("sess_a", NOW);
      db.query(
        "INSERT INTO pin_index (session_id, pin_id, owner_id, number, model, vector, doc_text, doc_hash, truncated, caption, ocr, updated_at) "
          + "VALUES (?, 'pin_b', 'usr_b', 1, 'old-model', NULL, 't', 'h', 0, NULL, NULL, ?)",
      ).run("sess_b", NOW);
      assert.equal(markToken(db, "sess_a"), null);

      // The first save with an embedding model marks A's index stale...
      const put1 = await api("PUT", "/api/byok", env, {
        body: JSON.stringify({ apiKey: TEST_KEY, baseUrl: "https://api.example.test/v1", chatModel: "chat-1", embeddingModel: "embed-1" }),
        headers: header,
      });
      assert.equal(put1.status, 200);
      assert.deepEqual(byokView(await jsonBody(put1)).capabilities, testedWith({ chat: true, embedding: true }), "the save records its own test");
      const token1 = markToken(db, "sess_a");
      assert.ok(token1, "A's session is marked");
      assert.equal(markToken(db, "sess_b"), null, "B's index is untouched");

      // The test passes and records the capabilities...
      const test = await api("POST", "/api/byok/test", env, { headers: { cookie } });
      assert.equal(test.status, 200);

      // ...and the change of the chat model records a new test, without a new mark.
      setByokNowForTests(LATER);
      const put2 = await api("PUT", "/api/byok", env, {
        body: JSON.stringify({ baseUrl: "https://api.example.test/v1", chatModel: "chat-2" }),
        headers: header,
      });
      assert.equal(put2.status, 200);
      assert.deepEqual(byokView(await jsonBody(put2)).capabilities, testedWith({ chat: true, embedding: true }, LATER), "the save records a new test");
      assert.equal(markToken(db, "sess_a"), token1, "the chat model does not re-mark the index");

      // The change of the embedding model re-marks it, with a fresh token...
      const put3 = await api("PUT", "/api/byok", env, {
        body: JSON.stringify({ baseUrl: "https://api.example.test/v1", embeddingModel: "embed-2" }),
        headers: header,
      });
      assert.equal(put3.status, 200);
      const token3 = markToken(db, "sess_a");
      assert.ok(token3 && token3 !== token1, "the embedding model change re-marks the index");

      // ...as does the change of the endpoint, keeping the same model.
      const put4 = await api("PUT", "/api/byok", env, {
        body: JSON.stringify({ baseUrl: "https://api2.example.test/v1" }),
        headers: header,
      });
      assert.equal(put4.status, 200);
      const token4 = markToken(db, "sess_a");
      assert.ok(token4 && token4 !== token3, "the endpoint change re-marks the index");
      assert.equal(markToken(db, "sess_b"), null, "B's index is still untouched");
    } finally {
      db.close();
    }
  });

  test("memory: the embedding model change marks the owner's sessions and nothing else", async () => {
    resetCloudPinIndexMemoryForTests();
    try {
      const env: CloudEnv = { BYOK_MASTER_KEY: MASTER_KEY };
      const account = await seedCloudWebSessionForTests({ email: "a@example.test", id: "usr_a", plan: "pro" });
      const header = { ...{ cookie: account.cookie }, "content-type": "application/json" };
      const storeA = cloudPinIndexStore({ DB: undefined }, "usr_a");
      const storeB = cloudPinIndexStore({ DB: undefined }, "usr_b");
      await storeA.replaceSession("mem_a", [pinIndexEntry("mem_a", "mem_a_p1")]);
      await storeB.replaceSession("mem_b", [pinIndexEntry("mem_b", "mem_b_p1")]);
      const sessionsA = [{ id: "mem_a", updatedAt: "2026-09-01T00:00:00.000Z" }];
      assert.deepEqual(await storeA.staleSessions({ limit: 10, sessions: sessionsA }), []);

      const put = await api("PUT", "/api/byok", env, {
        body: JSON.stringify({ apiKey: TEST_KEY, baseUrl: "https://api.example.test/v1", chatModel: "chat-1", embeddingModel: "embed-1" }),
        headers: header,
      });
      assert.equal(put.status, 200);
      assert.deepEqual(await storeA.staleSessions({ limit: 10, sessions: sessionsA }), ["mem_a"]);
      assert.deepEqual(await storeB.staleSessions({ limit: 10, sessions: [{ id: "mem_b", updatedAt: "2026-09-01T00:00:00.000Z" }] }), []);
    } finally {
      resetCloudPinIndexMemoryForTests();
    }
  });
});

// The PUT tests before it saves: the detection runs on the values the PUT
// received, under the same limit as POST /api/byok/test, and the row lands
// only when at least one capability passed, with that result.
describe("the PUT tests before it saves", () => {
  const OTHER_KEY = "sk-byok-other-secret-5678";

  beforeEach(() => {
    resetCloudMemoryStateForTests();
    resetByokMemoryStateForTests();
    resetByokTestWindowsForTests();
    setByokEgressForTests(null);
    setCloudNowForTests(NOW);
    setByokNowForTests(NOW);
  });

  afterEach(() => {
    resetCloudMemoryStateForTests();
    resetByokMemoryStateForTests();
    resetByokTestWindowsForTests();
    setByokEgressForTests(null);
    setCloudNowForTests(null);
    setByokNowForTests(null);
  });

  // Every call the detection makes, with the bearer it sent; the answer is
  // the given one (a 401 rejects the key on every capability).
  function recordingEgress(answer: () => Response) {
    const calls: Array<{ authorization: string | null; url: string }> = [];
    setByokEgressForTests(async (url, init) => {
      calls.push({ authorization: new Headers(init?.headers).get("authorization"), url });
      return answer();
    });
    return calls;
  }
  const rejecting = () => Response.json({ error: { message: "bad key" } }, { status: 401 });
  const passing = () => Response.json(applianceCatalog);

  function put(env: CloudEnv, cookie: string, body: Record<string, unknown>) {
    return api("PUT", "/api/byok", env, {
      body: JSON.stringify(body),
      headers: { cookie, "content-type": "application/json" },
    });
  }

  const FULL = { apiKey: TEST_KEY, baseUrl: "https://api.example.test/v1", chatModel: "chat-1", embeddingModel: "embed-1", transcriptionModel: "tr-1" };
  const REJECTED = {
    chat: { error: "key_rejected", ok: false, testedAt: NOW },
    embeddings: { dims: null, error: "key_rejected", ok: false, testedAt: NOW },
    tools: { error: "key_rejected", ok: false, testedAt: NOW },
    transcription: { error: "key_rejected", ok: false, testedAt: NOW },
    vision: { error: "key_rejected", ok: false, testedAt: NOW },
  };

  function windowAttempts(db: Database): number {
    const row = db.query("SELECT attempts FROM auth_rate_limits WHERE action = 'byok_test'").get() as { attempts: number } | null;
    return row?.attempts ?? 0;
  }

  test("no capability passed: 422 byok_test_failed with the tested capabilities, nothing stored, one test consumed", async () => {
    const db = migratedDatabase();
    const capture = new ConsoleCapture();
    try {
      const cookie = await insertUser(db, "usr_fail", "fail@example.test", "pro");
      const env = envFor(db);
      // A PUT refused by the validation never reaches the endpoint nor the limit.
      const calls = recordingEgress(rejecting);
      const refused = await put(env, cookie, { ...FULL, baseUrl: "https://10.0.0.1/v1" });
      assert.equal(refused.status, 400);
      const keyless = await put(env, cookie, { baseUrl: "https://api.example.test/v1", chatModel: "chat-1" });
      assert.equal(keyless.status, 400);
      assert.equal((await jsonBody(keyless)).code, "api_key_required");
      assert.equal(calls.length, 0, "the validation runs before any call");
      assert.equal(windowAttempts(db), 0, "a refused PUT does not consume the limit");

      const failed = await put(env, cookie, FULL);
      assert.equal(failed.status, 422);
      assert.equal(failed.headers.get("cache-control"), "no-store");
      const text = await failed.text();
      assert.ok(!text.includes(TEST_KEY), "the key is not in the answer");
      assert.deepEqual(JSON.parse(text), {
        capabilities: REJECTED,
        code: "byok_test_failed",
        error: "No capability passed the connection test; nothing was saved",
      });
      assert.equal(calls.length, 1, "the catalog's 401 decides every capability");
      assert.equal(calls[0]!.url, "https://api.example.test/v1/models");
      assert.equal(calls[0]!.authorization, `Bearer ${TEST_KEY}`, "the test ran on the key this PUT sent");
      assert.equal(windowAttempts(db), 1, "the failed PUT consumed exactly one test");
      assert.equal(db.query("SELECT * FROM byok_endpoints").all().length, 0, "nothing was stored");
      const get = await api("GET", "/api/byok", env, { headers: { cookie } });
      assert.equal(byokView(await jsonBody(get)).configured, false);
      capture.assertNotLeaked(TEST_KEY);
    } finally {
      capture.restore();
      db.close();
    }
  });

  test("after a 422 the previous configuration is intact and the pin index is not marked", async () => {
    const db = migratedDatabase();
    try {
      const cookie = await insertUser(db, "usr_keep", "keep@example.test", "pro");
      const env = envFor(db);
      db.query(
        "INSERT INTO pin_index (session_id, pin_id, owner_id, number, model, vector, doc_text, doc_hash, truncated, caption, ocr, updated_at) "
          + "VALUES ('sess_keep', 'pin_keep', 'usr_keep', 1, 'old-model', NULL, 't', 'h', 0, NULL, NULL, ?)",
      ).run(NOW);
      recordingEgress(passing);
      assert.equal((await put(env, cookie, FULL)).status, 200);
      const markOf = () => (db.query("SELECT doc_hash FROM pin_index WHERE session_id = 'sess_keep' AND pin_id = ''").get() as { doc_hash: string } | null)?.doc_hash ?? null;
      const mark = markOf();
      assert.ok(mark, "the first save marked the index");
      const before = db.query("SELECT * FROM byok_endpoints WHERE owner_id = 'usr_keep'").get();

      // Another key, URL and embedding model that do not pass: nothing moves.
      setByokNowForTests(LATER);
      const calls = recordingEgress(rejecting);
      const failed = await put(env, cookie, { ...FULL, apiKey: OTHER_KEY, baseUrl: "https://api2.example.test/v1", embeddingModel: "embed-2" });
      assert.equal(failed.status, 422);
      const failedText = await failed.text();
      assert.ok(!failedText.includes(OTHER_KEY) && !failedText.includes(TEST_KEY), "no key in the answer");
      assert.equal(calls[0]!.url, "https://api2.example.test/v1/models", "the test ran on the URL this PUT sent");
      assert.equal(calls[0]!.authorization, `Bearer ${OTHER_KEY}`);
      assert.deepEqual(db.query("SELECT * FROM byok_endpoints WHERE owner_id = 'usr_keep'").get(), before, "the stored row is intact");
      assert.equal(markOf(), mark, "the pin index is not marked again");
      const get = await api("GET", "/api/byok", env, { headers: { cookie } });
      const view = byokView(await jsonBody(get));
      assert.equal(view.baseUrl, "https://api.example.test/v1");
      assert.deepEqual(view.capabilities, TESTED_ALL, "the saved result is still the previous one");
    } finally {
      db.close();
    }
  });

  test("one capability passed: the row stores the result of the test, not the untested state", async () => {
    const db = migratedDatabase();
    try {
      const cookie = await insertUser(db, "usr_mixed", "mixed@example.test", "pro");
      const env = envFor(db);
      // The appliance catalog without the embeddings and audio items: the
      // chat passes, the other two are service_disabled.
      recordingEgress(() => Response.json({ data: [applianceCatalog.data[0]], object: "list" }));
      const saved = await put(env, cookie, FULL);
      assert.equal(saved.status, 200);
      const view = byokView(await jsonBody(saved));
      const expected = {
        chat: { error: null, ok: true, testedAt: NOW },
        embeddings: { dims: null, error: "service_disabled", ok: false, testedAt: NOW },
        tools: { error: null, ok: true, testedAt: NOW },
        transcription: { error: "service_disabled", ok: false, testedAt: NOW },
        vision: { error: null, ok: true, testedAt: NOW },
      };
      assert.deepEqual(view.capabilities, expected);
      assert.notDeepEqual(view.capabilities, UNTESTED);
      const row = db.query("SELECT capabilities_json FROM byok_endpoints WHERE owner_id = 'usr_mixed'").get() as { capabilities_json: string };
      assert.deepEqual(JSON.parse(row.capabilities_json), expected, "the stored capabilities are the test's");
    } finally {
      db.close();
    }
  });

  test("without a new key the test runs on the stored key, decrypted on the server", async () => {
    const db = migratedDatabase();
    const capture = new ConsoleCapture();
    try {
      const cookie = await insertUser(db, "usr_kept", "kept@example.test", "pro");
      const env = envFor(db);
      const calls = recordingEgress(passing);
      assert.equal((await put(env, cookie, FULL)).status, 200);
      const update = await put(env, cookie, { baseUrl: "https://api2.example.test/v1", chatModel: "chat-2" });
      assert.equal(update.status, 200);
      const updateText = await update.text();
      assert.ok(!updateText.includes(TEST_KEY));
      assert.deepEqual(calls.map((call) => [call.url, call.authorization]), [
        ["https://api.example.test/v1/models", `Bearer ${TEST_KEY}`],
        ["https://api2.example.test/v1/models", `Bearer ${TEST_KEY}`],
      ], "the second test used the stored key on the new URL");
      // A new key replaces it in the test as well.
      assert.equal((await put(env, cookie, { apiKey: OTHER_KEY, baseUrl: "https://api2.example.test/v1" })).status, 200);
      assert.equal(calls[2]!.authorization, `Bearer ${OTHER_KEY}`);
      assert.equal(byokView(await jsonBody(await api("GET", "/api/byok", env, { headers: { cookie } }))).keyLast4, "5678");

      // A stored ciphertext the master key cannot read: 503, nothing tested.
      const rotated = envFor(db, { BYOK_MASTER_KEY: OTHER_MASTER_KEY });
      const before = db.query("SELECT * FROM byok_endpoints WHERE owner_id = 'usr_kept'").get();
      const unreadable = await put(rotated, cookie, { baseUrl: "https://api3.example.test/v1" });
      assert.equal(unreadable.status, 503);
      assert.equal((await jsonBody(unreadable)).code, "byok_unavailable");
      assert.equal(calls.length, 3, "no call with an unreadable key");
      assert.deepEqual(db.query("SELECT * FROM byok_endpoints WHERE owner_id = 'usr_kept'").get(), before);
      capture.assertNotLeaked(TEST_KEY);
      capture.assertNotLeaked(OTHER_KEY);
    } finally {
      capture.restore();
      db.close();
    }
  });

  test("a pasted key loses the whitespace at its ends; whitespace in the middle is refused without echo", async () => {
    const db = migratedDatabase();
    const capture = new ConsoleCapture();
    try {
      const cookie = await insertUser(db, "usr_trim", "trim@example.test", "pro");
      const env = envFor(db);
      const calls = recordingEgress(passing);

      // Whitespace only counts as omitted: a new endpoint still needs a key.
      const blank = await put(env, cookie, { ...FULL, apiKey: " \n\t " });
      assert.equal(blank.status, 400);
      assert.equal((await jsonBody(blank)).code, "api_key_required");

      // Whitespace in the middle: 400 invalid_api_key, nothing tested or stored.
      for (const apiKey of ["ch ave", "sk-byok\tinner-1234", " sk-byok mid-1234\n"]) {
        const refused = await put(env, cookie, { ...FULL, apiKey });
        assert.equal(refused.status, 400, JSON.stringify(apiKey));
        const text = await refused.text();
        assert.deepEqual(JSON.parse(text), { code: "invalid_api_key", error: "The API key must not contain whitespace" });
        assert.ok(!text.includes(apiKey.trim()), "the key is not echoed");
      }
      assert.equal(calls.length, 0, "a refused key never reaches the endpoint");
      assert.equal(windowAttempts(db), 0, "nor the limit");
      assert.equal(db.query("SELECT * FROM byok_endpoints").all().length, 0);

      // " chave " and "chave\n": tested and stored without the ends.
      const { byokCrypto } = await import("./crypto");
      const master = (await byokCrypto(MASTER_KEY))!;
      for (const [index, apiKey] of [` ${TEST_KEY} `, `${OTHER_KEY}\n`].entries()) {
        const saved = await put(env, cookie, { ...FULL, apiKey });
        assert.equal(saved.status, 200, JSON.stringify(apiKey));
        const view = byokView(await jsonBody(saved));
        const trimmed = apiKey.trim();
        assert.equal(view.keyLast4, trimmed.slice(-4), "the last four of the trimmed key");
        assert.equal(calls[index]!.authorization, `Bearer ${trimmed}`, "the test ran on the trimmed key");
        const row = db.query("SELECT key_ciphertext FROM byok_endpoints WHERE owner_id = 'usr_trim'").get() as { key_ciphertext: string };
        assert.equal(await master.decrypt(row.key_ciphertext), trimmed, "the stored key is the trimmed one");
      }
      // The length cap applies after the trim: 4096 characters plus the ends pass.
      const atCap = await put(env, cookie, { ...FULL, apiKey: ` ${"k".repeat(4096)}\n` });
      assert.equal(atCap.status, 200);
      capture.assertNotLeaked(TEST_KEY);
      capture.assertNotLeaked(OTHER_KEY);
    } finally {
      capture.restore();
      db.close();
    }
  });

  test("the limit is shared with POST /api/byok/test: the hourly count and the one test in flight", async () => {
    const db = migratedDatabase();
    try {
      const cookie = await insertUser(db, "usr_shared", "shared@example.test", "pro");
      const env = envFor(db);
      recordingEgress(passing);
      // Three PUTs and three POSTs fill the six tests of the hour.
      for (let index = 1; index <= 3; index += 1) {
        assert.equal((await put(env, cookie, { ...FULL, chatModel: `chat-${index}` })).status, 200, `PUT ${index}`);
        assert.equal((await api("POST", "/api/byok/test", env, { headers: { cookie } })).status, 200, `POST ${index}`);
      }
      const limitedPut = await put(env, cookie, FULL);
      assert.equal(limitedPut.status, 429);
      assert.deepEqual(await jsonBody(limitedPut), {
        code: "byok_test_limited",
        error: "Too many connection tests; try again later (limit: 6 per hour)",
      });
      const limitedPost = await api("POST", "/api/byok/test", env, { headers: { cookie } });
      assert.equal(limitedPost.status, 429);
      assert.equal(byokView(await jsonBody(await api("GET", "/api/byok", env, { headers: { cookie } }))).models.chat, "chat-3", "the limited PUT stored nothing");

      // The next hour: a held PUT blocks the POST, and a held POST blocks the PUT.
      setByokNowForTests(Date.parse(NOW) + 60 * 60 * 1000 + 1);
      let release: () => void = () => {};
      let entered: () => void = () => {};
      let ready = new Promise<void>((resolve) => {
        entered = resolve;
      });
      const holdOnce = () => {
        const hold = new Promise<void>((resolve) => {
          release = resolve;
        });
        setByokEgressForTests(async () => {
          entered();
          await hold;
          return Response.json(applianceCatalog);
        });
      };
      holdOnce();
      const saving = put(env, cookie, { ...FULL, chatModel: "chat-held" });
      await ready;
      const postDuring = await api("POST", "/api/byok/test", env, { headers: { cookie } });
      assert.equal(postDuring.status, 429, "a POST during the PUT's test");
      release();
      assert.equal((await saving).status, 200);

      ready = new Promise<void>((resolve) => {
        entered = resolve;
      });
      holdOnce();
      const testing = api("POST", "/api/byok/test", env, { headers: { cookie } });
      await ready;
      const putDuring = await put(env, cookie, { ...FULL, chatModel: "chat-during" });
      assert.equal(putDuring.status, 429, "a PUT during the POST's test");
      release();
      assert.equal((await testing).status, 200);
      assert.equal(byokView(await jsonBody(await api("GET", "/api/byok", env, { headers: { cookie } }))).models.chat, "chat-held");
    } finally {
      db.close();
    }
  });

  // A held egress for the PUT's own test: the write in the middle lands
  // while the PUT waits (a DELETE through the API, or another Cloud
  // instance's PUT straight in the table: in this process the PUT holds the
  // one test in flight).
  function heldPutEgress() {
    let release: () => void = () => {};
    let entered: () => void = () => {};
    const hold = new Promise<void>((resolve) => {
      release = resolve;
    });
    const ready = new Promise<void>((resolve) => {
      entered = resolve;
    });
    setByokEgressForTests(async () => {
      entered();
      await hold;
      return Response.json(applianceCatalog);
    });
    return { ready, release };
  }

  test("a DELETE during the PUT's test wins: 409 byok_changed and the row is not resurrected", async () => {
    const db = migratedDatabase();
    try {
      const cookie = await insertUser(db, "usr_race_del", "racedel@example.test", "pro");
      const env = envFor(db);
      recordingEgress(passing);
      assert.equal((await put(env, cookie, FULL)).status, 200);
      const { ready, release } = heldPutEgress();
      const saving = put(env, cookie, { ...FULL, chatModel: "chat-2" });
      await ready;
      assert.equal((await api("DELETE", "/api/byok", env, { headers: { cookie } })).status, 200);
      release();
      const response = await saving;
      assert.equal(response.status, 409);
      const text = await response.text();
      assert.ok(!text.includes(TEST_KEY));
      const body = JSON.parse(text) as Record<string, unknown>;
      assert.equal(body.code, "byok_changed");
      assert.equal((body.view as ByokView).configured, false);
      assert.equal(db.query("SELECT * FROM byok_endpoints").all().length, 0, "the row is not resurrected");
    } finally {
      db.close();
    }
  });

  test("another save during the PUT's test wins: 409 with its view, for a new endpoint and an update", async () => {
    const db = migratedDatabase();
    try {
      const cookie = await insertUser(db, "usr_race_put", "raceput@example.test", "pro");
      const env = envFor(db);
      const other = {
        base_url: "https://other.example.test/v1",
        capabilities_json: JSON.stringify(UNTESTED),
        chat_model: "other-chat",
      };

      // A new endpoint: the row that appeared in the middle is not overwritten.
      let race = heldPutEgress();
      let saving = put(env, cookie, FULL);
      await race.ready;
      db.query(
        "INSERT INTO byok_endpoints (owner_id, base_url, key_ciphertext, key_last4, key_id, chat_model, embedding_model, transcription_model, capabilities_json, created_at, updated_at) "
          + "VALUES ('usr_race_put', ?, 'v1:00000000:x:y', '9999', '00000000', ?, '', '', ?, ?, ?)",
      ).run(other.base_url, other.chat_model, other.capabilities_json, NOW, NOW);
      race.release();
      let response = await saving;
      assert.equal(response.status, 409);
      let body = await jsonBody(response);
      assert.equal(body.code, "byok_changed");
      assert.equal((body.view as ByokView).baseUrl, other.base_url);
      assert.equal((body.view as ByokView).keyLast4, "9999");
      let row = db.query("SELECT base_url, key_last4, capabilities_json FROM byok_endpoints WHERE owner_id = 'usr_race_put'").get() as Record<string, unknown>;
      assert.deepEqual(row, { base_url: other.base_url, capabilities_json: other.capabilities_json, key_last4: "9999" });

      // An update: the change in the middle is kept as well.
      db.query("DELETE FROM byok_endpoints").run();
      recordingEgress(passing);
      assert.equal((await put(env, cookie, FULL)).status, 200);
      race = heldPutEgress();
      saving = put(env, cookie, { ...FULL, chatModel: "chat-2" });
      await race.ready;
      db.query("UPDATE byok_endpoints SET base_url = ?, chat_model = ?, capabilities_json = ? WHERE owner_id = 'usr_race_put'")
        .run(other.base_url, other.chat_model, other.capabilities_json);
      race.release();
      response = await saving;
      assert.equal(response.status, 409);
      body = await jsonBody(response);
      assert.equal(body.code, "byok_changed");
      assert.equal((body.view as ByokView).models.chat, "other-chat");
      row = db.query("SELECT base_url, chat_model, capabilities_json FROM byok_endpoints WHERE owner_id = 'usr_race_put'").get() as Record<string, unknown>;
      assert.deepEqual(row, { base_url: other.base_url, capabilities_json: other.capabilities_json, chat_model: other.chat_model });
    } finally {
      db.close();
    }
  });

  test("the memory deployment: 422 stores nothing, and a DELETE during the test wins", async () => {
    const env: CloudEnv = { BYOK_MASTER_KEY: MASTER_KEY };
    const account = await seedCloudWebSessionForTests({ email: "mem@example.test", plan: "pro" });
    const cookie = account.cookie;
    recordingEgress(rejecting);
    const failed = await put(env, cookie, FULL);
    assert.equal(failed.status, 422);
    assert.equal((await jsonBody(failed)).code, "byok_test_failed");
    assert.equal(byokView(await jsonBody(await api("GET", "/api/byok", env, { headers: { cookie } }))).configured, false);

    recordingEgress(passing);
    assert.equal((await put(env, cookie, FULL)).status, 200);
    recordingEgress(rejecting);
    assert.equal((await put(env, cookie, { ...FULL, chatModel: "chat-2" })).status, 422);
    assert.equal(byokView(await jsonBody(await api("GET", "/api/byok", env, { headers: { cookie } }))).models.chat, "chat-1", "the previous save is intact");

    const race = heldPutEgress();
    const saving = put(env, cookie, { ...FULL, chatModel: "chat-3" });
    await race.ready;
    assert.equal((await api("DELETE", "/api/byok", env, { headers: { cookie } })).status, 200);
    race.release();
    const response = await saving;
    assert.equal(response.status, 409);
    assert.equal((await jsonBody(response)).code, "byok_changed");
    assert.equal(byokView(await jsonBody(await api("GET", "/api/byok", env, { headers: { cookie } }))).configured, false);
  });
});

describe("the Pinar's own host is never a BYOK endpoint", () => {
  beforeEach(() => {
    resetCloudMemoryStateForTests();
    resetByokMemoryStateForTests();
    resetByokTestWindowsForTests();
    setByokEgressForTests(null);
    setCloudNowForTests(NOW);
    setByokNowForTests(NOW);
  });

  afterEach(() => {
    resetCloudMemoryStateForTests();
    resetByokMemoryStateForTests();
    resetByokTestWindowsForTests();
    setByokEgressForTests(null);
    setCloudNowForTests(null);
    setByokNowForTests(null);
  });

  // Every URL the detection asked the fake egress for.
  function recordingEgress() {
    const calls: string[] = [];
    setByokEgressForTests(async (url) => {
      calls.push(String(url));
      return Response.json(applianceCatalog);
    });
    return calls;
  }

  function put(env: CloudEnv, cookie: string, body: Record<string, unknown>) {
    return api("PUT", "/api/byok", env, {
      body: JSON.stringify(body),
      headers: { cookie, "content-type": "application/json" },
    });
  }

  function windowAttempts(db: Database): number {
    const row = db.query("SELECT attempts FROM auth_rate_limits WHERE action = 'byok_test'").get() as { attempts: number } | null;
    return row?.attempts ?? 0;
  }

  const NOT_ALLOWED = { code: "invalid_base_url", error: "The base URL is not allowed" };
  // The public hosts in every spelling the comparison normalizes, and the
  // host the test requests come in on (https://pinar.test).
  const OWN_HOSTS = [
    "https://pinar.dev/v1",
    "https://www.pinar.dev/v1",
    "https://PINAR.DEV/v1",
    "https://pinar.dev./v1",
    "https://pinar.dev:443/v1",
    "https://Www.Pinar.Dev.:443",
    "https://pinar.test/v1",
    "https://PINAR.TEST./v1",
  ];

  test("the PUT refuses the own host with 400 before the limit, the decryption and any egress", async () => {
    const db = migratedDatabase();
    const capture = new ConsoleCapture();
    try {
      const cookie = await insertUser(db, "usr_own", "own@example.test", "pro");
      const env = envFor(db);
      const calls = recordingEgress();
      for (const baseUrl of OWN_HOSTS) {
        const response = await put(env, cookie, { apiKey: TEST_KEY, baseUrl, chatModel: "chat-1" });
        assert.equal(response.status, 400, baseUrl);
        assert.equal(response.headers.get("cache-control"), "no-store");
        assert.deepEqual(await jsonBody(response), NOT_ALLOWED, baseUrl);
      }
      assert.deepEqual(calls, [], "no egress for the own host");
      assert.equal(windowAttempts(db), 0, "the limit is not consumed");
      assert.equal(db.query("SELECT * FROM byok_endpoints").all().length, 0, "nothing was stored");

      // A saved endpoint, then a keyless PUT to the own host under a master
      // key that cannot read the stored ciphertext: a decryption would answer
      // 503, the refusal comes first with the 400 and the row is unchanged.
      assert.equal((await put(env, cookie, { apiKey: TEST_KEY, baseUrl: "https://api.example.test/v1", chatModel: "chat-1" })).status, 200);
      assert.deepEqual(calls, ["https://api.example.test/v1/models"]);
      db.query("DELETE FROM auth_rate_limits WHERE action = 'byok_test'").run();
      resetByokTestWindowsForTests();
      const before = db.query("SELECT * FROM byok_endpoints WHERE owner_id = 'usr_own'").get();
      const rotated = envFor(db, { BYOK_MASTER_KEY: OTHER_MASTER_KEY });
      const keyless = await put(rotated, cookie, { baseUrl: "https://pinar.dev./v1" });
      assert.equal(keyless.status, 400);
      assert.deepEqual(await jsonBody(keyless), NOT_ALLOWED);
      // Control: the same keyless PUT to a third-party host does decrypt.
      assert.equal((await put(rotated, cookie, { baseUrl: "https://api2.example.test/v1" })).status, 503);
      db.query("DELETE FROM auth_rate_limits WHERE action = 'byok_test'").run();
      resetByokTestWindowsForTests();
      assert.equal((await put(rotated, cookie, { baseUrl: "https://pinar.dev/v1" })).status, 400);
      assert.equal(windowAttempts(db), 0, "the keyless refusal does not consume the limit");
      assert.deepEqual(calls, ["https://api.example.test/v1/models"], "no egress after the save");
      assert.deepEqual(db.query("SELECT * FROM byok_endpoints WHERE owner_id = 'usr_own'").get(), before);
      capture.assertNotLeaked(TEST_KEY);
    } finally {
      capture.restore();
      db.close();
    }
  });

  test("a neighbor host is not the Pinar: it is tested and saved", async () => {
    const db = migratedDatabase();
    try {
      const cookie = await insertUser(db, "usr_near", "near@example.test", "pro");
      const env = envFor(db);
      const calls = recordingEgress();
      for (const baseUrl of ["https://api.pinar.dev.example/v1", "https://pinar.dev.example", "https://notpinar.dev/v1", "https://pinar.test.example/v1"]) {
        const response = await put(env, cookie, { apiKey: TEST_KEY, baseUrl, chatModel: "chat-1" });
        assert.equal(response.status, 200, baseUrl);
        assert.equal(byokView(await jsonBody(response)).baseUrl, baseUrl);
      }
      assert.deepEqual(calls, [
        "https://api.pinar.dev.example/v1/models",
        "https://pinar.dev.example/models",
        "https://notpinar.dev/v1/models",
        "https://pinar.test.example/v1/models",
      ]);
    } finally {
      db.close();
    }
  });

  test("POST /api/byok/test refuses a stored row on the own host: 400, no limit, no decryption, no egress, the row stays", async () => {
    const db = migratedDatabase();
    try {
      const cookie = await insertUser(db, "usr_old", "old@example.test", "pro");
      const env = envFor(db);
      const calls = recordingEgress();
      assert.equal((await put(env, cookie, { apiKey: TEST_KEY, baseUrl: "https://api.example.test/v1", chatModel: "chat-1" })).status, 200);
      calls.length = 0;
      db.query("DELETE FROM auth_rate_limits WHERE action = 'byok_test'").run();
      resetByokTestWindowsForTests();
      // A row from before the refusal existed, in every spelling the
      // comparison normalizes (the trailing dot is what the PUT would have
      // stripped, so only an old row can hold it).
      const rotated = envFor(db, { BYOK_MASTER_KEY: OTHER_MASTER_KEY });
      for (const baseUrl of OWN_HOSTS) {
        db.query("UPDATE byok_endpoints SET base_url = ? WHERE owner_id = 'usr_old'").run(baseUrl);
        const before = db.query("SELECT * FROM byok_endpoints WHERE owner_id = 'usr_old'").get();
        for (const target of [env, rotated]) {
          const response = await api("POST", "/api/byok/test", target, { headers: { cookie } });
          assert.equal(response.status, 400, baseUrl);
          assert.equal(response.headers.get("cache-control"), "no-store");
          assert.deepEqual(await jsonBody(response), NOT_ALLOWED, baseUrl);
        }
        assert.deepEqual(db.query("SELECT * FROM byok_endpoints WHERE owner_id = 'usr_old'").get(), before, "nothing is deleted nor recorded");
      }
      assert.deepEqual(calls, [], "no egress for the own host");
      assert.equal(windowAttempts(db), 0, "the limit is not consumed");

      // Control: a third-party row is tested, and with the unreadable master
      // key it is decrypted (503).
      db.query("UPDATE byok_endpoints SET base_url = 'https://api.pinar.dev.example/v1' WHERE owner_id = 'usr_old'").run();
      assert.equal((await api("POST", "/api/byok/test", rotated, { headers: { cookie } })).status, 503);
      assert.equal((await api("POST", "/api/byok/test", env, { headers: { cookie } })).status, 200);
      assert.deepEqual(calls, ["https://api.pinar.dev.example/v1/models"]);
    } finally {
      db.close();
    }
  });

  test("the memory deployment refuses the same way, on the host each request came in on", async () => {
    const env: CloudEnv = { BYOK_MASTER_KEY: MASTER_KEY };
    const account = await seedCloudWebSessionForTests({ email: "m@example.test", plan: "pro" });
    const calls = recordingEgress();
    const putAt = (origin: string, baseUrl: string) => handleByokRequest(
      new Request(`${origin}/api/byok`, {
        body: JSON.stringify({ apiKey: TEST_KEY, baseUrl, chatModel: "chat-1" }),
        headers: { cookie: account.cookie, "content-type": "application/json" },
        method: "PUT",
      }),
      env,
    );
    for (const baseUrl of OWN_HOSTS) {
      const response = await putAt("https://pinar.test", baseUrl);
      assert.equal(response.status, 400, baseUrl);
      assert.deepEqual(await jsonBody(response), NOT_ALLOWED, baseUrl);
    }
    // The request host is whatever EdgeR routed: a staging request refuses
    // the staging host, in any case and with the trailing dot.
    for (const baseUrl of ["https://stg.pinar.dev/v1", "https://STG.pinar.dev./v1", "https://stg.pinar.dev:443"]) {
      assert.equal((await putAt("https://stg.pinar.dev", baseUrl)).status, 400, baseUrl);
    }
    assert.deepEqual(calls, []);
    // Control: the staging host is not the host of a request on another one.
    assert.equal((await putAt("https://pinar.test", "https://stg.pinar.dev/v1")).status, 200);
    assert.deepEqual(calls, ["https://stg.pinar.dev/v1/models"]);
  });
});
