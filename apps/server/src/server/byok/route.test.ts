// F5/S3: the BYOK capability routing (byok/route.ts). The five no-route
// cases (not Pro, no master key, no row, capability not ok, model not
// configured) answer null; the ok capability routes with the key decrypted
// on the server (the ciphertext that the master key cannot read answers
// null, never the ciphertext); the per-user concurrency caps the calls
// (rate_limited, no queue, the release frees the slot); the assistant's
// route needs tools and chat and reports the vision flag; the turn's fetch
// classifies every failure into the common cause table (the provider's
// body, the URL and the key never cross the error); the model keeps the
// image parts only with vision ok.

import assert from "node:assert/strict";
import { Database } from "bun:sqlite";
import { readdirSync, readFileSync } from "node:fs";
import { afterEach, describe, test } from "node:test";
import { streamText } from "ai";
import { ByokAssistantTurnError } from "./cause";
import { byokCrypto } from "./crypto";
import { untestedCapabilities } from "./api";
import type { ByokEgress } from "./fetch";
import { setByokEgressForTests } from "./fetch";
import {
  byokAssistantModel,
  byokAssistantRoute,
  byokAssistantRouteExists,
  byokStreamErrorPart,
  byokTurnFetch,
  cloudByokRoute,
  resetByokConcurrencyForTests,
  type ByokAssistantRoute,
} from "./route";
import type { CloudEnv, Principal } from "../cloud-api";

const NOW = "2026-10-01T12:00:00.000Z";
const LATER = "2026-12-01T12:00:00.000Z";
const MASTER_KEY = Buffer.alloc(32, 7).toString("base64");
const TEST_KEY = "sk-byok-test-secret-1234";
const BASE_URL = "https://byok.test/v1";

// ---------- D1 shim (same model as byok/api.test.ts) ----------

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
  const directory = new URL("../../../migrations/", import.meta.url);
  for (const file of readdirSync(directory).filter((name) => name.endsWith(".sql")).sort()) {
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

async function insertUser(db: Database, id: string, email: string, plan: "free" | "pro") {
  db.query(
    "INSERT INTO users (id, email, plan, ever_paid, billing_status, created_at, updated_at) VALUES (?, ?, ?, 1, 'active', ?, ?)",
  ).run(id, email, plan, NOW, NOW);
  const suffix = (id.split("_").pop() ?? "x").repeat(43).slice(0, 43);
  const token = `pws_${suffix}`;
  db.query(
    "INSERT INTO web_sessions (token_hash, owner_type, owner_id, expires_at, revoked_at, created_at) VALUES (?, 'account', ?, ?, NULL, ?)",
  ).run(await sha256Hex(token), id, LATER, NOW);
}

// Seeds the byok_endpoints row directly, with the capabilities_json the
// S2 test route would have written (the ok capabilities the test names).
async function seedByokRow(
  db: Database,
  ownerId: string,
  options: {
    capabilitiesJson?: string;
    chatModel?: string;
    embeddingModel?: string;
    transcriptionModel?: string;
  } = {},
) {
  const crypto = (await byokCrypto(MASTER_KEY))!;
  const ciphertext = await crypto.encrypt(TEST_KEY);
  db.query(
    `INSERT INTO byok_endpoints (owner_id, base_url, key_ciphertext, key_last4, key_id, chat_model,
       embedding_model, transcription_model, capabilities_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    ownerId,
    BASE_URL,
    ciphertext,
    "1234",
    crypto.keyId,
    options.chatModel ?? "chat-1",
    options.embeddingModel ?? "embed-1",
    options.transcriptionModel ?? "tr-1",
    options.capabilitiesJson ?? JSON.stringify(untestedCapabilities()),
    NOW,
    NOW,
  );
}

function capabilityJson(ok: boolean | null, testedAt: string | null = NOW) {
  return JSON.stringify({ error: ok === null || ok ? null : "unavailable", ok, testedAt });
}

function capabilitiesJson(options: {
  chat?: boolean | null;
  embeddings?: boolean | null;
  tools?: boolean | null;
  transcription?: boolean | null;
  vision?: boolean | null;
}) {
  return JSON.stringify({
    chat: JSON.parse(capabilityJson(options.chat ?? null)),
    embeddings: { dims: null, ...JSON.parse(capabilityJson(options.embeddings ?? null)) },
    tools: JSON.parse(capabilityJson(options.tools ?? null)),
    transcription: JSON.parse(capabilityJson(options.transcription ?? null)),
    vision: JSON.parse(capabilityJson(options.vision ?? null)),
  });
}

function principal(id: string, plan: "free" | "pro"): Principal {
  return { email: `${id}@example.test`, id, isPermanent: true, kind: "account", plan };
}

const FAKE_EGRESS: ByokEgress = async () => new Response("{}", { status: 200 });

afterEach(() => {
  resetByokConcurrencyForTests();
  setByokEgressForTests(null);
});

type RouteOrNull = Awaited<ReturnType<typeof cloudByokRoute>>;

function isRoute(result: RouteOrNull): result is Extract<RouteOrNull, object> & { apiKey: string } {
  return result !== null && !("cause" in result);
}

// ---------- cloudByokRoute ----------

describe("cloudByokRoute", () => {
  test("answers null in each of the five no-route cases", async () => {
    const db = migratedDatabase();
    await insertUser(db, "usr_a", "a@example.test", "free");
    await insertUser(db, "usr_b", "b@example.test", "pro");
    await insertUser(db, "usr_c", "c@example.test", "pro");
    await insertUser(db, "usr_d", "d@example.test", "pro");
    await insertUser(db, "usr_e", "e@example.test", "pro");
    await insertUser(db, "usr_f", "f@example.test", "pro");

    // 1. Not Pro.
    await seedByokRow(db, "usr_a", { capabilitiesJson: capabilitiesJson({ chat: true }) });
    assert.equal(await cloudByokRoute(envFor(db), principal("usr_a", "free"), "chat"), null);

    // 2. Pro without a row.
    assert.equal(await cloudByokRoute(envFor(db), principal("usr_b", "pro"), "chat"), null);

    // 3. Pro with a row, the capability not tested ok (untested).
    await seedByokRow(db, "usr_c");
    assert.equal(await cloudByokRoute(envFor(db), principal("usr_c", "pro"), "chat"), null);

    // 4. The capability ok but the model not configured.
    await seedByokRow(db, "usr_d", { capabilitiesJson: capabilitiesJson({ chat: true }), chatModel: "" });
    assert.equal(await cloudByokRoute(envFor(db), principal("usr_d", "pro"), "chat"), null);

    // 5. A deployment without a master key (like S1's byok_unavailable).
    await seedByokRow(db, "usr_e", { capabilitiesJson: capabilitiesJson({ chat: true }) });
    const noKey = envFor(db, { BYOK_MASTER_KEY: undefined });
    assert.equal(await cloudByokRoute(noKey, principal("usr_e", "pro"), "chat"), null);

    // A ciphertext the master key cannot read: null, and the error is not
    // logged with the ciphertext (a driver or a tag may echo the key).
    await seedByokRow(db, "usr_f", { capabilitiesJson: capabilitiesJson({ chat: true }) });
    db.query("UPDATE byok_endpoints SET key_ciphertext = 'v1:deadbeef:AAAA:BBBB' WHERE owner_id = 'usr_f'").run();
    assert.equal(await cloudByokRoute(envFor(db), principal("usr_f", "pro"), "chat"), null);
  });

  test("routes the ok capability with the key decrypted on the server", async () => {
    const db = migratedDatabase();
    await insertUser(db, "usr_a", "a@example.test", "pro");
    await seedByokRow(db, "usr_a", { capabilitiesJson: capabilitiesJson({ chat: true, embeddings: true, tools: true, transcription: true }) });
    setByokEgressForTests(FAKE_EGRESS);

    const chat = await cloudByokRoute(envFor(db), principal("usr_a", "pro"), "chat");
    assert.ok(isRoute(chat));
    assert.equal(chat.apiKey, TEST_KEY, "the key is decrypted only here");
    assert.equal(chat.baseUrl, BASE_URL);
    assert.equal(chat.model, "chat-1");
    assert.equal(chat.egress, FAKE_EGRESS);
    assert.equal(typeof chat.release, "function");

    // embeddings and transcription run on their own models (the test holds
    // the two in-flight slots: chat and embeddings; transcription takes the
    // slot chat frees).
    const embeddings = await cloudByokRoute(envFor(db), principal("usr_a", "pro"), "embeddings");
    assert.ok(isRoute(embeddings));
    assert.equal(embeddings.model, "embed-1");
    chat.release();
    const transcription = await cloudByokRoute(envFor(db), principal("usr_a", "pro"), "transcription");
    assert.ok(isRoute(transcription));
    assert.equal(transcription.model, "tr-1");

    // A capability that is not ok does not route, in the same row.
    assert.equal(await cloudByokRoute(envFor(db), principal("usr_a", "pro"), "vision"), null);
  });

  test("caps the concurrency per user (no queue) and the release frees the slot", async () => {
    const db = migratedDatabase();
    await insertUser(db, "usr_a", "a@example.test", "pro");
    await insertUser(db, "usr_b", "b@example.test", "pro");
    await seedByokRow(db, "usr_a", { capabilitiesJson: capabilitiesJson({ chat: true }) });
    await seedByokRow(db, "usr_b", { capabilitiesJson: capabilitiesJson({ chat: true }) });
    const env = envFor(db);
    const proA = principal("usr_a", "pro");
    const proB = principal("usr_b", "pro");

    const first = await cloudByokRoute(env, proA, "chat");
    assert.ok(isRoute(first));
    const second = await cloudByokRoute(env, proA, "chat");
    assert.ok(isRoute(second));
    // The third call of the same user: rate_limited, without a queue.
    const third = await cloudByokRoute(env, proA, "chat");
    assert.deepEqual(third, { cause: "rate_limited" });
    // The other user is unaffected.
    const other = await cloudByokRoute(env, proB, "chat");
    assert.ok(isRoute(other));

    // The release frees the slot (the turn's finally).
    first.release();
    const afterRelease = await cloudByokRoute(env, proA, "chat");
    assert.ok(isRoute(afterRelease));
    // A second release is a no-op (idempotent).
    first.release();
    const stillCapped = await cloudByokRoute(env, proA, "chat");
    assert.deepEqual(stillCapped, { cause: "rate_limited" }, "usr_a still holds two calls");
    second.release();
    afterRelease.release();
    assert.ok(isRoute(await cloudByokRoute(env, proA, "chat")));
  });

  test("acquire: false reads the route without taking a slot", async () => {
    const db = migratedDatabase();
    await insertUser(db, "usr_a", "a@example.test", "pro");
    await seedByokRow(db, "usr_a", { capabilitiesJson: capabilitiesJson({ chat: true }) });
    const env = envFor(db);
    const pro = principal("usr_a", "pro");

    const first = await cloudByokRoute(env, pro, "chat");
    const second = await cloudByokRoute(env, pro, "chat");
    assert.ok(isRoute(first));
    assert.ok(isRoute(second));
    // A status read takes no slot and never answers rate_limited.
    const read = await cloudByokRoute(env, pro, "chat", { acquire: false });
    assert.ok(isRoute(read));
    assert.equal(read.apiKey, TEST_KEY);
    // The cap is still enforced for the real calls.
    assert.deepEqual(await cloudByokRoute(env, pro, "chat"), { cause: "rate_limited" });
    first.release();
    second.release();
    read.release(); // the no-op release of the read
    assert.ok(isRoute(await cloudByokRoute(env, pro, "chat")));
  });
});

// ---------- byokAssistantRoute ----------

describe("byokAssistantRoute", () => {
  test("needs tools and chat: without tools there is no BYOK turn", async () => {
    const db = migratedDatabase();
    await insertUser(db, "usr_a", "a@example.test", "pro");
    // Chat ok, tools untested: the turn goes to the gateway (null here).
    await seedByokRow(db, "usr_a", { capabilitiesJson: capabilitiesJson({ chat: true }) });
    assert.equal(await byokAssistantRoute(envFor(db), principal("usr_a", "pro")), null);
    assert.equal(await byokAssistantRouteExists(envFor(db), principal("usr_a", "pro")), false);
  });

  test("routes with the vision flag from the vision capability", async () => {
    const db = migratedDatabase();
    await insertUser(db, "usr_a", "a@example.test", "pro");
    await seedByokRow(db, "usr_a", { capabilitiesJson: capabilitiesJson({ chat: true, tools: true }) });
    const route = await byokAssistantRoute(envFor(db), principal("usr_a", "pro"));
    assert.ok(isRoute(route));
    assert.equal((route as ByokAssistantRoute).vision, false, "vision untested: no image may leave");

    const db2 = migratedDatabase();
    await insertUser(db2, "usr_a", "a@example.test", "pro");
    await seedByokRow(db2, "usr_a", { capabilitiesJson: capabilitiesJson({ chat: true, tools: true, vision: true }) });
    const withVision = await byokAssistantRoute(envFor(db2), principal("usr_a", "pro"));
    assert.ok(isRoute(withVision));
    assert.equal((withVision as ByokAssistantRoute).vision, true);
  });

  test("propagates rate_limited from the chat slot", async () => {
    const db = migratedDatabase();
    await insertUser(db, "usr_a", "a@example.test", "pro");
    await seedByokRow(db, "usr_a", { capabilitiesJson: capabilitiesJson({ chat: true, tools: true }) });
    const env = envFor(db);
    const pro = principal("usr_a", "pro");
    const first = await cloudByokRoute(env, pro, "chat");
    const second = await cloudByokRoute(env, pro, "chat");
    assert.ok(isRoute(first));
    assert.ok(isRoute(second));
    assert.deepEqual(await byokAssistantRoute(env, pro), { cause: "rate_limited" });
    // The tools-only check (the no-slot read) still answers.
    assert.equal(await byokAssistantRouteExists(env, pro), true);
  });

  test("byokAssistantRouteExists takes no slot and never rate_limits", async () => {
    const db = migratedDatabase();
    await insertUser(db, "usr_a", "a@example.test", "pro");
    await seedByokRow(db, "usr_a", { capabilitiesJson: capabilitiesJson({ chat: true, tools: true }) });
    const env = envFor(db);
    const pro = principal("usr_a", "pro");
    assert.equal(await byokAssistantRouteExists(env, pro), true);
    // The status read did not consume the cap: two more calls still fit.
    assert.ok(isRoute(await cloudByokRoute(env, pro, "chat")));
    assert.ok(isRoute(await cloudByokRoute(env, pro, "chat")));
  });
});

// ---------- byokTurnFetch ----------

function byokTurnError(cause: string, retryAfterSeconds: number | null = null) {
  return new ByokAssistantTurnError({ cause, retryAfterSeconds });
}

async function thrownCause(egress: ByokEgress): Promise<{ cause: string; message: string; retryAfter: number | null }> {
  const fetch = byokTurnFetch(egress);
  try {
    await fetch("https://ignored.test/chat", { method: "POST" });
    assert.fail("the byok turn fetch answered without throwing");
    throw new Error("unreachable");
  } catch (error) {
    assert.ok(error instanceof ByokAssistantTurnError, `expected ByokAssistantTurnError, got ${String(error)}`);
    return { cause: error.cause, message: error.message, retryAfter: error.retryAfterSeconds };
  }
}

describe("byokTurnFetch", () => {
  test("turns a mid-stream cut of the 2xx body into the caused error (timeout or endpoint_unreachable)", async () => {
    const encoder = new TextEncoder();
    const sseChunk = (delta: Record<string, unknown>) =>
      encoder.encode(`data: ${JSON.stringify({ choices: [{ delta, finish_reason: null, index: 0 }], created: 1, id: "c1", model: "mock", object: "chat.completion.chunk" })}\n\n`);
    // A 2xx body that streams one valid chunk and then fails on the read
    // (the guard's cut by size or time, or the network dropping).
    const cutBody = (error: unknown) => {
      let reads = 0;
      return new ReadableStream<Uint8Array>({
        pull(controller) {
          if (reads++ === 0) controller.enqueue(sseChunk({ content: "Parcial", role: "assistant" }));
          else controller.error(error);
        },
      });
    };
    const cases: Array<{ cause: string; error: unknown; label: string }> = [
      { cause: "timeout", error: Object.assign(new Error("the guard cut the stream by time"), { name: "TimeoutError" }), label: "the deadline" },
      { cause: "timeout", error: new DOMException("aborted", "AbortError"), label: "the abort" },
      { cause: "endpoint_unreachable", error: new Error("socket destroyed"), label: "the network" },
    ];
    for (const { cause, error, label } of cases) {
      const egress: ByokEgress = async () =>
        new Response(cutBody(error), { headers: { "content-type": "text/event-stream" }, status: 200 });
      const response = await byokTurnFetch(egress)("https://byok.test/v1/chat/completions", { method: "POST" });
      assert.equal(response.status, 200, label);
      const reader = response.body!.getReader();
      // The valid chunk passes through untouched.
      const first = await reader.read();
      assert.equal(new TextDecoder().decode(first.value!), new TextDecoder().decode(sseChunk({ content: "Parcial", role: "assistant" })), `${label}: the chunk before the cut passes through`);
      // The cut surfaces on the next read as the caused error, with the
      // class kept (never the raw read failure).
      const failed: unknown = await reader.read().then(
        () => new Error("the cut was not felt on the read"),
        (error) => error,
      );
      assert.ok(failed instanceof ByokAssistantTurnError, `${label}: the class is kept`);
      assert.equal(failed.cause, cause, label);
      assert.equal(failed.message, "byok assistant turn failed", `${label}: the fixed message`);
    }
  });  test("classifies the non-2xx responses through the common table", async () => {
    const json = (status: number, body: string, headers: Record<string, string> = {}) =>
      new Response(body, { headers: { "content-type": "application/json", ...headers }, status });

    const cases: Array<{ cause: string; expected: string; label: string }> = [
      { cause: "401", expected: "key_rejected", label: "401" },
      { cause: "403", expected: "key_rejected", label: "403 without the scope marker" },
      { cause: "403-scope", expected: "scope_denied", label: "403 with the scope_denied marker" },
      { cause: "404-model", expected: "model_not_found", label: "404 with the model marker" },
      { cause: "404", expected: "service_disabled", label: "404 without the marker" },
      { cause: "429", expected: "rate_limited", label: "429" },
      { cause: "503", expected: "unavailable", label: "503" },
      { cause: "500", expected: "unavailable", label: "an unexpected 5xx" },
      { cause: "400", expected: "model_not_found", label: "a 4xx refusal" },
    ];
    for (const { cause, expected, label } of cases) {
      let body = "{}";
      let status = 500;
      if (cause === "401") status = 401;
      if (cause === "403") status = 403;
      if (cause === "403-scope") {
        status = 403;
        body = JSON.stringify({ error: { type: "permission_denied", code: "scope_denied" } });
      }
      if (cause === "404") status = 404;
      if (cause === "404-model") {
        status = 404;
        body = JSON.stringify({ error: { code: "model_not_found" } });
      }
      if (cause === "429") {
        status = 429;
        body = JSON.stringify({ error: { message: "the provider says slow down, please key-1234 at byok.test" } });
      }
      if (cause === "503") status = 503;
      if (cause === "400") status = 400;
      const result = await thrownCause(() => Promise.resolve(json(status, body)));
      assert.equal(result.cause, expected, label);
      assert.equal(result.message, "byok assistant turn failed", "the fixed message, never the provider's");
    }
  });

  test("carries the Retry-After of the 429 and nothing of the body", async () => {
    const body = JSON.stringify({ error: { message: "slow down, key-1234" } });
    const result = await thrownCause(
      () =>
        Promise.resolve(
          new Response(body, { headers: { "content-type": "application/json", "retry-after": "30" }, status: 429 }),
        ),
    );
    assert.equal(result.cause, "rate_limited");
    assert.equal(result.retryAfter, 30);
    assert.ok(!result.message.includes("slow down"));
  });

  test("the guard's egress header wins over the status", async () => {
    const cases: Array<[string, string]> = [
      ["EGRESS_BAD_TARGET", "endpoint_blocked"],
      ["EGRESS_HOST_BLOCKED", "endpoint_blocked"],
      ["EGRESS_PORT_BLOCKED", "endpoint_blocked"],
      ["EGRESS_TIMEOUT", "timeout"],
      ["EGRESS_LIMIT", "rate_limited"],
      ["EGRESS_DNS", "endpoint_unreachable"],
      ["EGRESS_UPSTREAM", "endpoint_unreachable"],
    ];
    for (const [header, expected] of cases) {
      const result = await thrownCause(() =>
        Promise.resolve(
          new Response("the provider's secret body", {
            headers: { "x-edger-egress-error": header },
            status: 502,
          }),
        ),
      );
      assert.equal(result.cause, expected, header);
    }
  });

  test("classifies the network and timeout failures of the egress", async () => {
    const network = await thrownCause(() => Promise.reject(new TypeError("fetch failed")));
    assert.equal(network.cause, "endpoint_unreachable");
    const aborted = await thrownCause(() => Promise.reject(Object.assign(new Error("aborted"), { name: "AbortError" })));
    assert.equal(aborted.cause, "timeout");
    const timeout = await thrownCause(() => Promise.reject(Object.assign(new Error("timed out"), { name: "TimeoutError" })));
    assert.equal(timeout.cause, "timeout");
  });

  test("keeps the 2xx stream untouched and never leaks the key, the URL or the body", async () => {
    const sse = "data: {\"choices\":[]}\n\n";
    const seen: string[] = [];
    const egress: ByokEgress = async (url) => {
      seen.push(url);
      return new Response(sse, { headers: { "content-type": "text/event-stream" }, status: 200 });
    };
    const response = await byokTurnFetch(egress)("https://byok.test/v1/chat/completions", { method: "POST" });
    assert.equal(response.status, 200);
    assert.equal(await response.text(), sse);
    assert.deepEqual(seen, ["https://byok.test/v1/chat/completions"]);
    // The classification errors carry none of the provider's secrets: the
    // message is the fixed one, the fields are the cause and the retry.
    const leaked = new ByokAssistantTurnError({ cause: "key_rejected" });
    const rendered = `${leaked}\n${JSON.stringify({ cause: leaked.cause, retryAfterSeconds: leaked.retryAfterSeconds })}`;
    for (const secret of ["key-1234", BASE_URL, "the provider's secret body"]) assert.ok(!rendered.includes(secret), secret);
  });
});

// ---------- byokAssistantModel ----------

const PNG_1X1 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwACh0GAyg==";

function capturedEgress(sseBody: string): { egress: ByokEgress; bodies: Record<string, unknown>[]; urls: string[] } {
  const bodies: Record<string, unknown>[] = [];
  const urls: string[] = [];
  const egress: ByokEgress = async (url, init) => {
    urls.push(url);
    bodies.push(JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>);
    return new Response(sseBody, { headers: { "content-type": "text/event-stream" }, status: 200 });
  };
  return { egress, bodies, urls };
}

function sseAnswer(text: string): string {
  const chunks = [
    { choices: [{ delta: { content: text, role: "assistant" }, index: 0 }], created: 1, id: "c1", model: "chat-1", object: "chat.completion.chunk" },
    { choices: [{ delta: {}, finish_reason: "stop", index: 0 }], created: 1, id: "c1", model: "chat-1", object: "chat.completion.chunk", usage: { completion_tokens: 2, prompt_tokens: 4, total_tokens: 6 } },
  ];
  return chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join("") + "data: [DONE]\n\n";
}

function byokModelRoute(vision: boolean, egress: ByokEgress): ByokAssistantRoute {
  return {
    apiKey: TEST_KEY,
    baseUrl: BASE_URL,
    egress,
    model: "chat-1",
    release: () => {},
    vision,
  };
}

const imageMessage = () => ({
  content: [
    { mediaType: "image/png", type: "file" as const, data: PNG_1X1 },
    { text: "what is in the image?", type: "text" as const },
  ],
  role: "user" as const,
});

describe("byokAssistantModel", () => {
  test("strips the image parts without vision ok and sends text only", async () => {
    const fake = capturedEgress(sseAnswer("ok"));
    const model = byokAssistantModel(byokModelRoute(false, fake.egress), { conversationId: "conv_a", requestId: "req_a" });
    const result = streamText({ model, messages: [imageMessage()] });
    assert.equal(await result.text, "ok");
    assert.equal(fake.urls.length, 1);
    assert.ok(fake.urls[0].startsWith(`${BASE_URL}/chat/completions`), fake.urls[0]);
    const sent = fake.bodies[0].messages as unknown[];
    assert.equal(sent.length, 1);
    const content = sent[0] as { content?: unknown };
    // The single text part is sent as the string content (the provider
    // collapses it); no image part, no base64.
    if (typeof content.content === "string") {
      assert.equal(content.content, "what is in the image?");
    } else {
      const parts = content.content as Array<{ type?: string }>;
      assert.ok(parts.length > 0 && parts.every((part) => part.type === "text"), JSON.stringify(content.content));
    }
    assert.ok(!JSON.stringify(content).includes("image_url"), "no image part");
    assert.ok(!JSON.stringify(content).includes(PNG_1X1), "no base64 payload");
    // The key travels in the Authorization header, never in the body.
    assert.ok(!JSON.stringify(fake.bodies[0]).includes(TEST_KEY));
  });

  test("keeps the image parts with vision ok", async () => {
    const fake = capturedEgress(sseAnswer("ok"));
    const model = byokAssistantModel(byokModelRoute(true, fake.egress), { conversationId: "conv_a", requestId: "req_b" });
    const result = streamText({ model, messages: [imageMessage()] });
    assert.equal(await result.text, "ok");
    const sent = fake.bodies[0].messages as unknown[];
    const content = sent[0] as { content?: unknown };
    const parts = Array.isArray(content.content) ? (content.content as Array<{ type?: string }>) : [];
    assert.ok(parts.some((part) => part.type === "image_url"), "the image part reaches the endpoint");
    assert.ok(parts.some((part) => part.type === "text"));
  });

  test("a failing call ends the turn with the byok cause, through byokStreamErrorPart", async () => {
    const egress: ByokEgress = async () =>
      new Response(JSON.stringify({ error: { message: "invalid key" } }), {
        headers: { "content-type": "application/json" },
        status: 401,
      });
    const model = byokAssistantModel(byokModelRoute(false, egress), { conversationId: "conv_a", requestId: "req_c" });
    const result = streamText({ model, messages: [{ content: "hi", role: "user" }], onError: () => {} });
    // The original error is the model stream's error part (result.response
    // rejects with its own no-output error, and the turn's onError gets the
    // same part through the UI message stream).
    let byokError: unknown;
    for await (const part of result.stream) {
      if (part.type === "error") byokError = part.error;
    }
    assert.ok(byokError !== undefined, "the model stream errored");
    // The provider's body never crosses the error (it is dropped at the
    // egress); the stream's error part carries only the cause.
    assert.ok(!String(byokError).includes("invalid key"), String(byokError));
    const part = byokStreamErrorPart(byokError);
    assert.deepEqual(part, {
      code: "byok_error",
      part: { data: { canUseCredits: true, cause: "key_rejected" }, type: "data-byok-error" },
    });
    // A non-byok error is not reclassified.
    assert.equal(byokStreamErrorPart(new Error("boom")), undefined);
  });
});

// ---------- the cause table of the turn ----------

describe("ByokAssistantTurnError", () => {
  test("carries only the cause, the retry and the fixed message", () => {
    const error = byokTurnError("rate_limited", 45);
    assert.equal(error.cause, "rate_limited");
    assert.equal(error.retryAfterSeconds, 45);
    assert.equal(error.message, "byok assistant turn failed");
    assert.equal(byokStreamErrorPart(error)?.part?.data.retryAfter, 45);
    assert.equal(byokTurnError("unavailable").retryAfterSeconds, null);
  });
});
