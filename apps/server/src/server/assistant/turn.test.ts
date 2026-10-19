import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { jsonSchema, tool, type LanguageModel, type ToolSet } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { ASSISTANT_PROPOSAL_TTL_MS, newAssistantProposalId, prepareProposal, publicProposal, type AssistantProposalRecord } from "./proposals";
import { FIXTURE_ID_PREFIX, fixtureReader, fixtureWorld } from "./proposals.test-helpers";
import { createAssistantConversation } from "../../components/assistant/assistant-conversation";
import { encodeAssistantTurnTerminal, parseAssistantTurnTerminal } from "../../lib/assistant-turn-terminal";
import { byokStreamErrorPart } from "../byok/route";
import { createAssistantTurnBudget } from "./deadline";
import { fakeTurnClock, pushableStream, settleIo } from "./deadline.test-helpers";
import { newAssistantMessageId } from "./store";
import { ASSISTANT_TOOL_POLICY } from "./tool-policy";
import type { AssistantProposalSink, AssistantToolHost } from "./tools";
import { buildAssistantToolSet } from "./tools";
import {
  ASSISTANT_MAX_STEPS,
  buildTurnWindow,
  classifyTurnOutcome,
  runAssistantTurn,
  type AssistantHistoryEntry,
  type AssistantStreamEmit,
  type AssistantTurnOutcome,
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
    ask: null,
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
  assert.deepEqual(errorParts[0], { errorText: JSON.stringify({ code: "ASSISTANT_STREAM_FAILED", phase: "model", retryable: true }), type: "error" });
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
    assert.deepEqual(errorParts, [{ errorText: JSON.stringify({ code: "ASSISTANT_STREAM_FAILED", phase: "model", retryable: true }), type: "error" }], "the SSE must carry one sanitized error part");
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
      ask: null,
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
    ask: null,
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

test("classifyTurnOutcome: a valid ask is final with the question, even on tool-calls; an error still wins", () => {
  const ask = { options: ["A", "B"], question: "Qual coleção?" };
  assert.deepEqual(classifyTurnOutcome({ ask, finishReason: "tool-calls", steps: 1, text: "", usage: usageForTest }), {
    ask,
    kind: "final",
    steps: 1,
    text: "Qual coleção?",
    usage: usageForTest,
  });
  assert.equal(classifyTurnOutcome({ ask, finishReason: "error", steps: 1, text: "", usage: usageForTest }).kind, "error");
  assert.equal(classifyTurnOutcome({ ask: null, finishReason: "tool-calls", steps: 1, text: "", usage: usageForTest }).kind, "error");
});

// ---------- 9: writes as proposals and pinar_ask ----------

const fx = (suffix: string) => `${FIXTURE_ID_PREFIX}${suffix}`;

// A mock model that records the prompt of every step.
function scriptedModel(steps: ModelPart[][]): { calls: () => number; model: LanguageModel; prompts: unknown[] } {
  const prompts: unknown[] = [];
  const model = new MockLanguageModelV4({
    doStream: (async (options: { prompt: unknown }) => {
      prompts.push(options.prompt);
      const parts = steps[Math.min(prompts.length - 1, steps.length - 1)];
      return { stream: modelStream(parts) };
    }) as unknown as MockLanguageModelV4["doStream"],
    modelId: "mock",
  });
  return { calls: () => prompts.length, model, prompts };
}

const callPart = (toolName: string, input: unknown, toolCallId = "tc1") => ({
  input: JSON.stringify(input),
  toolCallId,
  toolName,
  type: "tool-call",
});

// The turn's proposal sink as S3 will wire it: prepare over the state
// reader, store-shaped record, data-proposal through emit.
function fixtureSink(emit: AssistantStreamEmit): AssistantProposalSink & { proposals: string[] } {
  const reader = fixtureReader(fixtureWorld());
  const proposals: string[] = [];
  return {
    proposals,
    async propose(tool, args) {
      proposals.push(tool);
      const prepared = await prepareProposal({ args, reader, tool });
      if (!prepared.ok) return { problems: prepared.problems, status: "invalid_arguments" };
      const now = new Date();
      const record: AssistantProposalRecord = {
        args,
        createdAt: now.toISOString(),
        display: prepared.prepared.display,
        errorCode: null,
        executedAt: null,
        expiresAt: new Date(now.getTime() + ASSISTANT_PROPOSAL_TTL_MS).toISOString(),
        fingerprint: prepared.prepared.fingerprint,
        id: newAssistantProposalId(),
        messageId: newAssistantMessageId(),
        result: null,
        risk: prepared.prepared.risk,
        status: "proposed",
        summary: prepared.prepared.summary,
        threadId: THREAD.id,
        tool,
        undo: null,
        undoExpiresAt: null,
        updatedAt: now.toISOString(),
      };
      emit({ data: publicProposal(record, now), type: "data-proposal" });
      return { status: "awaiting_confirmation", summary: prepared.prepared.summary };
    },
  };
}

function spyHost(): AssistantToolHost & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    callTool: async (name) => {
      calls.push(name);
      return "ok";
    },
  };
}

function writeTurn(steps: ModelPart[][]) {
  const host = spyHost();
  const scripted = scriptedModel(steps);
  let sink: (AssistantProposalSink & { proposals: string[] }) | null = null;
  const { outcome, response } = runAssistantTurn({
    history: [{ role: "user", text: "move a sessão" }],
    model: scripted.model,
    system: "sys",
    thread: THREAD,
    tools: (emit) => {
      sink = fixtureSink(emit);
      return buildAssistantToolSet({ emit, host, kinds: ["read", "write"], proposals: sink, surface: "local" });
    },
  });
  return { host, outcome, response, scripted, sink: () => sink! };
}

test("a write tool call streams data-proposal, the model gets awaiting_confirmation and the host is never called", async () => {
  const turn = writeTurn([
    [callPart("pinar_move_session", { collectionId: fx("col-b"), sessionId: fx("session-2") }), finish("tool-calls")],
    [...textParts("Propus mover a sessão; confirme no cartão."), finish("stop")],
  ]);
  const parts = sseDataParts(await readSse(turn.response)) as Array<{ data?: Record<string, unknown>; type: string }>;
  assert.deepEqual(parts[0], { data: THREAD, type: "data-thread" });
  const proposals = parts.filter((part) => part.type === "data-proposal");
  assert.equal(proposals.length, 1);
  const data = proposals[0].data!;
  assert.deepEqual(data.display, { action: "move_session", params: { collection: "Onboarding", session: "Payment form" } });
  assert.equal(data.status, "proposed");
  assert.equal(data.tool, "pinar.move_session");
  for (const hidden of ["args", "fingerprint", "result", "undo", "summary"]) assert.ok(!(hidden in data), `${hidden} must not cross the stream`);
  assert.ok(!JSON.stringify(data.display).includes(FIXTURE_ID_PREFIX));
  assert.equal(turn.scripted.calls(), 2);
  const second = JSON.stringify(turn.scripted.prompts[1]);
  assert.ok(second.includes("awaiting_confirmation"), second.slice(-400));
  assert.ok(second.includes('Move session \\"Payment form\\" to \\"Onboarding\\"'), second.slice(-400));
  assert.deepEqual(turn.host.calls, [], "the host must never be called for a write");
  assert.deepEqual(turn.sink().proposals, ["pinar.move_session"]);
  const result = (await turn.outcome) as Extract<AssistantTurnOutcome, { kind: "final" }>;
  assert.equal(result.kind, "final");
  assert.equal(result.ask, null);
  assert.equal(result.steps, 2);
});

test("invalid write arguments go back as invalid_arguments, with no proposal", async () => {
  const turn = writeTurn([
    [callPart("pinar_move_session", { sessionId: 7 }), finish("tool-calls")],
    [...textParts("Faltou a coleção."), finish("stop")],
  ]);
  const parts = sseDataParts(await readSse(turn.response)) as Array<{ type: string }>;
  assert.ok(!parts.some((part) => part.type === "data-proposal"));
  assert.ok(JSON.stringify(turn.scripted.prompts[1]).includes("invalid_arguments"));
  assert.deepEqual(turn.sink().proposals, [], "invalid arguments never reach the sink");
  assert.deepEqual(turn.host.calls, []);
  assert.equal((await turn.outcome).kind, "final");
});

test("a missing entity goes back as invalid_arguments with '<entity> not found', with no proposal", async () => {
  const turn = writeTurn([
    [callPart("pinar_move_session", { collectionId: fx("col-b"), sessionId: fx("missing") }), finish("tool-calls")],
    [...textParts("Não achei a sessão."), finish("stop")],
  ]);
  const parts = sseDataParts(await readSse(turn.response)) as Array<{ type: string }>;
  assert.ok(!parts.some((part) => part.type === "data-proposal"));
  const second = JSON.stringify(turn.scripted.prompts[1]);
  assert.ok(second.includes("invalid_arguments") && second.includes("session not found"), second.slice(-300));
  assert.deepEqual(turn.host.calls, []);
});

test("pinar_ask streams data-ask, stops on the same step and is final with ask and text = question", async () => {
  const ask = { options: ["Checkout", "Onboarding"], question: "Para qual coleção?" };
  const turn = writeTurn([
    [callPart("pinar_ask", ask), finish("tool-calls")],
    [...textParts("never reached"), finish("stop")],
  ]);
  const parts = sseDataParts(await readSse(turn.response)) as Array<{ data?: unknown; type: string }>;
  assert.deepEqual(parts.filter((part) => part.type === "data-ask"), [{ data: ask, type: "data-ask" }]);
  assert.equal(turn.scripted.calls(), 1, "the turn must stop on the pinar_ask step");
  assert.deepEqual(await turn.outcome, {
    ask,
    kind: "final",
    steps: 1,
    text: "Para qual coleção?",
    usage: { inputTokens: 3, outputTokens: 5, totalTokens: 8 },
  });
});

test("an invalid pinar_ask still stops the loop but is not final and emits nothing", async () => {
  const turn = writeTurn([
    [callPart("pinar_ask", { options: ["só uma"], question: "Qual?" }), finish("tool-calls")],
    [...textParts("never reached"), finish("stop")],
  ]);
  const parts = sseDataParts(await readSse(turn.response)) as Array<{ type: string }>;
  assert.ok(!parts.some((part) => part.type === "data-ask"));
  assert.equal(turn.scripted.calls(), 1);
  assert.deepEqual(await turn.outcome, {
    code: "ASSISTANT_TURN_INCOMPLETE",
    kind: "error",
    steps: 1,
    usage: { inputTokens: 3, outputTokens: 5, totalTokens: 8 },
  });
});

test("an excluded write is not offered: a call to it never reaches the sink or the host", async () => {
  const entry = ASSISTANT_TOOL_POLICY["pinar.delete_project"];
  const original = entry.assistant;
  entry.assistant = "exclude";
  try {
    const turn = writeTurn([
      [callPart("pinar_delete_project", { projectId: fx("project-2") }), finish("tool-calls")],
      [...textParts("Não posso apagar projetos."), finish("stop")],
    ]);
    const parts = sseDataParts(await readSse(turn.response)) as Array<{ type: string }>;
    assert.ok(!parts.some((part) => part.type === "data-proposal"));
    await turn.outcome;
    assert.deepEqual(turn.sink().proposals, []);
    assert.deepEqual(turn.host.calls, []);
  } finally {
    entry.assistant = original;
  }
});

test("asking for writes without a proposal sink throws before the turn starts", () => {
  assert.throws(
    () =>
      runAssistantTurn({
        history: [{ role: "user", text: "?" }],
        model: textModel("x"),
        system: "sys",
        thread: THREAD,
        tools: (emit) => buildAssistantToolSet({ emit, host: spyHost(), kinds: ["read", "write"], surface: "local" }),
      }),
    /proposal sink/,
  );
});

// ---------- the turn's deadlines (deadline.ts), on a fake clock ----------

const errorPartsOf = (body: string) =>
  sseDataParts(body).filter((part) => (part as { type?: string }).type === "error") as Array<{ errorText: string; type: string }>;
const timeoutTerminal = (phase: "attempt" | "inactivity" | "turn") =>
  encodeAssistantTurnTerminal({ code: "ASSISTANT_TURN_TIMEOUT", phase, retryable: true });

// Tracks whether a promise settled, without awaiting it.
function settledFlag(promise: Promise<unknown>): () => boolean {
  let settled = false;
  void promise.then(() => {
    settled = true;
  });
  return () => settled;
}

describe("the turn's deadlines", () => {
  test("a slow model that keeps producing passes 60 s and ends final", async () => {
    const clock = fakeTurnClock();
    const feed = pushableStream();
    const { outcome, response } = runAssistantTurn({
      clock,
      history: [{ role: "user", text: "?" }],
      model: mockModel(() => ({ stream: feed.stream })),
      system: "sys",
      thread: THREAD,
      tools: {},
    });
    const reading = readSse(response);
    feed.push({ id: "t1", type: "text-start" });
    // 55 s between parts, 165 s in all: past the old fixed 60 s, under the
    // 180 s attempt cap.
    for (const word of ["Você ", "tem ", "duas sessões."]) {
      await clock.advance(55_000);
      feed.push({ delta: word, id: "t1", type: "text-delta" });
    }
    feed.push({ id: "t1", type: "text-end" });
    feed.push(finish("stop"));
    feed.close();
    const body = await reading;
    const result = await outcome;
    assert.equal(result.kind, "final", JSON.stringify(result));
    assert.equal(result.kind === "final" && result.text, "Você tem duas sessões.");
    assert.deepEqual(errorPartsOf(body), []);
  });

  test("60 s without any part ends the turn by inactivity, with the typed final error", async () => {
    const clock = fakeTurnClock();
    const feed = pushableStream();
    const { outcome, response } = runAssistantTurn({
      clock,
      history: [{ role: "user", text: "?" }],
      model: mockModel(() => ({ stream: feed.stream })),
      system: "sys",
      thread: THREAD,
      tools: {},
    });
    const reading = readSse(response);
    const settled = settledFlag(outcome);
    feed.push({ id: "t1", type: "text-start" });
    await clock.advance(59_999);
    assert.equal(settled(), false, "one millisecond before the window the turn is still running");
    await clock.advance(1);
    const body = await reading;
    assert.deepEqual(await outcome, { code: "ASSISTANT_TURN_TIMEOUT", kind: "error", steps: 0, usage: ZERO });
    assert.deepEqual(errorPartsOf(body), [{ errorText: timeoutTerminal("inactivity"), type: "error" }]);
  });

  test("a raw provider chunk counts as progress (includeRawChunks)", async () => {
    const clock = fakeTurnClock();
    const feed = pushableStream();
    const { outcome, response } = runAssistantTurn({
      clock,
      history: [{ role: "user", text: "?" }],
      model: mockModel(() => ({ stream: feed.stream })),
      system: "sys",
      thread: THREAD,
      tools: {},
    });
    const reading = readSse(response);
    // Reasoning the SDK does not map arrives only as raw chunks.
    await clock.advance(50_000);
    feed.push({ rawValue: { reasoning: "..." }, type: "raw" });
    await clock.advance(50_000);
    feed.push({ rawValue: { reasoning: "..." }, type: "raw" });
    await clock.advance(50_000);
    for (const part of [...textParts("Pronto."), finish("stop")]) feed.push(part);
    feed.close();
    await reading;
    const result = await outcome;
    assert.equal(result.kind, "final", JSON.stringify(result));
  });

  test("a slow tool is not inactivity: the clock stands still while it runs", async () => {
    const clock = fakeTurnClock();
    let releaseTool!: () => void;
    const toolGate = new Promise<void>((resolve) => {
      releaseTool = resolve;
    });
    let toolRuns = 0;
    let modelCalls = 0;
    const model = mockModel(() => {
      modelCalls += 1;
      return modelCalls === 1
        ? { stream: modelStream([{ input: "{}", toolCallId: "tc1", toolName: "slow_read", type: "tool-call" }, finish("tool-calls")]) }
        : { stream: modelStream([...textParts("Achei."), finish("stop")]) };
    });
    const { outcome, response } = runAssistantTurn({
      clock,
      history: [{ role: "user", text: "?" }],
      model,
      system: "sys",
      thread: THREAD,
      tools: {
        slow_read: tool({
          execute: async () => {
            toolRuns += 1;
            await toolGate;
            return "ok";
          },
          inputSchema: jsonSchema({ properties: {}, type: "object" }),
        }),
      },
    });
    const reading = readSse(response);
    const settled = settledFlag(outcome);
    await clock.advance(150_000);
    assert.equal(toolRuns, 1, "the tool is running");
    assert.equal(settled(), false, "150 s of a running tool is not inactivity");
    releaseTool();
    await settleIo();
    const body = await reading;
    const result = await outcome;
    assert.equal(result.kind, "final", JSON.stringify(result));
    assert.equal(result.kind === "final" && result.text, "Achei.");
    assert.deepEqual(errorPartsOf(body), []);
  });

  test("the attempt cap: steady progress still ends at 180 s with the attempt phase", async () => {
    const clock = fakeTurnClock();
    const feed = pushableStream();
    const { outcome, response } = runAssistantTurn({
      clock,
      history: [{ role: "user", text: "?" }],
      model: mockModel(() => ({ stream: feed.stream })),
      system: "sys",
      thread: THREAD,
      tools: {},
    });
    const reading = readSse(response);
    const settled = settledFlag(outcome);
    feed.push({ id: "t1", type: "text-start" });
    for (let index = 0; index < 5; index++) {
      await clock.advance(30_000);
      feed.push({ delta: ".", id: "t1", type: "text-delta" });
    }
    await clock.advance(29_999);
    assert.equal(settled(), false, "under 180 s the attempt goes on");
    await clock.advance(1);
    const body = await reading;
    const result = await outcome;
    assert.equal(result.kind === "error" && result.code, "ASSISTANT_TURN_TIMEOUT");
    assert.deepEqual(errorPartsOf(body), [{ errorText: timeoutTerminal("attempt"), type: "error" }]);
  });

  test("the turn's budget: work before the stream counts, and the cap is what is left (turn phase)", async () => {
    const clock = fakeTurnClock();
    const budget = createAssistantTurnBudget(clock);
    // 100 s spent before the stream (the request's own work).
    await clock.advance(100_000);
    const feed = pushableStream();
    const { outcome, response } = runAssistantTurn({
      budget,
      history: [{ role: "user", text: "?" }],
      model: mockModel(() => ({ stream: feed.stream })),
      system: "sys",
      thread: THREAD,
      tools: {},
    });
    const reading = readSse(response);
    const settled = settledFlag(outcome);
    feed.push({ id: "t1", type: "text-start" });
    for (let index = 0; index < 4; index++) {
      await clock.advance(30_000);
      feed.push({ delta: ".", id: "t1", type: "text-delta" });
    }
    await clock.advance(19_999);
    assert.equal(settled(), false, "139.999 s into the stream, 239.999 s into the turn");
    await clock.advance(1);
    const body = await reading;
    const result = await outcome;
    assert.equal(result.kind === "error" && result.code, "ASSISTANT_TURN_TIMEOUT");
    assert.deepEqual(errorPartsOf(body), [{ errorText: timeoutTerminal("turn"), type: "error" }]);
    budget.dispose();
  });

  test("BYOK: the deadline keeps the byok_error protocol with the timeout cause", async () => {
    const clock = fakeTurnClock();
    const feed = pushableStream();
    const { outcome, response } = runAssistantTurn({
      clock,
      history: [{ role: "user", text: "?" }],
      model: mockModel(() => ({ stream: feed.stream })),
      onStreamError: byokStreamErrorPart,
      system: "sys",
      thread: THREAD,
      tools: {},
    });
    const reading = readSse(response);
    await clock.advance(60_000);
    const body = await reading;
    const parts = sseDataParts(body) as Array<{ data?: unknown; errorText?: string; type: string }>;
    assert.deepEqual(parts.filter((part) => part.type === "data-byok-error").map((part) => part.data), [{ canUseCredits: true, cause: "timeout" }]);
    assert.deepEqual(errorPartsOf(body), [{ errorText: "byok_error", type: "error" }]);
    const result = await outcome;
    assert.equal(result.kind === "error" && result.code, "ASSISTANT_TURN_TIMEOUT");
  });

  test("the caller's abort stops every deadline: no timeout, no final error part", async () => {
    const clock = fakeTurnClock();
    const feed = pushableStream();
    const caller = new AbortController();
    const { outcome, response } = runAssistantTurn({
      abortSignal: caller.signal,
      clock,
      history: [{ role: "user", text: "?" }],
      model: mockModel(() => ({ stream: feed.stream })),
      system: "sys",
      thread: THREAD,
      tools: {},
    });
    const reading = readSse(response);
    feed.push({ id: "t1", type: "text-start" });
    await clock.advance(10_000);
    caller.abort(new Error("client left"));
    await clock.advance(300_000);
    const body = await reading;
    assert.deepEqual(errorPartsOf(body), []);
    const result = await outcome;
    assert.equal(result.kind === "error" && result.code, "ASSISTANT_STREAM_FAILED");
    assert.equal(clock.pending(), 0, "no timer left behind");
  });

  test("a missing final ends the stream with the typed ASSISTANT_TURN_INCOMPLETE part", async () => {
    const tools: ToolSet = buildAssistantToolSet({ host: { callTool: async () => "ok" }, kinds: ["read"], surface: "local" });
    let calls = 0;
    const model = mockModel(() => {
      calls += 1;
      return { stream: modelStream([toolCallPart(`tc${calls}`), finish("tool-calls")]) };
    });
    const { outcome, response } = runAssistantTurn({
      history: [{ role: "user", text: "?" }],
      maxSteps: 2,
      model,
      system: "sys",
      thread: THREAD,
      tools,
    });
    const body = await readSse(response);
    assert.deepEqual(errorPartsOf(body), [{
      errorText: encodeAssistantTurnTerminal({ code: "ASSISTANT_TURN_INCOMPLETE", phase: "model", retryable: true }),
      type: "error",
    }]);
    const result = await outcome;
    assert.equal(result.kind === "error" && result.code, "ASSISTANT_TURN_INCOMPLETE");
  });

  test("a final answer and a pinar_ask carry no final error part", async () => {
    const { response } = runAssistantTurn({
      history: [{ role: "user", text: "?" }],
      model: textModel("Duas."),
      system: "sys",
      thread: THREAD,
      tools: {},
    });
    assert.deepEqual(errorPartsOf(await readSse(response)), []);
  });
});

const ZERO = { inputTokens: 0, outputTokens: 0, totalTokens: 0 };

// ---------- the typed final error through the panel's chat transport ----------

// The SSE the turn writes, read by the panel's real transport (the SDK Chat
// with DefaultChatTransport): the chat ends in "error" and its error carries
// the terminal the panel maps.
describe("the typed final error through the panel's chat transport", () => {
  async function consume(response: Response) {
    const sse = await response.text();
    const errors: Error[] = [];
    const conversation = createAssistantConversation({
      chatId: "assistant:probe",
      fetch: async () => new Response(sse, { headers: response.headers }),
      generation: 0,
      hooks: { generation: { current: 0 }, onTurnError: (error) => errors.push(error) },
      messages: [],
      threadId: THREAD.id,
    });
    await conversation.chat.sendMessage({ text: "?" });
    return { errors, status: conversation.chat.status };
  }

  test("a deadline reaches the chat as an error with the timeout terminal", async () => {
    const clock = fakeTurnClock();
    const feed = pushableStream();
    const { outcome, response } = runAssistantTurn({
      clock,
      history: [{ role: "user", text: "?" }],
      model: mockModel(() => ({ stream: feed.stream })),
      system: "sys",
      thread: THREAD,
      tools: {},
    });
    const consuming = consume(response);
    await clock.advance(60_000);
    const { errors, status } = await consuming;
    await outcome;
    assert.equal(status, "error");
    assert.deepEqual(errors.map((error) => parseAssistantTurnTerminal(error)), [{ code: "ASSISTANT_TURN_TIMEOUT", phase: "inactivity", retryable: true }]);
  });

  test("a missing final reaches the chat as an error with the incomplete terminal, after the finish part", async () => {
    const { outcome, response } = runAssistantTurn({
      history: [{ role: "user", text: "?" }],
      model: textModel("Vou verificar."),
      system: "sys",
      thread: THREAD,
      tools: {},
    });
    const { errors, status } = await consume(response);
    await outcome;
    assert.equal(status, "error");
    assert.deepEqual(errors.map((error) => parseAssistantTurnTerminal(error)), [{ code: "ASSISTANT_TURN_INCOMPLETE", phase: "model", retryable: true }]);
  });

  test("a final answer leaves the chat ready, without an error", async () => {
    const { response } = runAssistantTurn({
      history: [{ role: "user", text: "?" }],
      model: textModel("Duas sessões."),
      system: "sys",
      thread: THREAD,
      tools: {},
    });
    const { errors, status } = await consume(response);
    assert.equal(status, "ready");
    assert.deepEqual(errors, []);
  });
});
