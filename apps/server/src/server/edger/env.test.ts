import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, test } from "node:test";
import { edgerCloudEnv } from "./env";

type Vars = Record<string, string>;

const readVars = (vars: Vars) => (name: string) => vars[name];

// The string fields of CloudEnv that must be read from variables of the same
// name (every CloudEnv string field: DB, AI, EMAIL and PINAR_BUCKET are
// built by the adapters instead).
const STRING_FIELDS = [
  "ADMIN_API_KEY",
  "AI_GATEWAY_API_KEY",
  "AI_GATEWAY_ZERO_DATA_RETENTION",
  "AI_TEXT_CHAIN",
  "AI_TRANSCRIPTION_CHAIN",
  "ASSISTANT_CHAIN",
  "ASSISTANT_ENABLED",
  "AUTH_PEPPER",
  "BYOK_MASTER_KEY",
  "CLOUD_TRIAL_ENABLED",
  "COMPLIMENTARY_PRO_USER_IDS",
  "EXTENSION_ORIGIN",
  "PRICING_AI_CREDITS_500_BRL_CENTS",
  "PRICING_AI_CREDITS_500_USD_CENTS",
  "PRICING_STORAGE_1GB_12M_BRL_CENTS",
  "PRICING_STORAGE_1GB_12M_USD_CENTS",
  "PRICING_STORAGE_5GB_12M_BRL_CENTS",
  "PRICING_STORAGE_5GB_12M_USD_CENTS",
  "PRICING_YEARLY_BRL_CENTS",
  "PRICING_YEARLY_USD_CENTS",
  "STRIPE_PRICE_AI_CREDITS_500",
  "STRIPE_PRICE_BR_AI_CREDITS_500",
  "STRIPE_PRICE_BR_STORAGE_1GB_12M",
  "STRIPE_PRICE_BR_STORAGE_5GB_12M",
  "STRIPE_PRICE_BR_YEARLY",
  "STRIPE_PRICE_STORAGE_1GB_12M",
  "STRIPE_PRICE_STORAGE_5GB_12M",
  "STRIPE_PRICE_YEARLY",
  "STRIPE_SECRET_KEY",
  "STRIPE_WEBHOOK_SECRET",
] as const;

describe("edgerCloudEnv", () => {
  test("everything absent leaves the adapters and the strings undefined", () => {
    const env = edgerCloudEnv(readVars({}));
    assert.equal(env.DB, undefined);
    assert.equal(env.PINAR_BUCKET, undefined);
    assert.equal(env.EMAIL, undefined);
    assert.equal(env.AI, undefined);
    assert.equal(env.DEPLOYMENT_ENV, undefined);
    for (const field of STRING_FIELDS) {
      assert.equal(env[field], undefined, field);
    }
  });

  test("passes the string fields through with the same names", () => {
    const vars: Vars = {};
    for (const field of STRING_FIELDS) vars[field] = field;
    vars.DEPLOYMENT_ENV = "staging";
    const env = edgerCloudEnv(readVars(vars));
    for (const field of STRING_FIELDS) {
      assert.equal(env[field], field, field);
    }
    assert.equal(env.DEPLOYMENT_ENV, "staging");
    assert.equal(env.DB, undefined);
  });

  test("treats empty or blank values as absent", () => {
    const env = edgerCloudEnv(readVars({ ADMIN_API_KEY: "   ", DEPLOYMENT_ENV: "", DATABASE_URL: "  " }));
    assert.equal(env.ADMIN_API_KEY, undefined);
    assert.equal(env.DEPLOYMENT_ENV, undefined);
    assert.equal(env.DB, undefined);
  });

  test("rejects a malformed DATABASE_URL without echoing it", () => {
    const vars: Vars = {
      DATABASE_AUTH_TOKEN: "TOKEN_SENTINEL",
      DATABASE_URL: "//user:TEST_SECRET_SENTINEL@127.0.0.1:1/db",
    };
    assert.throws(
      () => edgerCloudEnv(readVars(vars)),
      (error: unknown) =>
        error instanceof Error
        && error.message === "invalid DATABASE_URL"
        && error.cause === undefined
        && !String(error.stack).includes("SENTINEL"),
    );
  });

  test("rejects a DEPLOYMENT_ENV outside local/staging/production with the exact error", () => {
    for (const value of ["Production", "dev", "staging ", "prod"]) {
      assert.throws(
        () => edgerCloudEnv((name) => (name === "DEPLOYMENT_ENV" ? value : undefined)),
        (error: unknown) => error instanceof Error && error.message === "invalid DEPLOYMENT_ENV",
      );
    }
  });

  test("builds each adapter when its group is complete", async () => {
    const dir = mkdtempSync(join(tmpdir(), `pinar-env-${process.pid}-`));
    try {
      const file = join(dir, `env-${randomBytes(4).toString("hex")}.db`);
      const withDb = edgerCloudEnv(readVars({ DATABASE_URL: `file:${file}`, DATABASE_AUTH_TOKEN: "" }));
      assert.ok(withDb.DB, "DB must be defined with DATABASE_URL");
      assert.equal(typeof withDb.DB.batch, "function");
      assert.deepEqual(await withDb.DB.prepare("select 1 as x").first(), { x: 1 });

      const withBucket = edgerCloudEnv(
        readVars({
          S3_ENDPOINT: "https://s3.example.invalid",
          S3_BUCKET: "pinar-bucket",
          S3_ACCESS_KEY_ID: "TOP_SECRET_KEY_ID",
          S3_SECRET_ACCESS_KEY: "TOP_SECRET_SECRET",
          S3_REGION: "sa-east-1",
        }),
      );
      assert.ok(withBucket.PINAR_BUCKET, "PINAR_BUCKET must be defined with the full S3 group");
      assert.equal(typeof withBucket.PINAR_BUCKET.get, "function");
      assert.equal(typeof withBucket.PINAR_BUCKET.put, "function");
      assert.equal(typeof withBucket.PINAR_BUCKET.delete, "function");

      const withEmail = edgerCloudEnv(
        readVars({ CLOUDFLARE_ACCOUNT_ID: "1427e570ac9806fcc2626c20e0d38b3d", CLOUDFLARE_EMAIL_API_TOKEN: "TOP_SECRET_TOKEN" }),
      );
      assert.ok(withEmail.EMAIL, "EMAIL must be defined with the full email group");
      assert.equal(typeof withEmail.EMAIL.send, "function");

      const withAi = edgerCloudEnv(
        readVars({
          AI_BASE_URL: "https://ai.example.invalid/v1",
          AI_API_KEY: "TOP_SECRET_AI_KEY",
          AI_MODEL: "chat-model",
          AI_TRANSCRIPTION_MODEL: "transcription-model",
        }),
      );
      assert.ok(withAi.AI, "AI must be defined with the full AI group");
      assert.equal(typeof withAi.AI.run, "function");
      assert.equal(withAi.AI_BASE_URL, "https://ai.example.invalid/v1", "the assistant reads the raw strings too");
      assert.equal(withAi.AI_MODEL, "chat-model");
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  test("refuses a partial group with the exact message, never echoing a value", () => {
    const cases: Array<[Vars, string]> = [
      [
        { S3_ENDPOINT: "TOP_SECRET_ENDPOINT" },
        "incomplete S3 configuration: missing S3_ACCESS_KEY_ID, S3_BUCKET, S3_SECRET_ACCESS_KEY",
      ],
      [
        { S3_BUCKET: "TOP_SECRET_BUCKET", S3_REGION: "us-east-1" },
        "incomplete S3 configuration: missing S3_ACCESS_KEY_ID, S3_ENDPOINT, S3_SECRET_ACCESS_KEY",
      ],
      [{ CLOUDFLARE_EMAIL_API_TOKEN: "TOP_SECRET_TOKEN" }, "incomplete email configuration: missing CLOUDFLARE_ACCOUNT_ID"],
      [
        { CLOUDFLARE_ACCOUNT_ID: "1427e570ac9806fcc2626c20e0d38b3d" },
        "incomplete email configuration: missing CLOUDFLARE_EMAIL_API_TOKEN",
      ],
      [
        { AI_BASE_URL: "https://ai.example.invalid/v1", AI_MODEL: "chat-model" },
        "incomplete AI configuration: missing AI_API_KEY, AI_TRANSCRIPTION_MODEL",
      ],
      [
        { AI_MODEL: "chat-model" },
        "incomplete AI configuration: missing AI_API_KEY, AI_BASE_URL, AI_TRANSCRIPTION_MODEL",
      ],
      [
        { AI_TRANSCRIPTION_MODEL: "transcription-model" },
        "incomplete AI configuration: missing AI_API_KEY, AI_BASE_URL, AI_MODEL",
      ],
      // The URL and the key are a pair: without the models, one of them
      // present requires the other (blank counts as absent), so a broken
      // pair cannot boot silently with hasAssistant: false (A46).
      [
        { AI_BASE_URL: "https://ai.example.invalid/v1" },
        "incomplete AI configuration: missing AI_API_KEY",
      ],
      [{ AI_API_KEY: "TOP_SECRET_AI_KEY" }, "incomplete AI configuration: missing AI_BASE_URL"],
      [
        { AI_BASE_URL: "https://ai.example.invalid/v1", AI_API_KEY: " " },
        "incomplete AI configuration: missing AI_API_KEY",
      ],
      [
        { AI_API_KEY: "TOP_SECRET_AI_KEY", AI_BASE_URL: "" },
        "incomplete AI configuration: missing AI_BASE_URL",
      ],
    ];
    for (const [vars, message] of cases) {
      assert.throws(
        () => edgerCloudEnv(readVars(vars)),
        (error: unknown) =>
          error instanceof Error && error.message === message && !error.message.includes("TOP_SECRET"),
      );
    }
  });

  test("the assistant's appliance strings stand alone without the transcription group (A46)", () => {
    // An explicit appliance chain needs AI_BASE_URL and AI_API_KEY only;
    // AI_MODEL and AI_TRANSCRIPTION_MODEL belong to the metered AI binding.
    const env = edgerCloudEnv(
      readVars({ AI_BASE_URL: "https://ai.example.invalid/v1", AI_API_KEY: "TOP_SECRET_AI_KEY", AI_EMBEDDING_MODEL: "embed-model" }),
    );
    assert.equal(env.AI, undefined, "no metered AI binding without its group");
    assert.equal(env.AI_BASE_URL, "https://ai.example.invalid/v1");
    assert.equal(env.AI_API_KEY, "TOP_SECRET_AI_KEY");
    assert.equal(env.AI_MODEL, undefined);
    assert.equal(env.AI_EMBEDDING_MODEL, "embed-model");
  });

  test("leaves the binding undefined when a group is absent entirely", () => {
    // A lone optional member does not count as the group being present.
    const env = edgerCloudEnv(readVars({ S3_REGION: "us-east-1", DATABASE_AUTH_TOKEN: "TOP_SECRET_TOKEN" }));
    assert.equal(env.PINAR_BUCKET, undefined);
    assert.equal(env.DB, undefined);
    assert.equal(env.EMAIL, undefined);
    assert.equal(env.AI, undefined);
  });

  test("rejects a CLOUDFLARE_ACCOUNT_ID that is not 32 lowercase hex chars", () => {
    for (const id of ["1427e570/../x", "1427e570AC9806FCC2626C20E0D38B3D", "1427e570ac9806fcc2626c20e0d38b3"]) {
      assert.throws(
        () => edgerCloudEnv((name) => (name === "CLOUDFLARE_ACCOUNT_ID" ? id : undefined)),
        (error: unknown) => error instanceof Error && error.message === "invalid CLOUDFLARE_ACCOUNT_ID",
      );
    }
  });
});

describe("edgerCloudEnv — the BYOK egress guard (F5/S6a, EDG-38 §2)", () => {
  const GUARD_VARS: Vars = {
    EDGER_EGRESS_HOST: "edger-egress.invalid",
    EDGER_EGRESS_SOCKET: "/tmp/pinar-egress.sock",
  };
  type EgressOptions = { proxy: { path: string; transport: "unix" } };
  const factory = (calls: EgressOptions[], client: object) => (options: EgressOptions) => {
    calls.push(options);
    return client;
  };

  test("with the socket, the host and a factory: the client is created once and the field exists", () => {
    const calls: EgressOptions[] = [];
    const client = { fake: "client" };
    const env = edgerCloudEnv(readVars(GUARD_VARS), factory(calls, client));
    assert.ok(env.BYOK_EGRESS, "the field exists");
    assert.equal(env.BYOK_EGRESS!.host, "edger-egress.invalid");
    assert.equal(typeof env.BYOK_EGRESS!.fetch, "function");
    assert.equal(calls.length, 1, "the client is created once");
    assert.deepEqual(calls[0], { proxy: { path: "/tmp/pinar-egress.sock", transport: "unix" } });
  });

  test("the field's fetch is bound to the client and forwards the init", async () => {
    const client = { fake: "client" };
    const env = edgerCloudEnv(readVars(GUARD_VARS), () => client);
    const guard = env.BYOK_EGRESS;
    assert.ok(guard, "the field exists");
    const seen: Array<{ input: unknown; init: unknown }> = [];
    const realFetch = globalThis.fetch;
    globalThis.fetch = ((input: unknown, init?: unknown) => {
      seen.push({ input, init });
      return Promise.resolve(new Response("ok"));
    }) as typeof fetch;
    try {
      const response = await guard.fetch("http://edger-egress.invalid/", {
        headers: { Authorization: "Bearer sk-byok-test-secret" },
        method: "POST",
      });
      assert.equal(await response.text(), "ok");
    } finally {
      globalThis.fetch = realFetch;
    }
    assert.equal(seen.length, 1);
    assert.equal(seen[0]!.input, "http://edger-egress.invalid/");
    const init = seen[0]!.init as { client?: unknown; headers?: HeadersInit; method?: string };
    assert.equal(init.client, client, "the client is passed in the init");
    assert.equal(init.method, "POST");
    assert.equal(new Headers(init.headers).get("authorization"), "Bearer sk-byok-test-secret");
  });

  test("any missing piece keeps the field absent and the factory uncalled", () => {
    const cases: Vars[] = [
      { EDGER_EGRESS_HOST: "edger-egress.invalid" },
      { EDGER_EGRESS_SOCKET: "/tmp/pinar-egress.sock" },
      { EDGER_EGRESS_HOST: "https://edger-egress.invalid", EDGER_EGRESS_SOCKET: "/tmp/pinar-egress.sock" },
      { EDGER_EGRESS_HOST: "edger-egress.invalid:8443", EDGER_EGRESS_SOCKET: "/tmp/pinar-egress.sock" },
      { EDGER_EGRESS_HOST: "edger-egress.invalid/v1", EDGER_EGRESS_SOCKET: "/tmp/pinar-egress.sock" },
      { EDGER_EGRESS_HOST: "edger-egress.invalid?x=1", EDGER_EGRESS_SOCKET: "/tmp/pinar-egress.sock" },
      { EDGER_EGRESS_HOST: " ", EDGER_EGRESS_SOCKET: "/tmp/pinar-egress.sock" },
    ];
    for (const vars of cases) {
      const calls: EgressOptions[] = [];
      const env = edgerCloudEnv(readVars(vars), factory(calls, { fake: "client" }));
      assert.equal(env.BYOK_EGRESS, undefined, JSON.stringify(vars));
      assert.equal(calls.length, 0, JSON.stringify(vars));
    }
    // Without any factory (and no Deno global in Bun): the pair alone
    // cannot build the field.
    const env = edgerCloudEnv(readVars(GUARD_VARS));
    assert.equal(env.BYOK_EGRESS, undefined);
  });

  test("without an injected factory the EdgeR's Deno global provides it", () => {
    const calls: EgressOptions[] = [];
    const previous = (globalThis as { Deno?: unknown }).Deno;
    (globalThis as { Deno?: unknown }).Deno = { createHttpClient: factory(calls, { fake: "client" }) };
    try {
      const env = edgerCloudEnv(readVars(GUARD_VARS));
      assert.ok(env.BYOK_EGRESS, "the field exists");
      assert.equal(calls.length, 1, "the client is created once, from the Deno global");
      assert.deepEqual(calls[0], { proxy: { path: "/tmp/pinar-egress.sock", transport: "unix" } });
    } finally {
      if (previous === undefined) delete (globalThis as { Deno?: unknown }).Deno;
      else (globalThis as { Deno?: unknown }).Deno = previous;
    }
  });

  test("the guard does not change the other env fields", () => {
    const env = edgerCloudEnv(
      readVars({
        ...GUARD_VARS,
        ADMIN_API_KEY: "admin-key",
        BYOK_MASTER_KEY: "bmFtZS1ub3QtYS1rZXk=",
        DEPLOYMENT_ENV: "staging",
        STRIPE_SECRET_KEY: "sk-test",
      }),
      () => ({ fake: "client" }),
    );
    assert.ok(env.BYOK_EGRESS, "the field exists");
    assert.equal(env.ADMIN_API_KEY, "admin-key");
    assert.equal(env.BYOK_MASTER_KEY, "bmFtZS1ub3QtYS1rZXk=");
    assert.equal(env.DEPLOYMENT_ENV, "staging");
    assert.equal(env.STRIPE_SECRET_KEY, "sk-test");
    assert.equal(env.DB, undefined);
    assert.equal(env.AI, undefined);
    assert.equal(env.PINAR_BUCKET, undefined);
    assert.equal(env.EMAIL, undefined);
  });

  test("a client the runtime cannot build keeps the field absent, without an error", () => {
    const env = edgerCloudEnv(readVars(GUARD_VARS), () => {
      throw new Error("socket path /tmp/pinar-egress.sock refused");
    });
    assert.equal(env.BYOK_EGRESS, undefined, "the refusal stands");
  });
});
