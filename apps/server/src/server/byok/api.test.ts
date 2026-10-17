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
  setByokNowForTests,
  untestedCapabilities,
  type ByokView,
} from "./api";
import { resetByokMemoryStateForTests } from "./store";

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
    if (file === "0034_byok_endpoints.sql" && !withByok) continue;
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

describe("/api/byok (F5/S1)", () => {
  beforeEach(() => {
    resetCloudMemoryStateForTests();
    resetByokMemoryStateForTests();
    setCloudNowForTests(NOW);
    setByokNowForTests(NOW);
  });

  afterEach(() => {
    resetCloudMemoryStateForTests();
    resetByokMemoryStateForTests();
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

      // The PUT stores the normalized URL, the encrypted key and the models;
      // the capabilities start untested (S2 is what tests them).
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
      assert.deepEqual(view.capabilities, UNTESTED);
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
          body: JSON.stringify({ apiKey: TEST_KEY, baseUrl: "https://api.example.test/v1" }),
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
        body: JSON.stringify({ apiKey: TEST_KEY, baseUrl: "https://apiA.example.test/v1" }),
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
        body: JSON.stringify({ apiKey: "sk-byok-b-other-9999", baseUrl: "https://apiB.example.test/v1" }),
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
    assert.deepEqual(view.capabilities, UNTESTED);

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
      responses.push(await api("PUT", "/api/byok", env, { body: JSON.stringify({ apiKey: TEST_KEY, baseUrl: "https://api.example.test/v1" }), headers: header }));
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
      await api("PUT", "/api/byok", first, {
        body: JSON.stringify({ apiKey: TEST_KEY, baseUrl: "https://api.example.test/v1" }),
        headers: header,
      });
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
    setCloudNowForTests(null);
    setByokNowForTests(null);
  });

  test("the memory deployment answers through the same handler", async () => {
    setCloudNowForTests(NOW);
    setByokNowForTests(NOW);
    const env: CloudEnv = { BYOK_MASTER_KEY: MASTER_KEY };
    const account = await seedCloudWebSessionForTests({ email: "a@example.test", plan: "pro" });
    const put = await handleByokRequest(
      new Request("https://pinar.test/api/byok", {
        body: JSON.stringify({ apiKey: TEST_KEY, baseUrl: "https://api.example.test/v1" }),
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
