import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { LanguageModel } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import {
  ASSISTANT_BREAKER_OPEN_MS,
  ASSISTANT_CHAIN_METADATA_KEY,
  ASSISTANT_MODEL_PRICES,
  AssistantChainConfigError,
  AssistantChainError,
  assistantChainModel,
  classifyAssistantChainError,
  assistantChainOpen,
  assistantTableCostMicros,
  assistantTurnBilling,
  createAssistantCircuitBreaker,
  parseAssistantChain,
  usdToMicrosCeil,
  type AssistantChainAttempt,
  type AssistantChainLink,
  type AssistantCircuitBreaker,
} from "./chain";
import { runAssistantTurn, type AssistantTurnOutcome } from "./turn";

// ---------- fakes ----------

const GATEWAY_KEY = "gw-secret-key-123";
const APPLIANCE_KEY = "appliance-secret-key-456";
const APPLIANCE_URL = "https://appliance.test/v1";

const HAIKU = "anthropic/claude-haiku-5.5";
const DEEPSEEK = "deepseek/deepseek-v4.1-flash";
const GLM = "zai/glm-5.3-flash";

type Part = Record<string, unknown>;

interface Call {
  body: Record<string, unknown>;
  headers: Headers;
  model: string; // ai-language-model-id (gateway) or body.model (appliance)
  url: string;
}

type Reply = (call: Call) => Response | Promise<Response>;

// One fake fetch for both hubs: a call is answered by the first reply
// queued for its model (the last reply repeats).
function fakeFetch(replies: Record<string, Reply[]>) {
  const calls: Call[] = [];
  const used: Record<string, number> = {};
  const fetchFn = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const headers = new Headers(init?.headers);
    const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
    const model = headers.get("ai-language-model-id") ?? String(body.model ?? "");
    const call = { body, headers, model, url };
    calls.push(call);
    const queue = replies[model];
    if (!queue || queue.length === 0) throw new Error(`no reply for ${model}`);
    const index = Math.min(used[model] ?? 0, queue.length - 1);
    used[model] = (used[model] ?? 0) + 1;
    return queue[index](call);
  }) as typeof fetch;
  return { calls, fetch: fetchFn };
}

function sse(parts: unknown[]): Response {
  const text = parts.map((part) => `data: ${JSON.stringify(part)}\n\n`).join("");
  return new Response(text, { headers: { "content-type": "text/event-stream" }, status: 200 });
}

const gatewayUsage = (input: number, output: number, cache: { read?: number; write?: number } = {}) => ({
  inputTokens: { cacheRead: cache.read, cacheWrite: cache.write, noCache: undefined, total: input },
  outputTokens: { reasoning: undefined, text: undefined, total: output },
});

function gatewayAnswer(text: string, options: { cost?: unknown; marketCost?: unknown; input?: number; output?: number } = {}): Part[] {
  const finish: Part = {
    finishReason: { raw: "stop", unified: "stop" },
    type: "finish",
    usage: gatewayUsage(options.input ?? 10, options.output ?? 5),
  };
  if (options.cost !== undefined || options.marketCost !== undefined) {
    const gateway: Record<string, unknown> = {};
    if (options.cost !== undefined) gateway["cost"] = options.cost;
    if (options.marketCost !== undefined) gateway["marketCost"] = options.marketCost;
    finish.providerMetadata = { gateway };
  }
  return [
    { type: "stream-start", warnings: [] },
    { id: "t1", type: "text-start" },
    { delta: text, id: "t1", type: "text-delta" },
    { id: "t1", type: "text-end" },
    finish,
  ];
}

const answers = (text: string, options?: Parameters<typeof gatewayAnswer>[1]): Reply => () => sse(gatewayAnswer(text, options));
const status = (code: number, type: string): Reply => () =>
  Response.json({ error: { message: `upstream said ${GATEWAY_KEY} at https://upstream.test`, type } }, { status: code });
const timeout: Reply = () => {
  throw Object.assign(new Error("Headers Timeout Error"), { code: "UND_ERR_HEADERS_TIMEOUT" });
};
const network: Reply = () => {
  throw new TypeError("fetch failed", { cause: Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" }) });
};
// A 200 whose body breaks before any part is read (the gateway reports it
// as an error with status 200).
const brokenBody: Reply = () =>
  new Response(new ReadableStream({
    start(controller) {
      controller.error(new TypeError("terminated"));
    },
  }), { headers: { "content-type": "text/event-stream" } });

// OpenAI-compatible chat completions stream (the appliance).
function applianceAnswer(text: string): Reply {
  return () => {
    const chunks = [
      { choices: [{ delta: { content: text, role: "assistant" }, index: 0 }], created: 1, id: "c1", model: "qwen", object: "chat.completion.chunk" },
      { choices: [{ delta: {}, finish_reason: "stop", index: 0 }], created: 1, id: "c1", model: "qwen", object: "chat.completion.chunk", usage: { completion_tokens: 4, prompt_tokens: 7, total_tokens: 11 } },
    ];
    const body = chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join("") + "data: [DONE]\n\n";
    return new Response(body, { headers: { "content-type": "text/event-stream" }, status: 200 });
  };
}

const gatewayChain = (...models: string[]): AssistantChainLink[] => models.map((model) => ({ hub: "gateway", model }));

function chainModel(input: {
  appliance?: boolean;
  breaker?: AssistantCircuitBreaker;
  chain: AssistantChainLink[];
  fetch: typeof fetch;
  onAttempt?: (attempt: AssistantChainAttempt) => void;
  zeroDataRetention?: boolean;
}): LanguageModel {
  return assistantChainModel({
    appliance: input.appliance ? { apiKey: APPLIANCE_KEY, baseUrl: APPLIANCE_URL } : null,
    breaker: input.breaker ?? createAssistantCircuitBreaker(),
    chain: input.chain,
    context: { conversationId: "thread-1", requestId: "request-1" },
    fetch: input.fetch,
    gateway: { apiKey: GATEWAY_KEY, ...(input.zeroDataRetention ? { zeroDataRetention: true } : {}) },
    ...(input.onAttempt ? { onAttempt: input.onAttempt } : {}),
  });
}

async function turn(model: LanguageModel, providerOptions?: Record<string, Record<string, string[]>>) {
  const { outcome, response } = runAssistantTurn({
    history: [{ role: "user", text: "oi" }],
    model,
    ...(providerOptions ? { providerOptions } : {}),
    system: "system",
    thread: { id: "thread-1", title: "T" },
    tools: {},
  });
  const body = await response.text();
  return { body, outcome: await outcome };
}

function billingOf(outcome: AssistantTurnOutcome) {
  assert.ok(outcome.billing, "the outcome carries billing");
  return outcome.billing;
}

// A model as the turn passes it to the chain's doStream (wrapLanguageModel
// returns a v4 model).
function v4(model: LanguageModel) {
  assert.ok(typeof model !== "string" && model.specificationVersion === "v4");
  return model as Extract<LanguageModel, { specificationVersion: "v4" }>;
}

async function drainCall(model: LanguageModel): Promise<Part[]> {
  const { stream } = await v4(model).doStream({ prompt: [{ content: [{ text: "oi", type: "text" }], role: "user" }] });
  const parts: Part[] = [];
  const reader = stream.getReader();
  for (;;) {
    const next = await reader.read();
    if (next.done) return parts;
    parts.push(next.value as Part);
  }
}

// ---------- parseAssistantChain ----------

describe("parseAssistantChain", () => {
  test("reads hub:model links in order, trimmed", () => {
    assert.deepEqual(parseAssistantChain(` gateway:${HAIKU} , gateway:${DEEPSEEK},gateway:${GLM}`), gatewayChain(HAIKU, DEEPSEEK, GLM));
    assert.deepEqual(parseAssistantChain("appliance:qwen3.8-27b"), [{ hub: "appliance", model: "qwen3.8-27b" }]);
    assert.deepEqual(parseAssistantChain(`appliance:qwen,gateway:${HAIKU}`), [
      { hub: "appliance", model: "qwen" },
      { hub: "gateway", model: HAIKU },
    ]);
    assert.equal(parseAssistantChain("gateway:a,gateway:b,gateway:c,gateway:d").length, 4);
    // The model id keeps any further colon.
    assert.deepEqual(parseAssistantChain("gateway:vendor/model:tag"), [{ hub: "gateway", model: "vendor/model:tag" }]);
  });

  const invalid: Array<[string, string]> = [
    ["", "empty"],
    ["   ", "empty"],
    ["gateway", "malformed_link"],
    ["gateway:", "malformed_link"],
    [":model", "malformed_link"],
    ["gateway:a b", "malformed_link"],
    ["gateway:a,", "malformed_link"],
    ["gateway:a,,gateway:b", "malformed_link"],
    ["openai:gpt-secret-model", "unknown_hub"],
    ["Gateway:a", "unknown_hub"],
    ["gateway:a,gateway:a", "duplicate_link"],
    ["gateway:a,gateway:b,gateway:c,gateway:d,gateway:e", "too_many_links"],
  ];
  for (const [csv, reason] of invalid) {
    test(`refuses ${JSON.stringify(csv)} (${reason}) without quoting it`, () => {
      assert.throws(
        () => parseAssistantChain(csv),
        (error: unknown) => {
          assert.ok(error instanceof AssistantChainConfigError);
          assert.equal(error.reason, reason);
          for (const value of ["secret", "qwen", "gpt", HAIKU]) assert.ok(!error.message.includes(value), error.message);
          return true;
        },
      );
    });
  }

  test("an appliance link parses in every environment: the provider is configuration, not the environment (A46)", () => {
    assert.equal(parseAssistantChain("appliance:qwen")[0].hub, "appliance");
    assert.equal(parseAssistantChain(`gateway:${HAIKU},appliance:qwen`)[1].hub, "appliance");
  });
});

// ---------- link switch ----------

describe("link switch before the first chunk", () => {
  const transient: Array<[string, Reply]> = [
    ["429", status(429, "rate_limit_exceeded")],
    ["503", status(503, "internal_server_error")],
    ["timeout", timeout],
    ["network error", network],
    ["200 with a body broken before any part", brokenBody],
    ["error part before any text", () => sse([{ type: "stream-start", warnings: [] }, { error: { message: "overloaded" }, type: "error" }])],
  ];
  for (const [name, reply] of transient) {
    test(`${name} on the first link: the second answers with fallback true and link 1`, async () => {
      const fake = fakeFetch({ [DEEPSEEK]: [answers("da reserva", { cost: "0.0001" })], [HAIKU]: [reply] });
      const attempts: AssistantChainAttempt[] = [];
      const { body, outcome } = await turn(chainModel({ chain: gatewayChain(HAIKU, DEEPSEEK), fetch: fake.fetch, onAttempt: (attempt) => attempts.push(attempt) }));
      assert.deepEqual(fake.calls.map((call) => call.model), [HAIKU, DEEPSEEK]);
      assert.equal(outcome.kind, "final");
      assert.equal(outcome.kind === "final" && outcome.text, "da reserva");
      const billing = billingOf(outcome);
      assert.equal(billing.fallback, true);
      assert.equal(billing.link, 1);
      assert.equal(billing.model, `gateway:${DEEPSEEK}`);
      assert.deepEqual(attempts.map((attempt) => attempt.outcome), ["transient", "answered"]);
      assert.ok(body.includes("da reserva"));
      assert.ok(!body.includes(GATEWAY_KEY) && !body.includes("upstream.test"));
    });
  }

  const final: Array<[string, Reply, "budget" | "fatal"]> = [
    ["401", status(401, "authentication_error"), "fatal"],
    ["400", status(400, "invalid_request_error"), "fatal"],
    ["403", status(403, "forbidden"), "fatal"],
    ["402", status(402, "insufficient_funds"), "budget"],
  ];
  for (const [name, reply, kind] of final) {
    test(`${name} on the first link: no second attempt`, async () => {
      const fake = fakeFetch({ [DEEPSEEK]: [answers("nunca")], [HAIKU]: [reply] });
      const attempts: AssistantChainAttempt[] = [];
      const { body, outcome } = await turn(chainModel({ chain: gatewayChain(HAIKU, DEEPSEEK), fetch: fake.fetch, onAttempt: (attempt) => attempts.push(attempt) }));
      assert.deepEqual(fake.calls.map((call) => call.model), [HAIKU]);
      assert.equal(outcome.kind, "error");
      assert.equal(outcome.kind === "error" && outcome.code, "ASSISTANT_STREAM_FAILED");
      assert.deepEqual(attempts.map((attempt) => attempt.outcome), [kind]);
      assert.ok(!body.includes(GATEWAY_KEY) && !body.includes("upstream.test"));
    });
  }

  test("an error after the first chunk reaches the turn and no other link is tried", async () => {
    const fake = fakeFetch({
      [DEEPSEEK]: [answers("nunca")],
      [HAIKU]: [() => sse([
        { type: "stream-start", warnings: [] },
        { id: "t1", type: "text-start" },
        { delta: "parcial", id: "t1", type: "text-delta" },
        { error: { message: `boom ${GATEWAY_KEY}` }, type: "error" },
      ])],
    });
    const { body, outcome } = await turn(chainModel({ chain: gatewayChain(HAIKU, DEEPSEEK), fetch: fake.fetch }));
    assert.deepEqual(fake.calls.map((call) => call.model), [HAIKU]);
    assert.equal(outcome.kind, "error");
    assert.equal(outcome.kind === "error" && outcome.code, "ASSISTANT_STREAM_FAILED");
    assert.ok(body.includes("parcial"), "the first chunk reached the client");
    assert.ok(body.includes("ASSISTANT_STREAM_FAILED"));
    assert.ok(!body.includes(GATEWAY_KEY));
  });

  test("a thrown stream failure after the first chunk is not switched either", async () => {
    const encoder = new TextEncoder();
    const fake = fakeFetch({
      [DEEPSEEK]: [answers("nunca")],
      [HAIKU]: [() => new Response(new ReadableStream({
        start(controller) {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "stream-start", warnings: [] })}\n\n`));
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ id: "t1", type: "text-start" })}\n\n`));
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ delta: "parcial", id: "t1", type: "text-delta" })}\n\n`));
          // The body breaks once the first chunk is out (an error right
          // away would drop the queued parts).
          setTimeout(() => controller.error(new TypeError("terminated")), 50);
        },
      }), { headers: { "content-type": "text/event-stream" } })],
    });
    const { body, outcome } = await turn(chainModel({ chain: gatewayChain(HAIKU, DEEPSEEK), fetch: fake.fetch }));
    assert.ok(body.includes("parcial"), "the first chunk reached the client before the failure");
    assert.deepEqual(fake.calls.map((call) => call.model), [HAIKU]);
    assert.equal(outcome.kind, "error");
    assert.equal(outcome.kind === "error" && outcome.code, "ASSISTANT_STREAM_FAILED");
  });

  test("the status table: 402 budget, other 4xx fatal, 408/429/5xx and broken or status-less failures transient", () => {
    const kinds = [200, 400, 401, 402, 403, 404, 408, 409, 422, 429, 500, 502, 503, 504].map((statusCode) => [statusCode, classifyAssistantChainError({ statusCode })]);
    assert.deepEqual(kinds, [
      [200, "transient"], [400, "fatal"], [401, "fatal"], [402, "budget"], [403, "fatal"], [404, "fatal"], [408, "transient"],
      [409, "fatal"], [422, "fatal"], [429, "transient"], [500, "transient"], [502, "transient"], [503, "transient"], [504, "transient"],
    ]);
    assert.equal(classifyAssistantChainError(new TypeError("fetch failed")), "transient");
    assert.equal(classifyAssistantChainError(Object.assign(new Error("t"), { name: "TimeoutError" })), "transient");
    assert.equal(classifyAssistantChainError({ statusCode: "401" }), "transient", "only a numeric status counts");
  });

  test("every link failing transiently ends the call as unavailable", async () => {
    const fake = fakeFetch({ [DEEPSEEK]: [status(503, "internal_server_error")], [HAIKU]: [status(429, "rate_limit_exceeded")] });
    await assert.rejects(drainCall(chainModel({ chain: gatewayChain(HAIKU, DEEPSEEK), fetch: fake.fetch })), (error: unknown) => {
      assert.ok(error instanceof AssistantChainError);
      assert.equal(error.failure, "unavailable");
      assert.equal(error.cause, undefined);
      assert.ok(!error.message.includes(GATEWAY_KEY) && !error.message.includes("upstream.test"));
      return true;
    });
    assert.deepEqual(fake.calls.map((call) => call.model), [HAIKU, DEEPSEEK]);
  });

  test("a fatal error carries only its status, never the provider's error", async () => {
    const fake = fakeFetch({ [HAIKU]: [status(401, "authentication_error")] });
    await assert.rejects(drainCall(chainModel({ chain: gatewayChain(HAIKU), fetch: fake.fetch })), (error: unknown) => {
      assert.ok(error instanceof AssistantChainError);
      assert.equal(error.failure, "fatal");
      assert.equal(error.statusCode, 401);
      assert.equal(error.cause, undefined);
      assert.ok(!JSON.stringify({ message: error.message, stack: error.stack }).includes(GATEWAY_KEY));
      return true;
    });
  });

  test("the caller's abort is rethrown and is not a breaker failure", async () => {
    const controller = new AbortController();
    const breaker = createAssistantCircuitBreaker();
    const fake = fakeFetch({
      [DEEPSEEK]: [answers("nunca")],
      [HAIKU]: [(call) => {
        controller.abort(new Error("client left"));
        throw Object.assign(new Error("aborted"), { name: "AbortError" });
      }],
    });
    const model = v4(chainModel({ breaker, chain: gatewayChain(HAIKU, DEEPSEEK), fetch: fake.fetch }));
    for (let round = 0; round < 3; round++) {
      await assert.rejects(model.doStream({ abortSignal: controller.signal, prompt: [{ content: [{ text: "oi", type: "text" }], role: "user" }] }));
    }
    assert.deepEqual(fake.calls.map((call) => call.model), [HAIKU]);
    assert.equal(breaker.isOpen({ hub: "gateway", model: HAIKU }), false);
  });

  test("an appliance link fails over to the gateway in development, with enable_thinking false", async () => {
    const fake = fakeFetch({ [HAIKU]: [answers("do gateway", { cost: "0.00002" })], qwen: [status(503, "unavailable")] });
    const { outcome } = await turn(chainModel({
      appliance: true,
      chain: [{ hub: "appliance", model: "qwen" }, { hub: "gateway", model: HAIKU }],
      fetch: fake.fetch,
    }));
    assert.deepEqual(fake.calls.map((call) => call.model), ["qwen", HAIKU]);
    const applianceCall = fake.calls[0];
    assert.equal(applianceCall.url, `${APPLIANCE_URL}/chat/completions`);
    assert.deepEqual(applianceCall.body.chat_template_kwargs, { enable_thinking: false });
    assert.equal(applianceCall.headers.get("x-conversation-id"), "thread-1");
    assert.equal(applianceCall.headers.get("authorization"), `Bearer ${APPLIANCE_KEY}`);
    assert.equal(fake.calls[1].headers.get("authorization"), `Bearer ${GATEWAY_KEY}`);
    const billing = billingOf(outcome);
    assert.deepEqual([billing.fallback, billing.link, billing.model, billing.costSource, billing.costUsdMicros], [true, 1, `gateway:${HAIKU}`, "gateway", 20]);
  });

  test("a chain link without its hub configuration is a configuration error", () => {
    assert.throws(
      () => assistantChainModel({ appliance: null, breaker: createAssistantCircuitBreaker(), chain: [{ hub: "appliance", model: "qwen" }], gateway: { apiKey: GATEWAY_KEY } }),
      (error: unknown) => error instanceof AssistantChainConfigError && error.reason === "missing_hub_config",
    );
    assert.throws(
      () => assistantChainModel({ appliance: null, breaker: createAssistantCircuitBreaker(), chain: gatewayChain(HAIKU), gateway: null }),
      (error: unknown) => error instanceof AssistantChainConfigError && error.reason === "missing_hub_config",
    );
  });
});

// ---------- what commits a link ----------

describe("only text or a tool chunk commits a link", () => {
  const unavailable = { error: { message: "temporary provider failure", statusCode: 503 }, type: "error" };
  const start = { type: "stream-start", warnings: [] };

  test("a source before any text, then 503: the second link answers and the dropped source never reaches the turn", async () => {
    const source = { id: "src1", sourceType: "url", title: "Reference", type: "source", url: "https://dropped.example/reference" };
    const replies = () => ({ [DEEPSEEK]: [answers("Recovered")], [HAIKU]: [() => sse([start, source, unavailable])] });

    const fake = fakeFetch(replies());
    const { body, outcome } = await turn(chainModel({ chain: gatewayChain(HAIKU, DEEPSEEK), fetch: fake.fetch }));
    assert.deepEqual(fake.calls.map((call) => call.model), [HAIKU, DEEPSEEK]);
    assert.equal(outcome.kind, "final");
    assert.equal(outcome.kind === "final" && outcome.text, "Recovered");
    assert.equal(billingOf(outcome).link, 1);
    assert.ok(!body.includes("dropped.example"));

    // What the turn reads from the chain: only the second link's parts.
    const direct = fakeFetch(replies());
    const parts = await drainCall(chainModel({ chain: gatewayChain(HAIKU, DEEPSEEK), fetch: direct.fetch }));
    assert.deepEqual(direct.calls.map((call) => call.model), [HAIKU, DEEPSEEK]);
    assert.ok(!JSON.stringify(parts).includes("dropped.example"), JSON.stringify(parts));
    assert.deepEqual(parts.map((part) => part.type), ["stream-start", "text-start", "text-delta", "text-end", "finish"]);
  });

  // Every part that is not text or a tool chunk is held: a 503 after it
  // still moves to the next link, and the held part goes with the link.
  const held: Array<[string, Part[]]> = [
    ["source", [{ id: "s", sourceType: "url", type: "source", url: "https://dropped.example/s" }]],
    ["file", [{ data: { data: "ZHJvcHBlZA==", type: "data" }, mediaType: "text/plain", type: "file" }]],
    ["custom", [{ kind: "dropped.custom", type: "custom" }]],
    ["response-metadata", [{ id: "dropped-response", type: "response-metadata" }]],
    ["reasoning", [{ id: "r", type: "reasoning-start" }, { delta: "dropped reasoning", id: "r", type: "reasoning-delta" }, { id: "r", type: "reasoning-end" }]],
    ["reasoning-file", [{ data: { data: "ZHJvcHBlZA==", type: "data" }, mediaType: "image/png", type: "reasoning-file" }]],
    ["text-start without a delta", [{ id: "dropped-text", type: "text-start" }]],
    ["text-start and text-end without a delta", [{ id: "dropped-text", type: "text-start" }, { id: "dropped-text", type: "text-end" }]],
  ];
  for (const [name, parts] of held) {
    test(`${name} before any text, then 503: the next link answers and the held part is dropped`, async () => {
      const fake = fakeFetch({ [DEEPSEEK]: [answers("Recovered")], [HAIKU]: [() => sse([start, ...parts, unavailable])] });
      const out = await drainCall(chainModel({ chain: gatewayChain(HAIKU, DEEPSEEK), fetch: fake.fetch }));
      assert.deepEqual(fake.calls.map((call) => call.model), [HAIKU, DEEPSEEK]);
      assert.ok(!JSON.stringify(out).includes("dropped"), JSON.stringify(out));
      assert.equal(out.find((part) => part.type === "text-delta")?.delta, "Recovered");
    });
  }

  // The text and tool chunks commit: a 503 after them reaches the turn and
  // no other link is tried.
  const committing: Array<[string, Part[]]> = [
    ["text-delta", [{ id: "t", type: "text-start" }, { delta: "parcial", id: "t", type: "text-delta" }]],
    ["tool-input-start", [{ id: "tool1", toolName: "lookup", type: "tool-input-start" }]],
    ["tool-call", [{ input: "{}", toolCallId: "c1", toolName: "lookup", type: "tool-call" }]],
    ["tool-result", [{ result: { ok: true }, toolCallId: "c1", toolName: "web_search", type: "tool-result" }]],
    ["tool-approval-request", [{ approvalId: "a1", toolCallId: "c1", type: "tool-approval-request" }]],
  ];
  for (const [name, parts] of committing) {
    test(`a first ${name}, then 503: the link is committed and there is no fallback`, async () => {
      const fake = fakeFetch({ [DEEPSEEK]: [answers("must not run")], [HAIKU]: [() => sse([...parts, unavailable])] });
      const out = await drainCall(chainModel({ chain: gatewayChain(HAIKU, DEEPSEEK), fetch: fake.fetch }));
      assert.deepEqual(fake.calls.map((call) => call.model), [HAIKU]);
      assert.deepEqual(out.map((part) => part.type), [...parts.map((part) => part.type), "error"]);
    });
  }

  test("held parts of the committed link reach the turn in order once the text arrives", async () => {
    const source = { id: "s", sourceType: "url", type: "source", url: "https://kept.example/s" };
    const fake = fakeFetch({
      [HAIKU]: [() => sse([start, { id: "r", type: "reasoning-start" }, source, ...gatewayAnswer("ok").slice(1)])],
    });
    const out = await drainCall(chainModel({ chain: gatewayChain(HAIKU, DEEPSEEK), fetch: fake.fetch }));
    assert.deepEqual(fake.calls.map((call) => call.model), [HAIKU]);
    assert.deepEqual(out.map((part) => part.type), ["stream-start", "reasoning-start", "source", "text-start", "text-delta", "text-end", "finish"]);
  });

  test("a finish with no content is a valid empty answer: no fallback, and the turn calls it a missing final", async () => {
    const source = { id: "s", sourceType: "url", type: "source", url: "https://kept.example/s" };
    const finish = gatewayAnswer("").at(-1)!;
    const fake = fakeFetch({ [DEEPSEEK]: [answers("must not run")], [HAIKU]: [() => sse([start, source, finish])] });
    const { outcome } = await turn(chainModel({ chain: gatewayChain(HAIKU, DEEPSEEK), fetch: fake.fetch }));
    assert.deepEqual(fake.calls.map((call) => call.model), [HAIKU]);
    assert.equal(outcome.kind, "error");
    assert.equal(outcome.kind === "error" && outcome.code, "ASSISTANT_TURN_INCOMPLETE");
    assert.equal(billingOf(outcome).link, 0);
  });
});

// ---------- circuit breaker ----------

describe("circuit breaker", () => {
  const link = { hub: "gateway", model: HAIKU } as const;

  test("3 failures within 60 s open the link for 120 s, then it closes", () => {
    let now = 1_000_000;
    const breaker = createAssistantCircuitBreaker({ now: () => now });
    breaker.recordFailure(link);
    now += 30_000;
    breaker.recordFailure(link);
    assert.equal(breaker.isOpen(link), false);
    now += 29_999;
    breaker.recordFailure(link);
    assert.equal(breaker.isOpen(link), true);
    now += ASSISTANT_BREAKER_OPEN_MS - 1;
    assert.equal(breaker.isOpen(link), true);
    now += 1;
    assert.equal(breaker.isOpen(link), false);
    // Closed again with a clean count: one failure does not reopen it.
    breaker.recordFailure(link);
    assert.equal(breaker.isOpen(link), false);
  });

  test("failures spread over more than 60 s do not open the link", () => {
    let now = 0;
    const breaker = createAssistantCircuitBreaker({ now: () => now });
    breaker.recordFailure(link);
    now += 30_000;
    breaker.recordFailure(link);
    now += 30_000; // the first failure is 60 s old
    breaker.recordFailure(link);
    assert.equal(breaker.isOpen(link), false);
  });

  test("the breaker is per link", () => {
    const breaker = createAssistantCircuitBreaker({ now: () => 0 });
    for (let index = 0; index < 3; index++) breaker.recordFailure(link);
    assert.equal(breaker.isOpen(link), true);
    assert.equal(breaker.isOpen({ hub: "gateway", model: DEEPSEEK }), false);
    assert.equal(assistantChainOpen(gatewayChain(HAIKU), breaker), true);
    assert.equal(assistantChainOpen(gatewayChain(HAIKU, DEEPSEEK), breaker), false);
  });

  test("through the chain: an open link is skipped for 120 s and tried again after", async () => {
    let now = 5_000_000;
    const breaker = createAssistantCircuitBreaker({ now: () => now });
    const fake = fakeFetch({ [DEEPSEEK]: [answers("reserva")], [HAIKU]: [status(429, "rate_limit_exceeded")] });
    const attempts: AssistantChainAttempt[] = [];
    const model = chainModel({ breaker, chain: gatewayChain(HAIKU, DEEPSEEK), fetch: fake.fetch, onAttempt: (attempt) => attempts.push(attempt) });
    for (let round = 0; round < 3; round++) {
      await drainCall(model);
      now += 10_000;
    }
    assert.deepEqual(fake.calls.map((call) => call.model), [HAIKU, DEEPSEEK, HAIKU, DEEPSEEK, HAIKU, DEEPSEEK]);
    assert.equal(breaker.isOpen({ hub: "gateway", model: HAIKU }), true);
    fake.calls.length = 0;
    attempts.length = 0;
    await drainCall(model);
    assert.deepEqual(fake.calls.map((call) => call.model), [DEEPSEEK]);
    assert.deepEqual(attempts.map((attempt) => [attempt.link, attempt.outcome]), [[0, "skipped"], [1, "answered"]]);
    now += ASSISTANT_BREAKER_OPEN_MS;
    fake.calls.length = 0;
    await drainCall(model);
    assert.deepEqual(fake.calls.map((call) => call.model), [HAIKU, DEEPSEEK]);
  });

  test("with every link open the call is unavailable without a request", async () => {
    const breaker = createAssistantCircuitBreaker({ now: () => 0 });
    for (const model of [HAIKU, DEEPSEEK]) for (let index = 0; index < 3; index++) breaker.recordFailure({ hub: "gateway", model });
    const fake = fakeFetch({ [DEEPSEEK]: [answers("nunca")], [HAIKU]: [answers("nunca")] });
    await assert.rejects(
      drainCall(chainModel({ breaker, chain: gatewayChain(HAIKU, DEEPSEEK), fetch: fake.fetch })),
      (error: unknown) => error instanceof AssistantChainError && error.failure === "unavailable" && error.message === "assistant_unavailable",
    );
    assert.equal(fake.calls.length, 0);
  });

  test("a transient failure after the first chunk counts against the link", async () => {
    const breaker = createAssistantCircuitBreaker({ now: () => 0 });
    const fake = fakeFetch({
      [HAIKU]: [() => sse([
        { id: "t1", type: "text-start" },
        { delta: "parcial", id: "t1", type: "text-delta" },
        { error: { message: "dropped" }, type: "error" },
      ])],
    });
    const model = chainModel({ breaker, chain: gatewayChain(HAIKU), fetch: fake.fetch });
    for (let round = 0; round < 3; round++) await drainCall(model);
    assert.equal(breaker.isOpen({ hub: "gateway", model: HAIKU }), true);
  });
});

// ---------- gateway options ----------

describe("gateway options on each call", () => {
  test("disallowPromptTraining, caching and sessionId go in every call, never only nor order", async () => {
    const fake = fakeFetch({ [DEEPSEEK]: [answers("ok")], [HAIKU]: [status(503, "internal_server_error")] });
    // A caller trying to pin providers is overridden by the chain's options.
    await turn(chainModel({ chain: gatewayChain(HAIKU, DEEPSEEK), fetch: fake.fetch }), { gateway: { only: ["anthropic"], order: ["bedrock"] } });
    assert.equal(fake.calls.length, 2);
    for (const call of fake.calls) {
      assert.equal(call.url, "https://ai-gateway.vercel.sh/v4/ai/language-model");
      assert.deepEqual(call.body.providerOptions, {
        gateway: { caching: "auto", disallowPromptTraining: true, sessionId: "thread-1" },
      });
      assert.ok(!JSON.stringify(call.body).includes('"only"'));
      assert.ok(!JSON.stringify(call.body).includes('"order"'));
    }
  });

  test("zeroDataRetention goes only when the env turns it on", async () => {
    const fake = fakeFetch({ [HAIKU]: [answers("ok")] });
    await turn(chainModel({ chain: gatewayChain(HAIKU), fetch: fake.fetch, zeroDataRetention: true }));
    assert.deepEqual(fake.calls[0].body.providerOptions, {
      gateway: { caching: "auto", disallowPromptTraining: true, sessionId: "thread-1", zeroDataRetention: true },
    });
  });

  test("the options go in each step of a multi-step turn", async () => {
    let call = 0;
    const fake = fakeFetch({
      [HAIKU]: [() => {
        call += 1;
        if (call === 1) {
          return sse([
            { type: "stream-start", warnings: [] },
            { input: "{}", toolCallId: "c1", toolName: "lookup", type: "tool-call" },
            { finishReason: { raw: "tool_calls", unified: "tool-calls" }, providerMetadata: { gateway: { cost: "0.000002" } }, type: "finish", usage: gatewayUsage(4, 2) },
          ]);
        }
        return sse(gatewayAnswer("pronto", { cost: "0.000003", input: 6, output: 3 }));
      }],
    });
    const { jsonSchema, tool } = await import("ai");
    const { outcome } = runAssistantTurn({
      history: [{ role: "user", text: "oi" }],
      model: chainModel({ chain: gatewayChain(HAIKU), fetch: fake.fetch }),
      system: "system",
      thread: { id: "thread-1", title: "T" },
      tools: { lookup: tool({ execute: async () => ({ ok: true }), inputSchema: jsonSchema({ properties: {}, type: "object" }) }) },
    });
    const result = await outcome;
    assert.equal(fake.calls.length, 2);
    for (const each of fake.calls) {
      assert.deepEqual(each.body.providerOptions, { gateway: { caching: "auto", disallowPromptTraining: true, sessionId: "thread-1" } });
    }
    const billing = billingOf(result);
    assert.equal(billing.costSource, "gateway");
    assert.equal(billing.costUsdMicros, 5);
    assert.deepEqual(billing.usage, { inputTokens: 10, outputTokens: 5, totalTokens: 15 });
  });
});

// ---------- cost ----------

describe("cost", () => {
  test("usdToMicrosCeil rounds up exact decimals and refuses anything else", () => {
    assert.equal(usdToMicrosCeil("0.0045405"), 4541);
    assert.equal(usdToMicrosCeil("0"), 0);
    assert.equal(usdToMicrosCeil("0.000001"), 1);
    assert.equal(usdToMicrosCeil("0.0000010000000000000001"), 2);
    assert.equal(usdToMicrosCeil("0.0000000001"), 1);
    assert.equal(usdToMicrosCeil("1"), 1_000_000);
    assert.equal(usdToMicrosCeil("12.5"), 12_500_000);
    for (const bad of ["", "-1", "1e-7", "abc", " 1", "1.", ".5", "0x10", "NaN"]) assert.equal(usdToMicrosCeil(bad), null, bad);
  });

  test("from providerMetadata.gateway.cost: \"0.0045405\" is 4541 micros", async () => {
    const fake = fakeFetch({ [HAIKU]: [answers("ok", { cost: "0.0045405" })] });
    const { outcome } = await turn(chainModel({ chain: gatewayChain(HAIKU), fetch: fake.fetch }));
    const billing = billingOf(outcome);
    assert.deepEqual(
      { costSource: billing.costSource, costUsdMicros: billing.costUsdMicros, fallback: billing.fallback, link: billing.link, model: billing.model },
      { costSource: "gateway", costUsdMicros: 4541, fallback: false, link: 0, model: `gateway:${HAIKU}` },
    );
    assert.deepEqual(billing.usage, { inputTokens: 10, outputTokens: 5, totalTokens: 15 });
  });

  test("BYOK: cost is 0 and the real cost is the marketCost, rounded up", async () => {
    // The 2026-10-17 live shape: anthropic/claude-haiku-5.5, credentialType "byok".
    const fake = fakeFetch({ [HAIKU]: [answers("ok", { cost: "0", marketCost: "0.0000035" })] });
    const { outcome } = await turn(chainModel({ chain: gatewayChain(HAIKU), fetch: fake.fetch }));
    const billing = billingOf(outcome);
    assert.deepEqual(
      { costSource: billing.costSource, costUsdMicros: billing.costUsdMicros, fallback: billing.fallback, link: billing.link, model: billing.model },
      // 0.0000035 USD = 3.5 micros, rounded up to 4; not the 0 of cost.
      { costSource: "gateway", costUsdMicros: 4, fallback: false, link: 0, model: `gateway:${HAIKU}` },
    );
  });

  test("system credential: cost and marketCost equal give the same result as the cost alone", async () => {
    // The 2026-10-17 live shape: credentialType "system", all three equal.
    const fake = fakeFetch({ [HAIKU]: [answers("ok", { cost: "0.0000264", marketCost: "0.0000264" })] });
    const { outcome } = await turn(chainModel({ chain: gatewayChain(HAIKU), fetch: fake.fetch }));
    const billing = billingOf(outcome);
    assert.deepEqual([billing.costSource, billing.costUsdMicros], ["gateway", 27], "0.0000264 USD = 26.4 micros, rounded up to 27");
  });

  test("with a malformed marketCost the cost is used; with a malformed cost the marketCost is used", async () => {
    const costWins = fakeFetch({ [HAIKU]: [answers("ok", { cost: "0.000005", marketCost: "n/a" })] });
    const { outcome: costOutcome } = await turn(chainModel({ chain: gatewayChain(HAIKU), fetch: costWins.fetch }));
    const billingCost = billingOf(costOutcome);
    assert.deepEqual([billingCost.costSource, billingCost.costUsdMicros], ["gateway", 5]);
    const marketWins = fakeFetch({ [HAIKU]: [answers("ok", { cost: "-0.1", marketCost: "0.000005" })] });
    const { outcome: marketOutcome } = await turn(chainModel({ chain: gatewayChain(HAIKU), fetch: marketWins.fetch }));
    const billingMarket = billingOf(marketOutcome);
    assert.deepEqual([billingMarket.costSource, billingMarket.costUsdMicros], ["gateway", 5]);
  });

  test("a numeric marketCost is not a decimal string and does not shadow the cost", async () => {
    const fake = fakeFetch({ [HAIKU]: [answers("ok", { cost: "0.000002", marketCost: 0.0000035 })] });
    const { outcome } = await turn(chainModel({ chain: gatewayChain(HAIKU), fetch: fake.fetch }));
    const billing = billingOf(outcome);
    assert.deepEqual([billing.costSource, billing.costUsdMicros], ["gateway", 2]);
  });

  test("with both figures malformed the worst-case table is used", async () => {
    const fake = fakeFetch({ [HAIKU]: [answers("ok", { cost: "-0.1", marketCost: "n/a", input: 1000, output: 200 })] });
    const { outcome } = await turn(chainModel({ chain: gatewayChain(HAIKU), fetch: fake.fetch }));
    const billing = billingOf(outcome);
    // 1000 × 0.00000055 + 200 × 0.00000275 = 0.0011 USD = 1100 micros
    assert.deepEqual([billing.costSource, billing.costUsdMicros], ["table", 1100]);
  });

  for (const [name, cost] of [["without metadata", undefined], ["with a malformed cost", "-0.1"], ["with a numeric cost", 0.0045]] as const) {
    test(`${name}: the worst-case table, costSource "table"`, async () => {
      const fake = fakeFetch({ [HAIKU]: [answers("ok", { ...(cost === undefined ? {} : { cost }), input: 1000, output: 200 })] });
      const { outcome } = await turn(chainModel({ chain: gatewayChain(HAIKU), fetch: fake.fetch }));
      const billing = billingOf(outcome);
      // 1000 × 0.00000055 + 200 × 0.00000275 = 0.0011 USD = 1100 micros
      assert.deepEqual([billing.costSource, billing.costUsdMicros], ["table", 1100]);
    });
  }

  test("the table charges cache reads and writes at their own prices", () => {
    const usage = (total: number, read: number, write: number, output: number) => ({
      inputTokens: { cacheRead: read, cacheWrite: write, total },
      outputTokens: { total: output },
    });
    // haiku: 600 plain × 0.55 + 300 read × 0.055 + 100 write × 0.6875 + 50 × 2.75 (micros per token)
    assert.equal(assistantTableCostMicros(HAIKU, usage(1000, 300, 100, 50)), Math.ceil(330 + 16.5 + 68.75 + 137.5));
    // deepseek has no cache-write price: writes at the input price
    assert.equal(assistantTableCostMicros(DEEPSEEK, usage(1000, 0, 1000, 0)), 600);
    assert.equal(assistantTableCostMicros(GLM, usage(10, 0, 0, 10)), Math.ceil(1.5 + 5));
    assert.equal(assistantTableCostMicros("vendor/unknown", usage(10, 0, 0, 10)), null);
    assert.equal(assistantTableCostMicros("toString", usage(10, 0, 0, 10)), null);
  });

  test("the table holds the three chain models at the 2026-10-17 worst case", () => {
    assert.deepEqual(Object.keys(ASSISTANT_MODEL_PRICES).sort(), [HAIKU, DEEPSEEK, GLM].sort());
    for (const price of Object.values(ASSISTANT_MODEL_PRICES)) assert.equal(price.effectiveFrom, "2026-10-17");
  });

  test("a missing final (ASSISTANT_TURN_INCOMPLETE) still carries the billing of what ran", async () => {
    const fake = fakeFetch({ [HAIKU]: [answers("Vou verificar.", { cost: "0.0000021" })] });
    const { outcome } = await turn(chainModel({ chain: gatewayChain(HAIKU), fetch: fake.fetch }));
    assert.equal(outcome.kind, "error");
    assert.equal(outcome.kind === "error" && outcome.code, "ASSISTANT_TURN_INCOMPLETE");
    const billing = billingOf(outcome);
    assert.deepEqual([billing.costSource, billing.costUsdMicros, billing.link], ["gateway", 3, 0]);
  });

  test("a gateway model outside the table without metadata has no cost", async () => {
    const fake = fakeFetch({ "vendor/unknown": [answers("ok")] });
    const { outcome } = await turn(chainModel({ chain: gatewayChain("vendor/unknown"), fetch: fake.fetch }));
    const billing = billingOf(outcome);
    assert.deepEqual([billing.costSource, billing.costUsdMicros], ["none", null]);
  });

  test("the appliance costs 0", async () => {
    const fake = fakeFetch({ qwen: [applianceAnswer("local")] });
    const { outcome } = await turn(chainModel({ appliance: true, chain: [{ hub: "appliance", model: "qwen" }], fetch: fake.fetch }));
    const billing = billingOf(outcome);
    assert.deepEqual(
      [billing.costSource, billing.costUsdMicros, billing.fallback, billing.link, billing.model],
      ["appliance", 0, false, 0, "appliance:qwen"],
    );
    assert.deepEqual(billing.usage, { inputTokens: 7, outputTokens: 4, totalTokens: 11 });
  });

  test("assistantTurnBilling adds the steps up and keeps the least reliable source", () => {
    const step = (link: number, costSource: string, costUsdMicros: number | null) => ({
      providerMetadata: { [ASSISTANT_CHAIN_METADATA_KEY]: { costSource, costUsdMicros, fallback: link > 0, link, model: `gateway:m${link}` } },
    });
    const usage = { inputTokens: 1, outputTokens: 2, totalTokens: 3 };
    assert.equal(assistantTurnBilling([{}, { providerMetadata: { gateway: { cost: "1" } } }], usage), undefined);
    assert.deepEqual(assistantTurnBilling([step(1, "gateway", 10), step(0, "table", 5)], usage), {
      costSource: "table", costUsdMicros: 15, fallback: true, link: 0, model: "gateway:m0", usage,
    });
    assert.deepEqual(assistantTurnBilling([step(0, "none", null), step(0, "gateway", 5)], usage), {
      costSource: "none", costUsdMicros: null, fallback: false, link: 0, model: "gateway:m0", usage,
    });
    // A malformed chain entry is ignored, not trusted.
    assert.equal(assistantTurnBilling([{ providerMetadata: { [ASSISTANT_CHAIN_METADATA_KEY]: { costSource: "free", link: 0 } } }], usage), undefined);
  });
});

// ---------- the client stream ----------

describe("client stream", () => {
  test("the chain does not change what the client receives", async () => {
    const parts = gatewayAnswer("mesma resposta", { cost: "0.0045405" });
    const fake = fakeFetch({ [HAIKU]: [() => sse(parts)] });
    const viaChain = await turn(chainModel({ chain: gatewayChain(HAIKU), fetch: fake.fetch }));
    const plain = await turn(new MockLanguageModelV4({
      doStream: (async () => ({
        stream: new ReadableStream({
          start(controller) {
            for (const part of parts) controller.enqueue(part);
            controller.close();
          },
        }),
      })) as unknown as MockLanguageModelV4["doStream"],
    }));
    // The UI stream's message id is random per turn; everything else matches.
    const sameIds = (body: string) => body.replace(/"messageId":"[^"]+"/g, '"messageId":"id"');
    assert.equal(sameIds(viaChain.body), sameIds(plain.body));
    assert.ok(!viaChain.body.includes(ASSISTANT_CHAIN_METADATA_KEY));
    assert.ok(viaChain.outcome.billing);
    assert.equal(plain.outcome.billing, undefined);
  });
});
