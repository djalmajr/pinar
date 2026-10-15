import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { cloudflareAiProvider } from "../ai/inference";
import { createOpenAiCompatibleAi } from "./openai-compatible-ai";

const BASE_URL = "https://lbvllm.example/v1/"; // trailing slash: the adapter must strip it
const API_KEY = "sk-test-key-123";
const CHAT_MODEL = "qwen3.8-27b";
const TRANSCRIPTION_MODEL = "parakeet-tdt-0.6b-v3";

const THINK_BLOCK_CONTENT = "  <think>inner reasoning</think> the final answer  ";

interface MultipartCall {
  file: { bytes: number[]; name: string; type: string } | null;
  fields: Record<string, string>;
}

interface RecordedCall {
  authorization: string | null;
  bodyText: string | undefined;
  form: MultipartCall | null;
  method: string;
  redirect: RequestRedirect;
  signal: AbortSignal | null;
  url: string;
}

// Fake fetch that records the request (JSON body or multipart form) instead of hitting the network.
function createAiFakeFetch(respond: (index: number) => Response) {
  const calls: RecordedCall[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const headers = new Headers(init?.headers);
    let form: MultipartCall | null = null;
    if (init?.body instanceof FormData) {
      form = { file: null, fields: {} };
      for (const [key, value] of init.body.entries()) {
        if (key === "file" && value instanceof File) {
          form.file = {
            bytes: [...new Uint8Array(await new Response(value).arrayBuffer())],
            name: value.name,
            type: value.type,
          };
        } else if (typeof value === "string") {
          form.fields[key] = value;
        }
      }
    }
    calls.push({
      authorization: headers.get("authorization"),
      bodyText: typeof init?.body === "string" ? init.body : undefined,
      form,
      method: init?.method ?? "GET",
      redirect: init?.redirect ?? "follow",
      signal: init?.signal ?? null,
      url: String(input),
    });
    return respond(calls.length - 1);
  };
  return { calls, fetch: fetchImpl };
}

async function captureError(promise: Promise<unknown>): Promise<Error> {
  try {
    await promise;
  } catch (error) {
    assert.ok(error instanceof Error);
    return error;
  }
  throw new Error("expected the call to reject");
}

function makeAi(respond: (index: number) => Response) {
  const fake = createAiFakeFetch(respond);
  const ai = createOpenAiCompatibleAi({
    apiKey: API_KEY,
    baseUrl: BASE_URL,
    chatModel: CHAT_MODEL,
    fetch: fake.fetch,
    transcriptionModel: TRANSCRIPTION_MODEL,
  });
  return { ai, fake };
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { headers: { "content-type": "application/json" }, status });
}

// A 200 JSON response whose body stream errors: the shape the deadline
// produces when the headers already arrived and the clock runs out while
// json() reads the body.
function failingJsonBody(error: DOMException): Response {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.error(error);
    },
  });
  return new Response(stream, { headers: { "content-type": "application/json" }, status: 200 });
}

function audioStream(bytes: number) {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const data = new Uint8Array(bytes).fill(7);
      controller.enqueue(data);
      controller.close();
    },
  });
  return { body: stream, contentType: "audio/webm;codecs=opus" };
}

describe("createOpenAiCompatibleAi", () => {
  test("transcription posts the multipart to /audio/transcriptions and maps the response", async () => {
    const { ai, fake } = makeAi(() => jsonResponse({ duration: 2.5, language: "pt", text: "olá mundo" }));
    const signal = new AbortController().signal;
    const result = await ai.run("@cf/openai/whisper-large-v3-turbo", {
      audio: audioStream(16),
      language: "pt",
      task: "transcribe",
      vad_filter: true,
    }, { signal });
    assert.equal(fake.calls.length, 1);
    const call = fake.calls[0];
    assert.equal(call.url, "https://lbvllm.example/v1/audio/transcriptions");
    assert.equal(call.method, "POST");
    assert.equal(call.authorization, `Bearer ${API_KEY}`);
    assert.equal(call.signal, signal);
    assert.ok(call.form);
    assert.equal(call.form.file?.name, "audio.webm");
    assert.equal(call.form.file?.type, "audio/webm;codecs=opus");
    assert.ok(call.form.file?.bytes.length === 16);
    assert.ok(call.form.file?.bytes.every((byte) => byte === 7));
    assert.equal(call.form.fields.model, TRANSCRIPTION_MODEL);
    assert.equal(call.form.fields.language, "pt");
    // The Workers AI extra options are not part of the OpenAI-compatible form.
    assert.ok(!("task" in call.form.fields));
    assert.ok(!("vad_filter" in call.form.fields));
    assert.deepEqual(result, {
      text: "olá mundo",
      transcription_info: { duration: 2.5, language: "pt" },
    });
  });

  test("transcription omits an empty language and leaves transcription_info fields out when absent", async () => {
    const { ai, fake } = makeAi(() => jsonResponse({ text: "hello" }));
    const result = await ai.run("@cf/openai/whisper-large-v3-turbo", {
      audio: audioStream(8),
      language: "",
    });
    const call = fake.calls[0];
    assert.ok(call.form);
    assert.ok(!("language" in call.form.fields));
    assert.equal(call.form.fields.model, TRANSCRIPTION_MODEL);
    assert.deepEqual(result, {
      text: "hello",
      transcription_info: {},
    });
  });

  test("transcription maps content types to the file extension", async () => {
    for (const [contentType, expectedName] of [
      ["audio/webm", "audio.webm"],
      ["audio/ogg", "audio.ogg"],
      ["audio/mp4", "audio.m4a"],
      ["audio/x-m4a", "audio.m4a"],
      ["audio/wav", "audio.wav"],
      ["audio/x-wav", "audio.wav"],
      ["audio/mpeg", "audio.mp3"],
      ["video/unknown", "audio.bin"],
    ] as const) {
      const { ai, fake } = makeAi(() => jsonResponse({ text: "x" }));
      await ai.run("@cf/openai/whisper-large-v3-turbo", {
        audio: { body: audioStream(4).body, contentType },
      });
      assert.equal(fake.calls[0].form?.file?.name, expectedName, contentType);
    }
  });

  test("chat with the Responses input maps system+user messages, max_tokens and the configured model", async () => {
    const { ai, fake } = makeAi(() => jsonResponse({
      choices: [{ message: { content: "answer" } }],
      usage: { completion_tokens: 3, prompt_tokens: 9 },
    }));
    const result = await ai.run("@cf/openai/gpt-oss-20b", {
      input: "Do the thing",
      instructions: "You are Pinar.",
      max_output_tokens: 512,
      reasoning: { effort: "low" },
    });
    const call = fake.calls[0];
    assert.equal(call.url, "https://lbvllm.example/v1/chat/completions");
    assert.equal(call.method, "POST");
    assert.equal(call.authorization, `Bearer ${API_KEY}`);
    const body = JSON.parse(call.bodyText ?? "");
    assert.equal(body.model, CHAT_MODEL); // the @cf/... name is ignored
    assert.equal(body.stream, false);
    assert.equal(body.max_tokens, 512);
    assert.deepEqual(body.messages, [
      { content: "You are Pinar.", role: "system" },
      { content: "Do the thing", role: "user" },
    ]);
    assert.ok(!("reasoning" in body));
    assert.ok(!("temperature" in body));
    assert.ok(!("response_format" in body));
    assert.deepEqual(result, {
      choices: [{ message: { content: "answer" } }],
      response: "answer",
      usage: { completion_tokens: 3, prompt_tokens: 9 },
    });
  });

  test("chat without instructions sends only the user message", async () => {
    const { ai, fake } = makeAi(() => jsonResponse({ choices: [{ message: { content: "ok" } }] }));
    await ai.run("@cf/openai/gpt-oss-20b", {
      input: "Just the user",
      instructions: "",
      max_output_tokens: 16,
    });
    const body = JSON.parse(fake.calls[0].bodyText ?? "");
    assert.deepEqual(body.messages, [{ content: "Just the user", role: "user" }]);
  });

  test("chat with the chat input forwards messages, max_tokens, response_format and temperature", async () => {
    const { ai, fake } = makeAi(() => jsonResponse({
      choices: [{ message: { content: '{"ok":true}' } }],
      usage: { completion_tokens: 2, prompt_tokens: 4 },
    }));
    const input = {
      max_tokens: 64,
      messages: [{ content: "Return JSON", role: "user" }],
      response_format: { type: "json_object" },
      temperature: 0.2,
    };
    const result = await ai.run("@cf/openai/gpt-oss-20b", input);
    const body = JSON.parse(fake.calls[0].bodyText ?? "");
    assert.equal(body.model, CHAT_MODEL);
    assert.equal(body.stream, false);
    assert.deepEqual(body.messages, input.messages);
    assert.equal(body.max_tokens, 64);
    assert.deepEqual(body.response_format, { type: "json_object" });
    assert.equal(body.temperature, 0.2);
    assert.deepEqual(result, {
      choices: [{ message: { content: '{"ok":true}' } }],
      response: '{"ok":true}',
      usage: { completion_tokens: 2, prompt_tokens: 4 },
    });
  });

  test("chat strips a leading think block and trims the text, keeping the raw content", async () => {
    const { ai } = makeAi(() => jsonResponse({
      choices: [{ message: { content: THINK_BLOCK_CONTENT } }],
      usage: { completion_tokens: 5, prompt_tokens: 1 },
    }));
    const result = await ai.run(CHAT_MODEL, {
      max_tokens: 8,
      messages: [{ content: "hi", role: "user" }],
    });
    const record = result as { choices: { message: { content: string } }[]; response: string };
    assert.equal(record.response, "the final answer");
    assert.equal(record.choices[0].message.content, THINK_BLOCK_CONTENT);
  });

  test("chat without a think block only trims", async () => {
    const { ai } = makeAi(() => jsonResponse({ choices: [{ message: { content: "  plain text  " } }] }));
    const result = await ai.run(CHAT_MODEL, {
      max_tokens: 8,
      messages: [{ content: "hi", role: "user" }],
    });
    assert.equal((result as { response: string }).response, "plain text");
  });

  test("chat keeps text that only starts with the word think", async () => {
    const content = "thinking about it, the answer is </think> literal";
    const { ai } = makeAi(() => jsonResponse({ choices: [{ message: { content } }] }));
    const result = await ai.run(CHAT_MODEL, {
      max_tokens: 8,
      messages: [{ content: "hi", role: "user" }],
    });
    assert.equal((result as { response: string }).response, content);
  });

  test("a non-2xx response rejects with the exact status message and no secret material", async () => {
    const leaky = () => jsonResponse({ error: { message: `key ${API_KEY} and the prompt leaked` } }, 500);
    const chat = makeAi(leaky);
    const chatError = await captureError(chat.ai.run(CHAT_MODEL, {
      max_tokens: 8,
      messages: [{ content: "hi", role: "user" }],
    }));
    assert.equal(chatError.message, "ai request failed: 500");
    assert.ok(!chatError.message.includes(API_KEY));

    const transcription = makeAi(leaky);
    const transcriptionError = await captureError(transcription.ai.run("@cf/openai/whisper-large-v3-turbo", {
      audio: audioStream(4),
    }));
    assert.equal(transcriptionError.message, "ai request failed: 500");
  });

  test("a fetch TimeoutError passes through unwrapped", async () => {
    const timeout = new DOMException("The operation was aborted due to timeout", "TimeoutError");
    const fetchImpl: typeof fetch = async () => {
      throw timeout;
    };
    const ai = createOpenAiCompatibleAi({
      apiKey: API_KEY,
      baseUrl: BASE_URL,
      chatModel: CHAT_MODEL,
      fetch: fetchImpl,
      transcriptionModel: TRANSCRIPTION_MODEL,
    });
    const rejected = await captureError(ai.run(CHAT_MODEL, {
      max_tokens: 8,
      messages: [{ content: "hi", role: "user" }],
    }));
    assert.equal(rejected, timeout); // the very same DOMException, not a wrapper
  });

  test("chat rethrows the very same DOMException when the body stream fails with AbortError or TimeoutError", async () => {
    for (const name of ["AbortError", "TimeoutError"]) {
      const error = new DOMException("the deadline expired while reading the body", name);
      const { ai } = makeAi(() => failingJsonBody(error));
      const rejected = await captureError(ai.run(CHAT_MODEL, {
        max_tokens: 8,
        messages: [{ content: "hi", role: "user" }],
      }));
      assert.equal(rejected, error); // the very same DOMException, not {} nor a wrapper
    }
  });

  test("transcription rethrows the very same DOMException when the body stream fails with AbortError or TimeoutError", async () => {
    for (const name of ["AbortError", "TimeoutError"]) {
      const error = new DOMException("the deadline expired while reading the body", name);
      const { ai } = makeAi(() => failingJsonBody(error));
      const rejected = await captureError(ai.run("@cf/openai/whisper-large-v3-turbo", {
        audio: audioStream(4),
      }));
      assert.equal(rejected, error); // the very same DOMException, not {} nor a wrapper
    }
  });

  test("transcription asks for verbose_json first and maps duration and language from a 200", async () => {
    const { ai, fake } = makeAi(() => jsonResponse({ duration: 12.5, language: "pt", text: "doze e meio" }));
    const result = await ai.run("@cf/openai/whisper-large-v3-turbo", {
      audio: audioStream(8),
    });
    assert.equal(fake.calls.length, 1);
    assert.equal(fake.calls[0].form?.fields.response_format, "verbose_json");
    assert.deepEqual(result, { text: "doze e meio", transcription_info: { duration: 12.5, language: "pt" } });
  });

  test("a 400 or 422 retries once without response_format, with the same audio bytes, and uses the retry", async () => {
    for (const status of [400, 422]) {
      const { ai, fake } = makeAi((index) =>
        index === 0
          ? jsonResponse({ error: "response_format not accepted" }, status)
          : jsonResponse({ duration: 12.5, language: "pt", text: `retry ${status}` }),
      );
      const result = await ai.run("@cf/openai/whisper-large-v3-turbo", {
        audio: audioStream(16),
        language: "pt",
      });
      assert.equal(fake.calls.length, 2, `status ${status}`);
      assert.equal(fake.calls[0].form?.fields.response_format, "verbose_json", `status ${status}`);
      assert.ok(!("response_format" in (fake.calls[1].form?.fields ?? {})), `retry must drop response_format for ${status}`);
      assert.deepEqual(fake.calls[1].form?.file?.bytes, fake.calls[0].form?.file?.bytes, `same audio bytes for ${status}`);
      assert.equal(fake.calls[1].form?.file?.name, fake.calls[0].form?.file?.name, `status ${status}`);
      assert.equal(fake.calls[1].form?.fields.model, TRANSCRIPTION_MODEL, `status ${status}`);
      assert.equal(fake.calls[1].form?.fields.language, "pt", `status ${status}`);
      assert.deepEqual(result, { text: `retry ${status}`, transcription_info: { duration: 12.5, language: "pt" } }, `status ${status}`);
    }
  });

  test("a 500 on the first transcription request never retries and keeps the exact message", async () => {
    const { ai, fake } = makeAi(() => jsonResponse({ error: `key ${API_KEY} and the audio leaked` }, 500));
    const error = await captureError(ai.run("@cf/openai/whisper-large-v3-turbo", {
      audio: audioStream(4),
    }));
    assert.equal(error.message, "ai request failed: 500");
    assert.ok(!error.message.includes(API_KEY));
    assert.equal(fake.calls.length, 1);
  });

  test("a TimeoutError rejecting the first transcription request never starts the second", async () => {
    const timeout = new DOMException("the deadline expired", "TimeoutError");
    const { ai, fake } = makeAi(() => {
      throw timeout;
    });
    const rejected = await captureError(ai.run("@cf/openai/whisper-large-v3-turbo", {
      audio: audioStream(4),
    }));
    assert.equal(rejected, timeout); // the very same DOMException, not a wrapper
    assert.equal(fake.calls.length, 1);
  });

  test("a non-2xx on the retry rejects with that status after exactly two requests", async () => {
    const { ai, fake } = makeAi((index) => jsonResponse({ error: "still broken" }, index === 0 ? 422 : 502));
    const error = await captureError(ai.run("@cf/openai/whisper-large-v3-turbo", {
      audio: audioStream(4),
    }));
    assert.equal(error.message, "ai request failed: 502");
    assert.equal(fake.calls.length, 2);
    assert.ok(!("response_format" in (fake.calls[1].form?.fields ?? {})));
  });

  test("a rejection on the retry request surfaces unwrapped, like any fetch failure", async () => {
    const timeout = new DOMException("the deadline expired on the retry", "TimeoutError");
    const { ai, fake } = makeAi((index) => {
      if (index === 0) return jsonResponse({ error: "verbose refused" }, 400);
      throw timeout;
    });
    const rejected = await captureError(ai.run("@cf/openai/whisper-large-v3-turbo", {
      audio: audioStream(4),
    }));
    assert.equal(rejected, timeout); // the very same DOMException, not a wrapper
    assert.equal(fake.calls.length, 2);
  });

  test("a 200 body that is not JSON is still sanitized, because only abort/timeout names rethrow", async () => {
    const notJson = () => new Response("not a json body", { status: 200 });
    const chat = makeAi(notJson);
    const chatResult = await chat.ai.run(CHAT_MODEL, {
      max_tokens: 8,
      messages: [{ content: "hi", role: "user" }],
    });
    assert.deepEqual(chatResult, { response: "" });

    const transcription = makeAi(notJson);
    const transcriptionResult = await transcription.ai.run("@cf/openai/whisper-large-v3-turbo", {
      audio: audioStream(4),
    });
    assert.deepEqual(transcriptionResult, { text: "", transcription_info: {} });
  });

  test("cloudflareAiProvider reads the text and usage through the adapter without touching the app", async () => {
    const { ai } = makeAi(() => jsonResponse({
      choices: [{ message: { content: "Hello from the fake model" } }],
      usage: { completion_tokens: 12, prompt_tokens: 42 },
    }));
    const provider = cloudflareAiProvider(ai as unknown as Ai, "@cf/openai/gpt-oss-20b");
    const result = await provider.run(
      {
        messages: [
          { content: "You are Pinar.", role: "system" },
          { content: "Say hello", role: "user" },
        ],
        temperature: 0.1,
      },
      { maxTokens: 256, timeoutMs: 30_000 },
    );
    assert.equal(result.text, "Hello from the fake model");
    assert.deepEqual(result.usage, { inputTokens: 42, outputTokens: 12 });
    assert.equal(result.provider, "pinar_cloud");
  });
});
