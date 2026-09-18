import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  AiInferenceError,
  openAiCompatibleProvider,
  type AiPrompt,
  type AiProviderConfig,
} from "./inference";

const prompt: AiPrompt = {
  jsonObject: true,
  messages: [
    { role: "system", content: "Return JSON." },
    { role: "user", content: "Hello" },
  ],
  temperature: 0.1,
};

const config: AiProviderConfig = {
  endpoint: "http://127.0.0.1:11434/v1",
  mode: "local",
  model: "qwen2.5-coder:7b",
};

describe("OpenAI-compatible inference provider", () => {
  test("runs chat completions and reports provider and model", async () => {
    let requested = "";
    const provider = openAiCompatibleProvider(config, {
      fetch: async (input, init) => {
        requested = String(input);
        assert.equal(new Headers(init?.headers).has("Authorization"), false);
        const body = JSON.parse(String(init?.body));
        assert.equal(body.model, config.model);
        assert.deepEqual(body.response_format, { type: "json_object" });
        return Response.json({
          choices: [{ message: { content: '{"ok":true}' } }],
          model: "qwen2.5-coder:7b-q4",
          usage: { completion_tokens: 3, prompt_tokens: 4 },
        });
      },
    });

    const result = await provider.run(prompt, { maxTokens: 128, timeoutMs: 1_000 });
    assert.equal(requested, "http://127.0.0.1:11434/v1/chat/completions");
    assert.equal(result.text, '{"ok":true}');
    assert.equal(result.provider, "local");
    assert.equal(result.model, "qwen2.5-coder:7b-q4");
    assert.deepEqual(result.usage, { inputTokens: 4, outputTokens: 3 });
  });

  test("uses a bearer key for BYOK without exposing it in errors", async () => {
    const provider = openAiCompatibleProvider({ ...config, apiKey: "sk-secret", mode: "byok" }, {
      fetch: async (_input, init) => {
        assert.equal(new Headers(init?.headers).get("Authorization"), "Bearer sk-secret");
        return Response.json({ error: { message: "key sk-secret rejected" } }, { status: 401 });
      },
    });
    await assert.rejects(
      provider.run(prompt, { maxTokens: 128, timeoutMs: 1_000 }),
      (error: unknown) => error instanceof AiInferenceError
        && error.code === "ai_auth_failed"
        && !error.message.includes("sk-secret"),
    );
  });

  test("classifies timeout and malformed replies", async () => {
    const timedOut = openAiCompatibleProvider(config, {
      fetch: async () => { throw new DOMException("timed out", "TimeoutError"); },
    });
    await assert.rejects(
      timedOut.run(prompt, { maxTokens: 128, timeoutMs: 1 }),
      (error: unknown) => error instanceof AiInferenceError && error.code === "ai_timeout",
    );

    const malformed = openAiCompatibleProvider(config, {
      fetch: async () => Response.json({ choices: [] }),
    });
    await assert.rejects(
      malformed.run(prompt, { maxTokens: 128, timeoutMs: 1_000 }),
      (error: unknown) => error instanceof AiInferenceError && error.code === "invalid_ai_response",
    );
  });

  test("tests endpoint model compatibility through the models API", async () => {
    const provider = openAiCompatibleProvider(config, {
      fetch: async (input) => {
        assert.equal(String(input), "http://127.0.0.1:11434/v1/models");
        return Response.json({ data: [{ id: "other" }, { id: config.model }] });
      },
    });
    assert.deepEqual(await provider.testConnection(), {
      model: config.model,
      ok: true,
      provider: "local",
    });
  });
});
