import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { runtimeEnv } from "./cloud-env";

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
});
