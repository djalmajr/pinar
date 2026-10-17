import assert from "node:assert/strict";
import { beforeEach, describe, test } from "node:test";
import type { LanguageModel } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { ASSISTANT_SYSTEM_PROMPT } from "./prompt";
import {
  cloudAssistantStore,
  resetCloudAssistantMemoryForTests,
} from "./store-cloud";
import type { AssistantStore } from "./store";
import {
  handleAssistantRequest,
  type AssistantRequestDeps,
  type AssistantStatus,
} from "./http";
import type { AssistantToolHost } from "./tools";

// ---------- mock model helpers (same vocabulary as turn.test.ts) ----------

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
const toolCallPart = (toolCallId: string, toolName: string, input: unknown) => ({
  input: JSON.stringify(input),
  toolCallId,
  toolName,
  type: "tool-call",
});

function textModel(text: string): LanguageModel {
  return mockModel(() => ({ stream: modelStream([...textParts(text), finish("stop")]) }));
}

// Errors the stream immediately (provider failure).
function failingModel(): LanguageModel {
  return mockModel(() => ({
    stream: new ReadableStream<unknown>({
      start(controller) {
        controller.error(new Error("provider down"));
      },
    }),
  }));
}

// Emits its parts only after the gate resolves (a slow, controllable turn).
function gatedModel(gate: Promise<void>): LanguageModel {
  return mockModel(() => ({
    stream: new ReadableStream<unknown>({
      async start(controller) {
        await gate;
        for (const part of [...textParts("resposta"), finish("stop")]) controller.enqueue(part);
        controller.close();
      },
    }),
  }));
}

// Records the prompt (unified messages) each doStream call receives.
function promptCapturingModel(captured: unknown[][], make: () => { stream: ReadableStream<unknown> }): LanguageModel {
  return new MockLanguageModelV4({
    doStream: ((args: { prompt: unknown[] }) => {
      captured.push(args.prompt);
      return make();
    }) as unknown as MockLanguageModelV4["doStream"],
    modelId: "mock",
  });
}

// The roles/texts of a captured prompt, without the system message.
function promptConversation(prompt: unknown[]): { role: string; text: string }[] {
  return (prompt as Array<{ content: unknown; role: string }>)
    .filter((message) => message.role !== "system")
    .map((message) => ({
      role: message.role,
      text: Array.isArray(message.content)
        ? message.content.map((part) => String((part as { text: string }).text)).join("")
        : String(message.content),
    }));
}

// ---------- deps and request helpers ----------

const NOW = Date.UTC(2026, 0, 1);
const FAKE_ENDPOINT = { baseUrl: "http://127.0.0.1:9", kind: "openai-compatible" as const, model: "mock", thinkingControl: false };

function makeDeps(
  overrides: {
    model?: AssistantRequestDeps["model"];
    now?: () => Date;
    rateLimitTurn?: () => Promise<boolean>;
    status?: () => Promise<AssistantStatus>;
    toolHost?: AssistantToolHost;
  } = {},
) {
  let ticks = 0;
  const now = overrides.now ?? (() => new Date(NOW + ++ticks * 1_000));
  const store: AssistantStore = cloudAssistantStore({}, "u1");
  const deps: AssistantRequestDeps = {
    endpoint: async () => FAKE_ENDPOINT,
    now,
    status: overrides.status ?? (async () => ({ available: true, reason: null })),
    store,
    surface: "local",
    toolHost: overrides.toolHost ?? { callTool: async () => ({ sessions: [] }) },
    ...(overrides.model ? { model: overrides.model } : {}),
    ...(overrides.rateLimitTurn ? { rateLimitTurn: overrides.rateLimitTurn } : {}),
  };
  return { deps, store };
}

function request(path: string, init: RequestInit = {}): Request {
  return new Request(`http://127.0.0.1:17373${path}`, init);
}

async function postTurn(deps: AssistantRequestDeps, body: string | Record<string, unknown>): Promise<Response> {
  return handleAssistantRequest(
    request("/api/assistant/turn", {
      body: typeof body === "string" ? body : JSON.stringify(body),
      headers: { "content-type": "application/json" },
      method: "POST",
    }),
    deps,
  );
}

async function readSse(response: Response): Promise<string> {
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let body = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    body += decoder.decode(value, { stream: true });
  }
  return body;
}

function sseDataParts(body: string): Record<string, unknown>[] {
  return body
    .split("\n")
    .filter((line) => line.startsWith("data: ") && line.slice(6) !== "[DONE]")
    .map((line) => JSON.parse(line.slice(6)) as Record<string, unknown>);
}

// The thread id carried by the first part of a turn stream.
function threadIdFromTurn(body: string): string {
  const first = sseDataParts(body)[0];
  assert.equal(first.type, "data-thread");
  return String((first.data as { id: string }).id);
}

async function waitFor<T>(what: () => T | null | Promise<T | null>, timeoutMs = 3_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await what();
    if (value !== null) return value;
    if (Date.now() > deadline) throw new Error("timed out waiting for the store");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

const T1 = "ath_aaaaaaaaaaaaaaaaaaaaaaaa";
const T2 = "ath_bbbbbbbbbbbbbbbbbbbbbbbb";
const T3 = "ath_cccccccccccccccccccccccc";
const ISO = (seconds: number) => new Date(NOW + seconds * 1_000).toISOString();

beforeEach(() => {
  resetCloudAssistantMemoryForTests();
});

describe("assistant http handler", () => {
  test("returns null for paths outside the assistant namespace", async () => {
    const { deps } = makeDeps();
    assert.equal(await handleAssistantRequest(request("/api/other"), deps), null);
    assert.equal(await handleAssistantRequest(request("/api"), deps), null);
  });

  test("unavailable status: requires_pro gives 403, the rest 503", async () => {
    for (const [reason, status, code] of [
      ["requires_pro", 403, "assistant_requires_pro"],
      ["not_configured", 503, "assistant_unavailable"],
      ["disabled", 503, "assistant_unavailable"],
    ] as const) {
      const { deps } = makeDeps({ status: async () => ({ available: false, reason: reason }) });
      const response = await postTurn(deps, { text: "oi" });
      assert.equal(response.status, status, `reason ${reason}`);
      const body = (await response.json()) as { code: string; error: string };
      assert.equal(body.code, code, `reason ${reason}`);
      assert.ok(body.error);
    }
    // The status route itself always answers 200 with the reason.
    const { deps } = makeDeps({ status: async () => ({ available: false, reason: "not_configured" }) });
    const statusResponse = await handleAssistantRequest(request("/api/assistant/status"), deps);
    assert.equal(statusResponse.status, 200);
    assert.deepEqual(await statusResponse.json(), { available: false, reason: "not_configured", surface: "local" });
  });

  test("a null endpoint gives 503 and the thread is released for the next turn", async () => {
    const { deps, store } = makeDeps({ model: () => textModel("ok") });
    await store.createThread({ id: T2, now: ISO(0), title: "sem endpoint" });
    const noEndpoint = await postTurn({ ...deps, endpoint: async () => null }, { threadId: T2, text: "oi" });
    assert.equal(noEndpoint.status, 503);
    assert.equal((await noEndpoint.json()).code, "assistant_unavailable");
    // The thread is free: the next turn proceeds (no 409 left behind).
    const again = await postTurn(deps, { threadId: T2, text: "de novo" });
    assert.equal(again.status, 200);
    await readSse(again);
    await waitFor(() =>
      store.listMessages(T2, { limit: 10 }).then((items) => (items.length === 3 ? items : null)),
    );
  });

  test("invalid body gives 400 in the four cases", async () => {
    const invalidBodies: Array<[string, string]> = [
      ["JSON that is not an object", "hello"],
      ["not JSON at all", "{nope"],
      ["empty trimmed text", JSON.stringify({ text: "   " })],
      ["text above 8,000 characters", JSON.stringify({ text: "a".repeat(8_001) })],
    ];
    for (const [label, body] of invalidBodies) {
      const { deps } = makeDeps();
      const response = await postTurn(deps, body);
      assert.equal(response.status, 400, label);
      assert.equal((await response.json()).code, "invalid_request", label);
    }
    // threadId present but not matching the pattern.
    const { deps } = makeDeps();
    const badThreadId = await postTurn(deps, { text: "oi", threadId: "not-a-thread" });
    assert.equal(badThreadId.status, 400);
    assert.equal((await badThreadId.json()).code, "invalid_request");
    // Body above 64 KB.
    const { deps: largeDeps } = makeDeps();
    const large = await postTurn(largeDeps, JSON.stringify({ text: "a".repeat(70_000) }));
    assert.equal(large.status, 400);
    assert.equal((await large.json()).code, "invalid_request");
  });

  test("rateLimitTurn false gives 429; true proceeds", async () => {
    const { deps } = makeDeps({ model: () => textModel("ok"), rateLimitTurn: async () => false });
    const limited = await postTurn(deps, { text: "oi" });
    assert.equal(limited.status, 429);
    assert.equal((await limited.json()).code, "assistant_rate_limited");

    const { deps: allowed, store } = makeDeps({ model: () => textModel("ok"), rateLimitTurn: async () => true });
    const response = await postTurn(allowed, { text: "oi" });
    assert.equal(response.status, 200);
    const body = await readSse(response);
    const id = threadIdFromTurn(body);
    await waitFor(() =>
      store.listMessages(id, { limit: 10 }).then((messages) => (messages.length === 2 ? messages : null)),
    );
  });

  test("a turn on a new thread creates the thread, starts with data-thread, and stores both messages", async () => {
    const { deps, store } = makeDeps({ model: () => textModel("Duas sessões.") });
    const response = await postTurn(deps, { text: "Olá, Pinar" });
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type") ?? "", /text\/event-stream/);
    const body = await readSse(response);
    const id = threadIdFromTurn(body);
    const first = sseDataParts(body)[0];
    assert.deepEqual(first, { data: { id, title: "Olá, Pinar" }, type: "data-thread" });
    assert.ok(body.includes("Duas sessões."));

    const messages = await waitFor(() =>
      store.listMessages(id, { limit: 10 }).then((items) => (items.length === 2 ? items : null)),
    );
    assert.deepEqual(
      messages.map((message) => ({ role: message.role, status: message.status, text: message.text })),
      [
        { role: "user", status: "final", text: "Olá, Pinar" },
        { role: "assistant", status: "final", text: "Duas sessões." },
      ],
    );
    const thread = await store.getThread(id);
    assert.ok(thread);
    assert.equal(thread.title, "Olá, Pinar");
  });

  test("a turn whose model fails stores the assistant message with status error and the code", async () => {
    const { deps, store } = makeDeps({ model: () => failingModel() });
    const response = await postTurn(deps, { text: "oi" });
    assert.equal(response.status, 200);
    const body = await readSse(response);
    const parts = sseDataParts(body);
    const errorPart = parts.find((part) => part.type === "error");
    assert.ok(errorPart, "the stream carries an error part");
    assert.equal(errorPart.errorText, "ASSISTANT_STREAM_FAILED");
    assert.ok(!body.includes("provider down"), "the provider message never crosses the stream");
    const id = threadIdFromTurn(body);

    const messages = await waitFor(() =>
      store.listMessages(id, { limit: 10 }).then((items) =>
        items.length === 2 && items[1].status === "error" ? items : null,
      ),
    );
    assert.deepEqual(
      messages.map((message) => ({ errorCode: message.errorCode, role: message.role, status: message.status, text: message.text })),
      [
        { errorCode: null, role: "user", status: "final", text: "oi" },
        { errorCode: "ASSISTANT_STREAM_FAILED", role: "assistant", status: "error", text: "" },
      ],
    );
  });

  test("the history of an existing thread reaches the model", async () => {
    const { deps, store } = makeDeps();
    // Turn 1 on a fresh thread.
    const firstTurn = await postTurn({ ...deps, model: () => textModel("resposta um") }, { text: "primeira pergunta" });
    assert.equal(firstTurn.status, 200);
    const firstId = threadIdFromTurn(await readSse(firstTurn));
    await waitFor(() =>
      store.listMessages(firstId, { limit: 10 }).then((items) => (items.length === 2 ? items : null)),
    );

    // Turn 2 on the same thread, with a model that captures its prompt.
    const captured: unknown[][] = [];
    const turnTwo = await postTurn(
      { ...deps, model: () => promptCapturingModel(captured, () => ({ stream: modelStream([...textParts("resposta dois"), finish("stop")]) })) },
      { threadId: firstId, text: "segunda pergunta" },
    );
    assert.equal(turnTwo.status, 200);
    await readSse(turnTwo);
    await waitFor(() =>
      store.listMessages(firstId, { limit: 10 }).then((items) => (items.length === 4 ? items : null)),
    );

    assert.equal(captured.length, 1);
    const prompt = captured[0] as Array<{ content: unknown; role: string }>;
    assert.equal((prompt[0] as { role: string }).role, "system");
    assert.equal(String((prompt[0] as { content: unknown }).content), ASSISTANT_SYSTEM_PROMPT);
    assert.deepEqual(promptConversation(prompt), [
      { role: "user", text: "primeira pergunta" },
      { role: "assistant", text: "resposta um" },
      { role: "user", text: "segunda pergunta" },
    ]);
  });

  test("a second concurrent turn on the same thread gives 409 and the thread is released after", async () => {
    const { deps, store } = makeDeps();
    // Create the thread with an immediate turn.
    const setup = await postTurn({ ...deps, model: () => textModel("setup") }, { text: "thread setup" });
    assert.equal(setup.status, 200);
    const threadId = threadIdFromTurn(await readSse(setup));
    await waitFor(() =>
      store.listMessages(threadId, { limit: 10 }).then((items) => (items.length === 2 ? items : null)),
    );

    // Turn A is gated; turn B on the same thread must be refused while A runs.
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const turnA = await postTurn({ ...deps, model: () => gatedModel(gate) }, { threadId, text: "em andamento" });
    assert.equal(turnA.status, 200);
    const turnB = await postTurn(deps, { threadId, text: "na fila" });
    assert.equal(turnB.status, 409);
    const denied = (await turnB.json()) as { code: string; error: string };
    assert.equal(denied.code, "turn_in_progress");
    assert.ok(denied.error);

    // The user message of the refused turn was not persisted.
    const during = await store.listMessages(threadId, { limit: 10 });
    assert.deepEqual(
      during.map((message) => message.text),
      ["thread setup", "setup", "em andamento"],
    );

    // Release A; once its answer is stored the thread is free again.
    release();
    await readSse(turnA);
    await waitFor(() =>
      store.listMessages(threadId, { limit: 10 }).then((items) => (items.length === 4 ? items : null)),
    );
    const turnC = await postTurn({ ...deps, model: () => textModel("liberado") }, { threadId, text: "de novo" });
    assert.equal(turnC.status, 200);
    await readSse(turnC);
  });

  test("threads: pagination, detail, and delete (200 then 404)", async () => {
    const { deps, store } = makeDeps();
    await store.createThread({ id: T1, now: ISO(0), title: "t1" });
    await store.appendMessage({
      createdAt: ISO(10),
      errorCode: null,
      id: "amg_111111111111111111111111",
      role: "user",
      status: "final",
      text: "pergunta",
      threadId: T1,
    });
    await store.appendMessage({
      createdAt: ISO(20),
      errorCode: null,
      id: "amg_222222222222222222222222",
      role: "assistant",
      status: "final",
      text: "resposta",
      threadId: T1,
    });
    await store.createThread({ id: T2, now: ISO(30), title: "t2" });
    await store.createThread({ id: T3, now: ISO(40), title: "t3" });

    // Newest first by updatedAt, with the pagination limits.
    const page = await handleAssistantRequest(request("/api/assistant/threads?limit=2&offset=0"), deps);
    assert.equal(page.status, 200);
    const pageBody = (await page.json()) as { threads: { id: string }[] };
    assert.deepEqual(pageBody.threads.map((thread) => thread.id), [T3, T2]);
    const secondPage = (await (
      await handleAssistantRequest(request("/api/assistant/threads?limit=2&offset=1"), deps)
    ).json()) as { threads: { id: string }[] };
    assert.deepEqual(secondPage.threads.map((thread) => thread.id), [T2, T1]);
    const thirdPage = (await (
      await handleAssistantRequest(request("/api/assistant/threads?limit=2&offset=2"), deps)
    ).json()) as { threads: { id: string }[] };
    assert.deepEqual(thirdPage.threads.map((thread) => thread.id), [T1]);
    for (const query of ["limit=0", "limit=51", "limit=abc", "offset=-1"]) {
      const invalid = await handleAssistantRequest(request(`/api/assistant/threads?${query}`), deps);
      assert.equal(invalid.status, 400, query);
      assert.equal((await invalid.json()).code, "invalid_request", query);
    }

    // Detail with the messages in chronological order.
    const detail = await handleAssistantRequest(request(`/api/assistant/threads/${T1}`), deps);
    assert.equal(detail.status, 200);
    const detailBody = (await detail.json()) as {
      messages: { role: string; text: string }[];
      thread: { id: string; title: string };
    };
    assert.equal(detailBody.thread.id, T1);
    assert.deepEqual(
      detailBody.messages.map((message) => ({ role: message.role, text: message.text })),
      [
        { role: "user", text: "pergunta" },
        { role: "assistant", text: "resposta" },
      ],
    );

    // A malformed or unknown id is a 404 thread_not_found.
    for (const id of ["ath_bad", "ath_dddddddddddddddddddddddd", ""]) {
      const missing = await handleAssistantRequest(request(`/api/assistant/threads/${id}`), deps);
      assert.equal(missing.status, 404, id || "empty id");
      assert.equal((await missing.json()).code, "thread_not_found", id || "empty id");
    }

    // Delete: 200 once, then 404; the thread and its messages are gone.
    const deleted = await handleAssistantRequest(request(`/api/assistant/threads/${T1}`, { method: "DELETE" }), deps);
    assert.equal(deleted.status, 200);
    assert.deepEqual(await deleted.json(), { ok: true });
    assert.equal(await store.getThread(T1), null);
    const deletedAgain = await handleAssistantRequest(request(`/api/assistant/threads/${T1}`, { method: "DELETE" }), deps);
    assert.equal(deletedAgain.status, 404);
    assert.equal((await deletedAgain.json()).code, "thread_not_found");
  });

  test("a read tool called by the model reaches the toolHost with the MCP name", async () => {
    const calls: { args: Record<string, unknown>; name: string }[] = [];
    const host: AssistantToolHost = {
      callTool: async (name, args) => {
        calls.push({ args, name });
        return { sessions: ["S1"] };
      },
    };
    let step = 0;
    const { deps } = makeDeps({
      model: () =>
        mockModel(() => {
          step += 1;
          if (step === 1) {
            return {
              stream: modelStream([
                toolCallPart("tc1", "pinar_list_sessions", { limit: 1 }),
                finish("tool-calls", 3, 2),
              ]),
            };
          }
          return { stream: modelStream([...textParts("Existe 1 sessão: 'S1'."), finish("stop", 4, 6)]) };
        }),
      toolHost: host,
    });
    const response = await postTurn(deps, { text: "quantas sessões?" });
    assert.equal(response.status, 200);
    const body = await readSse(response);
    assert.ok(body.includes("Existe 1 sessão: 'S1'."));
    assert.equal(calls.length, 1);
    assert.equal(calls[0].name, "pinar.list_sessions", "the host receives the MCP name, not the LLM name");
    assert.deepEqual(calls[0].args, { limit: 1 });
  });
});
