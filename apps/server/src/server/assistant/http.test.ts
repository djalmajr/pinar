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
import { ASSISTANT_PROPOSAL_TTL_MS } from "./proposals";
import {
  FIXTURE_ID_PREFIX,
  fixtureHost,
  fixtureReader,
  fixtureWorld,
  worldView,
  type FixtureHost,
  type FixtureWorld,
} from "./proposals.test-helpers";
import type { AssistantStateReader } from "./state-reader";
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
    reader?: AssistantStateReader;
    status?: () => Promise<AssistantStatus>;
    toolHost?: AssistantToolHost;
    writeHost?: AssistantToolHost;
  } = {},
) {
  let ticks = 0;
  const now = overrides.now ?? (() => new Date(NOW + ++ticks * 1_000));
  const store: AssistantStore = cloudAssistantStore({}, "u1");
  const deps: AssistantRequestDeps = {
    endpoint: async () => FAKE_ENDPOINT,
    now,
    reader: overrides.reader ?? fixtureReader(fixtureWorld()),
    status: overrides.status ?? (async () => ({ available: true, reason: null })),
    store,
    surface: "local",
    toolHost: overrides.toolHost ?? { callTool: async () => ({ sessions: [] }) },
    writeHost: overrides.writeHost ?? {
      callTool: async () => {
        throw new Error("this test has no write host");
      },
    },
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
    assert.equal(response.headers.get("cache-control"), "no-store", "the answer stream is never stored");
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
      ask: null,
      createdAt: ISO(10),
      errorCode: null,
      id: "amg_111111111111111111111111",
      role: "user",
      status: "final",
      text: "pergunta",
      threadId: T1,
    });
    await store.appendMessage({
      ask: null,
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

  test("a failure outside the stream gives the sanitized 503 on every route, without logging it", async () => {
    const secret = "SYNTHETIC_PRIVATE_PATH";
    const failing = () => Promise.reject(new Error(secret));
    const cases: Array<{ deps: AssistantRequestDeps; init?: RequestInit; path: string }> = [];
    const statusFails = makeDeps({ status: failing }).deps;
    cases.push({ deps: statusFails, path: "/api/assistant/status" });
    cases.push({ deps: statusFails, init: { body: JSON.stringify({ text: "oi" }), method: "POST" }, path: "/api/assistant/turn" });
    const storeFails = makeDeps().deps;
    storeFails.store = {
      ...storeFails.store,
      createThread: failing,
      deleteThread: failing,
      getProposal: failing,
      getThread: failing,
      listThreads: failing,
      transitionProposal: failing,
    };
    cases.push({ deps: storeFails, path: "/api/assistant/threads" });
    cases.push({ deps: storeFails, path: `/api/assistant/threads/${T1}` });
    cases.push({ deps: storeFails, init: { method: "DELETE" }, path: `/api/assistant/threads/${T1}` });
    cases.push({ deps: storeFails, init: { body: JSON.stringify({ text: "oi" }), method: "POST" }, path: "/api/assistant/turn" });
    cases.push({ deps: storeFails, init: { body: JSON.stringify({ text: "oi", threadId: T1 }), method: "POST" }, path: "/api/assistant/turn" });
    for (const action of ["confirm", "reject", "undo"]) {
      cases.push({ deps: storeFails, init: { method: "POST" }, path: `/api/assistant/proposals/apr_aaaaaaaaaaaaaaaaaaaaaaaa/${action}` });
      cases.push({ deps: statusFails, init: { method: "POST" }, path: `/api/assistant/proposals/apr_aaaaaaaaaaaaaaaaaaaaaaaa/${action}` });
    }

    const logged: unknown[] = [];
    const original = { error: console.error, log: console.log, warn: console.warn };
    console.error = (...args: unknown[]) => { logged.push(args); };
    console.warn = (...args: unknown[]) => { logged.push(args); };
    console.log = (...args: unknown[]) => { logged.push(args); };
    try {
      for (const item of cases) {
        const response = await handleAssistantRequest(request(item.path, item.init), item.deps);
        assert.ok(response, item.path);
        assert.equal(response.status, 503, `${item.init?.method ?? "GET"} ${item.path}`);
        assert.equal(response.headers.get("cache-control"), "no-store");
        const text = await response.text();
        assert.deepEqual(JSON.parse(text), { code: "assistant_unavailable", error: "The assistant is unavailable" });
        assert.ok(!text.includes(secret));
      }
    } finally {
      Object.assign(console, original);
    }
    assert.ok(!JSON.stringify(logged).includes(secret), "nothing about the failure is logged");
  });
});

// ---------- F2: proposals over HTTP ----------

const fx = (suffix: string) => `${FIXTURE_ID_PREFIX}${suffix}`;

interface ProposalContext {
  clock: { ms: number };
  deps: AssistantRequestDeps;
  readCalls: string[];
  store: AssistantStore;
  world: FixtureWorld;
  writeHost: FixtureHost;
}

// The fixture world behind both the state reader and the write host; the
// turn's read host only records its calls and never writes, so a write
// that reached it would leave the world untouched.
function proposalContext(overrides: { status?: () => Promise<AssistantStatus>; writeHost?: (host: FixtureHost) => AssistantToolHost } = {}): ProposalContext {
  const world = fixtureWorld();
  const writeHost = fixtureHost(world);
  const readCalls: string[] = [];
  const clock = { ms: NOW };
  const { deps, store } = makeDeps({
    now: () => new Date((clock.ms += 1)),
    reader: fixtureReader(world),
    ...(overrides.status ? { status: overrides.status } : {}),
    toolHost: {
      callTool: async (name) => {
        readCalls.push(name);
        return { sessions: [] };
      },
    },
    writeHost: overrides.writeHost ? overrides.writeHost(writeHost) : writeHost,
  });
  return { clock, deps, readCalls, store, world, writeHost };
}

// A model that plays one parts list per step and records every prompt.
function scriptedModel(steps: ModelPart[][], captured?: unknown[][]): LanguageModel {
  let step = 0;
  return new MockLanguageModelV4({
    doStream: ((args: { prompt: unknown[] }) => {
      captured?.push(args.prompt);
      const parts = steps[Math.min(step, steps.length - 1)];
      step += 1;
      return { stream: modelStream(parts) };
    }) as unknown as MockLanguageModelV4["doStream"],
    modelId: "mock",
  });
}

interface ProposedTurn {
  messages: Array<{ ask: unknown; id: string; role: string; text: string }>;
  parts: Record<string, unknown>[];
  proposals: Array<Record<string, unknown> & { id: string }>;
  threadId: string;
}

// One turn whose first step calls `calls` and whose second step answers
// `answer`; waits until the assistant message is stored.
async function proposingTurn(
  ctx: ProposalContext,
  calls: ModelPart[],
  options: { answer?: string; captured?: unknown[][]; text?: string; threadId?: string } = {},
): Promise<ProposedTurn> {
  const before = options.threadId ? (await ctx.store.listMessages(options.threadId, { limit: 50 })).length : 0;
  const response = await postTurn(
    {
      ...ctx.deps,
      model: () =>
        scriptedModel(
          [
            [...calls, finish("tool-calls")],
            [...textParts(options.answer ?? "Propus a mudança; confirme no cartão."), finish("stop")],
          ],
          options.captured,
        ),
    },
    { text: options.text ?? "organiza isso", ...(options.threadId ? { threadId: options.threadId } : {}) },
  );
  assert.equal(response.status, 200);
  const body = await readSse(response);
  const threadId = threadIdFromTurn(body);
  const parts = sseDataParts(body);
  const messages = await waitFor(() =>
    ctx.store.listMessages(threadId, { limit: 50 }).then((items) => (items.length === before + 2 ? items : null)),
  );
  return {
    messages,
    parts,
    proposals: parts.filter((part) => part.type === "data-proposal").map((part) => part.data as Record<string, unknown> & { id: string }),
    threadId,
  };
}

async function proposalAction(deps: AssistantRequestDeps, id: string, action: string, method = "POST"): Promise<Response> {
  return handleAssistantRequest(request(`/api/assistant/proposals/${id}/${action}`, { method }), deps);
}

async function threadDetail(deps: AssistantRequestDeps, threadId: string) {
  const response = await handleAssistantRequest(request(`/api/assistant/threads/${threadId}`), deps);
  assert.equal(response.status, 200);
  return (await response.json()) as {
    messages: Array<{ ask: unknown; id: string; role: string; text: string }>;
    proposals: Array<Record<string, unknown> & { id: string; messageId: string; status: string }>;
    thread: { id: string };
  };
}

const MOVE_CALL = toolCallPart("tc-move", "pinar_move_session", { collectionId: fx("col-b"), sessionId: fx("session-2") });
const RENAME_CALL = toolCallPart("tc-rename", "pinar_rename_collection", { collectionId: fx("col-b"), name: "First run" });
const BATCH_CALL = toolCallPart("tc-batch", "pinar_rename_batch", { batchId: fx("batch-1"), label: "Sprint 13" });

describe("assistant proposals over http", () => {
  test("a write in the turn streams a proposed data-proposal, the detail lists it, and nothing is executed", async () => {
    const ctx = proposalContext();
    const before = worldView(ctx.world);
    const turn = await proposingTurn(ctx, [MOVE_CALL]);
    assert.equal(turn.proposals.length, 1);
    const [streamed] = turn.proposals;
    assert.equal(streamed.status, "proposed");
    assert.equal(streamed.tool, "pinar.move_session");
    assert.deepEqual(streamed.display, { action: "move_session", params: { collection: "Onboarding", session: "Payment form" } });
    for (const hidden of ["args", "fingerprint", "result", "undo", "summary"]) assert.ok(!(hidden in streamed), hidden);

    const detail = await threadDetail(ctx.deps, turn.threadId);
    assert.deepEqual(detail.proposals.map((item) => [item.id, item.status]), [[streamed.id, "proposed"]]);
    const assistant = detail.messages.find((message) => message.role === "assistant");
    assert.ok(assistant);
    assert.equal(detail.proposals[0].messageId, assistant.id, "the proposal belongs to the turn's assistant message");
    assert.equal(assistant.ask, null);

    assert.deepEqual(ctx.readCalls, [], "the read host is never called for a write");
    assert.deepEqual(ctx.writeHost.calls, [], "nothing runs before the confirmation");
    assert.deepEqual(worldView(ctx.world), before);
  });

  test("confirm runs once on the write host, undo restores the world, reject marks another", async () => {
    const ctx = proposalContext();
    const before = worldView(ctx.world);
    const turn = await proposingTurn(ctx, [MOVE_CALL, RENAME_CALL]);
    const move = turn.proposals.find((item) => item.tool === "pinar.move_session")!;
    const rename = turn.proposals.find((item) => item.tool === "pinar.rename_collection")!;

    const confirmed = await proposalAction(ctx.deps, move.id, "confirm");
    assert.equal(confirmed.status, 200);
    assert.equal(confirmed.headers.get("cache-control"), "no-store");
    const confirmedBody = (await confirmed.json()) as { proposal: Record<string, unknown> };
    assert.equal(confirmedBody.proposal.status, "executed");
    assert.equal(confirmedBody.proposal.errorCode, null);
    assert.equal(typeof confirmedBody.proposal.undoExpiresAt, "string");
    for (const hidden of ["args", "fingerprint", "result", "undo"]) assert.ok(!(hidden in confirmedBody.proposal), hidden);
    assert.deepEqual(ctx.writeHost.calls.map((call) => call.name), ["pinar.move_session"], "the write host ran it once");
    assert.deepEqual(ctx.readCalls, []);
    assert.equal(ctx.world.sessions.find((item) => item.id === fx("session-2"))?.collectionId, fx("col-b"));

    const undone = await proposalAction(ctx.deps, move.id, "undo");
    assert.equal(undone.status, 200);
    assert.equal(((await undone.json()) as { proposal: { status: string } }).proposal.status, "undone");
    assert.deepEqual(worldView(ctx.world), before, "undo restores the collection and the order");

    const calls = ctx.writeHost.calls.length;
    const rejected = await proposalAction(ctx.deps, rename.id, "reject");
    assert.equal(rejected.status, 200);
    assert.equal(((await rejected.json()) as { proposal: { status: string } }).proposal.status, "rejected");
    assert.equal(ctx.writeHost.calls.length, calls, "reject runs nothing");

    const detail = await threadDetail(ctx.deps, turn.threadId);
    assert.deepEqual(
      Object.fromEntries(detail.proposals.map((item) => [item.tool, item.status])),
      { "pinar.move_session": "undone", "pinar.rename_collection": "rejected" },
    );
  });

  test("the next turn's prompt carries each proposal's outcome after the assistant message", async () => {
    const ctx = proposalContext();
    const answer = "Propus mover a sessão e renomear a coleção.";
    const first = await proposingTurn(ctx, [MOVE_CALL, RENAME_CALL], { answer, text: "primeira pergunta" });
    const move = first.proposals.find((item) => item.tool === "pinar.move_session")!;
    const rename = first.proposals.find((item) => item.tool === "pinar.rename_collection")!;
    assert.equal((await proposalAction(ctx.deps, move.id, "confirm")).status, 200);
    assert.equal((await proposalAction(ctx.deps, rename.id, "reject")).status, 200);

    const captured: unknown[][] = [];
    const response = await postTurn(
      { ...ctx.deps, model: () => promptCapturingModel(captured, () => ({ stream: modelStream([...textParts("ok"), finish("stop")]) })) },
      { threadId: first.threadId, text: "segunda pergunta" },
    );
    assert.equal(response.status, 200);
    await readSse(response);
    const notes: Record<string, string> = {
      [move.id]: '[proposal executed: Move session "Payment form" to "Onboarding"]',
      [rename.id]: '[proposal rejected: Rename collection "Onboarding" to "First run"]',
    };
    // The notes follow the store order of the thread's proposals.
    const order = (await threadDetail(ctx.deps, first.threadId)).proposals.map((item) => notes[item.id]);
    assert.deepEqual(promptConversation(captured[0]), [
      { role: "user", text: "primeira pergunta" },
      { role: "assistant", text: [answer, ...order].join("\n") },
      { role: "user", text: "segunda pergunta" },
    ]);
  });

  test("an assistant message that failed after proposing still carries its notes; without proposals it stays out", async () => {
    const ctx = proposalContext();
    const response = await postTurn(
      {
        ...ctx.deps,
        model: () =>
          scriptedModel([
            [MOVE_CALL, finish("tool-calls")],
            [{ error: new Error("provider dropped"), type: "error" }],
          ]),
      },
      { text: "primeira pergunta" },
    );
    assert.equal(response.status, 200);
    const body = await readSse(response);
    const threadId = threadIdFromTurn(body);
    const move = sseDataParts(body).find((part) => part.type === "data-proposal")!.data as { id: string };
    const stored = await waitFor(() =>
      ctx.store.listMessages(threadId, { limit: 10 }).then((items) => (items.length === 2 ? items : null)),
    );
    assert.equal(stored[1].status, "error");
    assert.equal((await proposalAction(ctx.deps, move.id, "confirm")).status, 200);

    const captured: unknown[][] = [];
    const next = await postTurn(
      { ...ctx.deps, model: () => promptCapturingModel(captured, () => ({ stream: modelStream([...textParts("ok"), finish("stop")]) })) },
      { threadId, text: "segunda pergunta" },
    );
    assert.equal(next.status, 200);
    await readSse(next);
    assert.deepEqual(promptConversation(captured[0]), [
      { role: "user", text: "primeira pergunta" },
      { role: "assistant", text: '[proposal executed: Move session "Payment form" to "Onboarding"]' },
      { role: "user", text: "segunda pergunta" },
    ]);
  });

  test("a pinar_ask turn stores the assistant message with ask, and the detail returns it", async () => {
    const ctx = proposalContext();
    const ask = { options: ["Checkout", "Onboarding"], question: "Para qual coleção?" };
    const response = await postTurn(
      { ...ctx.deps, model: () => scriptedModel([[toolCallPart("tc-ask", "pinar_ask", ask), finish("tool-calls")]]) },
      { text: "move a sessão" },
    );
    assert.equal(response.status, 200);
    const body = await readSse(response);
    const threadId = threadIdFromTurn(body);
    assert.deepEqual(sseDataParts(body).filter((part) => part.type === "data-ask"), [{ data: ask, type: "data-ask" }]);
    const stored = await waitFor(() =>
      ctx.store.listMessages(threadId, { limit: 10 }).then((items) => (items.length === 2 ? items : null)),
    );
    assert.deepEqual(stored[1].ask, ask);
    assert.equal(stored[1].text, "Para qual coleção?");
    const detail = await threadDetail(ctx.deps, threadId);
    assert.deepEqual(detail.messages[1].ask, ask);
    assert.deepEqual(detail.messages[0].ask, null);
    assert.deepEqual(detail.proposals, []);
  });

  test("an invalid write or a missing entity goes back to the model as invalid_arguments, with no proposal", async () => {
    const ctx = proposalContext();
    const captured: unknown[][] = [];
    const turn = await proposingTurn(ctx, [
      toolCallPart("tc-bad", "pinar_move_session", { sessionId: 7 }),
      toolCallPart("tc-missing", "pinar_move_session", { collectionId: fx("col-b"), sessionId: fx("missing") }),
    ], { captured });
    assert.deepEqual(turn.proposals, []);
    const second = JSON.stringify(captured[1]);
    assert.ok(second.includes("invalid_arguments") && second.includes("session not found"), second.slice(-400));
    assert.deepEqual((await threadDetail(ctx.deps, turn.threadId)).proposals, []);
  });

  test("a store failure in the proposal sink is a generic tool error: no proposal, nothing logged", async () => {
    const ctx = proposalContext();
    const secret = "SYNTHETIC_SINK_SECRET";
    ctx.deps.store = { ...ctx.deps.store, createProposal: () => Promise.reject(new Error(secret)) };
    const logged: unknown[] = [];
    const original = { error: console.error, log: console.log, warn: console.warn };
    console.error = (...args: unknown[]) => { logged.push(args); };
    console.warn = (...args: unknown[]) => { logged.push(args); };
    console.log = (...args: unknown[]) => { logged.push(args); };
    const captured: unknown[][] = [];
    try {
      const turn = await proposingTurn(ctx, [MOVE_CALL], { captured });
      assert.deepEqual(turn.proposals, []);
      const second = JSON.stringify(captured[1]);
      assert.ok(second.includes("Tool failed"), second.slice(-300));
      assert.ok(!second.includes(secret) && !JSON.stringify(turn.parts).includes(secret));
    } finally {
      Object.assign(console, original);
    }
    assert.ok(!JSON.stringify(logged).includes(secret));
  });

  test("proposal routes answer the 404 and 409 codes of the contract", async () => {
    const ctx = proposalContext();
    // Malformed, undecodable or unknown ids, and a wrong method.
    for (const action of ["confirm", "reject", "undo"]) {
      for (const id of ["apr_bad", "nope", `apr_${"a".repeat(25)}`, "%E0%A4%A", "apr_aaaaaaaaaaaaaaaaaaaaaaaa"]) {
        const response = await proposalAction(ctx.deps, id, action);
        assert.equal(response.status, 404, `${action} ${id}`);
        assert.equal(((await response.json()) as { code: string }).code, "proposal_not_found", `${action} ${id}`);
      }
      const wrongMethod = await proposalAction(ctx.deps, "apr_aaaaaaaaaaaaaaaaaaaaaaaa", action, "GET");
      assert.equal(wrongMethod.status, 404);
      assert.equal(((await wrongMethod.json()) as { code: string }).code, "proposal_not_found");
    }

    const turn = await proposingTurn(ctx, [MOVE_CALL, RENAME_CALL, BATCH_CALL]);
    const byTool = (tool: string) => turn.proposals.find((item) => item.tool === tool)!.id;
    const move = byTool("pinar.move_session");
    const rename = byTool("pinar.rename_collection");
    const batch = byTool("pinar.rename_batch");
    const code = async (response: Response) => {
      assert.equal(response.status, 409);
      return ((await response.json()) as { code: string }).code;
    };

    // Not executed yet: nothing to undo.
    assert.equal(await code(await proposalAction(ctx.deps, rename, "undo")), "undo_unavailable");
    // Executed: reject is not pending, confirm again returns the stored record.
    assert.equal((await proposalAction(ctx.deps, move, "confirm")).status, 200);
    assert.equal(await code(await proposalAction(ctx.deps, move, "reject")), "proposal_not_pending");
    const again = await proposalAction(ctx.deps, move, "confirm");
    assert.equal(again.status, 200);
    assert.equal(((await again.json()) as { proposal: { status: string } }).proposal.status, "executed");
    assert.equal(ctx.writeHost.calls.length, 1, "confirming again never re-executes");
    // The world changed after the execution: undo_stale, nothing runs.
    ctx.world.sessions.push({ batchId: null, collectionId: fx("col-b"), id: fx("session-9"), title: "Late" });
    assert.equal(await code(await proposalAction(ctx.deps, move, "undo")), "undo_stale");
    assert.equal(ctx.writeHost.calls.length, 1);
    // Rejected: confirm and reject are not pending.
    assert.equal((await proposalAction(ctx.deps, rename, "reject")).status, 200);
    assert.equal(await code(await proposalAction(ctx.deps, rename, "confirm")), "proposal_not_pending");
    assert.equal(await code(await proposalAction(ctx.deps, rename, "reject")), "proposal_not_pending");
    // Past the TTL: proposal_expired, nothing runs.
    ctx.clock.ms += ASSISTANT_PROPOSAL_TTL_MS;
    assert.equal(await code(await proposalAction(ctx.deps, batch, "confirm")), "proposal_expired");
    assert.equal(ctx.writeHost.calls.length, 1);
  });

  test("confirm and undo while the write host runs answer 409 proposal_in_progress", async () => {
    let release: () => void = () => {};
    let entered: () => void = () => {};
    let gated = false;
    const ctx = proposalContext({
      writeHost: (host) => ({
        callTool: async (name, args) => {
          if (gated) {
            entered();
            await new Promise<void>((resolve) => {
              release = resolve;
            });
          }
          return host.callTool(name, args);
        },
      }),
    });
    const turn = await proposingTurn(ctx, [BATCH_CALL]);
    const id = turn.proposals[0].id;
    const hold = () => {
      gated = true;
      return new Promise<void>((resolve) => {
        entered = resolve;
      });
    };

    let inside = hold();
    const confirming = proposalAction(ctx.deps, id, "confirm");
    await inside;
    const busy = await proposalAction(ctx.deps, id, "confirm");
    assert.equal(busy.status, 409);
    assert.equal(((await busy.json()) as { code: string }).code, "proposal_in_progress");
    gated = false;
    release();
    assert.equal((await confirming).status, 200);

    inside = hold();
    const undoing = proposalAction(ctx.deps, id, "undo");
    await inside;
    const busyUndo = await proposalAction(ctx.deps, id, "undo");
    assert.equal(busyUndo.status, 409);
    assert.equal(((await busyUndo.json()) as { code: string }).code, "proposal_in_progress");
    gated = false;
    release();
    const done = await undoing;
    assert.equal(done.status, 200);
    assert.equal(((await done.json()) as { proposal: { status: string } }).proposal.status, "undone");
    assert.equal(ctx.writeHost.calls.length, 2);
  });

  test("proposal routes sit behind the status gate: requires_pro 403, the rest 503", async () => {
    for (const [reason, status, expected] of [
      ["requires_pro", 403, "assistant_requires_pro"],
      ["not_configured", 503, "assistant_unavailable"],
      ["disabled", 503, "assistant_unavailable"],
    ] as const) {
      const ctx = proposalContext({ status: async () => ({ available: false, reason }) });
      for (const action of ["confirm", "reject", "undo"]) {
        const response = await proposalAction(ctx.deps, "apr_aaaaaaaaaaaaaaaaaaaaaaaa", action);
        assert.equal(response.status, status, `${reason} ${action}`);
        assert.equal(((await response.json()) as { code: string }).code, expected);
      }
      assert.deepEqual(ctx.writeHost.calls, []);
    }
  });
});
