// F5/S3b: the BYOK routing of the voice transcription and the written
// reproduction (F5 contract §5). With the capability tested ok (and without
// useCredits) the request runs on the user's endpoint — one link, no
// gateway fallback, no credits, no ledger row; the plan and the per-minute
// limit run on both paths, exactly as today. The failures end with
// byok_error and the cause of the common table (never the gateway, never a
// charge, the concurrency slot freed); useCredits: true returns to today's
// metered path; the mixed voice (the transcription on the BYOK, the
// structuring on the gateway) charges exactly one credit, the
// transcription's. The provider's body, the URL and the key never cross a
// response or a log.

import assert from "node:assert/strict";
import { Database } from "bun:sqlite";
import { readdirSync, readFileSync } from "node:fs";
import { afterEach, describe, test } from "node:test";
import { byokCrypto } from "./crypto";
import { ByokEgressUnavailableError, setByokEgressForTests } from "./fetch";
import { cloudByokRoute, resetByokConcurrencyForTests } from "./route";
import {
  handleCloudApiRequest,
  seedCloudWebSessionForTests,
  type CloudEnv,
  type Principal,
} from "../cloud-api";
import { uploadCapture } from "../../../tests/helpers/cloud-ai";

const NOW = "2026-10-01T12:00:00.000Z";
const MASTER_KEY = Buffer.alloc(32, 9).toString("base64");
const BYOK_KEY = "sk-byok-voice-repro-3456";
const BASE_URL = "https://byok-user.test/v1";
const TRANSCRIPTION_MODEL = "@cf/openai/whisper-large-v3-turbo";
const STRUCTURING_MODEL = "@cf/openai/gpt-oss-20b";
const TRANSRIPT = "O botão precisa ficar alinhado com o título.";
const STRUCTURED = JSON.stringify({
  acceptanceCriteria: ["O espaço entre o título e o botão é de 8 px."],
  comment: "Alinhe o botão ao título e mantenha 8 px de espaço.",
});

// ---------- D1 shim (same model as byok/route.test.ts) ----------

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

function insertUser(db: Database, id: string, plan: "free" | "pro") {
  db.query(
    "INSERT INTO users (id, email, plan, ever_paid, billing_status, created_at, updated_at) VALUES (?, ?, ?, 1, 'active', ?, ?)",
  ).run(id, `${id}@example.test`, plan, NOW, NOW);
}

function capabilityJson(ok: boolean | null, error: string | null = null, testedAt: string | null = NOW) {
  return JSON.stringify({ error, ok, testedAt });
}

// Seeds the byok_endpoints row the S2 test route would have written.
async function seedByokRow(
  db: Database,
  ownerId: string,
  options: {
    capabilitiesJson?: string;
    chatModel?: string;
    transcriptionModel?: string;
  } = {},
) {
  const crypto = (await byokCrypto(MASTER_KEY))!;
  const ciphertext = await crypto.encrypt(BYOK_KEY);
  db.query(
    `INSERT INTO byok_endpoints (owner_id, base_url, key_ciphertext, key_last4, key_id, chat_model,
       embedding_model, transcription_model, capabilities_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    ownerId,
    BASE_URL,
    ciphertext,
    "3456",
    crypto.keyId,
    options.chatModel ?? "chat-1",
    "",
    options.transcriptionModel ?? "tr-1",
    options.capabilitiesJson ?? JSON.stringify({
      chat: JSON.parse(capabilityJson(null)),
      embeddings: { dims: null, ...JSON.parse(capabilityJson(null)) },
      tools: JSON.parse(capabilityJson(null)),
      transcription: JSON.parse(capabilityJson(null)),
      vision: JSON.parse(capabilityJson(null)),
    }),
    NOW,
    NOW,
  );
}

function capabilities(options: {
  chat?: boolean | null;
  transcription?: boolean | null;
}) {
  return JSON.stringify({
    chat: JSON.parse(capabilityJson(options.chat ?? null)),
    embeddings: { dims: null, ...JSON.parse(capabilityJson(null)) },
    tools: JSON.parse(capabilityJson(null)),
    transcription: JSON.parse(capabilityJson(options.transcription ?? null)),
    vision: JSON.parse(capabilityJson(null)),
  });
}

// The production shape S2 records when byokFetch refuses (S6 not wired):
// every capability fails with the egress_unavailable cause.
const EGRESS_UNAVAILABLE_CAPABILITIES = JSON.stringify({
  chat: JSON.parse(capabilityJson(false, "egress_unavailable")),
  embeddings: { dims: null, ...JSON.parse(capabilityJson(false, "egress_unavailable")) },
  tools: JSON.parse(capabilityJson(false, "egress_unavailable")),
  transcription: JSON.parse(capabilityJson(false, "egress_unavailable")),
  vision: JSON.parse(capabilityJson(false, "egress_unavailable")),
});

function principal(id: string, plan: "free" | "pro"): Principal {
  return { email: `${id}@example.test`, id, isPermanent: plan === "pro", kind: "account", plan };
}

// The scripted BYOK egress: the next scripted reply per call, with the
// request's auth and body recorded (the key must only cross the header).
interface ByokCall {
  auth: string | null;
  body: unknown;
  url: string;
}

function fakeByokEgress(replies: Array<() => Response>) {
  const calls: ByokCall[] = [];
  setByokEgressForTests(async (url, init) => {
    const call: ByokCall = { auth: new Headers(init?.headers ?? {}).get("authorization"), body: init?.body, url };
    calls.push(call);
    const reply = replies[Math.min(calls.length - 1, replies.length - 1)];
    return reply();
  });
  return calls;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function jsonBody(response: Response): Promise<Record<string, unknown>> {
  const body: unknown = await response.json();
  assert.ok(isRecord(body));
  return body;
}

function api(path: string, init: RequestInit = {}, env: CloudEnv) {
  return handleCloudApiRequest(new Request(`https://pinar.test${path}`, init), env);
}

function voiceForm(requestId: string, extra: Record<string, string | File> = {}) {
  const form = new FormData();
  form.set("requestId", requestId);
  form.set("durationSeconds", "30");
  form.set("language", "pt");
  form.set("audio", new Blob([new Uint8Array([1, 2, 3, 4])], { type: "audio/webm" }), "pin.webm");
  for (const [key, value] of Object.entries(extra)) form.set(key, value);
  return form;
}

// The gateway's AI stub: counts its calls (the BYOK tests prove the
// gateway is not called) and answers by model.
function gatewayStub(replies: Record<string, (model: string, input: unknown) => unknown>) {
  const calls: Array<{ input: unknown; model: string }> = [];
  const run = async (model: string, input: unknown): Promise<unknown> => {
    calls.push({ input, model });
    const reply = replies[model];
    if (!reply) throw new Error(`gateway stub: no reply for ${model}`);
    return reply(model, input);
  };
  return { calls, env: { AI: { run } as unknown as Ai } };
}

async function byokCookie(db: Database, env: CloudEnv, id: string, plan: "free" | "pro" = "pro") {
  return (await seedCloudWebSessionForTests({ email: `${id}@example.test`, id, plan }, env)).cookie;
}

function setPostProcessing(db: Database, ownerId: string) {
  db.query("INSERT INTO owner_preferences (owner_id, updated_at) VALUES (?, ?)").run(ownerId, NOW);
  db.query("UPDATE owner_preferences SET voice_post_processing = 1 WHERE owner_id = ?").run(ownerId);
}

const ledgerRows = (db: Database) =>
  db.query("SELECT feature, status, credits, model FROM ai_credit_usages ORDER BY created_at").all() as Array<{ feature: string; status: string; credits: number; model: string }>;

const grantBalance = (db: Database, ownerId: string) =>
  (db.query("SELECT COALESCE(SUM(credits - consumed_credits), 0) AS balance FROM ai_credit_grants WHERE owner_id = ?").get(ownerId) as { balance: number }).balance;

const transcriptReply = () => Response.json({ duration: 30, language: "pt", text: TRANSRIPT });
const chatReply = (content: string) =>
  () => Response.json({
    choices: [{ finish_reason: "stop", index: 0, message: { content, role: "assistant" } }],
    created: 1,
    id: "c1",
    model: "chat-1",
    usage: { completion_tokens: 40, prompt_tokens: 100, total_tokens: 140 },
  });

afterEach(() => {
  resetByokConcurrencyForTests();
  setByokEgressForTests(null);
});

// ---------- voice ----------

describe("POST /api/ai/voice-pin on BYOK (F5/S3b)", () => {
  test("the transcription runs on the user's endpoint: the model, the key only in the header, no credit, no ledger, source byok", async () => {
    const db = migratedDatabase();
    try {
      insertUser(db, "usr_v1", "pro");
      await seedByokRow(db, "usr_v1", { capabilitiesJson: capabilities({ transcription: true }) });
      const gateway = gatewayStub({
        [TRANSCRIPTION_MODEL]: () => { throw new Error("the gateway must not be called"); },
      });
      const env: CloudEnv = {
        BYOK_MASTER_KEY: MASTER_KEY,
        DB: sqliteD1(db),
        DEPLOYMENT_ENV: "staging",
        ...gateway.env,
      };
      const cookie = await byokCookie(db, env, "usr_v1");
      const calls = fakeByokEgress([transcriptReply]);

      const response = await api("/api/ai/voice-pin", {
        body: voiceForm("byok_voice_request_001"),
        headers: { cookie },
        method: "POST",
      }, env);
      assert.equal(response.status, 200, await response.clone().text());
      const body = await jsonBody(response);
      assert.equal(body.ok, true);
      assert.equal(body.source, "byok");
      assert.equal(body.creditsCharged, 0);
      assert.equal(body.idempotent, false);
      assert.ok(isRecord(body.aiCredits));
      assert.equal(body.aiCredits.balance, 0, "the balance did not move (no grant was ever created)");
      assert.ok(isRecord(body.result));
      assert.equal(body.result.transcript, TRANSRIPT);
      assert.equal(body.result.detectedLanguage, "pt");
      assert.ok(isRecord(body.usage));
      assert.equal(body.usage.provider, "byok");
      assert.equal(body.usage.model, "tr-1");
      assert.equal(body.usage.costUsdMicros, 0);

      // The transcription went to the user's endpoint, with the user's
      // transcription model, the key only in the Authorization header.
      assert.equal(calls.length, 1, "one link, no retry, no fallback");
      assert.ok(calls[0].url.startsWith(`${BASE_URL}/audio/transcriptions`), calls[0].url);
      assert.equal(calls[0].auth, `Bearer ${BYOK_KEY}`, "the key only crosses the header");
      assert.ok(calls[0].body instanceof FormData);
      const sent = calls[0].body as FormData;
      assert.deepEqual(Array.from(sent.keys()), ["file", "model"], "the S2 probe format");
      assert.equal(sent.get("model"), "tr-1", "the user's transcription model");
      const file = sent.get("file");
      assert.ok(file instanceof File, "the clip crosses as a file");
      assert.equal(file.name, "pin.webm", "the clip's name, untouched");
      assert.equal(file.size, 4, "the clip's bytes, untouched");

      assert.equal(gateway.calls.length, 0, "the gateway is not called");
      assert.deepEqual(ledgerRows(db), [], "no line in the ledger");
      assert.deepEqual(db.query("SELECT id FROM ai_credit_grants").all(), [], "no grant was created");
    } finally {
      db.close();
    }
  });

  test("with the chat ok the structuring runs on the BYOK too (no credit, the same prompt as today)", async () => {
    const db = migratedDatabase();
    try {
      insertUser(db, "usr_v2", "pro");
      await seedByokRow(db, "usr_v2", { capabilitiesJson: capabilities({ chat: true, transcription: true }) });
      setPostProcessing(db, "usr_v2");
      const gateway = gatewayStub({
        [STRUCTURING_MODEL]: () => { throw new Error("the gateway must not be called"); },
        [TRANSCRIPTION_MODEL]: () => { throw new Error("the gateway must not be called"); },
      });
      const env: CloudEnv = {
        BYOK_MASTER_KEY: MASTER_KEY,
        DB: sqliteD1(db),
        DEPLOYMENT_ENV: "staging",
        ...gateway.env,
      };
      const cookie = await byokCookie(db, env, "usr_v2");
      const calls = fakeByokEgress([transcriptReply, chatReply(STRUCTURED)]);

      const response = await api("/api/ai/voice-pin", {
        body: voiceForm("byok_voice_request_002"),
        headers: { cookie },
        method: "POST",
      }, env);
      assert.equal(response.status, 200, await response.clone().text());
      const body = await jsonBody(response);
      assert.equal(body.source, "byok");
      assert.equal(body.creditsCharged, 0);
      assert.ok(isRecord(body.result));
      assert.equal(body.result.comment, "Alinhe o botão ao título e mantenha 8 px de espaço.");
      assert.deepEqual(body.result.acceptanceCriteria, ["O espaço entre o título e o botão é de 8 px."]);
      assert.equal(body.result.transcript, TRANSRIPT);
      assert.ok(isRecord(body.usage));
      assert.equal(body.usage.provider, "byok");
      assert.equal(body.usage.model, "tr-1 + chat-1");
      assert.equal(body.usage.inputTokens, 100, "the usage the provider reported");
      assert.equal(body.usage.outputTokens, 40);

      // Two BYOK calls: the transcription, then the structuring on the
      // user's chat — the same prompt the metered path sends (the
      // structuring's instructions + the transcript's JSON), the maxTokens
      // of the voice spec, no JSON mode (the metered path's voice call has
      // none).
      assert.equal(calls.length, 2);
      assert.ok(calls[1].url.startsWith(`${BASE_URL}/chat/completions`), calls[1].url);
      assert.equal(calls[1].auth, `Bearer ${BYOK_KEY}`);
      const chatBody = JSON.parse(String(calls[1].body)) as Record<string, unknown>;
      assert.equal(chatBody.model, "chat-1");
      assert.equal(chatBody.max_tokens, 768);
      assert.equal("response_format" in chatBody, false, "the voice's structuring has no JSON mode today");
      const messages = chatBody.messages as Array<Record<string, unknown>>;
      assert.equal(messages.length, 2);
      assert.equal(messages[0].role, "system");
      assert.match(String(messages[0].content), /remove stutters, filler words/);
      assert.match(String(messages[1].content), /"transcript":"O botão precisa ficar alinhado com o título\./);
      assert.equal(gateway.calls.length, 0, "the gateway is not called");
      assert.deepEqual(ledgerRows(db), [], "no credit, no ledger");
    } finally {
      db.close();
    }
  });

  test("the mixed case: the transcription on the BYOK, the structuring on the gateway with exactly one credit", async () => {
    const db = migratedDatabase();
    try {
      insertUser(db, "usr_v3", "pro");
      // The transcription is ok; the chat is untested: the structuring has
      // no BYOK route (the mixed case of contract §5).
      await seedByokRow(db, "usr_v3", { capabilitiesJson: capabilities({ transcription: true }) });
      setPostProcessing(db, "usr_v3");
      const gateway = gatewayStub({
        [STRUCTURING_MODEL]: () => ({
          output: [{ content: [{ text: STRUCTURED, type: "output_text" }], type: "message" }],
          usage: { input_tokens: 12, output_tokens: 10 },
        }),
        [TRANSCRIPTION_MODEL]: () => { throw new Error("the transcription does not charge: it is on the BYOK"); },
      });
      const env: CloudEnv = {
        BYOK_MASTER_KEY: MASTER_KEY,
        DB: sqliteD1(db),
        DEPLOYMENT_ENV: "staging",
        ...gateway.env,
      };
      const cookie = await byokCookie(db, env, "usr_v3");
      const calls = fakeByokEgress([transcriptReply]);

      const response = await api("/api/ai/voice-pin", {
        body: voiceForm("byok_voice_request_003"),
        headers: { cookie },
        method: "POST",
      }, env);
      assert.equal(response.status, 200, await response.clone().text());
      const body = await jsonBody(response);
      assert.equal(body.source, "byok", "the origin of the request: the transcription ran on the user's endpoint");
      assert.equal(body.creditsCharged, 1, "the gateway charges exactly one (the transcription does not charge)");
      assert.equal(body.idempotent, false);
      assert.ok(isRecord(body.aiCredits));
      assert.equal(body.aiCredits.balance, 499);
      assert.ok(isRecord(body.usage));
      assert.equal(body.usage.provider, "pinar_cloud", "the metered call's usage");
      assert.equal(body.usage.model, STRUCTURING_MODEL);
      assert.ok(isRecord(body.result));
      assert.equal(body.result.comment, "Alinhe o botão ao título e mantenha 8 px de espaço.");
      assert.equal(body.result.transcript, TRANSRIPT);

      // The gateway ran only the structuring (the transcription stayed on
      // the user's endpoint).
      assert.equal(calls.length, 1, "the user's endpoint got the transcription only");
      assert.ok(calls[0].url.startsWith(`${BASE_URL}/audio/transcriptions`));
      assert.equal(gateway.calls.length, 1, "one metered call: the structuring");
      assert.equal(gateway.calls[0].model, STRUCTURING_MODEL);
      assert.deepEqual(ledgerRows(db), [{ feature: "voice_pin", status: "succeeded", credits: 1, model: STRUCTURING_MODEL }], "the voice's feature, one credit, the structuring's model");
      assert.equal(grantBalance(db, "usr_v3"), 499);
    } finally {
      db.close();
    }
  });

  test("a failing BYOK structuring ends with byok_error (no gateway call, no credit, the same refusal as today's failure)", async () => {
    const db = migratedDatabase();
    try {
      insertUser(db, "usr_v4", "pro");
      await seedByokRow(db, "usr_v4", { capabilitiesJson: capabilities({ chat: true, transcription: true }) });
      setPostProcessing(db, "usr_v4");
      const gateway = gatewayStub({
        [STRUCTURING_MODEL]: () => { throw new Error("the gateway must not be called in the BYOK structuring's place"); },
      });
      const env: CloudEnv = {
        BYOK_MASTER_KEY: MASTER_KEY,
        DB: sqliteD1(db),
        DEPLOYMENT_ENV: "staging",
        ...gateway.env,
      };
      const cookie = await byokCookie(db, env, "usr_v4");
      // The transcription answers; the structuring's 2xx has no choices —
      // the invalid_response of the common table.
      const calls = fakeByokEgress([transcriptReply, () => Response.json({ model: "chat-1" })]);

      const response = await api("/api/ai/voice-pin", {
        body: voiceForm("byok_voice_request_004"),
        headers: { cookie },
        method: "POST",
      }, env);
      assert.equal(response.status, 502);
      const body = await jsonBody(response);
      assert.deepEqual(body, { canUseCredits: true, cause: "invalid_response", code: "byok_error" });
      assert.equal(calls.length, 2, "the structuring was not retried on the same link");
      assert.equal(gateway.calls.length, 0, "the gateway is not called in its place");
      assert.deepEqual(ledgerRows(db), [], "nothing was reserved, nothing to refund");
      // The slot was freed: with a fully working endpoint the same account
      // runs end to end (the transcription + the structuring).
      const fixedCalls = fakeByokEgress([transcriptReply, chatReply(STRUCTURED)]);
      const fixed = await api("/api/ai/voice-pin", {
        body: voiceForm("byok_voice_request_004c"),
        headers: { cookie },
        method: "POST",
      }, env);
      assert.equal(fixed.status, 200, await fixed.clone().text());
      assert.equal(fixedCalls.length, 2);
    } finally {
      db.close();
    }
  });

  test("the failures of the common table end with byok_error, the right cause and status (no gateway, no credit, the slot freed)", async () => {
    const db = migratedDatabase();
    try {
      insertUser(db, "usr_v5", "pro");
      await seedByokRow(db, "usr_v5", { capabilitiesJson: capabilities({ transcription: true }) });
      const gateway = gatewayStub({
        [TRANSCRIPTION_MODEL]: () => { throw new Error("the gateway must not be called on a BYOK failure"); },
      });
      const env: CloudEnv = {
        BYOK_MASTER_KEY: MASTER_KEY,
        DB: sqliteD1(db),
        DEPLOYMENT_ENV: "staging",
        ...gateway.env,
      };
      const cookie = await byokCookie(db, env, "usr_v5");

      const providerError = (marker: string, status: number, headers: Record<string, string> = {}) =>
        new Response(JSON.stringify({ error: { message: marker } }), {
          headers: { "content-type": "application/json", ...headers },
          status,
        });
      // The cases run back to back with the same account: with the cap of
      // 2, a slot leaked by a previous case would rate_limit the next one
      // instead of answering with its own cause.
      const cases: Array<{
        cause: string;
        label: string;
        marker: string;
        respond?: () => Response;
        status: number;
        throwName?: string;
        refusal?: boolean;
        retryAfter?: number;
      }> = [
        { cause: "key_rejected", label: "401", marker: "PROVIDER-BODY-401", respond: () => providerError("PROVIDER-BODY-401", 401), status: 502 },
        {
          cause: "model_not_found",
          label: "404 with the model marker",
          marker: "PROVIDER-BODY-404",
          respond: () => new Response(JSON.stringify({ error: { code: "model_not_found", message: "PROVIDER-BODY-404" } }), { headers: { "content-type": "application/json" }, status: 404 }),
          status: 502,
        },
        { cause: "service_disabled", label: "404 without the marker", marker: "PROVIDER-BODY-404b", respond: () => providerError("PROVIDER-BODY-404b", 404), status: 502 },
        {
          cause: "rate_limited",
          label: "429 with Retry-After: 7",
          marker: "PROVIDER-BODY-429",
          respond: () => providerError("PROVIDER-BODY-429", 429, { "retry-after": "7" }),
          retryAfter: 7,
          status: 429,
        },
        { cause: "unavailable", label: "503", marker: "PROVIDER-BODY-503", respond: () => providerError("PROVIDER-BODY-503", 503), status: 502 },
        { cause: "timeout", label: "the deadline", marker: "PROVIDER-BODY-TIMEOUT", throwName: "TimeoutError", status: 502 },
        { cause: "egress_unavailable", label: "the egress refusal", marker: "", refusal: true, status: 502 },
        {
          cause: "endpoint_blocked",
          label: "EGRESS_HOST_BLOCKED",
          marker: "PROVIDER-BODY-HOST-BLOCKED",
          respond: () => new Response("PROVIDER-BODY-HOST-BLOCKED", { headers: { "x-edger-egress-error": "EGRESS_HOST_BLOCKED" }, status: 502 }),
          status: 502,
        },
      ];
      let index = 0;
      for (const c of cases) {
        index += 1;
        setByokEgressForTests(async () => {
          if (c.refusal) throw new ByokEgressUnavailableError();
          if (c.throwName) throw Object.assign(new Error(c.marker || "the provider timed out"), { name: c.throwName });
          return c.respond!();
        });
        const response = await api("/api/ai/voice-pin", {
          body: voiceForm(`byok_voice_fail_${String(index).padStart(2, "0")}`),
          headers: { cookie },
          method: "POST",
        }, env);
        assert.equal(response.status, c.status, `${c.label}: the status`);
        const body = await jsonBody(response);
        assert.equal(body.code, "byok_error", `${c.label}: the code`);
        assert.equal(body.cause, c.cause, `${c.label}: the cause`);
        assert.equal(body.canUseCredits, true, `${c.label}: canUseCredits`);
        assert.equal(body.retryAfter, c.retryAfter ?? undefined, `${c.label}: the retryAfter (only the 429)`);
        assert.ok(!JSON.stringify(body).includes(BYOK_KEY), `${c.label}: the key is not in the response`);
        assert.ok(c.marker === "" || !JSON.stringify(body).includes(c.marker), `${c.label}: the provider's body is not in the response`);
        assert.equal(gateway.calls.length, 0, `${c.label}: the gateway is not called`);
        assert.deepEqual(ledgerRows(db), [], `${c.label}: nothing was charged`);
      }
      // Every case answered its own cause (no rate_limited among them): the
      // slot was freed after each failing request. The account is not
      // capped — a working endpoint answers 200.
      setByokEgressForTests(transcriptReply);
      const after = await api("/api/ai/voice-pin", {
        body: voiceForm("byok_voice_fail_after"),
        headers: { cookie },
        method: "POST",
      }, env);
      assert.equal(after.status, 200, await after.clone().text());
      assert.equal(gateway.calls.length, 0, "across the table, the gateway was never called");
    } finally {
      db.close();
    }
  });

  test("the concurrency cap answers byok_error rate_limited (no queue, no gateway, no credit)", async () => {
    const db = migratedDatabase();
    try {
      insertUser(db, "usr_v6", "pro");
      await seedByokRow(db, "usr_v6", { capabilitiesJson: capabilities({ chat: true, transcription: true }) });
      setPostProcessing(db, "usr_v6");
      const gateway = gatewayStub({
        [TRANSCRIPTION_MODEL]: () => { throw new Error("the gateway must not be called"); },
      });
      const env: CloudEnv = {
        BYOK_MASTER_KEY: MASTER_KEY,
        DB: sqliteD1(db),
        DEPLOYMENT_ENV: "staging",
        ...gateway.env,
      };
      const cookie = await byokCookie(db, env, "usr_v6");
      const pro = principal("usr_v6", "pro");

      // Two in-flight BYOK calls of the account (held here): the request's
      // third call is capped — the no-queue rate_limited of the common
      // table, 429, never a fallback to the gateway.
      const heldTranscription = await cloudByokRoute(env, pro, "transcription");
      const heldChat = await cloudByokRoute(env, pro, "chat");
      assert.ok(heldTranscription !== null && !("cause" in heldTranscription));
      assert.ok(heldChat !== null && !("cause" in heldChat));
      const calls = fakeByokEgress([transcriptReply]);

      const response = await api("/api/ai/voice-pin", {
        body: voiceForm("byok_voice_capped_001"),
        headers: { cookie },
        method: "POST",
      }, env);
      assert.equal(response.status, 429);
      assert.deepEqual(await jsonBody(response), { canUseCredits: true, cause: "rate_limited", code: "byok_error" });
      assert.equal(calls.length, 0, "the endpoint was not called");
      assert.equal(gateway.calls.length, 0, "the gateway was not called");
      assert.deepEqual(ledgerRows(db), [], "no credit");

      // The release frees the slot: the next request runs on the endpoint.
      (heldTranscription as NonNullable<typeof heldTranscription>).release();
      (heldChat as NonNullable<typeof heldChat>).release();
      const afterCalls = fakeByokEgress([transcriptReply, chatReply(STRUCTURED)]);
      const after = await api("/api/ai/voice-pin", {
        body: voiceForm("byok_voice_capped_002"),
        headers: { cookie },
        method: "POST",
      }, env);
      assert.equal(after.status, 200, await after.clone().text());
      assert.equal(calls.length, 0, "the capped request never reached the endpoint");
      assert.equal(afterCalls.length, 2, "the transcription + the structuring on the endpoint");
    } finally {
      db.close();
    }
  });

  test("useCredits: true opts out of the BYOK route (the gateway, the credits, source pinar); an invalid value is 400", async () => {
    const db = migratedDatabase();
    try {
      insertUser(db, "usr_v7", "pro");
      await seedByokRow(db, "usr_v7", { capabilitiesJson: capabilities({ transcription: true }) });
      const gateway = gatewayStub({
        [TRANSCRIPTION_MODEL]: () => ({ text: TRANSRIPT, transcription_info: { duration: 30, language: "pt" } }),
      });
      const env: CloudEnv = {
        BYOK_MASTER_KEY: MASTER_KEY,
        DB: sqliteD1(db),
        DEPLOYMENT_ENV: "staging",
        ...gateway.env,
      };
      const cookie = await byokCookie(db, env, "usr_v7");
      const calls = fakeByokEgress([transcriptReply]);

      // useCredits: true (the form field) keeps today's metered path.
      const withCredits = await api("/api/ai/voice-pin", {
        body: voiceForm("byok_voice_usecr_001", { useCredits: "true" }),
        headers: { cookie },
        method: "POST",
      }, env);
      assert.equal(withCredits.status, 200, await withCredits.clone().text());
      const withCreditsBody = await jsonBody(withCredits);
      assert.equal(withCreditsBody.source, "pinar");
      assert.equal(withCreditsBody.creditsCharged, 1);
      assert.ok(calls.length === 0, "the user's endpoint is not called");
      assert.equal(gateway.calls.length, 1, "the gateway answers");

      // useCredits: false takes the BYOK route.
      const byok = await api("/api/ai/voice-pin", {
        body: voiceForm("byok_voice_usecr_002", { useCredits: "false" }),
        headers: { cookie },
        method: "POST",
      }, env);
      assert.equal(byok.status, 200, await byok.clone().text());
      const byokBody = await jsonBody(byok);
      assert.equal(byokBody.source, "byok");
      assert.equal(byokBody.creditsCharged, 0);
      assert.equal(calls.length, 1);

      // Any other value is 400 (before the plan, the limit and the route).
      for (const invalid of ["yes", "1", "TRUE"]) {
        const response = await api("/api/ai/voice-pin", {
          body: voiceForm("byok_voice_usecr_bad", { useCredits: invalid }),
          headers: { cookie },
          method: "POST",
        }, env);
        assert.equal(response.status, 400, invalid);
        assert.equal((await jsonBody(response)).error, "useCredits must be \"true\" or \"false\"");
      }
      // A File value (not a string) is 400 too.
      const fileForm = voiceForm("byok_voice_usecr_bad_file");
      fileForm.set("useCredits", new File([new Uint8Array([1])], "x.txt"));
      const fileResponse = await api("/api/ai/voice-pin", { body: fileForm, headers: { cookie }, method: "POST" }, env);
      assert.equal(fileResponse.status, 400);
      assert.equal((await jsonBody(fileResponse)).error, "useCredits must be \"true\" or \"false\"");
      assert.equal(calls.length, 1, "the 400s never reach the endpoint");
      assert.equal(gateway.calls.length, 1, "the 400s never reach the gateway");
      assert.deepEqual(ledgerRows(db).map((row) => [row.feature, row.status]), [["voice_pin", "succeeded"]], "only the useCredits request charged");
    } finally {
      db.close();
    }
  });

  test("without an ok capability the request keeps today's path (the gateway, the credit, source pinar, no endpoint call)", async () => {
    const db = migratedDatabase();
    try {
      insertUser(db, "usr_v8", "pro");
      // The transcription is untested (the S2 test never passed it): no
      // route — the metered path, unchanged.
      await seedByokRow(db, "usr_v8");
      const gateway = gatewayStub({
        [TRANSCRIPTION_MODEL]: () => ({ text: TRANSRIPT, transcription_info: { duration: 30, language: "pt" } }),
      });
      const env: CloudEnv = {
        BYOK_MASTER_KEY: MASTER_KEY,
        DB: sqliteD1(db),
        DEPLOYMENT_ENV: "staging",
        ...gateway.env,
      };
      const cookie = await byokCookie(db, env, "usr_v8");
      const calls = fakeByokEgress([transcriptReply]);

      const response = await api("/api/ai/voice-pin", {
        body: voiceForm("byok_voice_noroute_001"),
        headers: { cookie },
        method: "POST",
      }, env);
      assert.equal(response.status, 200, await response.clone().text());
      const body = await jsonBody(response);
      assert.equal(body.source, "pinar");
      assert.equal(body.creditsCharged, 1);
      assert.ok(isRecord(body.usage));
      assert.equal(body.usage.provider, "pinar_cloud");
      assert.equal(calls.length, 0, "the user's endpoint is not called");
      assert.equal(gateway.calls.length, 1);
      assert.deepEqual(ledgerRows(db).map((row) => [row.feature, row.status, row.credits]), [["voice_pin", "succeeded", 1]]);

      // A Free plan has no AI, BYOK included (D2): the plan check is the
      // first gate, on both paths.
      insertUser(db, "usr_v8_free", "free");
      const freeCookie = await byokCookie(db, env, "usr_v8_free", "free");
      const denied = await api("/api/ai/voice-pin", {
        body: voiceForm("byok_voice_free_001"),
        headers: { cookie: freeCookie },
        method: "POST",
      }, env);
      assert.equal(denied.status, 403);
      assert.equal((await jsonBody(denied)).code, "ai_requires_paid");
      assert.equal(calls.length, 0);
    } finally {
      db.close();
    }
  });

  test("production: without an injected egress, the egress_unavailable row goes to the gateway and nothing reaches the BYOK host", async () => {
    const db = migratedDatabase();
    try {
      insertUser(db, "usr_v9", "pro");
      // The row S2 stores in production (byokFetch refused): every
      // capability fails with the egress_unavailable cause — no route.
      await seedByokRow(db, "usr_v9", { capabilitiesJson: EGRESS_UNAVAILABLE_CAPABILITIES });
      const gatewayReplies: Record<string, unknown[]> = {
        [STRUCTURING_MODEL]: [
          { output: [{ content: [{ text: STRUCTURED, type: "output_text" }], type: "message" }], usage: { input_tokens: 12, output_tokens: 10 } },
          { output: [{ content: [{ text: REPRO_STEPS, type: "output_text" }], type: "message" }], usage: { input_tokens: 900, output_tokens: 300 } },
        ],
        [TRANSCRIPTION_MODEL]: [{ text: TRANSRIPT, transcription_info: { duration: 30, language: "pt" } }],
      };
      const gatewayCalls: string[] = [];
      const env: CloudEnv = {
        BYOK_MASTER_KEY: MASTER_KEY,
        DB: sqliteD1(db),
        DEPLOYMENT_ENV: "staging",
        AI: {
          run: async (model: string) => {
            gatewayCalls.push(model);
            const queue = gatewayReplies[model];
            const reply = queue?.shift();
            if (reply === undefined) throw new Error(`gateway stub: no reply for ${model}`);
            return reply;
          },
        } as unknown as CloudEnv["AI"],
      };
      const cookie = await byokCookie(db, env, "usr_v9");
      setByokEgressForTests(null); // production: byokFetch refuses

      // The spy on globalThis.fetch proves what leaves the server.
      const fetchUrls: string[] = [];
      const realFetch = globalThis.fetch;
      globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
        fetchUrls.push(typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url);
        return realFetch(input, init);
      }) as typeof fetch;
      try {
        setPostProcessing(db, "usr_v9");
        const voice = await api("/api/ai/voice-pin", {
          body: voiceForm("byok_voice_prod_001"),
          headers: { cookie },
          method: "POST",
        }, env);
        assert.equal(voice.status, 200, await voice.clone().text());
        const voiceBody = await jsonBody(voice);
        assert.equal(voiceBody.source, "pinar", "the path is the gateway's");
        assert.equal(voiceBody.creditsCharged, 1, "the 30 s clip's credit, exactly as today");

        // The reproduction of the same account (a session with steps).
        assert.equal((await uploadCapture(cookie, {
          id: "byok_repro_prod",
          pins: [{ comment: "The error toast never appears", number: 1 }],
          reproduction: {
            startedAt: NOW,
            steps: [
              { at: NOW, kind: "navigate", title: "Login", url: "https://example.test/login" },
              { at: NOW, kind: "click", locator: { cssSelector: "button", tag: "button" } },
            ],
            version: 1,
          },
        }, env)).status, 201);
        const repro = await api("/api/ai/reproduction", {
          body: JSON.stringify({ requestId: "byok_repro_prod_001", sessionId: "byok_repro_prod" }),
          headers: { cookie, "content-type": "application/json" },
          method: "POST",
        }, env);
        assert.equal(repro.status, 200, await repro.clone().text());
        const reproBody = await jsonBody(repro);
        assert.equal(reproBody.source, "pinar");
        assert.equal(reproBody.creditsCharged, 1);
      } finally {
        globalThis.fetch = realFetch;
      }

      // No call reached the BYOK host — the egress refusal (byokFetch) and
      // the route's null agree: the gateway path only.
      assert.ok(!fetchUrls.some((url) => url.includes("byok-user.test")), JSON.stringify(fetchUrls));
      assert.deepEqual(ledgerRows(db).map((row) => [row.feature, row.status, row.credits]), [
        ["voice_pin", "succeeded", 1],
        ["reproduction", "succeeded", 1],
      ]);
    } finally {
      db.close();
    }
  });

  test("production: a stale ok capability without an egress ends with byok_error egress_unavailable (unbilled, no gateway)", async () => {
    const db = migratedDatabase();
    try {
      insertUser(db, "usr_v10", "pro");
      // A stale ok (tested when the egress worked; S6 not wired since):
      // the route resolves, the egress is byokFetch's refusal.
      await seedByokRow(db, "usr_v10", { capabilitiesJson: capabilities({ transcription: true }) });
      const gateway = gatewayStub({
        [TRANSCRIPTION_MODEL]: () => { throw new Error("the gateway must not be called"); },
      });
      const env: CloudEnv = {
        BYOK_MASTER_KEY: MASTER_KEY,
        DB: sqliteD1(db),
        DEPLOYMENT_ENV: "staging",
        ...gateway.env,
      };
      const cookie = await byokCookie(db, env, "usr_v10");
      setByokEgressForTests(null); // production: byokFetch refuses

      const response = await api("/api/ai/voice-pin", {
        body: voiceForm("byok_voice_stale_001"),
        headers: { cookie },
        method: "POST",
      }, env);
      assert.equal(response.status, 502);
      assert.deepEqual(await jsonBody(response), { canUseCredits: true, cause: "egress_unavailable", code: "byok_error" });
      assert.equal(gateway.calls.length, 0, "no fallback to the gateway");
      assert.deepEqual(ledgerRows(db), [], "unbilled");
    } finally {
      db.close();
    }
  });

  test("F1: the transcription ok never goes to the gateway without useCredits (the structuring-unavailable keeps the BYOK decision)", async () => {
    const db = migratedDatabase();
    try {
      insertUser(db, "usr_f1", "pro");
      // The transcription is ok; the chat is untested (no route) and the
      // text path is unavailable (no AI binding, no text chain) — the
      // reviewer's FALLBACK scenario, with a usable transcription chain
      // (the metered path could have taken the audio — it must not).
      await seedByokRow(db, "usr_f1", { capabilitiesJson: capabilities({ transcription: true }) });
      setPostProcessing(db, "usr_f1");
      const env: CloudEnv = {
        AI_GATEWAY_API_KEY: "fake-key",
        AI_TRANSCRIPTION_CHAIN: "gateway:openai/whisper-1",
        BYOK_MASTER_KEY: MASTER_KEY,
        DB: sqliteD1(db),
        DEPLOYMENT_ENV: "staging",
      };
      const cookie = await byokCookie(db, env, "usr_f1");
      const byokCalls = fakeByokEgress([transcriptReply]);
      const fetchUrls: string[] = [];
      const realFetch = globalThis.fetch;
      globalThis.fetch = (async (input: RequestInfo | URL) => {
        fetchUrls.push(typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url);
        return Response.json({ durationInSeconds: 30, language: "pt", text: "gateway transcript" });
      }) as typeof fetch;
      try {
        const response = await api("/api/ai/voice-pin", {
          body: voiceForm("byok_voice_f1_001"),
          headers: { cookie },
          method: "POST",
        }, env);
        assert.equal(response.status, 503, await response.clone().text());
        assert.deepEqual(
          await jsonBody(response),
          { code: "ai_unavailable", error: "AI is not configured" },
          "today's structuring-unavailable response, without a credit",
        );
        assert.equal(byokCalls.length, 0, "no call to the user's endpoint (the transcription is not repeated)");
        assert.equal(fetchUrls.length, 0, "no gateway URL (the audio does not cross to the gateway)");
        assert.deepEqual(ledgerRows(db), [], "no credit, no ledger");
      } finally {
        globalThis.fetch = realFetch;
      }
      // The slot was released: with the text path available the same
      // account runs the mixed case end to end (no 429 cap).
      const gateway = gatewayStub({
        [STRUCTURING_MODEL]: () => ({
          output: [{ content: [{ text: STRUCTURED, type: "output_text" }], type: "message" }],
          usage: { input_tokens: 12, output_tokens: 10 },
        }),
      });
      const withText: CloudEnv = {
        BYOK_MASTER_KEY: MASTER_KEY,
        DB: sqliteD1(db),
        DEPLOYMENT_ENV: "staging",
        ...gateway.env,
      };      const mixedCalls = fakeByokEgress([transcriptReply]);
      const mixed = await api("/api/ai/voice-pin", {
        body: voiceForm("byok_voice_f1_002"),
        headers: { cookie },
        method: "POST",
      }, withText);
      assert.equal(mixed.status, 200, await mixed.clone().text());
      assert.equal((await jsonBody(mixed)).source, "byok");
      assert.equal(mixedCalls.length, 1);
      assert.equal(gateway.calls.length, 1, "only the structuring on the gateway");
    } finally {
      db.close();
    }
  });

  test("F2: one slot per voice request — the second runs while the first is in the transcription, the third is capped only with two in flight", async () => {
    const db = migratedDatabase();
    try {
      insertUser(db, "usr_f2", "pro");
      await seedByokRow(db, "usr_f2", { capabilitiesJson: capabilities({ chat: true, transcription: true }) });
      setPostProcessing(db, "usr_f2");
      const env: CloudEnv = {
        BYOK_MASTER_KEY: MASTER_KEY,
        DB: sqliteD1(db),
        DEPLOYMENT_ENV: "staging",
      };
      const cookie = await byokCookie(db, env, "usr_f2");
      let signalFirst!: () => void;
      let signalSecond!: () => void;
      let release!: () => void;
      const firstStarted = new Promise<void>((resolve) => { signalFirst = resolve; });
      const secondStarted = new Promise<void>((resolve) => { signalSecond = resolve; });
      const hold = new Promise<void>((resolve) => { release = resolve; });
      let transcriptions = 0;
      setByokEgressForTests(async (url) => {
        if (url.includes("transcriptions")) {
          transcriptions += 1;
          if (transcriptions === 1) signalFirst();
          if (transcriptions === 2) signalSecond();
          await hold; // both transcriptions stay in flight
          return transcriptReply();
        }
        return chatReply(STRUCTURED)();
      });
      const first = api("/api/ai/voice-pin", { body: voiceForm("byok_voice_f2_001"), headers: { cookie }, method: "POST" }, env);
      await firstStarted; // the first is stopped in the transcription (one in flight)
      const second = api("/api/ai/voice-pin", { body: voiceForm("byok_voice_f2_002"), headers: { cookie }, method: "POST" }, env);
      // The second request is not capped while only one call is in flight:
      // it reaches the transcription's egress (it is held there, like the
      // first). A second slot for the chat would cap it here with 429.
      const secondProbe = await Promise.race([
        secondStarted.then(() => "running" as const),
        second.then((response) => (response.status === 429 ? "capped" as const : "other")),
      ]);
      assert.equal(secondProbe, "running", "the second request runs (one call in flight)");
      await secondStarted; // it is in the transcription too (two in flight)
      // The third is capped only now, with two calls in flight.
      const third = await api("/api/ai/voice-pin", { body: voiceForm("byok_voice_f2_003"), headers: { cookie }, method: "POST" }, env);
      assert.equal(third.status, 429);
      assert.deepEqual(await jsonBody(third), { canUseCredits: true, cause: "rate_limited", code: "byok_error" });
      release();
      const firstResponse = await first;
      const secondResponse = await second;
      assert.equal(firstResponse.status, 200, await firstResponse.clone().text());
      assert.equal(secondResponse.status, 200, await secondResponse.clone().text());
      // With no call in flight the account is not capped.
      const after = await api("/api/ai/voice-pin", { body: voiceForm("byok_voice_f2_004"), headers: { cookie }, method: "POST" }, env);
      assert.equal(after.status, 200, await after.clone().text());
    } finally {
      db.close();
    }
  });

  test("F3: the mixed and the full path do not cross in the replay (409 before any new call, the stored origin on the same path)", async () => {
    const db = migratedDatabase();
    try {
      insertUser(db, "usr_f3", "pro");
      // The transcription is ok; the chat is untested (the mixed case).
      await seedByokRow(db, "usr_f3", { capabilitiesJson: capabilities({ transcription: true }) });
      setPostProcessing(db, "usr_f3");
      const gateway = gatewayStub({
        [TRANSCRIPTION_MODEL]: () => { throw new Error("the gateway must not transcribe (the transcription is on the BYOK)"); },
        [STRUCTURING_MODEL]: () => ({
          output: [{ content: [{ text: STRUCTURED, type: "output_text" }], type: "message" }],
          usage: { input_tokens: 12, output_tokens: 10 },
        }),
      });
      const env: CloudEnv = {
        BYOK_MASTER_KEY: MASTER_KEY,
        DB: sqliteD1(db),
        DEPLOYMENT_ENV: "staging",
        ...gateway.env,
      };
      const cookie = await byokCookie(db, env, "usr_f3");
      const byokCalls = fakeByokEgress([transcriptReply]);

      // The mixed: the transcription on the BYOK, the structuring on the
      // gateway — one credit, its own reservation identity.
      const first = await api("/api/ai/voice-pin", {
        body: voiceForm("byok_voice_f3_001", { durationSeconds: "90" }),
        headers: { cookie },
        method: "POST",
      }, env);
      assert.equal(first.status, 200, await first.clone().text());
      const firstBody = await jsonBody(first);
      assert.equal(firstBody.source, "byok");
      assert.equal(firstBody.creditsCharged, 1);
      assert.equal(firstBody.idempotent, false);
      assert.equal(byokCalls.length, 1);
      assert.equal(gateway.calls.length, 1, "only the structuring on the gateway");

      // The same requestId on the full metered path (useCredits): the 409
      // conflict before any new call (the identities differ).
      const second = await api("/api/ai/voice-pin", {
        body: voiceForm("byok_voice_f3_001", { durationSeconds: "90", useCredits: "true" }),
        headers: { cookie },
        method: "POST",
      }, env);
      assert.equal(second.status, 409);
      assert.equal((await jsonBody(second)).code, "request_id_conflict");
      assert.equal(byokCalls.length, 1, "no new call to the provider");
      assert.equal(gateway.calls.length, 1, "no new call to the gateway");
      assert.deepEqual(ledgerRows(db), [{ feature: "voice_pin", status: "succeeded", credits: 1, model: STRUCTURING_MODEL }]);

      // The same requestId on the mixed path again replays the stored
      // result with the stored origin (no new call).
      const third = await api("/api/ai/voice-pin", {
        body: voiceForm("byok_voice_f3_001", { durationSeconds: "90" }),
        headers: { cookie },
        method: "POST",
      }, env);
      assert.equal(third.status, 200);
      const thirdBody = await jsonBody(third);
      assert.equal(thirdBody.idempotent, true);
      assert.equal(thirdBody.source, "byok", "the stored origin");
      assert.equal(thirdBody.creditsCharged, 1);
      assert.deepEqual(thirdBody.result, firstBody.result);
      assert.equal(byokCalls.length, 1);
      assert.equal(gateway.calls.length, 1);
    } finally {
      db.close();
    }
  });

  test("F3 reverse: the full path first, the mixed second (the 409 before the BYOK call)", async () => {
    const db = migratedDatabase();
    try {
      insertUser(db, "usr_f3r", "pro");
      await seedByokRow(db, "usr_f3r", { capabilitiesJson: capabilities({ transcription: true }) });
      setPostProcessing(db, "usr_f3r");
      const gateway = gatewayStub({
        [TRANSCRIPTION_MODEL]: () => ({ text: "old gateway transcript", transcription_info: { duration: 90 } }),
        [STRUCTURING_MODEL]: () => ({
          output: [{ content: [{ text: STRUCTURED, type: "output_text" }], type: "message" }],
          usage: { input_tokens: 12, output_tokens: 10 },
        }),
      });
      const env: CloudEnv = {
        BYOK_MASTER_KEY: MASTER_KEY,
        DB: sqliteD1(db),
        DEPLOYMENT_ENV: "staging",
        ...gateway.env,
      };
      const cookie = await byokCookie(db, env, "usr_f3r");
      const byokCalls = fakeByokEgress([transcriptReply]);

      // The full metered first: two credits (the 90 s clip), source pinar.
      const first = await api("/api/ai/voice-pin", {
        body: voiceForm("byok_voice_f3r_001", { durationSeconds: "90", useCredits: "true" }),
        headers: { cookie },
        method: "POST",
      }, env);
      assert.equal(first.status, 200, await first.clone().text());
      const firstBody = await jsonBody(first);
      assert.equal(firstBody.source, "pinar");
      assert.equal(firstBody.creditsCharged, 2);
      assert.equal(gateway.calls.length, 2, "the transcription + the structuring");
      assert.equal(byokCalls.length, 0);

      // The same requestId without useCredits: the mixed's reservation
      // conflicts with the stored full one — the 409 before any BYOK call
      // (the transcription must not run on the user's endpoint).
      const second = await api("/api/ai/voice-pin", {
        body: voiceForm("byok_voice_f3r_001", { durationSeconds: "90" }),
        headers: { cookie },
        method: "POST",
      }, env);
      assert.equal(second.status, 409);
      assert.equal((await jsonBody(second)).code, "request_id_conflict");
      assert.equal(byokCalls.length, 0, "the transcription did not run on the BYOK");
      assert.equal(gateway.calls.length, 2, "no new gateway call");
      assert.deepEqual(ledgerRows(db), [{ feature: "voice_pin", status: "succeeded", credits: 2, model: `${TRANSCRIPTION_MODEL} + ${STRUCTURING_MODEL}` }]);
    } finally {
      db.close();
    }
  });

  test("F4: an exception in the preparation (the chat's route) releases the slot (the next request runs)", async () => {
    const db = migratedDatabase();
    try {
      insertUser(db, "usr_f4", "pro");
      await seedByokRow(db, "usr_f4", { capabilitiesJson: capabilities({ chat: true, transcription: true }) });
      setPostProcessing(db, "usr_f4");
      // The chat's route read throws on the first two requests (their
      // transcription slots, if not released, leak for good — the counter
      // never expires).
      const real = sqliteD1(db);
      let reads = 0;
      let remaining = 2;
      const wrapped = {
        ...real,
        prepare(query: string) {
          if (query.includes("FROM byok_endpoints")) {
            reads += 1;
            if (reads % 2 === 0 && remaining > 0) {
              remaining -= 1;
              throw new Error("injected chat route database failure");
            }
          }
          return real.prepare(query);
        },
      };
      const env: CloudEnv = {
        BYOK_MASTER_KEY: MASTER_KEY,
        DB: wrapped,
        DEPLOYMENT_ENV: "staging",
      };
      const cookie = await byokCookie(db, env, "usr_f4");
      const calls = fakeByokEgress([transcriptReply, chatReply(STRUCTURED)]);
      let initial: string | number = "";
      for (const i of [1, 2]) {
        try {
          const response = await api("/api/ai/voice-pin", { body: voiceForm(`byok_voice_f4_00${i}`), headers: { cookie }, method: "POST" }, env);
          initial = response.status;
        } catch (error) {
          initial = (error as Error).message;
        }
      }
      assert.equal(initial, "injected chat route database failure", "the exception propagates (a server bug, not a byok_error)");
      // The slots were released: the next request runs end to end (in the
      // leak, the two failed requests leave the account capped).
      const after = await api("/api/ai/voice-pin", { body: voiceForm("byok_voice_f4_003"), headers: { cookie }, method: "POST" }, env);
      assert.equal(after.status, 200, await after.clone().text());
      assert.equal(calls.length, 2, "the transcription + the structuring on the endpoint");
      assert.deepEqual(ledgerRows(db), [], "no credit");
    } finally {
      db.close();
    }
  });

  test("R1: a failed mixed transcription refunds the reservation and answers the byok_error with the cause (the retry runs)", async () => {
    const db = migratedDatabase();
    try {
      insertUser(db, "usr_r1", "pro");
      // The transcription is ok; the chat is untested: the mixed case
      // (the transcription on the BYOK inside the metered path).
      await seedByokRow(db, "usr_r1", { capabilitiesJson: capabilities({ transcription: true }) });
      setPostProcessing(db, "usr_r1");
      const gateway = gatewayStub({
        [STRUCTURING_MODEL]: () => ({
          output: [{ content: [{ text: STRUCTURED, type: "output_text" }], type: "message" }],
          usage: { input_tokens: 12, output_tokens: 10 },
        }),
        [TRANSCRIPTION_MODEL]: () => { throw new Error("the transcription does not charge: it is on the BYOK"); },
      });
      const env: CloudEnv = {
        BYOK_MASTER_KEY: MASTER_KEY,
        DB: sqliteD1(db),
        DEPLOYMENT_ENV: "staging",
        ...gateway.env,
      };
      const cookie = await byokCookie(db, env, "usr_r1");
      let attempts = 0;
      setByokEgressForTests(async (url) => {
        if (url.includes("transcriptions")) {
          attempts += 1;
          // The reviewer's MIXED_BYOK_ERROR: the first call is a 429 with
          // Retry-After: 7.
          if (attempts === 1) {
            return new Response("slow down", { status: 429, headers: { "retry-after": "7" } });
          }
          return transcriptReply();
        }
        return chatReply(STRUCTURED)();
      });

      const response = await api("/api/ai/voice-pin", { body: voiceForm("byok_voice_r1_001"), headers: { cookie }, method: "POST" }, env);
      assert.equal(response.status, 429, "the BYOK's 429 keeps its status");
      const body = await jsonBody(response);
      assert.equal(body.code, "byok_error", "not the generic ai_inference_failed");
      assert.equal(body.cause, "rate_limited", "the sanitized cause survives the refund");
      assert.equal(body.retryAfter, 7);
      assert.equal(body.canUseCredits, true, "the contractual alternative is offered");
      assert.ok(!JSON.stringify(body).includes(BASE_URL), "the user's endpoint never crosses the response");
      assert.deepEqual(ledgerRows(db), [{ feature: "voice_pin", status: "refunded", credits: 1, model: STRUCTURING_MODEL }], "the reserved credit went back");
      assert.equal(grantBalance(db, "usr_r1"), 500);
      assert.equal(gateway.calls.length, 0, "the structuring never ran (the gateway got nothing)");

      // The retry runs: the second call is ok — the mixed case completes.
      const retry = await api("/api/ai/voice-pin", { body: voiceForm("byok_voice_r1_002"), headers: { cookie }, method: "POST" }, env);
      assert.equal(retry.status, 200, await retry.clone().text());
      const retryBody = await jsonBody(retry);
      assert.equal(retryBody.source, "byok");
      assert.equal(retryBody.creditsCharged, 1);
      assert.equal(gateway.calls.length, 1, "only the structuring");
      assert.equal(attempts, 2);
      assert.equal(grantBalance(db, "usr_r1"), 499);
    } finally {
      db.close();
    }
  });

  test("R1: a rejected key in the mixed transcription answers 502 key_rejected (the credit goes back, no gateway)", async () => {
    const db = migratedDatabase();
    try {
      insertUser(db, "usr_r1b", "pro");
      await seedByokRow(db, "usr_r1b", { capabilitiesJson: capabilities({ transcription: true }) });
      setPostProcessing(db, "usr_r1b");
      const gateway = gatewayStub({
        [STRUCTURING_MODEL]: () => ({
          output: [{ content: [{ text: STRUCTURED, type: "output_text" }], type: "message" }],
          usage: { input_tokens: 12, output_tokens: 10 },
        }),
        [TRANSCRIPTION_MODEL]: () => { throw new Error("no transcription on the gateway"); },
      });
      const env: CloudEnv = {
        BYOK_MASTER_KEY: MASTER_KEY,
        DB: sqliteD1(db),
        DEPLOYMENT_ENV: "staging",
        ...gateway.env,
      };
      const cookie = await byokCookie(db, env, "usr_r1b");
      setByokEgressForTests(async () => new Response("nope", { status: 401 }));

      const response = await api("/api/ai/voice-pin", { body: voiceForm("byok_voice_r1b_001"), headers: { cookie }, method: "POST" }, env);
      assert.equal(response.status, 502);
      const body = await jsonBody(response);
      assert.equal(body.code, "byok_error");
      assert.equal(body.cause, "key_rejected");
      assert.equal(body.canUseCredits, true);
      assert.deepEqual(ledgerRows(db), [{ feature: "voice_pin", status: "refunded", credits: 1, model: STRUCTURING_MODEL }]);
      assert.equal(grantBalance(db, "usr_r1b"), 500);
      assert.equal(gateway.calls.length, 0);
    } finally {
      db.close();
    }
  });

  test("R2: the mixed path holds the slot until the transcription it protects ends (the third mixed is capped)", async () => {
    const db = migratedDatabase();
    try {
      insertUser(db, "usr_r2", "pro");
      // The transcription is ok; the chat is untested: every request is
      // the mixed case (the R2 window: the slot vs. the metered path's
      // promise).
      await seedByokRow(db, "usr_r2", { capabilitiesJson: capabilities({ transcription: true }) });
      setPostProcessing(db, "usr_r2");
      const gateway = gatewayStub({
        [STRUCTURING_MODEL]: () => ({
          output: [{ content: [{ text: STRUCTURED, type: "output_text" }], type: "message" }],
          usage: { input_tokens: 12, output_tokens: 10 },
        }),
        [TRANSCRIPTION_MODEL]: () => { throw new Error("the transcription does not charge: it is on the BYOK"); },
      });
      const env: CloudEnv = {
        BYOK_MASTER_KEY: MASTER_KEY,
        DB: sqliteD1(db),
        DEPLOYMENT_ENV: "staging",
        ...gateway.env,
      };
      const cookie = await byokCookie(db, env, "usr_r2");
      let transcriptions = 0;
      let release!: () => void;
      const hold = new Promise<void>((resolve) => { release = resolve; });
      setByokEgressForTests(async (url) => {
        if (url.includes("transcriptions")) {
          transcriptions += 1;
          await hold; // the mixed transcriptions stay in flight
          return transcriptReply();
        }
        return chatReply(STRUCTURED)();
      });
      const first = api("/api/ai/voice-pin", { body: voiceForm("byok_voice_r2_001"), headers: { cookie }, method: "POST" }, env);
      const second = api("/api/ai/voice-pin", { body: voiceForm("byok_voice_r2_002"), headers: { cookie }, method: "POST" }, env);
      while (transcriptions < 2) await new Promise((resolve) => setTimeout(resolve, 10));
      // Two mixed transcriptions in flight: the slot still covers them
      // (the release comes only after the protected work — R2).
      const third = api("/api/ai/voice-pin", { body: voiceForm("byok_voice_r2_003"), headers: { cookie }, method: "POST" }, env);
      let settled = false;
      const capped = await new Promise<boolean>((resolve) => {
        const timer = setInterval(() => {
          if (transcriptions >= 3) {
            settled = true;
            clearInterval(timer);
            resolve(false);
          }
        }, 10);
        void third.then((response) => {
          if (settled) return;
          settled = true;
          clearInterval(timer);
          resolve(response.status === 429);
        });
      });
      assert.equal(capped, true, "the third mixed request never reaches the BYOK egress (the slot is still held)");
      const thirdResponse = await third;
      assert.equal(thirdResponse.status, 429);
      assert.deepEqual(await jsonBody(thirdResponse), { canUseCredits: true, cause: "rate_limited", code: "byok_error" });
      assert.deepEqual(ledgerRows(db), [
        { feature: "voice_pin", status: "reserved", credits: 1, model: STRUCTURING_MODEL },
        { feature: "voice_pin", status: "reserved", credits: 1, model: STRUCTURING_MODEL },
      ], "the two in flight reserved (the capped one never did)");
      release();
      const firstResponse = await first;
      const secondResponse = await second;
      assert.equal(firstResponse.status, 200, await firstResponse.clone().text());
      assert.equal(secondResponse.status, 200, await secondResponse.clone().text());
      // With the slots back the account is not capped.
      const after = await api("/api/ai/voice-pin", { body: voiceForm("byok_voice_r2_004"), headers: { cookie }, method: "POST" }, env);
      assert.equal(after.status, 200, await after.clone().text());
      assert.equal(transcriptions, 3, "the capped one never called the endpoint");
      assert.equal(gateway.calls.length, 3, "the structuring of each completed request");
      assert.deepEqual(ledgerRows(db).map((row) => row.status), ["succeeded", "succeeded", "succeeded"]);
      assert.equal(grantBalance(db, "usr_r2"), 497, "one credit per mixed request");
    } finally {
      db.close();
    }
  });
});

// ---------- reproduction ----------

const RECORDING = {
  startedAt: NOW,
  steps: [
    { at: NOW, kind: "navigate", title: "Login", url: "https://example.test/login" },
    { at: NOW, kind: "input", locator: { cssSelector: "input[name=email]", tag: "input" }, value: "user@example.test" },
    { at: NOW, kind: "click", locator: { cssSelector: "button[type=submit]", innerText: "Sign in", tag: "button" } },
  ],
  version: 1,
};

const REPRO_STEPS = JSON.stringify({ steps: ["Open https://example.test/login", "Type user@example.test into Email", "Click Sign in"] });

describe("POST /api/ai/reproduction on BYOK (F5/S3b)", () => {
  test("the generation runs on the user's chat, persists in the session, without credit, source byok", async () => {
    const db = migratedDatabase();
    try {
      insertUser(db, "usr_r1", "pro");
      await seedByokRow(db, "usr_r1", { capabilitiesJson: capabilities({ chat: true }) });
      const gateway = gatewayStub({
        [STRUCTURING_MODEL]: () => { throw new Error("the gateway must not be called"); },
      });
      const env: CloudEnv = {
        BYOK_MASTER_KEY: MASTER_KEY,
        DB: sqliteD1(db),
        DEPLOYMENT_ENV: "staging",
        ...gateway.env,
      };
      const cookie = await byokCookie(db, env, "usr_r1");
      assert.equal((await uploadCapture(cookie, {
        id: "byok_repro_001",
        pins: [{ comment: "The error toast never appears", number: 1 }],
        reproduction: RECORDING,
      }, env)).status, 201);
      const calls = fakeByokEgress([chatReply(REPRO_STEPS)]);

      const response = await api("/api/ai/reproduction", {
        body: JSON.stringify({ requestId: "byok_repro_request_001", sessionId: "byok_repro_001" }),
        headers: { cookie, "content-type": "application/json" },
        method: "POST",
      }, env);
      assert.equal(response.status, 200, await response.clone().text());
      const body = await jsonBody(response);
      assert.equal(body.source, "byok");
      assert.equal(body.creditsCharged, 0);
      assert.equal(body.idempotent, false);
      assert.ok(isRecord(body.aiCredits));
      assert.equal(body.aiCredits.balance, 0, "the balance did not move (no grant was ever created)");
      assert.ok(isRecord(body.usage));
      assert.equal(body.usage.provider, "byok");
      assert.equal(body.usage.model, "chat-1");
      assert.ok(isRecord(body.result));
      assert.deepEqual(body.result.steps, ["Open https://example.test/login", "Type user@example.test into Email", "Click Sign in"]);
      assert.equal(body.result.provider, "byok");
      assert.equal(body.result.model, "chat-1");

      // The same prompt as today: the reproduction's instructions + the
      // session's JSON, the user's chat model, the JSON mode (today's
      // jsonObject: true), the spec's maxTokens and temperature.
      assert.equal(calls.length, 1);
      assert.ok(calls[0].url.startsWith(`${BASE_URL}/chat/completions`), calls[0].url);
      assert.equal(calls[0].auth, `Bearer ${BYOK_KEY}`);
      const chatBody = JSON.parse(String(calls[0].body)) as Record<string, unknown>;
      assert.equal(chatBody.model, "chat-1");
      assert.equal(chatBody.max_tokens, 2048);
      assert.equal(chatBody.temperature, 0.1);
      assert.deepEqual(chatBody.response_format, { type: "json_object" }, "the same JSON mode as today");
      const messages = chatBody.messages as Array<Record<string, unknown>>;
      assert.equal(messages.length, 2);
      assert.match(String(messages[0].content), /untrusted data/);
      assert.match(String(messages[1].content), /"redacted"|user@example\.test/);
      assert.equal(calls[0].auth, `Bearer ${BYOK_KEY}`, "the key only crosses the header");

      // The same persistence as today: the session's generated, with the
      // user's model and the byok provider.
      const session = await api("/api/sessions/byok_repro_001", { headers: { cookie } }, env);
      assert.equal(session.status, 200);
      const sessionBody = await jsonBody(session);
      const generated = (isRecord(sessionBody.session) && isRecord(sessionBody.session.reproduction)
        ? (sessionBody.session.reproduction as Record<string, unknown>).generated
        : undefined) as Record<string, unknown> | undefined;
      assert.ok(isRecord(generated), "the result was persisted");
      assert.equal(generated!.model, "chat-1");
      assert.equal(generated!.provider, "byok");

      assert.equal(gateway.calls.length, 0, "the gateway is not called");
      assert.deepEqual(ledgerRows(db), [], "no credit, no ledger");
      assert.deepEqual(db.query("SELECT id FROM ai_credit_grants").all(), [], "no grant was created");
    } finally {
      db.close();
    }
  });

  test("the invalid JSON answers byok_error invalid_response (no credit, nothing persisted, the slot freed)", async () => {
    const db = migratedDatabase();
    try {
      insertUser(db, "usr_r2", "pro");
      await seedByokRow(db, "usr_r2", { capabilitiesJson: capabilities({ chat: true }) });
      const gateway = gatewayStub({
        [STRUCTURING_MODEL]: () => { throw new Error("the gateway must not be called"); },
      });
      const env: CloudEnv = {
        BYOK_MASTER_KEY: MASTER_KEY,
        DB: sqliteD1(db),
        DEPLOYMENT_ENV: "staging",
        ...gateway.env,
      };
      const cookie = await byokCookie(db, env, "usr_r2");
      assert.equal((await uploadCapture(cookie, {
        id: "byok_repro_002",
        pins: [{ comment: "x", number: 1 }],
        reproduction: RECORDING,
      }, env)).status, 201);
      const calls = fakeByokEgress([chatReply("not json at all")]);

      const response = await api("/api/ai/reproduction", {
        body: JSON.stringify({ requestId: "byok_repro_request_002", sessionId: "byok_repro_002" }),
        headers: { cookie, "content-type": "application/json" },
        method: "POST",
      }, env);
      assert.equal(response.status, 502);
      assert.deepEqual(await jsonBody(response), { canUseCredits: true, cause: "invalid_response", code: "byok_error" });
      assert.equal(calls.length, 1, "one call, no retry");
      assert.equal(gateway.calls.length, 0, "the gateway is not called");
      assert.deepEqual(ledgerRows(db), [], "nothing was charged");
      // Nothing was persisted.
      const session = await api("/api/sessions/byok_repro_002", { headers: { cookie } }, env);
      const sessionBody = await jsonBody(session);
      const reproduction = isRecord(sessionBody.session) ? (sessionBody.session as Record<string, unknown>).reproduction : undefined;
      assert.equal(isRecord(reproduction) && "generated" in (reproduction as Record<string, unknown>), false, "no generated was persisted");
      // The slot was freed: a working endpoint answers 200 for the next
      // request of the same account.
      setByokEgressForTests(chatReply(REPRO_STEPS));
      const retry = await api("/api/ai/reproduction", {
        body: JSON.stringify({ requestId: "byok_repro_request_002b", sessionId: "byok_repro_002" }),
        headers: { cookie, "content-type": "application/json" },
        method: "POST",
      }, env);
      assert.equal(retry.status, 200, await retry.clone().text());
    } finally {
      db.close();
    }
  });

  test("a session deleted between the read and the write answers 404, without a credit to refund", async () => {
    const db = migratedDatabase();
    try {
      insertUser(db, "usr_r3", "pro");
      await seedByokRow(db, "usr_r3", { capabilitiesJson: capabilities({ chat: true }) });
      const env: CloudEnv = {
        BYOK_MASTER_KEY: MASTER_KEY,
        DB: sqliteD1(db),
        DEPLOYMENT_ENV: "staging",
        AI: { run: async () => { throw new Error("the gateway must not be called") } } as unknown as CloudEnv["AI"],
      };
      const cookie = await byokCookie(db, env, "usr_r3");
      assert.equal((await uploadCapture(cookie, {
        id: "byok_repro_003",
        pins: [{ comment: "x", number: 1 }],
        reproduction: RECORDING,
      }, env)).status, 201);
      // The egress deletes the session while it answers: the write does
      // not persist (the 404 of the other session edits), and nothing was
      // reserved on the BYOK path.
      setByokEgressForTests(async () => {
        db.query("DELETE FROM sessions WHERE id = 'byok_repro_003'").run();
        return chatReply(REPRO_STEPS)();
      });

      const response = await api("/api/ai/reproduction", {
        body: JSON.stringify({ requestId: "byok_repro_request_003", sessionId: "byok_repro_003" }),
        headers: { cookie, "content-type": "application/json" },
        method: "POST",
      }, env);
      assert.equal(response.status, 404, await response.clone().text());
      assert.deepEqual(ledgerRows(db), [], "no credit to refund");
      assert.deepEqual(db.query("SELECT id FROM ai_credit_grants").all(), [], "no grant was ever created");
    } finally {
      db.close();
    }
  });

  test("the failures of the common table end with byok_error, the right cause and status (no gateway, no credit, the slot freed)", async () => {
    const db = migratedDatabase();
    try {
      insertUser(db, "usr_r4", "pro");
      await seedByokRow(db, "usr_r4", { capabilitiesJson: capabilities({ chat: true }) });
      const gateway = gatewayStub({
        [STRUCTURING_MODEL]: () => { throw new Error("the gateway must not be called on a BYOK failure"); },
      });
      const env: CloudEnv = {
        BYOK_MASTER_KEY: MASTER_KEY,
        DB: sqliteD1(db),
        DEPLOYMENT_ENV: "staging",
        ...gateway.env,
      };
      const cookie = await byokCookie(db, env, "usr_r4");
      assert.equal((await uploadCapture(cookie, {
        id: "byok_repro_004",
        pins: [{ comment: "x", number: 1 }],
        reproduction: RECORDING,
      }, env)).status, 201);

      const providerError = (marker: string, status: number, headers: Record<string, string> = {}) =>
        new Response(JSON.stringify({ error: { message: marker } }), {
          headers: { "content-type": "application/json", ...headers },
          status,
        });
      const cases: Array<{
        cause: string;
        label: string;
        marker: string;
        respond?: () => Response;
        status: number;
        throwName?: string;
        refusal?: boolean;
        retryAfter?: number;
      }> = [
        { cause: "key_rejected", label: "401", marker: "PROVIDER-BODY-401", respond: () => providerError("PROVIDER-BODY-401", 401), status: 502 },
        {
          cause: "model_not_found",
          label: "404 with the model marker",
          marker: "PROVIDER-BODY-404",
          respond: () => new Response(JSON.stringify({ error: { code: "model_not_found", message: "PROVIDER-BODY-404" } }), { headers: { "content-type": "application/json" }, status: 404 }),
          status: 502,
        },
        {
          cause: "rate_limited",
          label: "429 with Retry-After: 9",
          marker: "PROVIDER-BODY-429",
          respond: () => providerError("PROVIDER-BODY-429", 429, { "retry-after": "9" }),
          retryAfter: 9,
          status: 429,
        },
        { cause: "unavailable", label: "503", marker: "PROVIDER-BODY-503", respond: () => providerError("PROVIDER-BODY-503", 503), status: 502 },
        { cause: "timeout", label: "the deadline", marker: "PROVIDER-BODY-TIMEOUT", throwName: "TimeoutError", status: 502 },
        { cause: "egress_unavailable", label: "the egress refusal", marker: "", refusal: true, status: 502 },
        {
          cause: "endpoint_blocked",
          label: "EGRESS_HOST_BLOCKED",
          marker: "PROVIDER-BODY-HOST-BLOCKED",
          respond: () => new Response("PROVIDER-BODY-HOST-BLOCKED", { headers: { "x-edger-egress-error": "EGRESS_HOST_BLOCKED" }, status: 502 }),
          status: 502,
        },
      ];
      let index = 0;
      for (const c of cases) {
        index += 1;
        setByokEgressForTests(async () => {
          if (c.refusal) throw new ByokEgressUnavailableError();
          if (c.throwName) throw Object.assign(new Error(c.marker || "the provider timed out"), { name: c.throwName });
          return c.respond!();
        });
        const response = await api("/api/ai/reproduction", {
          body: JSON.stringify({ requestId: `byok_repro_fail_${String(index).padStart(2, "0")}`, sessionId: "byok_repro_004" }),
          headers: { cookie, "content-type": "application/json" },
          method: "POST",
        }, env);
        assert.equal(response.status, c.status, `${c.label}: the status`);
        const body = await jsonBody(response);
        assert.equal(body.code, "byok_error", `${c.label}: the code`);
        assert.equal(body.cause, c.cause, `${c.label}: the cause`);
        assert.equal(body.canUseCredits, true, `${c.label}: canUseCredits`);
        assert.equal(body.retryAfter, c.retryAfter ?? undefined, `${c.label}: the retryAfter (only the 429)`);
        assert.ok(!JSON.stringify(body).includes(BYOK_KEY), `${c.label}: the key is not in the response`);
        assert.ok(c.marker === "" || !JSON.stringify(body).includes(c.marker), `${c.label}: the provider's body is not in the response`);
        assert.equal(gateway.calls.length, 0, `${c.label}: the gateway is not called`);
        assert.deepEqual(ledgerRows(db), [], `${c.label}: nothing was charged`);
      }
      // The slot was freed after each case (a leak would rate_limit the
      // next one): a working endpoint answers 200.
      setByokEgressForTests(chatReply(REPRO_STEPS));
      const after = await api("/api/ai/reproduction", {
        body: JSON.stringify({ requestId: "byok_repro_fail_after", sessionId: "byok_repro_004" }),
        headers: { cookie, "content-type": "application/json" },
        method: "POST",
      }, env);
      assert.equal(after.status, 200, await after.clone().text());
    } finally {
      db.close();
    }
  });

  test("useCredits: true opts out of the BYOK route (the gateway, the credit, source pinar); an invalid type is 400", async () => {
    const db = migratedDatabase();
    try {
      insertUser(db, "usr_r5", "pro");
      await seedByokRow(db, "usr_r5", { capabilitiesJson: capabilities({ chat: true }) });
      const gateway = gatewayStub({
        [STRUCTURING_MODEL]: () => ({
          output: [{ content: [{ text: REPRO_STEPS, type: "output_text" }], type: "message" }],
          usage: { input_tokens: 900, output_tokens: 300 },
        }),
      });
      const env: CloudEnv = {
        BYOK_MASTER_KEY: MASTER_KEY,
        DB: sqliteD1(db),
        DEPLOYMENT_ENV: "staging",
        ...gateway.env,
      };
      const cookie = await byokCookie(db, env, "usr_r5");
      assert.equal((await uploadCapture(cookie, {
        id: "byok_repro_005",
        pins: [{ comment: "x", number: 1 }],
        reproduction: RECORDING,
      }, env)).status, 201);
      const calls = fakeByokEgress([chatReply(REPRO_STEPS)]);

      // useCredits: true keeps today's metered path.
      const withCredits = await api("/api/ai/reproduction", {
        body: JSON.stringify({ requestId: "byok_repro_usecr_001", sessionId: "byok_repro_005", useCredits: true }),
        headers: { cookie, "content-type": "application/json" },
        method: "POST",
      }, env);
      assert.equal(withCredits.status, 200, await withCredits.clone().text());
      const withCreditsBody = await jsonBody(withCredits);
      assert.equal(withCreditsBody.source, "pinar");
      assert.equal(withCreditsBody.creditsCharged, 1);
      assert.equal(calls.length, 0, "the user's endpoint is not called");
      assert.equal(gateway.calls.length, 1, "the gateway answers");

      // Without useCredits the BYOK route runs.
      const byok = await api("/api/ai/reproduction", {
        body: JSON.stringify({ requestId: "byok_repro_usecr_002", sessionId: "byok_repro_005" }),
        headers: { cookie, "content-type": "application/json" },
        method: "POST",
      }, env);
      assert.equal(byok.status, 200, await byok.clone().text());
      const byokBody = await jsonBody(byok);
      assert.equal(byokBody.source, "byok");
      assert.equal(byokBody.creditsCharged, 0);
      assert.equal(calls.length, 1);

      // Any other type is 400.
      for (const invalid of ["true", 1, null]) {
        const response = await api("/api/ai/reproduction", {
          body: JSON.stringify({ requestId: "byok_repro_usecr_bad_01", sessionId: "byok_repro_005", useCredits: invalid }),
          headers: { cookie, "content-type": "application/json" },
          method: "POST",
        }, env);
        assert.equal(response.status, 400, JSON.stringify(invalid));
        assert.equal((await jsonBody(response)).error, "useCredits must be a boolean");
      }
      assert.deepEqual(ledgerRows(db).map((row) => [row.feature, row.status]), [["reproduction", "succeeded"]], "only the useCredits request charged");
    } finally {
      db.close();
    }
  });

  test("without an ok capability the request keeps today's path (the gateway, the credit, source pinar)", async () => {
    const db = migratedDatabase();
    try {
      insertUser(db, "usr_r6", "pro");
      await seedByokRow(db, "usr_r6"); // the chat is untested: no route
      const gateway = gatewayStub({
        [STRUCTURING_MODEL]: () => ({
          output: [{ content: [{ text: REPRO_STEPS, type: "output_text" }], type: "message" }],
          usage: { input_tokens: 900, output_tokens: 300 },
        }),
      });
      const env: CloudEnv = {
        BYOK_MASTER_KEY: MASTER_KEY,
        DB: sqliteD1(db),
        DEPLOYMENT_ENV: "staging",
        ...gateway.env,
      };
      const cookie = await byokCookie(db, env, "usr_r6");
      assert.equal((await uploadCapture(cookie, {
        id: "byok_repro_006",
        pins: [{ comment: "x", number: 1 }],
        reproduction: RECORDING,
      }, env)).status, 201);
      const calls = fakeByokEgress([chatReply(REPRO_STEPS)]);

      const response = await api("/api/ai/reproduction", {
        body: JSON.stringify({ requestId: "byok_repro_noroute_001", sessionId: "byok_repro_006" }),
        headers: { cookie, "content-type": "application/json" },
        method: "POST",
      }, env);
      assert.equal(response.status, 200, await response.clone().text());
      const body = await jsonBody(response);
      assert.equal(body.source, "pinar");
      assert.equal(body.creditsCharged, 1);
      assert.ok(isRecord(body.usage));
      assert.equal(body.usage.provider, "pinar_cloud");
      assert.equal(calls.length, 0, "the user's endpoint is not called");
      assert.equal(gateway.calls.length, 1);
      assert.deepEqual(ledgerRows(db).map((row) => [row.feature, row.status, row.credits]), [["reproduction", "succeeded", 1]]);
    } finally {
      db.close();
    }
  });
});
