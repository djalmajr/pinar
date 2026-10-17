import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, test } from "node:test";
import type { AssistantEndpoint } from "../models";
import { captionSessionPins, PIN_CAPTION_MAX_CHARS, PIN_OCR_MAX_CHARS, VISION_MAX_IMAGE_BYTES, VISION_PROMPT, type VisionEndpoint } from "./vision";

const appliance: AssistantEndpoint = {
  apiKey: "vision-key",
  baseUrl: "https://appliance.example/v1",
  kind: "appliance",
  model: "qwen3.8-27b",
  thinkingControl: true,
};

const png = { bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]), mimeType: "image/png" as const };
const pins = [
  { comment: "Contrast is too low", number: 1 },
  { comment: "Wrong price", number: 2 },
];

type Call = { body: Record<string, unknown>; init: RequestInit; url: string };

function chatResponse(content: unknown): Response {
  return Response.json({
    choices: [{ finish_reason: "stop", index: 0, message: { content: typeof content === "string" ? content : JSON.stringify(content), role: "assistant" } }],
    id: "chatcmpl-1",
    model: "qwen3.8-27b",
  });
}

function fakeFetch(respond: () => Response = () => chatResponse({ pins: [] })) {
  const calls: Call[] = [];
  const fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ body: JSON.parse(String(init?.body)), init: init ?? {}, url: String(input) });
    return respond();
  }) as typeof fetch;
  return { calls, fetch };
}

// Every console method is replaced by a recorder for each test, so any
// log line (with or without content) fails the assertions below.
const consoleCalls: unknown[][] = [];
const originals = new Map<string, unknown>();
const consoleMethods = ["log", "info", "warn", "error", "debug", "trace"] as const;
beforeEach(() => {
  consoleCalls.length = 0;
  for (const method of consoleMethods) {
    originals.set(method, console[method]);
    console[method] = (...args: unknown[]) => {
      consoleCalls.push(args);
    };
  }
});
afterEach(() => {
  for (const method of consoleMethods) console[method] = originals.get(method) as never;
});

describe("captionSessionPins", () => {
  test("sends the image as a data URL with structured output and thinking off", async () => {
    const fake = fakeFetch(() => chatResponse({ pins: [{ caption: "Blue button", number: 1, ocr: "Buy now" }] }));
    const result = await captionSessionPins({ endpoint: appliance, fetch: fake.fetch, image: png, pins });
    assert.deepEqual(result, [{ caption: "Blue button", number: 1, ocr: "Buy now" }]);
    assert.equal(fake.calls.length, 1);
    const { body, init, url } = fake.calls[0]!;
    assert.equal(url, "https://appliance.example/v1/chat/completions");
    assert.equal(init.method, "POST");
    assert.equal(init.redirect, "manual");
    assert.ok(init.signal instanceof AbortSignal);
    assert.equal(new Headers(init.headers).get("authorization"), "Bearer vision-key");
    assert.ok(!String(init.body).includes("vision-key"));
    assert.equal(body["model"], "qwen3.8-27b");
    assert.deepEqual(body["chat_template_kwargs"], { enable_thinking: false });
    const messages = body["messages"] as Array<{ content: unknown; role: string }>;
    assert.equal(messages[0]!.role, "system");
    assert.equal(messages[0]!.content, VISION_PROMPT);
    assert.ok(VISION_PROMPT.includes("describe what is under each numbered Pinar marker; transcribe visible text"));
    const parts = messages[1]!.content as Array<Record<string, unknown>>;
    assert.equal(messages[1]!.role, "user");
    assert.deepEqual(parts[0], { text: "Markers and their comments:\n#1: Contrast is too low\n#2: Wrong price", type: "text" });
    assert.deepEqual(parts[1], { image_url: { url: `data:image/png;base64,${btoa(String.fromCharCode(...png.bytes))}` }, type: "image_url" });
    const format = body["response_format"] as { json_schema: { name: string; schema: Record<string, unknown>; strict: boolean }; type: string };
    assert.equal(format.type, "json_schema");
    assert.equal(format.json_schema.strict, true);
    assert.deepEqual(format.json_schema.schema["required"], ["pins"]);
    const item = (format.json_schema.schema["properties"] as { pins: { items: { required: string[] } } }).pins.items;
    assert.deepEqual(item.required, ["number", "caption", "ocr"]);
  });

  test("a BYOK endpoint without thinking control sends no chat_template_kwargs", async () => {
    const fake = fakeFetch();
    const byok: AssistantEndpoint = { baseUrl: "https://byok.example/v1", kind: "openai-compatible", model: "gpt-vision", thinkingControl: false };
    await captionSessionPins({ endpoint: byok, fetch: fake.fetch, image: { ...png, mimeType: "image/webp" }, pins });
    const body = fake.calls[0]!.body;
    assert.equal(body["chat_template_kwargs"], undefined);
    assert.equal(new Headers(fake.calls[0]!.init.headers).get("authorization"), null);
    const parts = (body["messages"] as Array<{ content: Array<{ image_url?: { url: string } }> }>)[1]!.content;
    assert.ok(parts[1]!.image_url!.url.startsWith("data:image/webp;base64,"));
  });

  test("ignores unknown numbers and returns the pins' order", async () => {
    const fake = fakeFetch(() =>
      chatResponse({
        pins: [
          { caption: "Price", number: 2, ocr: "$10" },
          { caption: "Ghost", number: 7, ocr: "?" },
          { caption: "Button", number: 1, ocr: "" },
        ],
      }),
    );
    const result = await captionSessionPins({ endpoint: appliance, fetch: fake.fetch, image: png, pins });
    assert.deepEqual(result, [
      { caption: "Button", number: 1, ocr: "" },
      { caption: "Price", number: 2, ocr: "$10" },
    ]);
  });

  test("cuts caption at 300 and ocr at 1000", async () => {
    const fake = fakeFetch(() => chatResponse({ pins: [{ caption: "c".repeat(400), number: 1, ocr: "o".repeat(1500) }] }));
    const [first] = await captionSessionPins({ endpoint: appliance, fetch: fake.fetch, image: png, pins });
    assert.equal(PIN_CAPTION_MAX_CHARS, 300);
    assert.equal(PIN_OCR_MAX_CHARS, 1000);
    assert.equal(first!.caption.length, 300);
    assert.equal(first!.ocr.length, 1000);
  });

  test("an image over 8 MB returns [] without a call; exactly 8 MB is sent", async () => {
    const fake = fakeFetch();
    assert.equal(VISION_MAX_IMAGE_BYTES, 8 * 1024 * 1024);
    const over = { bytes: new Uint8Array(VISION_MAX_IMAGE_BYTES + 1), mimeType: "image/png" as const };
    assert.deepEqual(await captionSessionPins({ endpoint: appliance, fetch: fake.fetch, image: over, pins }), []);
    assert.equal(fake.calls.length, 0);
    const limit = { bytes: new Uint8Array(VISION_MAX_IMAGE_BYTES), mimeType: "image/png" as const };
    await captionSessionPins({ endpoint: appliance, fetch: fake.fetch, image: limit, pins });
    assert.equal(fake.calls.length, 1);
  });

  test("no pins, no call", async () => {
    const fake = fakeFetch();
    assert.deepEqual(await captionSessionPins({ endpoint: appliance, fetch: fake.fetch, image: png, pins: [] }), []);
    assert.equal(fake.calls.length, 0);
  });

  test("malformed responses throw without content in the error or any log", async () => {
    const secret = "SECRET-CAPTION-TEXT";
    const responses = [
      () => chatResponse(`not json ${secret}`),
      () => chatResponse({ pins: [{ caption: secret, number: "1", ocr: "" }] }),
      () => chatResponse({ pins: [{ caption: secret, number: 1 }] }),
      () => chatResponse({ pins: [{ caption: secret, number: 1, ocr: "" }, { caption: secret, number: 1, ocr: "" }] }),
      () => chatResponse({ other: secret }),
      () => Response.json({ choices: [] }),
      () => new Response(`upstream ${secret} vision-key`, { status: 500 }),
      () => new Response(null, { headers: { location: "https://evil.example" }, status: 302 }),
    ];
    for (const respond of responses) {
      const fake = fakeFetch(respond);
      const error = await captionSessionPins({ endpoint: appliance, fetch: fake.fetch, image: png, pins }).catch((caught: Error) => caught);
      assert.ok(error instanceof Error);
      for (const leak of [secret, "vision-key", "appliance.example", "Contrast is too low"]) assert.ok(!error.message.includes(leak), `${error.message} leaks ${leak}`);
    }
    assert.deepEqual(consoleCalls, []);
  });

  test("successful calls log nothing either", async () => {
    const fake = fakeFetch(() => chatResponse({ pins: [{ caption: "Blue button", number: 1, ocr: "Buy now" }] }));
    await captionSessionPins({ endpoint: appliance, fetch: fake.fetch, image: png, pins });
    assert.deepEqual(consoleCalls, []);
  });

  test("refuses a redirect without following it", async () => {
    const fake = fakeFetch(() => new Response(null, { headers: { location: "https://evil.example/steal" }, status: 302 }));
    await assert.rejects(captionSessionPins({ endpoint: appliance, fetch: fake.fetch, image: png, pins }), { message: "assistant endpoint redirect refused" });
    assert.equal(fake.calls.length, 1);
    assert.equal(fake.calls[0]!.init.redirect, "manual");
  });

  test("refuses an invalid base URL before any request and times out a stalled one", async () => {
    const fake = fakeFetch();
    await assert.rejects(captionSessionPins({ endpoint: { ...appliance, baseUrl: "http://appliance.example/v1" }, fetch: fake.fetch, image: png, pins }), /invalid assistant endpoint/);
    assert.equal(fake.calls.length, 0);
    const stalled = (async (_input: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(init.signal!.reason));
      })) as typeof fetch;
    await assert.rejects(captionSessionPins({ endpoint: appliance, fetch: stalled, image: png, pins, timeoutMs: 30 }), /vision request timed out/);
  });
});

describe("captionSessionPins through the gateway", () => {
  const gateway: VisionEndpoint = {
    apiKey: "vck-gateway-key",
    baseUrl: "https://ai-gateway.vercel.sh/v1",
    gateway: { zeroDataRetention: false },
    kind: "openai-compatible",
    model: "anthropic/claude-haiku-5.5",
    thinkingControl: false,
  };
  const answer = (extra: Record<string, unknown>) => () =>
    Response.json({
      choices: [{ finish_reason: "stop", index: 0, message: { content: JSON.stringify({ pins: [{ caption: "Botão azul", number: 1, ocr: "Comprar" }] }), role: "assistant" } }],
      ...extra,
    });
  const costLines = () => consoleCalls.map((args) => JSON.parse(String(args[0])) as Record<string, unknown>);

  test("sends the privacy options in providerOptions with the gateway key, without thinking flags", async () => {
    for (const zeroDataRetention of [false, true]) {
      const fake = fakeFetch(answer({}));
      const result = await captionSessionPins({ endpoint: { ...gateway, gateway: { zeroDataRetention } }, fetch: fake.fetch, image: png, pins });
      assert.deepEqual(result, [{ caption: "Botão azul", number: 1, ocr: "Comprar" }]);
      const { body, init, url } = fake.calls[0]!;
      assert.equal(url, "https://ai-gateway.vercel.sh/v1/chat/completions");
      assert.equal(new Headers(init.headers).get("authorization"), "Bearer vck-gateway-key");
      assert.ok(!String(init.body).includes("vck-gateway-key"));
      assert.equal(body["model"], "anthropic/claude-haiku-5.5");
      assert.deepEqual(body["providerOptions"], { gateway: zeroDataRetention ? { disallowPromptTraining: true, zeroDataRetention: true } : { disallowPromptTraining: true } });
      assert.equal(body["chat_template_kwargs"], undefined);
      assert.deepEqual(Object.keys(body).sort(), ["messages", "model", "providerOptions", "response_format"]);
    }
  });

  test("one assistant_index_cost line: the gateway's cost, else ASSISTANT_MODEL_PRICES × usage, else none", async () => {
    const cases: Array<[Record<string, unknown>, VisionEndpoint, unknown]> = [
      [{ providerMetadata: { gateway: { cost: "0.000321" } }, usage: { completion_tokens: 200, prompt_tokens: 1000 } }, gateway, ["gateway", 321]],
      // 1000 × 0.00000055 + 200 × 0.00000275 = 0.0011 USD.
      [{ usage: { completion_tokens: 200, prompt_tokens: 1000 } }, gateway, ["table", 1100]],
      [{ usage: { prompt_tokens: 1000 } }, gateway, ["none", null]],
      [{}, gateway, ["none", null]],
      [{ usage: { completion_tokens: 200, prompt_tokens: 1000 } }, { ...gateway, model: "google/gemini-9-vision" }, ["none", null]],
    ];
    for (const [extra, endpoint, expected] of cases) {
      consoleCalls.length = 0;
      await captionSessionPins({ endpoint, fetch: fakeFetch(answer(extra)).fetch, image: png, pins });
      assert.equal(consoleCalls.length, 1, JSON.stringify(extra));
      const [line] = costLines();
      assert.deepEqual(line, { costSource: (expected as unknown[])[0], costUsdMicros: (expected as unknown[])[1], kind: "caption", message: "assistant_index_cost", model: endpoint.model });
    }
  });

  test("the line carries no key, URL, comment, caption or image", async () => {
    await captionSessionPins({ endpoint: gateway, fetch: fakeFetch(answer({ usage: { completion_tokens: 2, prompt_tokens: 3 } })).fetch, image: png, pins });
    const line = String(consoleCalls[0]![0]);
    assert.deepEqual(Object.keys(JSON.parse(line)), ["message", "kind", "model", "costUsdMicros", "costSource"]);
    for (const leak of ["vck-gateway-key", "ai-gateway.vercel.sh", "https://", "Contrast", "Wrong price", "Botão", "Comprar", "base64"]) assert.ok(!line.includes(leak), leak);
  });

  test("a billed call with a bad body logs its cost and still throws; a failed request logs nothing", async () => {
    const bad = fakeFetch(() => Response.json({ choices: [{ message: { content: "not json" } }], usage: { completion_tokens: 200, prompt_tokens: 1000 } }));
    await assert.rejects(captionSessionPins({ endpoint: gateway, fetch: bad.fetch, image: png, pins }), /vision response invalid/);
    assert.deepEqual(costLines().map((line) => [line["costSource"], line["costUsdMicros"]]), [["table", 1100]]);
    consoleCalls.length = 0;
    await assert.rejects(captionSessionPins({ endpoint: gateway, fetch: fakeFetch(() => new Response("down", { status: 503 })).fetch, image: png, pins }));
    assert.deepEqual(consoleCalls, []);
  });
});
