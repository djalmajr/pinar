import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { runtimeEnv } from "./cloud-env";
import { edgerCloudEnv } from "./edger/env";

describe("runtimeEnv", () => {
  test("passes AI_EMBEDDING_MODEL with the other assistant AI strings", () => {
    const env = runtimeEnv({
      AI_API_KEY: "sk-ai-test",
      AI_BASE_URL: "https://ai.example.invalid/v1",
      AI_EMBEDDING_MODEL: "embeddinggemma-300m",
      AI_MODEL: "chat-model",
    });
    assert.equal(env.AI_EMBEDDING_MODEL, "embeddinggemma-300m");
    assert.equal(env.AI_MODEL, "chat-model");
    assert.equal(runtimeEnv({ AI_MODEL: "chat-model" }).AI_EMBEDDING_MODEL, undefined, "absent stays absent");
  });

  test("passes the assistant chain and the gateway strings", () => {
    const env = runtimeEnv({
      AI_GATEWAY_API_KEY: "gw-key",
      AI_GATEWAY_ZERO_DATA_RETENTION: "true",
      ASSISTANT_CHAIN: "gateway:anthropic/claude-haiku-5.5",
      ASSISTANT_ENABLED: "true",
    });
    assert.equal(env.AI_GATEWAY_API_KEY, "gw-key");
    assert.equal(env.AI_GATEWAY_ZERO_DATA_RETENTION, "true");
    assert.equal(env.ASSISTANT_CHAIN, "gateway:anthropic/claude-haiku-5.5");
    assert.equal(env.ASSISTANT_ENABLED, "true");
    const absent = runtimeEnv({});
    assert.deepEqual([absent.AI_GATEWAY_API_KEY, absent.AI_GATEWAY_ZERO_DATA_RETENTION, absent.ASSISTANT_CHAIN], [undefined, undefined, undefined]);
  });

  // runtimeEnv copies a fixed list of fields; one missing there is silently
  // dropped in production even when the EdgeR env reads it (v0.8.0 lost the
  // voice chains and the filing thresholds this way).
  test("keeps every field the EdgeR env produces", () => {
    const vars: Record<string, string> = {
      AI_API_KEY: "key",
      AI_BASE_URL: "https://ai.example.invalid/v1",
      AI_MODEL: "chat",
      AI_TRANSCRIPTION_MODEL: "stt",
      CLOUDFLARE_ACCOUNT_ID: "0".repeat(32),
      CLOUDFLARE_EMAIL_API_TOKEN: "token",
      DATABASE_AUTH_TOKEN: "token",
      DATABASE_URL: "http://db.example.invalid:8080",
      DEPLOYMENT_ENV: "production",
      S3_ACCESS_KEY_ID: "id",
      S3_BUCKET: "bucket",
      S3_ENDPOINT: "https://s3.example.invalid",
      S3_REGION: "auto",
      S3_SECRET_ACCESS_KEY: "secret",
    };
    // Every other name the EdgeR env reads gets its own name as the value.
    const read = (name: string) => vars[name] ?? (/^[A-Z][A-Z0-9_]*$/.test(name) ? name : undefined);
    const source = edgerCloudEnv(read) as Record<string, unknown>;
    const kept = runtimeEnv(source) as Record<string, unknown>;
    const dropped = Object.keys(source).filter((key) => source[key] !== undefined && kept[key] !== source[key]);
    assert.deepEqual(dropped, []);
    for (const key of ["AI_TEXT_CHAIN", "AI_TRANSCRIPTION_CHAIN", "FILING_SIMILARITY_MARGIN", "FILING_SIMILARITY_MIN"]) {
      assert.equal(kept[key], key, key);
    }
  });
});
