import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { LanguageModel, ToolSet } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import type { AssistantToolHost, AssistantTurnOutcome } from "./tools";
import { buildAssistantToolSet } from "./tools";
import {
  ASSISTANT_MAX_STEPS,
  buildTurnWindow,
  classifyTurnOutcome,
  runAssistantTurn,
  type AssistantHistoryEntry,
} from "./turn";

// ---------- mock model helpers ----------

type ModelPart = { [key: string]: unknown };

function modelStream(parts: ModelPart[]): ReadableStream<unknown> {
  let index = 0;
  return new ReadableStream({
    pull(controller) {
      if (index < parts.length) {
        controller.enqueue(parts[index++]);
      } else {
        controller.close();
      }
    },
  });
}

// The mock part vocabulary is the v4 stream-part shape; the cast is only at
// this boundary (ai/test types the stream with the provider's part union).
function mockModel(doStream: () => { stream: ReadableStream<unknown> }): LanguageModel {
  return new MockLanguageModelV4({
    doStream: doStream as unknown as MockLanguageModelV4["doStream"],
    modelId: "mock",
  });
}

const usage = (inputTokens: number, outputTokens: number) => ({
  inputTokens: { cacheRead: undefined, cacheWrite: undefined, noCache: undefined, total: inputTokens },
  outputTokens: { reasoning: undefined, text: undefined, total: outputTokens },
});
const finish = (unified: "stop" | "tool-calls", inputTokens = 3, outputTokens = 5) => ({
  finishReason: { raw: unified, unified },
  type: "finish",
  usage: usage(inputTokens, outputTokens),
});
const textParts = (delta: string) => [
  { id: "t1", type: "text-start" },
  { delta, id: "t1", type: "text-delta" },
  { id: "t1", type: "text-end" },
];
const toolCallPart = (toolCallId: string) => ({
  input: JSON.stringify({ limit: 1 }),
  toolCallId,
  toolName: "pinar_list_sessions",
  type: "tool-call",
});

function textModel(text: string): LanguageModel {
  return mockModel(() => ({ stream: modelStream([...textParts(text), finish("stop")]) }));
}

// Emits each part after a delay, so the turn outlives a client that cancels
// after the first chunk.
function slowPartsStream(parts: ModelPart[], delayMs: number): ReadableStream<unknown> {
  let index = 0;
  return new ReadableStream({
    async pull(controller) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      if (index < parts.length) controller.enqueue(parts[index++]);
      else controller.close();
    },
  });
}

// ---------- response helpers ----------

async function readSse(response: Response): Promise<string> {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let body = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    body += decoder.decode(value, { stream: true });
  }
  return body;
}

function sseDataParts(body: string): unknown[] {
  return body
    .split("\n")
    .filter((line) => line.startsWith("data: ") && line.slice(6) !== "[DONE]")
    .map((line) => JSON.parse(line.slice(6)));
}

const THREAD = { id: "ath_test000000000000000000", title: "Quantas sessões?" };

// ---------- 1: text response ----------

test("text response: the stream starts with data-thread, then text; outcome is final", async () => {
  const { outcome, response } = runAssistantTurn({
    history: [{ role: "user", text: "quantas sessões?" }],
    model: textModel("Você tem 2 sessões."),
    system: "sys",
    thread: THREAD,
    tools: {},
  });
  const body = await readSse(response);
  const parts = sseDataParts(body);
  assert.deepEqual(parts[0], { data: THREAD, type: "data-thread" });
  assert.ok(body.includes("Você tem 2 sessões."), "the text must reach the stream");
  assert.deepEqual(await outcome, {
    kind: "final",
    steps: 1,
    text: "Você tem 2 sessões.",
    usage: { inputTokens: 3, outputTokens: 5, totalTokens: 8 },
  });
});

// ---------- 2: tool call then text ----------

test("tool call then text: the host receives the MCP name; outcome is final with steps: 2", async () => {
  const calls: { args: Record<string, unknown>; name: string }[] = [];
  const host: AssistantToolHost = {
    callTool: async (name, args) => {
      calls.push({ args, name });
      return { sessions: ["S1"] };
    },
  };
  const tools = buildAssistantToolSet({ host, kinds: ["read"], surface: "local" });
  let step = 0;
  const model = mockModel(() => {
    step += 1;
    if (step === 1) return { stream: modelStream([toolCallPart("tc1"), finish("tool-calls", 3, 2)]) };
    return { stream: modelStream([...textParts("Existe 1 sessão: 'S1'."), finish("stop", 4, 6)]) };
  });
  const { outcome, response } = runAssistantTurn({
    history: [{ role: "user", text: "quantas sessões?" }],
    model,
    system: "sys",
    thread: THREAD,
    tools,
  });
  const body = await readSse(response);
  assert.ok(body.includes("Existe 1 sessão: 'S1'."));
  assert.equal(calls.length, 1);
  assert.equal(calls[0].name, "pinar.list_sessions", "the host must receive the MCP name, not the LLM name");
  assert.deepEqual(calls[0].args, { limit: 1 });
  const result = (await outcome) as Extract<AssistantTurnOutcome, { kind: "final" }>;
  assert.equal(result.kind, "final");
  assert.equal(result.steps, 2);
  assert.deepEqual(result.usage, { inputTokens: 7, outputTokens: 8, totalTokens: 15 });
});

// ---------- 3: tool calls only until the step cap ----------

test("a model that only calls tools until the cap gives ASSISTANT_TURN_INCOMPLETE", async () => {
  const tools: ToolSet = buildAssistantToolSet({
    host: { callTool: async () => "ok" },
    kinds: ["read"],
    surface: "local",
  });
  let modelCalls = 0;
  const model = mockModel(() => {
    modelCalls += 1;
    return { stream: modelStream([toolCallPart(`tc${modelCalls}`), finish("tool-calls", 3, 5)]) };
  });
  const { outcome, response } = runAssistantTurn({
    history: [{ role: "user", text: "?" }],
    maxSteps: 3,
    model,
    system: "sys",
    thread: THREAD,
    tools,
  });
  const body = await readSse(response);
  assert.ok(body.length > 0);
  assert.equal(modelCalls, 3, "the model must be called exactly up to the cap");
  assert.deepEqual(await outcome, {
    code: "ASSISTANT_TURN_INCOMPLETE",
    kind: "error",
    steps: 3,
    usage: { inputTokens: 9, outputTokens: 15, totalTokens: 24 },
  });
});

// ---------- 4: timeout ----------

test("a model slower than timeoutMs (50 ms in the test) gives ASSISTANT_TURN_TIMEOUT", async () => {
  const model = mockModel(() => ({
    stream: new ReadableStream<unknown>({
      start(controller) {
        controller.enqueue({ id: "t1", type: "text-start" });
        // and then nothing: the turn outlives the 50 ms budget
      },
    }),
  }));
  const { outcome, response } = runAssistantTurn({
    history: [{ role: "user", text: "?" }],
    model,
    system: "sys",
    thread: THREAD,
    timeoutMs: 50,
    tools: {},
  });
  await readSse(response);
  assert.deepEqual(await outcome, {
    code: "ASSISTANT_TURN_TIMEOUT",
    kind: "error",
    steps: 0,
    usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
  });
});

// ---------- 5: provider error ----------

test("a provider error surfaces exactly ASSISTANT_STREAM_FAILED, never the secret", async () => {
  const model = mockModel(() => ({
    stream: new ReadableStream<unknown>({
      start(controller) {
        controller.enqueue({ id: "t1", type: "text-start" });
        controller.enqueue({ delta: "parcial ", id: "t1", type: "text-delta" });
        controller.error(new Error("chave sk-SEGREDO vazou"));
      },
    }),
  }));
  const { outcome, response } = runAssistantTurn({
    history: [{ role: "user", text: "?" }],
    model,
    system: "sys",
    thread: THREAD,
    tools: {},
  });
  const body = await readSse(response);
  const errorParts = sseDataParts(body).filter((part) => (part as { type?: string }).type === "error");
  assert.equal(errorParts.length, 1, "the stream must carry one error part");
  assert.deepEqual(errorParts[0], { errorText: "ASSISTANT_STREAM_FAILED", type: "error" });
  assert.ok(!body.includes("SEGREDO"), "the provider error text must never reach the client");
  assert.ok(!body.includes("sk-"), "no secret material may reach the client");
  assert.deepEqual(await outcome, {
    code: "ASSISTANT_STREAM_FAILED",
    kind: "error",
    steps: 0,
    usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
  });
});

// ---------- 5b: provider errors must never reach the console ----------

// Records every console.error/warn/log call made while the spy is in
// place, so a test can prove provider content (secrets, URLs, messages)
// was not logged by the turn or the SDK.
function spyConsole(): { calls: string[][]; restore: () => void } {
  const calls: string[][] = [];
  const error = console.error;
  const warn = console.warn;
  const log = console.log;
  const record = (...args: unknown[]) => {
    calls.push(args.map((arg) => String(arg)));
  };
  console.error = record;
  console.warn = record;
  console.log = record;
  return {
    calls,
    restore: () => {
      console.error = error;
      console.warn = warn;
      console.log = log;
    },
  };
}

function assertNoLoggedToken(calls: string[][], token: string, message: string): void {
  assert.ok(!calls.some((call) => call.some((part) => part.includes(token))), `${message}: ${JSON.stringify(calls)}`);
}

test("a rejected doStream with a secret logs nothing and gives ASSISTANT_STREAM_FAILED", async () => {
  const spy = spyConsole();
  try {
    const model = new MockLanguageModelV4({
      doStream: (async () => {
        throw new Error("sk-SYNTHETIC_SECRET");
      }) as unknown as MockLanguageModelV4["doStream"],
      modelId: "mock",
    });
    const { outcome, response } = runAssistantTurn({
      history: [{ role: "user", text: "?" }],
      model,
      system: "sys",
      thread: THREAD,
      timeoutMs: 100,
      tools: {},
    });
    await readSse(response);
    assert.deepEqual(await outcome, {
      code: "ASSISTANT_STREAM_FAILED",
      kind: "error",
      steps: 0,
      usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
    });
    assertNoLoggedToken(spy.calls, "SYNTHETIC", "the rejected doStream must not log the provider error");
  } finally {
    spy.restore();
  }
});

test("a model error part is ASSISTANT_STREAM_FAILED in the outcome and logs nothing", async () => {
  const model = mockModel(() => ({
    stream: modelStream([{ error: new Error("sk-SYNTHETIC_SECRET"), type: "error" }]),
  }));
  const spy = spyConsole();
  try {
    const { outcome, response } = runAssistantTurn({
      history: [{ role: "user", text: "?" }],
      model,
      system: "sys",
      thread: THREAD,
      timeoutMs: 100,
      tools: {},
    });
    const body = await readSse(response);
    const errorParts = sseDataParts(body).filter((part) => (part as { type?: string }).type === "error");
    assert.deepEqual(errorParts, [{ errorText: "ASSISTANT_STREAM_FAILED", type: "error" }], "the SSE must carry one sanitized error part");
    assert.ok(!body.includes("SYNTHETIC"), "the error part content must not reach the client");
    assert.deepEqual(await outcome, {
      code: "ASSISTANT_STREAM_FAILED",
      kind: "error",
      steps: 1,
      usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
    });
    assertNoLoggedToken(spy.calls, "SYNTHETIC", "the model error part must not be logged");
  } finally {
    spy.restore();
  }
});

// ---------- 6: client cancels after the first chunk ----------

test("the client reads the first chunk and cancels: the outcome still resolves", async () => {
  const model = mockModel(() => ({
    stream: slowPartsStream(
      [
        { id: "t1", type: "text-start" },
        { delta: "Oi! ", id: "t1", type: "text-delta" },
        { delta: "tudo bem?", id: "t1", type: "text-delta" },
        { id: "t1", type: "text-end" },
        finish("stop"),
      ],
      40,
    ),
  }));
  const { outcome, response } = runAssistantTurn({
    history: [{ role: "user", text: "?" }],
    model,
    system: "sys",
    thread: THREAD,
    tools: {},
  });
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const first = await reader.read();
  assert.ok(!first.done);
  assert.ok(decoder.decode(first.value).includes("data-thread"), "the first chunk is the data-thread part");
  await reader.cancel();
  const settled = await Promise.race([
    outcome.then((value) => ({ resolved: true as const, value })),
    new Promise<{ resolved: false }>((resolve) => setTimeout(() => resolve({ resolved: false }), 3_000)),
  ]);
  assert.equal(settled.resolved, true, "the outcome must settle even after the client cancels");
  if (settled.resolved) {
    assert.deepEqual(settled.value, {
      kind: "final",
      steps: 1,
      text: "Oi! tudo bem?",
      usage: { inputTokens: 3, outputTokens: 5, totalTokens: 8 },
    });
  }
});

// ---------- 7: buildTurnWindow ----------

const h = (role: "user" | "assistant", text: string): AssistantHistoryEntry => ({ role, text });

test("buildTurnWindow respects both limits and always includes the last message", () => {
  // (a) the message limit: 20 short alternating messages -> at most 12,
  // ending on the last one and starting on a user message.
  const many: AssistantHistoryEntry[] = [];
  for (let i = 0; i < 20; i += 1) {
    many.push(h(i % 2 === 0 ? "user" : "assistant", `mensagem ${i}`));
  }
  const windowA = buildTurnWindow(many);
  assert.ok(windowA.length <= 12, `window has ${windowA.length} messages`);
  assert.equal(windowA.at(-1), many.at(-1), "the last message always enters");
  assert.equal(windowA[0].role, "user", "the window starts on a user message");
  assert.equal(windowA.length, 12, "with room to spare the window takes the full 12");

  // (b) the character limit: 10k + 10k + 10k + 9k; only the last two fit.
  const chars: AssistantHistoryEntry[] = [
    h("user", "u".repeat(10_000)),
    h("assistant", "a".repeat(10_000)),
    h("user", "u".repeat(10_000)),
    h("assistant", "a".repeat(9_000)),
  ];
  const windowB = buildTurnWindow(chars);
  assert.deepEqual(
    windowB.map((entry) => entry.text.length),
    [10_000, 9_000],
  );
  assert.equal(windowB[0].role, "user");
  assert.equal(windowB.at(-1), chars.at(-1));

  // (c) the last message enters even alone over the character limit.
  const windowC = buildTurnWindow([h("user", "curta"), h("assistant", "a".repeat(30_000))]);
  assert.deepEqual(windowC, [h("assistant", "a".repeat(30_000))]);

  // (d) when the message limit would start the window on an assistant
  // message, the window trims up to the next user message.
  const windowD = buildTurnWindow([h("user", "u".repeat(12_000)), h("assistant", "a".repeat(10_000)), h("assistant", "a".repeat(3_000))]);
  assert.equal(windowD.length, 1);
  assert.equal(windowD.at(-1).text.length, 3_000);

  // (e) an empty history stays empty.
  assert.deepEqual(buildTurnWindow([]), []);
});

// ---------- 8: classifyTurnOutcome ----------

const usageForTest = { inputTokens: 1, outputTokens: 1, totalTokens: 2 };

test("classifyTurnOutcome: a wait notice is not a final answer", () => {
  const notice = classifyTurnOutcome({
    finishReason: "stop",
    steps: 1,
    text: "Vou consultar as sessões…",
    usage: usageForTest,
  });
  assert.deepEqual(notice, { code: "ASSISTANT_TURN_INCOMPLETE", kind: "error", steps: 1, usage: usageForTest });
});

test("classifyTurnOutcome: final, long wait-like text, tool cap and empty text", () => {
  // A normal stop with content is final (whitespace trimmed from the text).
  assert.deepEqual(classifyTurnOutcome({ finishReason: "stop", steps: 2, text: "  Você tem 2 sessões. ", usage: usageForTest }), {
    kind: "final",
    steps: 2,
    text: "Você tem 2 sessões.",
    usage: usageForTest,
  });

  // A notice-like text over 200 characters is a real answer, not a notice.
  const longText = `Vou consultar ${"x".repeat(210)}`;
  assert.equal(classifyTurnOutcome({ finishReason: "stop", steps: 1, text: longText, usage: usageForTest }).kind, "final");

  // Hitting the step cap ends on a tool-calls finish reason.
  assert.equal(
    classifyTurnOutcome({ finishReason: "tool-calls", steps: ASSISTANT_MAX_STEPS, text: "qualquer coisa", usage: usageForTest }).kind,
    "error",
  );

  // Empty (whitespace-only) text is incomplete even on a stop finish.
  assert.equal(
    classifyTurnOutcome({ finishReason: "stop", steps: 1, text: "   ", usage: usageForTest }).kind,
    "error",
  );
});
