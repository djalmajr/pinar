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

// The probes of the F4d security review (17/10), through the same entry
// point the probes used: handleCloudApiRequest on a migrated database.
describe("/api/byok security review probes (F4d)", () => {
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
        body: JSON.stringify({ apiKey: TEST_KEY, baseUrl: "https://api.example.test/v1" }),
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
        body: JSON.stringify({ apiKey: TEST_KEY, baseUrl: "https://api.example.test/v1" }),
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

  async function saveEndpoint(db: Database, env: CloudEnv, cookie: string, baseUrl = "https://api.example.test/v1") {
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
      // Nothing was tested or recorded.
      const row = db.query("SELECT capabilities_json FROM byok_endpoints").get() as { capabilities_json: string };
      assert.deepEqual(JSON.parse(row.capabilities_json), UNTESTED);
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

  test("the memory deployment runs the same test", async () => {
    const env: CloudEnv = { BYOK_MASTER_KEY: MASTER_KEY };
    const account = await seedCloudWebSessionForTests({ email: "a@example.test", plan: "pro" });
    const header = { cookie: account.cookie };
    const notConfigured = await api("POST", "/api/byok/test", env, { headers: header });
    assert.equal(notConfigured.status, 404);
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
  // The appliance catalog shortcut: one GET /models decides everything.
  const applianceCatalog = {
    data: [
      { available: true, modalities: { input: ["image", "text"] }, scope: "llm", supported_parameters: ["stream", "tool_choice", "tools"] },
      { available: true, embedding: { dimensions: { native: 256, supported: [256, 512] } }, scope: "embeddings" },
      { available: true, scope: "audio" },
    ],
    object: "list",
  };

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
      assert.deepEqual(byokView(await jsonBody(put1)).capabilities, UNTESTED, "the save resets the capabilities");
      const token1 = markToken(db, "sess_a");
      assert.ok(token1, "A's session is marked");
      assert.equal(markToken(db, "sess_b"), null, "B's index is untouched");

      // The test passes and records the capabilities...
      setByokEgressForTests(async () => Response.json(applianceCatalog));
      const test = await api("POST", "/api/byok/test", env, { headers: { cookie } });
      assert.equal(test.status, 200);

      // ...and the change of the chat model resets them, without a new mark.
      const put2 = await api("PUT", "/api/byok", env, {
        body: JSON.stringify({ baseUrl: "https://api.example.test/v1", chatModel: "chat-2" }),
        headers: header,
      });
      assert.equal(put2.status, 200);
      assert.deepEqual(byokView(await jsonBody(put2)).capabilities, UNTESTED, "the capabilities are untested again");
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
