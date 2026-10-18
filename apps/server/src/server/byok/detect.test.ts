// F5/S2: capability detection, with a fake egress (the ByokEgress
// interface): the appliance shortcut with the catalog of the Appliance
// answers (scope/available items, available: false, a missing item), the
// general path with success and with each error (401, 403 scope_denied,
// 404, 429, 503, a deadline, invalid JSON), the 255/256 positions of the
// embeddings, the refusal of byokFetch, and the rule that the key and the
// provider's body never appear in a result or in a console line.

import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { silentWav } from "../ai/inference";
import type { ByokCapabilities } from "./api";
import { detectByokCapabilities, type ByokDetectEndpoint } from "./detect";
import { byokFetch, type ByokEgress } from "./fetch";

const NOW = "2026-10-02T12:00:00.000Z";
const KEY = "sk-byok-detect-secret-0000";
const BASE = "https://api.example.test/v1";

const endpoint: ByokDetectEndpoint = {
  baseUrl: BASE,
  chatModel: "chat-1",
  embeddingModel: "embed-1",
  key: KEY,
  transcriptionModel: "tr-1",
};

interface Call {
  init: RequestInit | undefined;
  url: string;
}

/** A fake egress that answers in order and records every call. */
function fakeEgress(responses: Array<Response | ((call: Call) => Response)>) {
  const calls: Call[] = [];
  const egress: ByokEgress = async (url, init) => {
    const call = { init, url };
    calls.push(call);
    const next = responses.shift();
    assert.ok(next !== undefined, `unexpected egress call to ${url}`);
    return typeof next === "function" ? next(call) : next;
  };
  return { calls, egress };
}

function headerOf(call: Call | undefined, name: string): string | null {
  const headers = call?.init?.headers;
  return headers instanceof Headers ? headers.get(name) : null;
}

function jsonStatus(body: unknown, status: number, headers?: Record<string, string>) {
  return new Response(JSON.stringify(body), { headers: { ...headers, "content-type": "application/json" }, status });
}

function chatCompletion(content: string | null, toolCall = false) {
  const message: Record<string, unknown> = { content };
  if (toolCall) message.tool_calls = [{ function: { arguments: "{}", name: "pinar_probe" }, id: "call_1", type: "function" }];
  return { choices: [{ message }], object: "chat.completion" };
}

// The appliance catalog of the appendix answers: every item carries scope
// and available, the chat lists image and the tools parameters, the
// embeddings item supports 256, and the audio item is enabled.
function applianceCatalog() {
  return {
    data: [
      {
        available: true,
        id: "chat-1",
        modalities: { input: ["image", "text"] },
        scope: "llm",
        supported_parameters: ["response_format", "stream", "tool_choice", "tools"],
      },
      {
        available: true,
        embedding: { dimensions: { native: 256, supported: [256, 512] }, max_input_tokens: 8192 },
        id: "embed-1",
        scope: "embeddings",
      },
      {
        available: true,
        id: "tr-1",
        scope: "audio",
        transcription: { input: ["wav", "mp3"], max_duration_seconds: 600, max_file_mb: 25 },
      },
    ],
    object: "list",
  };
}

// A general catalog (OpenAI-style): the items have no scope/available, so
// the minimal calls run.
function generalCatalog() {
  return { data: [{ id: "chat-1", object: "model" }, { id: "embed-1", object: "model" }], object: "list" };
}

async function detectWith(egress: ByokEgress, over: Partial<typeof endpoint> = {}, now: string = NOW): Promise<ByokCapabilities> {
  return await detectByokCapabilities({ endpoint: { ...endpoint, ...over }, egress, now });
}

describe("detectByokCapabilities with an egress that ignores the signal", () => {
  test("every call settles at its deadline as timeout", async () => {
    const started = Date.now();
    const result = await detectByokCapabilities({
      egress: async () => new Promise<Response>(() => {}),
      endpoint,
      now: "2026-10-18T00:00:00.000Z",
      timeoutMs: 20,
    });
    assert.ok(Date.now() - started < 2_000, "the detection did not wait past the deadlines");
    for (const name of ["chat", "tools", "vision", "embeddings", "transcription"] as const) {
      const capability = result[name] as { error?: string | null; ok: boolean };
      assert.equal(capability.ok, false, name);
      if (capability.error !== "model_not_configured") assert.equal(capability.error, "timeout", name);
    }
  });
});

describe("detectByokCapabilities (F5/S2)", () => {
  test("the appliance shortcut reads the catalog and makes no test call", async () => {
    const { calls, egress } = fakeEgress([jsonStatus(applianceCatalog(), 200)]);
    const result = await detectWith(egress);
    assert.deepEqual(result, {
      chat: { error: null, ok: true, testedAt: NOW },
      embeddings: { dims: 256, error: null, ok: true, testedAt: NOW },
      tools: { error: null, ok: true, testedAt: NOW },
      transcription: { error: null, ok: true, testedAt: NOW },
      vision: { error: null, ok: true, testedAt: NOW },
    });
    // The catalog decided: the single call was the GET /models, with the
    // key only in the Authorization header.
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, `${BASE}/models`);
    assert.equal(headerOf(calls[0], "authorization"), `Bearer ${KEY}`);
  });

  test("the shortcut: available:false is scope_denied, a missing item is service_disabled", async () => {
    const denied = applianceCatalog();
    denied.data[0].available = false; // the key lacks the llm scope
    const { calls: deniedCalls, egress: deniedEgress } = fakeEgress([jsonStatus(denied, 200)]);
    const deniedResult = await detectWith(deniedEgress);
    assert.equal(deniedCalls.length, 1, "no test call behind the shortcut");
    for (const capability of ["chat", "tools", "vision"] as const) {
      assert.deepEqual(deniedResult[capability], { error: "scope_denied", ok: false, testedAt: NOW }, capability);
    }
    assert.deepEqual(deniedResult.embeddings, { dims: 256, error: null, ok: true, testedAt: NOW });
    assert.deepEqual(deniedResult.transcription, { error: null, ok: true, testedAt: NOW });

    // The embeddings item is missing: the service is not enabled there.
    const missing = applianceCatalog();
    missing.data = missing.data.filter((item: { scope: string }) => item.scope !== "embeddings");
    const { egress: missingEgress } = fakeEgress([jsonStatus(missing, 200)]);
    const missingResult = await detectWith(missingEgress);
    assert.deepEqual(missingResult.embeddings, { dims: null, error: "service_disabled", ok: false, testedAt: NOW });

    // An empty catalog: every service is absent.
    const { egress: emptyEgress } = fakeEgress([jsonStatus({ data: [], object: "list" }, 200)]);
    const emptyResult = await detectWith(emptyEgress);
    for (const capability of ["chat", "tools", "transcription", "vision"] as const) {
      assert.equal(emptyResult[capability].error, "service_disabled", capability);
      assert.equal(emptyResult[capability].ok, false, capability);
    }
    assert.deepEqual(emptyResult.embeddings, { dims: null, error: "service_disabled", ok: false, testedAt: NOW });
  });

  test("the shortcut: a model without the feature is ok:false with the model cause", async () => {
    const plain = applianceCatalog();
    plain.data[0].modalities = { input: ["text"] };
    plain.data[0].supported_parameters = ["stream"];
    const { egress } = fakeEgress([jsonStatus(plain, 200)]);
    const result = await detectWith(egress);
    assert.deepEqual(result.chat, { error: null, ok: true, testedAt: NOW });
    assert.deepEqual(result.vision, { error: "model_not_found", ok: false, testedAt: NOW });
    assert.deepEqual(result.tools, { error: "model_not_found", ok: false, testedAt: NOW });
  });

  test("the general path: success with the minimal calls, in sequence, with the key only in headers", async () => {
    const { calls, egress } = fakeEgress([
      jsonStatus(generalCatalog(), 200),
      jsonStatus(chatCompletion("", true), 200), // the forced tool_call
      jsonStatus(chatCompletion("ok"), 200), // the 1×1 image with content
      jsonStatus({ data: [{ embedding: Array.from({ length: 256 }, (_, i) => i / 256), index: 0 }], object: "list" }, 200),
      jsonStatus({ text: "" }, 200), // the silence transcribes to nothing
    ]);
    const result = await detectWith(egress);
    assert.deepEqual(result, {
      chat: { error: null, ok: true, testedAt: NOW },
      embeddings: { dims: 256, error: null, ok: true, testedAt: NOW },
      tools: { error: null, ok: true, testedAt: NOW },
      transcription: { error: null, ok: true, testedAt: NOW },
      vision: { error: null, ok: true, testedAt: NOW },
    });

    // The five calls, one per capability plus the catalog, in order.
    assert.deepEqual(
      calls.map((call) => call.url),
      [`${BASE}/models`, `${BASE}/chat/completions`, `${BASE}/chat/completions`, `${BASE}/embeddings`, `${BASE}/audio/transcriptions`],
    );
    for (const call of calls) {
      assert.equal(headerOf(call, "authorization"), `Bearer ${KEY}`, call.url);
      assert.ok(!call.url.includes(KEY), "the key is not in the URL");
    }
    // The chat probe forces the trivial tool; the vision probe sends the 1×1
    // PNG as a data URL; the transcription probe is a 1 s silent WAV.
    const toolsBody = JSON.parse(String(calls[1].init?.body)) as Record<string, unknown>;
    assert.equal(toolsBody.model, "chat-1");
    assert.ok(Array.isArray(toolsBody.tools) && toolsBody.tools.length === 1);
    assert.deepEqual(toolsBody.tool_choice, { function: { name: "pinar_probe" }, type: "function" });
    const visionBody = JSON.parse(String(calls[2].init?.body)) as { messages: Array<{ content: Array<Record<string, unknown>> }> };
    assert.ok(visionBody.messages[0].content.some((part) => part.type === "image_url" && String((part.image_url as { url: string }).url).startsWith("data:image/png;base64,")));
    const transcriptionBody = calls[4].init?.body;
    assert.ok(transcriptionBody instanceof FormData, "the transcription probe is a multipart form");
    const file = transcriptionBody.get("file");
    assert.ok(file instanceof Blob, "the form carries the WAV file");
    if (file instanceof File) assert.equal(file.name, "probe.wav");
    assert.equal(file.type, "audio/wav");
    const wav = new Uint8Array(await file.arrayBuffer());
    assert.deepEqual(Array.from(wav.subarray(0, 4)), [0x52, 0x49, 0x46, 0x46], "the RIFF signature of the generated WAV");
    assert.equal(wav.length, 44 + 16_000 * 2, "a 1 s mono PCM16 file");
    const silent = silentWav(1_000, 16_000);
    assert.equal(wav.length, silent.length);
    assert.equal(transcriptionBody.get("model"), "tr-1");
  });

  test("the general path: a 401 of the catalog stops the detection, one call, key_rejected everywhere", async () => {
    const { calls, egress } = fakeEgress([jsonStatus({ error: { message: "bad key", type: "invalid_api_key" } }, 401)]);
    const result = await detectWith(egress);
    assert.equal(calls.length, 1, "the 429/503/401 are never repeated");
    for (const capability of ["chat", "tools", "transcription", "vision"] as const) {
      assert.deepEqual(result[capability], { error: "key_rejected", ok: false, testedAt: NOW }, capability);
    }
    assert.deepEqual(result.embeddings, { dims: null, error: "key_rejected", ok: false, testedAt: NOW });
  });

  test("the general path: each error of its own calls maps to its cause", async () => {
    const cases: Array<[() => Response, string]> = [
      [() => jsonStatus({ error: { message: "nope", type: "invalid_api_key" } }, 401), "key_rejected"],
      [() => jsonStatus({ error: { message: "nope", type: "scope_denied" } }, 403), "scope_denied"],
      [() => jsonStatus({ error: { message: "nope", type: "forbidden" } }, 403), "key_rejected"],
      [() => jsonStatus({ error: { message: "nope", type: "service_disabled" } }, 404), "service_disabled"],
      [() => jsonStatus({ error: { code: "model_not_found", message: "nope", type: "invalid_request_error" } }, 404), "model_not_found"],
      [() => jsonStatus({ error: { message: "nope", type: "rate_limited" } }, 429, { "Retry-After": "999" }), "rate_limited"],
      [() => jsonStatus({ error: { message: "nope", type: "llm_unavailable" } }, 503, { "Retry-After": "5" }), "unavailable"],
      [() => {
        throw new DOMException("timeout", "TimeoutError");
      }, "timeout"],
      [() => new Response("not a json at all", { status: 200 }), "invalid_response"],
    ];
    for (const [make, cause] of cases) {
      const { calls, egress } = fakeEgress([jsonStatus(generalCatalog(), 200), make, make, make, make]);
      const startedAt = Date.now();
      const result = await detectWith(egress);
      assert.ok(Date.now() - startedAt < 5_000, `no waiting for the Retry-After of the ${cause} case`);
      for (const capability of ["chat", "tools", "transcription", "vision"] as const) {
        assert.deepEqual(result[capability], { error: cause, ok: false, testedAt: NOW }, `${capability} of ${cause}`);
      }
      assert.deepEqual(result.embeddings, { dims: null, error: cause, ok: false, testedAt: NOW }, `embeddings of ${cause}`);
      assert.equal(calls.length, 5, `${cause}: one call per capability, in sequence`);
    }
  });

  test("the general path: a 404 catalog falls through to the minimal calls", async () => {
    const { calls, egress } = fakeEgress([
      jsonStatus({ error: { message: "no such route", type: "not_found" } }, 404),
      jsonStatus(chatCompletion("", true), 200),
      jsonStatus(chatCompletion("ok"), 200),
      jsonStatus({ data: [{ embedding: Array.from({ length: 256 }, () => 0) }] }, 200),
      jsonStatus({ text: "silence" }, 200),
    ]);
    const result = await detectWith(egress);
    assert.equal(result.chat.ok, true);
    assert.equal(result.tools.ok, true);
    assert.equal(result.vision.ok, true);
    assert.equal(result.embeddings.ok, true);
    assert.equal(result.embeddings.dims, 256);
    assert.equal(result.transcription.ok, true);
    assert.equal(calls.length, 5);
  });

  test("the general path: the embeddings pass with 256 positions and fail with 255", async () => {
    const { egress: egress256 } = fakeEgress([
      jsonStatus(generalCatalog(), 200),
      jsonStatus(chatCompletion("", true), 200),
      jsonStatus(chatCompletion("ok"), 200),
      jsonStatus({ data: [{ embedding: Array.from({ length: 256 }, (_, i) => i) }] }, 200),
      jsonStatus({ text: "" }, 200),
    ]);
    const pass = await detectWith(egress256);
    assert.deepEqual(pass.embeddings, { dims: 256, error: null, ok: true, testedAt: NOW });

    const { egress: egress255 } = fakeEgress([
      jsonStatus(generalCatalog(), 200),
      jsonStatus(chatCompletion("", true), 200),
      jsonStatus(chatCompletion("ok"), 200),
      jsonStatus({ data: [{ embedding: Array.from({ length: 255 }, (_, i) => i) }] }, 200),
      jsonStatus({ text: "" }, 200),
    ]);
    const fail = await detectWith(egress255);
    // The index requires 256: the 255-position vector does not pass, and no
    // dimension is recorded for it.
    assert.deepEqual(fail.embeddings, { dims: null, error: "invalid_response", ok: false, testedAt: NOW });
  });

  test("the general path: a forced tool_choice not honored keeps the chat and fails the tools", async () => {
    const { egress } = fakeEgress([
      jsonStatus(generalCatalog(), 200),
      jsonStatus(chatCompletion("I did not call the tool"), 200),
      jsonStatus(chatCompletion("ok"), 200),
      jsonStatus({ data: [{ embedding: Array.from({ length: 256 }, () => 0) }] }, 200),
      jsonStatus({ text: "" }, 200),
    ]);
    const result = await detectWith(egress);
    assert.deepEqual(result.chat, { error: null, ok: true, testedAt: NOW });
    assert.deepEqual(result.tools, { error: "invalid_response", ok: false, testedAt: NOW });
  });

  test("the refusal of byokFetch: egress_unavailable, and nothing else is attempted", async () => {
    const { calls, egress } = fakeEgress([]);
    void egress;
    const result = await detectWith((url, init) => byokFetch({}, url, init));
    for (const capability of ["chat", "tools", "transcription", "vision"] as const) {
      assert.deepEqual(result[capability], { error: "egress_unavailable", ok: false, testedAt: NOW }, capability);
    }
    assert.deepEqual(result.embeddings, { dims: null, error: "egress_unavailable", ok: false, testedAt: NOW });
    // The catalog refusal decided: no second call left the process.
    const callsCount = calls.length;
    assert.equal(callsCount, 0, "the fake was never used: byokFetch refused");
  });

  test("only the configured capabilities are tested; the others cost no call", async () => {
    const { calls, egress } = fakeEgress([
      jsonStatus(applianceCatalog(), 200),
      jsonStatus({ text: "x" }, 200),
    ]);
    const result = await detectWith(egress, { chatModel: "", embeddingModel: "" });
    assert.deepEqual(result.chat, { error: "model_not_configured", ok: false, testedAt: NOW });
    assert.deepEqual(result.tools, { error: "model_not_configured", ok: false, testedAt: NOW });
    assert.deepEqual(result.vision, { error: "model_not_configured", ok: false, testedAt: NOW });
    assert.deepEqual(result.embeddings, { dims: null, error: "model_not_configured", ok: false, testedAt: NOW });
    assert.deepEqual(result.transcription, { error: null, ok: true, testedAt: NOW });
    assert.equal(calls.length, 1, "the catalog shortcut: the audio item decided, no WAV call");

    // The general path with only chat configured: the catalog plus the two
    // chat calls, nothing else.
    const { calls: generalCalls, egress: generalEgress } = fakeEgress([
      jsonStatus(generalCatalog(), 200),
      jsonStatus(chatCompletion("", true), 200),
      jsonStatus(chatCompletion("ok"), 200),
    ]);
    const general = await detectWith(generalEgress, { embeddingModel: "", transcriptionModel: "" });
    assert.equal(generalCalls.length, 3);
    assert.deepEqual(general.transcription, { error: "model_not_configured", ok: false, testedAt: NOW });
    assert.deepEqual(general.embeddings, { dims: null, error: "model_not_configured", ok: false, testedAt: NOW });
  });

  test("with no model at all nothing is called and everything is untested-shape", async () => {
    const { calls, egress } = fakeEgress([]);
    const result = await detectWith(egress, { chatModel: "", embeddingModel: "", transcriptionModel: "" });
    assert.equal(calls.length, 0);
    assert.deepEqual(result, {
      chat: { error: "model_not_configured", ok: false, testedAt: NOW },
      embeddings: { dims: null, error: "model_not_configured", ok: false, testedAt: NOW },
      tools: { error: "model_not_configured", ok: false, testedAt: NOW },
      transcription: { error: "model_not_configured", ok: false, testedAt: NOW },
      vision: { error: "model_not_configured", ok: false, testedAt: NOW },
    });
  });

  test("the total budget leaves the unrun capabilities as timeout", async () => {
    // The catalog answer arrives after the budget: the catalog call runs,
    // and the minimal calls that did not fit in the budget record the
    // deadline, without being attempted.
    const { calls, egress } = fakeEgress([
      () => new Promise<Response>((resolve) => setTimeout(() => resolve(jsonStatus(generalCatalog(), 200)), 30)),
    ]);
    const result = await detectByokCapabilities({
      budgetMs: 10,
      endpoint,
      egress,
      now: NOW,
      timeoutMs: 1_000,
    });
    assert.equal(calls.length, 1, "the budget stopped the remaining calls");
    for (const capability of ["chat", "tools", "transcription", "vision"] as const) {
      assert.equal(result[capability].error, "timeout", capability);
      assert.equal(result[capability].ok, false, capability);
    }
    assert.deepEqual(result.embeddings, { dims: null, error: "timeout", ok: false, testedAt: NOW });
  });

  test("the guard's x-edger-egress-error codes map to the causes (EDG-38 §4)", async () => {
    const cases: Array<[string, number, string]> = [
      ["EGRESS_HOST_BLOCKED", 403, "endpoint_blocked"],
      ["EGRESS_PORT_BLOCKED", 403, "endpoint_blocked"],
      ["EGRESS_BAD_TARGET", 400, "endpoint_blocked"],
      ["EGRESS_DNS_ERROR", 502, "endpoint_unreachable"],
      ["EGRESS_UPSTREAM_ERROR", 502, "endpoint_unreachable"],
      ["EGRESS_TIMEOUT", 504, "timeout"],
      ["EGRESS_LIMIT", 429, "rate_limited"],
    ];
    for (const [code, status, cause] of cases) {
      // The guard's refusal on a general-path call: the capability takes
      // the cause, and the sequential calls after it still run.
      const { egress } = fakeEgress([
        jsonStatus(generalCatalog(), 200),
        jsonStatus({ error: code, message: "guard" }, status, { "x-edger-egress-error": code }),
        jsonStatus(chatCompletion("ok", true), 200),
        jsonStatus({ data: [{ embedding: Array.from({ length: 256 }, () => 0) }] }, 200),
        jsonStatus({ text: "" }, 200),
      ]);
      const result = await detectWith(egress);
      assert.equal(result.chat.error, cause, `${code} (chat call)`);
      assert.equal(result.chat.ok, false, code);
      assert.equal(result.tools.error, cause, `${code} (tools)`);
      assert.equal(result.vision.ok, true, `${code}: the following calls still run`);
      assert.equal(result.embeddings.ok, true, code);
      assert.equal(result.transcription.ok, true, code);
    }
  });

  test("the calls are sequential: none starts before the previous one ends", async () => {
    let active = 0;
    let maxActive = 0;
    const slow: ByokEgress = async (url) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 10));
      active -= 1;
      if (url === `${BASE}/models`) return jsonStatus(generalCatalog(), 200);
      if (url.endsWith("/embeddings")) return jsonStatus({ data: [{ embedding: Array.from({ length: 256 }, () => 0) }] }, 200);
      if (url.endsWith("/audio/transcriptions")) return jsonStatus({ text: "" }, 200);
      return jsonStatus(chatCompletion("ok", true), 200);
    };
    const result = await detectWith(slow);
    assert.equal(maxActive, 1, "no parallelism: the user's limit is not burst");
    assert.equal(result.chat.ok, true);
  });

  test("the key and the provider's body never appear in a result or a console line", async () => {
    const consoleLines: string[] = [];
    const original = { error: console.error, warn: console.warn, log: console.log };
    for (const name of ["error", "warn", "log"] as const) {
      console[name] = (...args: unknown[]) => {
        consoleLines.push(args.map((arg) => (typeof arg === "string" ? arg : JSON.stringify(arg))).join(" "));
      };
    }
    try {
      const hostile = `{"error":{"type":"scope_denied","message":"the key ${KEY} is missing the scope; see https://internal.example/secret"}`;
      const { egress } = fakeEgress([
        jsonStatus(generalCatalog(), 200),
        new Response(hostile, { headers: { "content-type": "application/json" }, status: 403 }),
        new Response(hostile, { headers: { "content-type": "application/json" }, status: 403 }),
        new Response(hostile, { headers: { "content-type": "application/json" }, status: 403 }),
        new Response(hostile, { headers: { "content-type": "application/json" }, status: 403 }),
      ]);
      const result = await detectWith(egress);
      const serialized = JSON.stringify(result);
      assert.ok(!serialized.includes(KEY), "the key is not in the result");
      assert.ok(!serialized.includes("internal.example"), "the provider's body is not in the result");
      assert.ok(!serialized.includes("the key"), "the provider's message is not in the result");
      for (const capability of Object.keys(result) as Array<keyof ByokCapabilities>) {
        assert.ok(result[capability].error !== null && result[capability].error.length <= 32, `a short cause for ${capability}`);
      }
      assert.ok(consoleLines.every((line) => !line.includes(KEY)), `the console leaked the key:\n${consoleLines.join("\n")}`);
    } finally {
      console.error = original.error;
      console.warn = original.warn;
      console.log = original.log;
    }
  });

  test("every call's deadline is capped by the remaining budget (30 ms budget, a 200 ms call)", async () => {
    // The chat call would run 200 ms and honors its signal: the 30 ms
    // budget must end the detection with a timeout near 30 ms, not after
    // the full per-call deadline.
    let calls = 0;
    const egress: ByokEgress = (url, init) => {
      calls += 1;
      if (url === `${BASE}/models`) return Promise.resolve(jsonStatus(generalCatalog(), 200));
      return new Promise<Response>((_resolve, reject) => {
        const signal = init?.signal;
        assert.ok(signal instanceof AbortSignal, "the call carries its deadline");
        signal.addEventListener("abort", () => reject(signal.reason), { once: true });
      });
    };
    const startedAt = Date.now();
    const result = await detectByokCapabilities({
      budgetMs: 30,
      endpoint: { ...endpoint, embeddingModel: "", transcriptionModel: "" },
      egress,
      now: NOW,
      timeoutMs: 200,
    });
    const elapsed = Date.now() - startedAt;
    assert.equal(calls, 2, "the catalog and the chat call; the rest never starts");
    for (const capability of ["chat", "tools", "vision"] as const) {
      assert.equal(result[capability].error, "timeout", capability);
    }
    assert.ok(elapsed < 150, `the detection ended near the budget (${elapsed} ms)`);
  });

  test("the catalog call's deadline is the remaining budget too", async () => {
    // A catalog that would run 500 ms: its deadline is the 30 ms budget, so
    // the detection ends near 30 ms and the minimal calls never start.
    const egress: ByokEgress = (_url, init) =>
      new Promise<Response>((_resolve, reject) => {
        const signal = init?.signal;
        assert.ok(signal instanceof AbortSignal, "the catalog call carries its deadline");
        signal.addEventListener("abort", () => reject(signal.reason), { once: true });
      });
    const startedAt = Date.now();
    const result = await detectByokCapabilities({ budgetMs: 30, endpoint, egress, now: NOW, timeoutMs: 500 });
    const elapsed = Date.now() - startedAt;
    assert.equal(result.chat.error, "timeout");
    assert.equal(result.embeddings.error, "timeout");
    assert.equal(result.transcription.error, "timeout");
    assert.ok(elapsed < 250, `the catalog alone ended near the budget (${elapsed} ms)`);
  });

  test("a body that fails to read is a short cause of the call, never a raw rejection", async () => {
    // (a) the headers arrive and the body stream fails by timeout: the
    // cause is timeout, and the detection resolves with the short causes.
    const streamTimeout = () =>
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.error(new DOMException("synthetic stream timeout", "TimeoutError"));
        },
      });
    const timeoutEgress: ByokEgress = async () => new Response(streamTimeout());
    const a = await detectByokCapabilities({
      endpoint: { ...endpoint, embeddingModel: "", transcriptionModel: "" },
      egress: timeoutEgress,
      now: NOW,
    });
    for (const capability of ["chat", "tools", "vision"] as const) {
      assert.equal(a[capability].error, "timeout", capability);
      assert.equal(a[capability].ok, false, capability);
    }

    // (b) a network failure of the body: endpoint_unreachable, and the
    // capabilities after the failed call keep being tested.
    const networkEgress: ByokEgress = async (url) => {
      if (url === `${BASE}/models`) {
        return new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              controller.error(new Error("synthetic network failure"));
            },
          }),
        );
      }
      return jsonStatus(chatCompletion("ok", true), 200);
    };
    const b = await detectByokCapabilities({
      endpoint: { ...endpoint, embeddingModel: "", transcriptionModel: "" },
      egress: networkEgress,
      now: NOW,
    });
    assert.equal(b.chat.ok, true, "the general path ran past the failed catalog body");
    assert.equal(b.tools.ok, true);
    assert.equal(b.vision.ok, true);
  });
});
