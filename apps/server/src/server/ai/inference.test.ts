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

// Mimics the real fetch redirect contract: with redirect: "error" the 3xx
// answer rejects instead of following; the default mode follows to the
// location, so a provider that omits redirect: "error" issues a second
// request and answers from the stolen endpoint.
function redirectingFetcher() {
  const calls: string[] = [];
  const fetcher: typeof fetch = async (input, init) => {
    const url = String(input);
    calls.push(url);
    if (url === "http://127.0.0.1:11434/stolen") {
      return Response.json({ choices: [{ message: { content: "leaked" } }], data: [{ id: config.model }], text: "leaked" });
    }
    if (init?.redirect === "error") throw new TypeError("fetch failed");
    return fetcher("http://127.0.0.1:11434/stolen", init);
  };
  return { calls, fetcher };
}

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

  test("rejects a redirect on chat completions instead of following it", async () => {
    const { calls, fetcher } = redirectingFetcher();
    const provider = openAiCompatibleProvider({ ...config, apiKey: "sk-secret", mode: "byok" }, { fetch: fetcher });
    await assert.rejects(
      provider.run(prompt, { maxTokens: 128, timeoutMs: 1_000 }),
      (error: unknown) => error instanceof AiInferenceError && error.code === "ai_endpoint_unavailable",
    );
    assert.deepEqual(calls, ["http://127.0.0.1:11434/v1/chat/completions"]);
  });

  test("rejects a redirect on the connection test instead of following it", async () => {
    const { calls, fetcher } = redirectingFetcher();
    const provider = openAiCompatibleProvider({ ...config, apiKey: "sk-secret", mode: "byok" }, { fetch: fetcher });
    await assert.rejects(
      provider.testConnection(),
      (error: unknown) => error instanceof AiInferenceError && error.code === "ai_endpoint_unavailable",
    );
    assert.deepEqual(calls, ["http://127.0.0.1:11434/v1/models"]);
  });
});

describe("OpenAI-compatible transcription", () => {
  const audio = () => new Blob([new TextEncoder().encode("áudio")], { type: "audio/webm" });

  test("rejects a redirect on the transcription endpoint instead of following it", async () => {
    const { calls, fetcher } = redirectingFetcher();
    const provider = openAiCompatibleProvider({ ...config, apiKey: "sk-secret", mode: "byok" }, { fetch: fetcher });
    await assert.rejects(
      provider.transcribe(audio(), { model: "parakeet-tdt-0.6b-v3" }),
      (error: unknown) => error instanceof AiInferenceError && error.code === "ai_endpoint_unavailable",
    );
    assert.deepEqual(calls, ["http://127.0.0.1:11434/v1/audio/transcriptions"]);
  });

  test("posts file, model and language as multipart without response_format", async () => {
    const calls: Array<{ body: FormData; headers: Headers; signal?: AbortSignal; url: string }> = [];
    const provider = openAiCompatibleProvider(config, {
      fetch: async (input, init) => {
        calls.push({
          body: init?.body as FormData,
          headers: new Headers(init?.headers),
          signal: init?.signal,
          url: String(input),
        });
        return Response.json({ duration: 3.2, language: "pt", text: "  olá mundo  " });
      },
    });

    const result = await provider.transcribe(audio(), {
      filename: "pin.webm",
      language: "pt",
      model: "parakeet-tdt-0.6b-v3",
    });

    assert.equal(calls.length, 1);
    const call = calls[0];
    assert.equal(call.url, "http://127.0.0.1:11434/v1/audio/transcriptions");
    assert.equal(call.headers.get("Authorization"), null);
    assert.ok(call.signal instanceof AbortSignal);
    assert.equal(call.signal.aborted, false);
    assert.equal(call.body.get("response_format"), null);
    assert.equal(call.body.get("model"), "parakeet-tdt-0.6b-v3");
    assert.equal(call.body.get("language"), "pt");
    const file = call.body.get("file");
    assert.ok(file instanceof File);
    assert.equal(file.name, "pin.webm");
    assert.equal(file.type, "audio/webm");
    assert.equal(await file.text(), "áudio");
    assert.equal(result.text, "olá mundo");
    assert.equal(result.duration, 3.2);
    assert.equal(result.language, "pt");
    assert.equal(result.truncated, undefined);
  });

  test("sends the bearer key when configured and omits the optional multipart fields", async () => {
    const provider = openAiCompatibleProvider({ ...config, apiKey: "sk-audio", mode: "byok" }, {
      fetch: async (_input, init) => {
        assert.equal(new Headers(init?.headers).get("Authorization"), "Bearer sk-audio");
        const form = init?.body as FormData;
        assert.equal(form.get("language"), null);
        const file = form.get("file");
        assert.ok(file instanceof File);
        assert.equal(file.name, undefined);
        return Response.json({ text: "ok" });
      },
    });
    const result = await provider.transcribe(audio(), { model: "parakeet-tdt-0.6b-v3" });
    assert.equal(result.text, "ok");
    assert.equal(result.duration, undefined);
    assert.equal(result.language, undefined);
    assert.equal(result.truncated, undefined);
  });

  test("reports a truncated transcription when the appliance sets X-ASR-Truncated", async () => {
    const provider = openAiCompatibleProvider(config, {
      fetch: async () => new Response(JSON.stringify({ text: "texto cortado" }), {
        headers: { "Content-Type": "application/json", "X-ASR-Truncated": "true" },
        status: 200,
      }),
    });
    const result = await provider.transcribe(audio(), { model: "parakeet-tdt-0.6b-v3" });
    assert.equal(result.text, "texto cortado");
    assert.equal(result.truncated, true);

    const notTruncated = openAiCompatibleProvider(config, {
      fetch: async () => new Response(JSON.stringify({ text: "texto inteiro" }), {
        headers: { "Content-Type": "application/json", "X-ASR-Truncated": "false" },
        status: 200,
      }),
    });
    const whole = await notTruncated.transcribe(audio(), { model: "parakeet-tdt-0.6b-v3" });
    assert.equal(whole.truncated, undefined);
  });

  test("classifies transcription failures with the inference error codes", async () => {
    const rejected = openAiCompatibleProvider(config, {
      fetch: async () => Response.json({ error: "bad key" }, { status: 401 }),
    });
    await assert.rejects(
      rejected.transcribe(audio(), { model: "parakeet-tdt-0.6b-v3" }),
      (error: unknown) => error instanceof AiInferenceError && error.code === "ai_auth_failed",
    );

    const forbidden = openAiCompatibleProvider(config, {
      fetch: async () => Response.json({ error: "forbidden" }, { status: 403 }),
    });
    await assert.rejects(
      forbidden.transcribe(audio(), { model: "parakeet-tdt-0.6b-v3" }),
      (error: unknown) => error instanceof AiInferenceError && error.code === "ai_auth_failed",
    );

    const missing = openAiCompatibleProvider(config, {
      fetch: async () => Response.json({ error: "no route" }, { status: 404 }),
    });
    await assert.rejects(
      missing.transcribe(audio(), { model: "parakeet-tdt-0.6b-v3" }),
      (error: unknown) => error instanceof AiInferenceError && error.code === "ai_model_unavailable",
    );

    const timedOut = openAiCompatibleProvider(config, {
      fetch: async () => { throw new DOMException("timed out", "TimeoutError"); },
    });
    await assert.rejects(
      timedOut.transcribe(audio(), { model: "parakeet-tdt-0.6b-v3" }),
      (error: unknown) => error instanceof AiInferenceError && error.code === "ai_timeout",
    );

    const aborted = openAiCompatibleProvider(config, {
      fetch: async () => { throw new DOMException("aborted", "AbortError"); },
    });
    await assert.rejects(
      aborted.transcribe(audio(), { model: "parakeet-tdt-0.6b-v3" }),
      (error: unknown) => error instanceof AiInferenceError && error.code === "ai_timeout",
    );

    const unreachable = openAiCompatibleProvider(config, {
      fetch: async () => { throw new TypeError("fetch failed"); },
    });
    await assert.rejects(
      unreachable.transcribe(audio(), { model: "parakeet-tdt-0.6b-v3" }),
      (error: unknown) => error instanceof AiInferenceError && error.code === "ai_endpoint_unavailable",
    );

    const noText = openAiCompatibleProvider(config, {
      fetch: async () => Response.json({ duration: 1, language: "en" }),
    });
    await assert.rejects(
      noText.transcribe(audio(), { model: "parakeet-tdt-0.6b-v3" }),
      (error: unknown) => error instanceof AiInferenceError && error.code === "invalid_ai_response",
    );

    const notJson = openAiCompatibleProvider(config, {
      fetch: async () => new Response("<html>oops</html>", { status: 200 }),
    });
    await assert.rejects(
      notJson.transcribe(audio(), { model: "parakeet-tdt-0.6b-v3" }),
      (error: unknown) => error instanceof AiInferenceError && error.code === "invalid_ai_response",
    );
  });
});
