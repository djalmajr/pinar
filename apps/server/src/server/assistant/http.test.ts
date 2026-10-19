import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, test } from "node:test";
import type { LanguageModel } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { createClient } from "@libsql/client";
import { createLibsqlD1 } from "../edger/libsql-d1";
import { ASSISTANT_SYSTEM_PROMPT } from "./prompt";
import {
  cloudAssistantStore,
  resetCloudAssistantMemoryForTests,
} from "./store-cloud";
import type { AssistantMessage, AssistantStore } from "./store";
import { ASSISTANT_CHAIN_METADATA_KEY } from "./chain";
import {
  ASSISTANT_TURN_CLIENT_CANCELLED,
  handleAssistantRequest,
  type AssistantRequestDeps,
  type AssistantStatus,
  type AssistantTurnCharge,
  type AssistantTurnReservation,
} from "./http";
import { ASSISTANT_PROPOSAL_TTL_MS } from "./proposals";
import { encodeAssistantTurnTerminal } from "../../lib/assistant-turn-terminal";
import { fakeTurnClock, pushableStream } from "./deadline.test-helpers";
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
    assert.equal(errorPart.errorText, JSON.stringify({ code: "ASSISTANT_STREAM_FAILED", phase: "model", retryable: true }));
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

  test("deps.pinSearch reaches the turn: pinar_pins_search is offered and called; without it, it is not offered", async () => {
    const searches: Array<{ limit: number; query: string; signal?: AbortSignal }> = [];
    const pinSearch = {
      async search(input: { limit: number; query: string }) {
        searches.push(input);
        return {
          hits: [{ caption: null, comment: "Contraste baixo", number: 3, pinId: "p3", score: 0.9, sessionId: "s1", sessionTitle: "Checkout", url: "https://site.example/c" }],
          semantic: true,
        };
      },
    };
    const offered: string[][] = [];
    const toolResults: unknown[] = [];
    const scripted = () => {
      let step = 0;
      return () =>
        new MockLanguageModelV4({
          doStream: ((options: { prompt: Array<{ content: unknown; role: string }>; tools?: Array<{ name: string }> }) => {
            step += 1;
            if (step === 1) {
              offered.push((options.tools ?? []).map((item) => item.name).sort());
              return { stream: modelStream([toolCallPart("tc1", "pinar_pins_search", { query: "contraste" }), finish("tool-calls", 3, 2)]) };
            }
            toolResults.push(options.prompt.filter((message) => message.role === "tool").map((message) => message.content));
            return { stream: modelStream([...textParts("Achei 1 pin."), finish("stop", 4, 6)]) };
          }) as unknown as MockLanguageModelV4["doStream"],
          modelId: "mock",
        });
    };

    const withSearch = makeDeps({ model: scripted() }).deps;
    withSearch.pinSearch = pinSearch;
    const response = await postTurn(withSearch, { text: "onde falei de contraste?" });
    assert.equal(response.status, 200);
    assert.ok((await readSse(response)).includes("Achei 1 pin."));
    assert.ok(offered[0]!.includes("pinar_pins_search"));
    assert.deepEqual(searches.map(({ limit, query }) => ({ limit, query })), [{ limit: 20, query: "contraste" }]);
    assert.ok(searches[0]!.signal instanceof AbortSignal, "the turn's signal reaches the search through the handler");
    assert.ok(JSON.stringify(toolResults[0]).includes("Contraste baixo"), "the hit reaches the model as the tool result");

    const withoutSearch = makeDeps({ model: scripted() }).deps;
    const second = await postTurn(withoutSearch, { text: "onde falei de contraste?" });
    assert.equal(second.status, 200);
    await readSse(second);
    assert.ok(!offered[1]!.includes("pinar_pins_search"));
    assert.ok(offered[1]!.includes("pinar_list_sessions"), "the other reads are still offered");
    assert.equal(searches.length, 1);
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

  test("proposal routes sit behind the status gate: requires_pro 403, the rest 503, whatever the id", async () => {
    // A well-formed id, a malformed one and one that does not decode: the
    // gate answers first for all of them.
    const ids = ["apr_aaaaaaaaaaaaaaaaaaaaaaaa", "apr_bad", "%E0%A4%A"];
    for (const [reason, status, expected] of [
      ["requires_pro", 403, "assistant_requires_pro"],
      ["not_configured", 503, "assistant_unavailable"],
      ["disabled", 503, "assistant_unavailable"],
    ] as const) {
      let gateCalls = 0;
      const ctx = proposalContext({
        status: async () => {
          gateCalls += 1;
          return { available: false, reason };
        },
      });
      for (const action of ["confirm", "reject", "undo"]) {
        for (const id of ids) {
          const before = gateCalls;
          const response = await proposalAction(ctx.deps, id, action);
          assert.equal(response.status, status, `${reason} ${action} ${id}`);
          assert.equal(((await response.json()) as { code: string }).code, expected, `${reason} ${action} ${id}`);
          assert.equal(gateCalls, before + 1, `the gate ran for ${action} ${id}`);
        }
      }
      assert.deepEqual(ctx.writeHost.calls, []);
    }
    // With the gate open, the malformed and the undecodable ids are 404.
    const open = proposalContext();
    for (const action of ["confirm", "reject", "undo"]) {
      for (const id of ["apr_bad", "%E0%A4%A"]) {
        const response = await proposalAction(open.deps, id, action);
        assert.equal(response.status, 404, `${action} ${id}`);
        assert.equal(((await response.json()) as { code: string }).code, "proposal_not_found", `${action} ${id}`);
      }
    }
  });
});

// ---------- F4/S2: the turn's credits (meterTurn) ----------

interface MeterLog {
  consumed: AssistantTurnCharge[];
  events: string[];
  refunded: string[];
  reserved: Array<{ messageId: string; threadId: string }>;
}

// A fake meter that records each reservation and how it ended; `balance`
// null reserves, a number refuses with that balance. The first
// `failedSettlements` endings throw (a transient database error), logged as
// "consume failed" / "refund failed".
function fakeMeter(
  balance: number | null = null,
  options: { failedSettlements?: number } = {},
): { log: MeterLog; meterTurn: NonNullable<AssistantRequestDeps["meterTurn"]> } {
  const log: MeterLog = { consumed: [], events: [], refunded: [], reserved: [] };
  let failures = options.failedSettlements ?? 0;
  const failing = (ending: string) => {
    if (failures === 0) return false;
    failures -= 1;
    log.events.push(`${ending} failed`);
    return true;
  };
  return {
    log,
    meterTurn: async (turn): Promise<AssistantTurnReservation> => {
      log.events.push("reserve");
      if (balance !== null) return { aiCredits: { balance, nextExpiryAt: null }, creditsRequired: 3, reserved: false };
      log.reserved.push(turn);
      return {
        consume: async (charge) => {
          if (failing("consume")) throw new Error("D1_ERROR: database is locked");
          log.events.push("consume");
          log.consumed.push(charge);
        },
        refund: async (code) => {
          if (failing("refund")) throw new Error("D1_ERROR: database is locked");
          log.events.push("refund");
          log.refunded.push(code);
        },
        reserved: true,
      };
    },
  };
}

async function settled(log: MeterLog) {
  return waitFor(() => (log.consumed.length + log.refunded.length > 0 ? log : null));
}

// A model whose finish carries the chain's billing metadata, as chain.ts
// adds it.
function chainBilledModel(text: string): LanguageModel {
  return mockModel(() => ({
    stream: modelStream([
      ...textParts(text),
      {
        ...finish("stop", 120, 30),
        providerMetadata: {
          [ASSISTANT_CHAIN_METADATA_KEY]: { costSource: "gateway", costUsdMicros: 4541, fallback: true, link: 1, model: "gateway:deepseek/deepseek-v4.1-flash" },
        },
      },
    ]),
  }));
}

describe("assistant turn credits (meterTurn)", () => {
  test("a final turn reserves under its assistant message and consumes with the chain's billing", async () => {
    const { deps, store } = makeDeps({ model: () => chainBilledModel("Duas sessões.") });
    const meter = fakeMeter();
    const response = await postTurn({ ...deps, meterTurn: meter.meterTurn }, { text: "Quantas sessões?" });
    assert.equal(response.status, 200);
    const threadId = threadIdFromTurn(await readSse(response));
    await settled(meter.log);
    const messages = await waitFor(() => store.listMessages(threadId, { limit: 10 }).then((items) => (items.length === 2 ? items : null)));
    assert.deepEqual(meter.log.reserved, [{ messageId: messages[1].id, threadId }]);
    assert.deepEqual(meter.log.consumed, [{
      costUsdMicros: 4541,
      inputTokens: 120,
      model: "gateway:deepseek/deepseek-v4.1-flash",
      outputTokens: 30,
      resultJson: JSON.stringify({ costSource: "gateway", fallback: true, link: 1 }),
    }]);
    assert.deepEqual(meter.log.refunded, []);
  });

  test("without billing the charge uses the endpoint's model and an unknown cost", async () => {
    const { deps } = makeDeps({ model: () => textModel("ok") });
    const meter = fakeMeter();
    await readSse(await postTurn({ ...deps, meterTurn: meter.meterTurn }, { text: "oi" }));
    await settled(meter.log);
    assert.deepEqual(meter.log.consumed, [{
      costUsdMicros: null,
      inputTokens: 3,
      model: FAKE_ENDPOINT.model,
      outputTokens: 5,
      resultJson: JSON.stringify({ costSource: "none", fallback: false, link: 0 }),
    }]);
  });

  test("an intentional stop (pinar_ask) consumes like a final", async () => {
    const ctx = proposalContext();
    const meter = fakeMeter();
    const ask = { options: ["A", "B"], question: "Qual?" };
    await readSse(await postTurn(
      { ...ctx.deps, meterTurn: meter.meterTurn, model: () => scriptedModel([[toolCallPart("tc-ask", "pinar_ask", ask), finish("tool-calls")]]) },
      { text: "move" },
    ));
    await settled(meter.log);
    assert.equal(meter.log.consumed.length, 1);
    assert.deepEqual(meter.log.refunded, []);
  });

  const refunds: Array<[string, () => LanguageModel, string]> = [
    ["a missing final (only a wait notice)", () => textModel("Vou verificar."), "ASSISTANT_TURN_INCOMPLETE"],
    ["a stream error", failingModel, "ASSISTANT_STREAM_FAILED"],
  ];
  for (const [name, model, code] of refunds) {
    test(`${name} refunds with ${code} and never consumes`, async () => {
      const { deps } = makeDeps({ model });
      const meter = fakeMeter();
      await readSse(await postTurn({ ...deps, meterTurn: meter.meterTurn }, { text: "oi" }));
      await settled(meter.log);
      assert.deepEqual(meter.log.refunded, [code]);
      assert.deepEqual(meter.log.consumed, []);
    });
  }

  test("an exception after the reservation answers 503 and refunds", async () => {
    const { deps } = makeDeps({
      model: () => {
        throw new Error("model setup broke");
      },
    });
    const meter = fakeMeter();
    const response = await postTurn({ ...deps, meterTurn: meter.meterTurn }, { text: "oi" });
    assert.equal(response.status, 503);
    assert.equal(((await response.json()) as { code: string }).code, "assistant_unavailable");
    assert.deepEqual(meter.log.events, ["reserve", "refund"]);
    assert.deepEqual(meter.log.refunded, ["assistant_unavailable"]);
  });

  test("a client that leaves before the first token is refunded, even when the turn ends final", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { deps, store } = makeDeps({ model: () => gatedModel(gate) });
    const meter = fakeMeter();
    const response = await postTurn({ ...deps, meterTurn: meter.meterTurn }, { text: "oi" });
    assert.equal(response.status, 200);
    const reader = response.body!.getReader();
    const first = new TextDecoder().decode((await reader.read()).value);
    assert.ok(first.includes("data-thread") && !first.includes("text-delta"), first);
    await reader.cancel();
    release();
    await settled(meter.log);
    assert.deepEqual(meter.log.refunded, [ASSISTANT_TURN_CLIENT_CANCELLED]);
    assert.deepEqual(meter.log.consumed, []);
    // The answer is still stored: the turn ran to the end.
    const threads = await store.listThreads({ limit: 5, offset: 0 });
    const messages = await waitFor(() => store.listMessages(threads[0].id, { limit: 10 }).then((items) => (items.length === 2 ? items : null)));
    assert.equal(messages[1].status, "final");
  });

  test("a client that leaves after the first token still pays", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { deps } = makeDeps({ model: () => gatedModel(gate) });
    const meter = fakeMeter();
    const response = await postTurn({ ...deps, meterTurn: meter.meterTurn }, { text: "oi" });
    const reader = response.body!.getReader();
    release();
    let seen = "";
    while (!seen.includes("text-delta")) {
      const next = await reader.read();
      assert.equal(next.done, false, "the stream ended before the first token");
      seen += new TextDecoder().decode(next.value);
    }
    await reader.cancel();
    await settled(meter.log);
    assert.equal(meter.log.consumed.length, 1);
    assert.deepEqual(meter.log.refunded, []);
  });

  test("without credits: 402 with the balance, the model is never called and no assistant message is stored", async () => {
    let modelCalls = 0;
    const { deps, store } = makeDeps({
      model: () => {
        modelCalls += 1;
        return textModel("nunca");
      },
    });
    const meter = fakeMeter(2);
    const response = await postTurn({ ...deps, meterTurn: meter.meterTurn }, { text: "oi" });
    assert.equal(response.status, 402);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.deepEqual(await response.json(), {
      aiCredits: { balance: 2, nextExpiryAt: null },
      code: "insufficient_ai_credits",
      creditsRequired: 3,
      error: "Not enough AI credits",
    });
    assert.equal(modelCalls, 0);
    const [thread] = await store.listThreads({ limit: 5, offset: 0 });
    const messages = await store.listMessages(thread.id, { limit: 10 });
    assert.deepEqual(messages.map((message) => message.role), ["user"]);
    // The thread is released: the next turn on it is admitted.
    const next = await postTurn({ ...deps, meterTurn: fakeMeter().meterTurn }, { text: "de novo", threadId: thread.id });
    assert.equal(next.status, 200);
    await readSse(next);
  });

  test("the reservation comes after the endpoint check and the thread lock", async () => {
    const meter = fakeMeter();
    const { deps } = makeDeps({ model: () => textModel("ok") });
    const unavailable = await postTurn({ ...deps, endpoint: async () => null, meterTurn: meter.meterTurn }, { text: "oi" });
    assert.equal(unavailable.status, 503);
    assert.deepEqual(meter.log.events, []);

    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const busy = makeDeps({ model: () => gatedModel(gate) });
    const first = await postTurn({ ...busy.deps, meterTurn: meter.meterTurn }, { text: "primeira" });
    const reader = first.body!.getReader();
    const threadId = threadIdFromTurn(new TextDecoder().decode((await reader.read()).value));
    const second = await postTurn({ ...busy.deps, meterTurn: meter.meterTurn }, { text: "segunda", threadId });
    assert.equal(second.status, 409);
    assert.deepEqual(meter.log.events, ["reserve"]);
    release();
    while (!(await reader.read()).done);
    await settled(meter.log);
  });

  // ---- A39 complement: the settlement waits for the outcome and the delivery ----

  test("a final that settles before a slow client cancels is refunded: the delivery decides, not the order", async () => {
    const { deps, store } = makeDeps({ model: () => textModel("Resposta pronta.") });
    const meter = fakeMeter();
    const response = await postTurn({ ...deps, meterTurn: meter.meterTurn }, { text: "oi" });
    assert.equal(response.status, 200);
    // The model is done and its answer stored before the client reads anything.
    const [thread] = await store.listThreads({ limit: 5, offset: 0 });
    const messages = await waitFor(() => store.listMessages(thread.id, { limit: 10 }).then((items) => (items.length === 2 ? items : null)));
    assert.equal(messages[1].status, "final");
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.deepEqual(meter.log.events, ["reserve"], "a final waits for the delivery");
    const reader = response.body!.getReader();
    const first = new TextDecoder().decode((await reader.read()).value);
    assert.ok(first.includes("data-thread") && !first.includes("text-delta"), first);
    await reader.cancel();
    await settled(meter.log);
    assert.deepEqual(meter.log.refunded, [ASSISTANT_TURN_CLIENT_CANCELLED]);
    assert.deepEqual(meter.log.consumed, []);
  });

  test("a first token queued behind the last read, never read, does not count as delivered", async () => {
    const { deps, store } = makeDeps({ model: () => textModel("Resposta pronta.") });
    const meter = fakeMeter();
    const response = await postTurn({ ...deps, meterTurn: meter.meterTurn }, { text: "oi" });
    const [thread] = await store.listThreads({ limit: 5, offset: 0 });
    await waitFor(() => store.listMessages(thread.id, { limit: 10 }).then((items) => (items.length === 2 ? items : null)));
    const reader = response.body!.getReader();
    let seen = "";
    // Up to the part right before the first token; the client stalls there
    // (time enough for a read-ahead to take the next part) and leaves.
    while (!seen.includes('"type":"text-start"')) {
      const next = await reader.read();
      assert.equal(next.done, false, "the stream ended before the text started");
      seen += new TextDecoder().decode(next.value);
    }
    assert.ok(!seen.includes("text-delta"), seen);
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.deepEqual(meter.log.events, ["reserve"]);
    await reader.cancel();
    await settled(meter.log);
    assert.deepEqual(meter.log.refunded, [ASSISTANT_TURN_CLIENT_CANCELLED]);
  });

  test("a final that settles before the client reads is consumed once the first token is read", async () => {
    const { deps, store } = makeDeps({ model: () => textModel("Resposta pronta.") });
    const meter = fakeMeter();
    const response = await postTurn({ ...deps, meterTurn: meter.meterTurn }, { text: "oi" });
    const [thread] = await store.listThreads({ limit: 5, offset: 0 });
    await waitFor(() => store.listMessages(thread.id, { limit: 10 }).then((items) => (items.length === 2 ? items : null)));
    const reader = response.body!.getReader();
    let seen = "";
    while (!seen.includes("text-delta")) {
      const next = await reader.read();
      assert.equal(next.done, false, "the stream ended before the first token");
      seen += new TextDecoder().decode(next.value);
    }
    await reader.cancel();
    await settled(meter.log);
    assert.deepEqual(meter.log.events, ["reserve", "consume"]);
  });

  test("a final whose body is never read nor cancelled stays reserved, and its thread is free again", async () => {
    const { deps, store } = makeDeps({ model: () => textModel("Resposta pronta.") });
    const meter = fakeMeter();
    const response = await postTurn({ ...deps, meterTurn: meter.meterTurn }, { text: "oi" });
    const [thread] = await store.listThreads({ limit: 5, offset: 0 });
    await waitFor(() => store.listMessages(thread.id, { limit: 10 }).then((items) => (items.length === 2 ? items : null)));
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.deepEqual(meter.log.events, ["reserve"], "neither consumed nor refunded: the sweeper settles it");
    const next = await postTurn({ ...deps, meterTurn: fakeMeter().meterTurn }, { text: "de novo", threadId: thread.id });
    assert.equal(next.status, 200);
    await readSse(next);
    // A late read still decides it.
    await readSse(response);
    await settled(meter.log);
    assert.deepEqual(meter.log.events, ["reserve", "consume"]);
  });

  test("settling an earlier turn never frees the lock a newer turn of the same thread holds", async () => {
    let releaseB!: () => void;
    const holdB = new Promise<void>((resolve) => {
      releaseB = resolve;
    });
    let calls = 0;
    const { deps, store } = makeDeps({
      model: () => {
        calls += 1;
        return calls === 1 ? textModel("Resposta A.") : gatedModel(holdB);
      },
    });
    const meter = fakeMeter();
    const charged = { ...deps, meterTurn: meter.meterTurn };
    // A is stored but its body is not read yet, so its credits wait.
    const a = await postTurn(charged, { text: "A" });
    const [thread] = await store.listThreads({ limit: 5, offset: 0 });
    await waitFor(() => store.listMessages(thread.id, { limit: 10 }).then((items) => (items.length === 2 ? items : null)));
    // B takes the thread and blocks in the model.
    const b = await postTurn(charged, { text: "B", threadId: thread.id });
    assert.equal(b.status, 200);
    assert.equal((await postTurn(charged, { text: "C", threadId: thread.id })).status, 409);
    // Reading A settles it; B still holds the thread.
    await readSse(a);
    await waitFor(() => (meter.log.events.includes("consume") ? true : null));
    const c = await postTurn(charged, { text: "C again", threadId: thread.id });
    assert.equal(c.status, 409, "A's settlement must not release B's lock");
    assert.equal(calls, 2);
    releaseB();
    await readSse(b);
  });

  test("an error refunds without waiting for the delivery", async () => {
    const { deps } = makeDeps({ model: failingModel });
    const meter = fakeMeter();
    const response = await postTurn({ ...deps, meterTurn: meter.meterTurn }, { text: "oi" });
    assert.equal(response.status, 200);
    await settled(meter.log);
    assert.deepEqual(meter.log.refunded, ["ASSISTANT_STREAM_FAILED"]);
    await response.body!.cancel();
    assert.deepEqual(meter.log.events, ["reserve", "refund"]);
  });

  test("a missing final cancelled before its first token keeps its own code", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const waitNotice = mockModel(() => ({
      stream: new ReadableStream<unknown>({
        async start(controller) {
          await gate;
          for (const part of [...textParts("Vou verificar."), finish("stop")]) controller.enqueue(part);
          controller.close();
        },
      }),
    }));
    const { deps } = makeDeps({ model: () => waitNotice });
    const meter = fakeMeter();
    const response = await postTurn({ ...deps, meterTurn: meter.meterTurn }, { text: "oi" });
    const reader = response.body!.getReader();
    await reader.read();
    await reader.cancel();
    release();
    await settled(meter.log);
    assert.deepEqual(meter.log.refunded, ["ASSISTANT_TURN_INCOMPLETE"]);
  });

  test("a settlement that fails once is tried again; a second failure leaves it to the sweeper", async () => {
    const once = fakeMeter(null, { failedSettlements: 1 });
    const { deps } = makeDeps({ model: () => textModel("ok") });
    await readSse(await postTurn({ ...deps, meterTurn: once.meterTurn }, { text: "oi" }));
    await settled(once.log);
    assert.deepEqual(once.log.events, ["reserve", "consume failed", "consume"]);

    const twice = fakeMeter(null, { failedSettlements: 2 });
    const failing = makeDeps({ model: failingModel });
    await readSse(await postTurn({ ...failing.deps, meterTurn: twice.meterTurn }, { text: "oi" }));
    await waitFor(() => (twice.log.events.length === 3 ? twice.log : null));
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.deepEqual(twice.log.events, ["reserve", "refund failed", "refund failed"]);
  });

  test("a reservation that already existed answers 409 assistant_turn_in_progress: no model, no settlement", async () => {
    let modelCalls = 0;
    const { deps, store } = makeDeps({
      model: () => {
        modelCalls += 1;
        return textModel("nunca");
      },
    });
    const events: string[] = [];
    const response = await postTurn({
      ...deps,
      meterTurn: async () => {
        events.push("reserve");
        return { inProgress: true, reserved: false };
      },
    }, { text: "oi" });
    assert.equal(response.status, 409);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.deepEqual(await response.json(), { code: "assistant_turn_in_progress", error: "This turn is already running" });
    assert.equal(modelCalls, 0);
    assert.deepEqual(events, ["reserve"]);
    // The user message stored before the reservation stays; no assistant message.
    const [thread] = await store.listThreads({ limit: 5, offset: 0 });
    assert.deepEqual((await store.listMessages(thread.id, { limit: 10 })).map((message) => message.role), ["user"]);
    // The thread is released.
    const next = await postTurn({ ...deps, meterTurn: fakeMeter().meterTurn }, { text: "de novo", threadId: thread.id });
    assert.equal(next.status, 200);
    await readSse(next);
  });

  test("confirming and undoing a proposal is not a turn and never reaches the meter", async () => {
    const ctx = proposalContext();
    const meter = fakeMeter();
    const deps = { ...ctx.deps, meterTurn: meter.meterTurn };
    const turn = await proposingTurn({ ...ctx, deps }, [MOVE_CALL]);
    await settled(meter.log);
    assert.deepEqual(meter.log.events, ["reserve", "consume"]);
    const [proposal] = turn.proposals;
    assert.equal((await proposalAction(deps, proposal.id, "confirm")).status, 200);
    assert.equal((await proposalAction(deps, proposal.id, "undo")).status, 200);
    assert.deepEqual(meter.log.events, ["reserve", "consume"]);
  });
});

// ---------- the turn's budget over http (deadline.ts), on a fake clock ----------

describe("assistant turn deadlines over http", () => {
  const timeoutBody = { code: "ASSISTANT_TURN_TIMEOUT", error: "The assistant took too long to answer", phase: "turn", retryable: true };

  test("a budget spent before the stream answers 504 with the typed code, and the model never runs", async () => {
    const clock = fakeTurnClock();
    let modelCalls = 0;
    const { deps } = makeDeps({
      model: () => {
        modelCalls += 1;
        return textModel("nunca");
      },
      status: () => new Promise<AssistantStatus>(() => {}),
    });
    const pending = postTurn({ ...deps, clock }, { text: "oi" });
    await clock.advance(239_999);
    let answered = false;
    void pending.then(() => {
      answered = true;
    });
    await clock.advance(0);
    assert.equal(answered, false, "under 240 s the request still waits");
    await clock.advance(1);
    const response = await pending;
    assert.equal(response.status, 504);
    assert.deepEqual(await response.json(), timeoutBody);
    assert.equal(modelCalls, 0);
    assert.equal(clock.pending(), 0, "the budget's timer is disposed");
  });

  test("a reservation that arrives after the budget ran out is refunded, and the thread is free again", async () => {
    const clock = fakeTurnClock();
    const { deps } = makeDeps({ model: () => textModel("ok") });
    const log: string[] = [];
    let resolveReservation!: (reservation: AssistantTurnReservation) => void;
    const meterTurn: NonNullable<AssistantRequestDeps["meterTurn"]> = () =>
      new Promise((resolve) => {
        resolveReservation = resolve;
      });
    const pending = postTurn({ ...deps, clock, meterTurn }, { text: "oi" });
    await clock.advance(240_000);
    const response = await pending;
    assert.equal(response.status, 504);
    assert.deepEqual(await response.json(), timeoutBody);
    resolveReservation({
      consume: async () => {
        log.push("consume");
      },
      refund: async (code) => {
        log.push(`refund ${code}`);
      },
      reserved: true,
    });
    await waitFor(() => (log.length > 0 ? log : null));
    assert.deepEqual(log, ["refund ASSISTANT_TURN_TIMEOUT"]);
    // The thread lock went with the 504: the next turn of that thread runs.
    const threads = await deps.store.listThreads({ limit: 10, offset: 0 });
    assert.equal(threads.length, 1);
    const next = await postTurn({ ...deps, clock }, { text: "de novo", threadId: threads[0].id });
    assert.equal(next.status, 200);
    await readSse(next);
  });

  test("a BYOK route that arrives after the budget ran out frees its slot", async () => {
    const clock = fakeTurnClock();
    const { deps } = makeDeps();
    let released = 0;
    let resolveRoute!: (route: Awaited<ReturnType<NonNullable<AssistantRequestDeps["byokTurn"]>>>) => void;
    const byokTurn: NonNullable<AssistantRequestDeps["byokTurn"]> = () =>
      new Promise((resolve) => {
        resolveRoute = resolve;
      });
    const pending = postTurn({ ...deps, byokTurn, clock }, { text: "oi" });
    await clock.advance(240_000);
    assert.equal((await pending).status, 504);
    resolveRoute({
      endpoint: FAKE_ENDPOINT,
      kind: "route",
      model: textModel("nunca"),
      pinSearch: { search: async () => [] },
      release: () => {
        released += 1;
      },
    });
    await waitFor(() => (released > 0 ? released : null));
    assert.equal(released, 1);
  });

  test("the budget starts with the request: 100 s before the stream leave 140 s to the attempt (turn phase)", async () => {
    const clock = fakeTurnClock();
    const feed = pushableStream();
    const { deps } = makeDeps({ model: () => mockModel(() => ({ stream: feed.stream })) });
    const slowStore: AssistantStore = {
      ...deps.store,
      listMessages: async (threadId, options) => {
        await new Promise((resolve) => clock.setTimeout(() => resolve(undefined), 100_000));
        return deps.store.listMessages(threadId, options);
      },
    };
    const pending = postTurn({ ...deps, clock, store: slowStore }, { text: "oi" });
    await clock.advance(100_000);
    const response = await pending;
    assert.equal(response.status, 200);
    const reading = readSse(response);
    feed.push({ id: "t1", type: "text-start" });
    for (let index = 0; index < 4; index++) {
      await clock.advance(30_000);
      feed.push({ delta: ".", id: "t1", type: "text-delta" });
    }
    await clock.advance(20_000);
    const body = await reading;
    const errors = sseDataParts(body).filter((part) => part.type === "error");
    assert.deepEqual(errors, [{ errorText: encodeAssistantTurnTerminal({ code: "ASSISTANT_TURN_TIMEOUT", phase: "turn", retryable: true }), type: "error" }]);
  });

  test("a turn that times out mid-stream refunds its credits with ASSISTANT_TURN_TIMEOUT and stores the code", async () => {
    const clock = fakeTurnClock();
    const feed = pushableStream();
    const { deps, store } = makeDeps({ model: () => mockModel(() => ({ stream: feed.stream })) });
    const meter = fakeMeter();
    const response = await postTurn({ ...deps, clock, meterTurn: meter.meterTurn }, { text: "oi" });
    assert.equal(response.status, 200);
    const reading = readSse(response);
    feed.push({ id: "t1", type: "text-start" });
    await clock.advance(60_000);
    const body = await reading;
    await settled(meter.log);
    assert.deepEqual(meter.log.refunded, ["ASSISTANT_TURN_TIMEOUT"]);
    assert.deepEqual(meter.log.consumed, []);
    const errors = sseDataParts(body).filter((part) => part.type === "error");
    assert.deepEqual(errors, [{ errorText: encodeAssistantTurnTerminal({ code: "ASSISTANT_TURN_TIMEOUT", phase: "inactivity", retryable: true }), type: "error" }]);
    const threadId = threadIdFromTurn(body);
    const messages = await waitFor(() => store.listMessages(threadId, { limit: 10 }).then((items) => (items.length === 2 ? items : null)));
    assert.equal(messages[1].errorCode, "ASSISTANT_TURN_TIMEOUT");
  });

  // The first user-message write of the store hangs until released; the
  // write then goes on to the real store (or fails, with `fail`).
  function heldFirstUserWrite(store: AssistantStore, options: { fail?: boolean } = {}) {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let held = false;
    const heldStore: AssistantStore = {
      ...store,
      appendMessage: (message: AssistantMessage) => {
        if (held || message.role !== "user") return store.appendMessage(message);
        held = true;
        return gate.then(() => {
          if (options.fail) throw new Error("D1_ERROR: database is locked");
          return store.appendMessage(message);
        });
      },
    };
    return { release, store: heldStore };
  }

  // A model that records each prompt it gets and answers "resposta".
  function promptRecorder() {
    const prompts: string[] = [];
    const model = () =>
      new MockLanguageModelV4({
        doStream: (async (options: { prompt: unknown }) => {
          prompts.push(JSON.stringify(options.prompt));
          return { stream: modelStream([...textParts("resposta"), finish("stop")]) };
        }) as unknown as MockLanguageModelV4["doStream"],
        modelId: "mock",
      });
    return { model, prompts };
  }

  // The held question over the route: no 504 while the write hangs past
  // the budget, a second turn of the thread gets the 409, and the 504
  // leaves only once the write settled; the next turn then sees the old
  // question once, and the thread's updatedAt only moves forward.
  async function assertHeldQuestion(input: {
    clock: ReturnType<typeof fakeTurnClock>;
    deps: AssistantRequestDeps;
    heldStore: AssistantStore;
    prompts: string[];
    release: () => void;
    store: AssistantStore;
  }) {
    const { clock, deps, heldStore, prompts, release, store } = input;
    const meter = fakeMeter();
    const pending = postTurn({ ...deps, clock, meterTurn: meter.meterTurn, store: heldStore }, { text: "pergunta antiga", threadId: T1 });
    let answered = false;
    void pending.then(() => {
      answered = true;
    });
    await clock.advance(300_000);
    assert.equal(answered, false, "no 504 while the question's write is pending, even past 240 s");
    const busy = await postTurn({ ...deps, clock, meterTurn: meter.meterTurn, store: heldStore }, { text: "outra", threadId: T1 });
    assert.equal(busy.status, 409);
    assert.equal(((await busy.json()) as { code: string }).code, "turn_in_progress");
    release();
    const response = await pending;
    assert.equal(response.status, 504);
    assert.deepEqual(await response.json(), timeoutBody);
    // The credits come after the question: nothing was reserved, so there
    // is nothing to refund and nothing consumed; the model never ran.
    assert.deepEqual(meter.log.events, []);
    assert.equal(prompts.length, 0);
    assert.equal(clock.pending(), 0, "the budget's timer is disposed");
    const [old] = await store.listMessages(T1, { limit: 10 });
    assert.equal(old.text, "pergunta antiga");
    const stampedOld = (await store.getThread(T1))!.updatedAt;
    assert.equal(stampedOld, old.createdAt);
    // The thread went free with the 504: the next turn runs and reads the
    // old question in its history, once.
    const next = await postTurn({ ...deps, clock, meterTurn: meter.meterTurn, store: heldStore }, { text: "pergunta nova", threadId: T1 });
    assert.equal(next.status, 200);
    await readSse(next);
    const after = await waitFor(() => store.listMessages(T1, { limit: 10 }).then((items) => (items.length === 3 ? items : null)));
    assert.deepEqual(after.map((message) => [message.role, message.text]), [["user", "pergunta antiga"], ["user", "pergunta nova"], ["assistant", "resposta"]]);
    assert.equal(prompts.length, 1);
    assert.equal(prompts[0].split("pergunta antiga").length - 1, 1, "the old question enters the next prompt once");
    assert.ok(prompts[0].includes("pergunta nova"));
    const stampedNext = (await store.getThread(T1))!.updatedAt;
    assert.ok(stampedNext > stampedOld, "updatedAt only moves forward");
    assert.equal(stampedNext, after[2].createdAt);
  }

  test("a question write held past 240 s holds the thread (409) and the 504 until it lands; the next turn sees it once", async () => {
    const clock = fakeTurnClock();
    const recorder = promptRecorder();
    const { deps, store } = makeDeps({ model: recorder.model });
    await store.createThread({ id: T1, now: ISO(0), title: "T" });
    const held = heldFirstUserWrite(store);
    await assertHeldQuestion({ clock, deps, heldStore: held.store, prompts: recorder.prompts, release: held.release, store });
  });

  test("a question write that fails after the budget ran out answers 504, not 503, and frees the thread", async () => {
    const clock = fakeTurnClock();
    const { deps, store } = makeDeps({ model: () => textModel("ok") });
    await store.createThread({ id: T1, now: ISO(0), title: "T" });
    const held = heldFirstUserWrite(store, { fail: true });
    const pending = postTurn({ ...deps, clock, store: held.store }, { text: "pergunta antiga", threadId: T1 });
    await clock.advance(240_000);
    held.release();
    const response = await pending;
    assert.equal(response.status, 504);
    assert.deepEqual(await response.json(), timeoutBody);
    assert.deepEqual(await store.listMessages(T1, { limit: 10 }), []);
    assert.equal((await store.getThread(T1))!.updatedAt, ISO(0));
    const next = await postTurn({ ...deps, clock, store: held.store }, { text: "de novo", threadId: T1 });
    assert.equal(next.status, 200);
    await readSse(next);
  });

  test("a new thread's creation held past 240 s answers 504 only once the thread is written", async () => {
    const clock = fakeTurnClock();
    const { deps, store } = makeDeps({ model: () => textModel("ok") });
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const heldStore: AssistantStore = { ...store, createThread: (input) => gate.then(() => store.createThread(input)) };
    const pending = postTurn({ ...deps, clock, store: heldStore }, { text: "oi" });
    let answered = false;
    void pending.then(() => {
      answered = true;
    });
    await clock.advance(300_000);
    assert.equal(answered, false, "no 504 while the thread's write is pending");
    release();
    assert.equal((await pending).status, 504);
    // Written before the 504, never after it; no question in it.
    const threads = await store.listThreads({ limit: 10, offset: 0 });
    assert.equal(threads.length, 1);
    assert.deepEqual(await store.listMessages(threads[0].id, { limit: 10 }), []);
  });

  // The reviewer's probe (review-20261019T152214) over the route, on the
  // production libSQL adapter (createLibsqlD1) and the D1 store: the first
  // question's SELECT or batch is held in the driver while the route's clock
  // runs past its deadline. The database's clock is the real one and the
  // route's is a fake one far from it (the skew the probe simulated): with
  // the write awaited before the 504, no clock is compared, and the old
  // question never lands after the next turn's write.
  for (const stage of ["select", "batch"] as const) {
    test(`libSQL (${stage} held): the old question lands before the 504 and never rolls the next turn's updatedAt back`, async () => {
      const client = createClient({ url: "file::memory:" });
      try {
        const migrations = fileURLToPath(new URL("../../../migrations/", import.meta.url));
        for (const name of readdirSync(migrations).filter((file) => file.endsWith(".sql")).sort()) {
          await client.executeMultiple(readFileSync(join(migrations, name), "utf8"));
        }
        await client.execute("INSERT INTO users (id, email, plan, ever_paid, billing_status, created_at, updated_at) VALUES ('u1', 'u1@example.test', 'pro', 1, 'active', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')");
        let release!: () => void;
        const gate = new Promise<void>((resolve) => {
          release = resolve;
        });
        let armed = false;
        let held = false;
        const db = createLibsqlD1({
          batch: async (statements, mode) => {
            if (armed && stage === "batch" && !held) {
              held = true;
              await gate;
            }
            return client.batch(statements, mode);
          },
          execute: async (statement) => {
            const sql = typeof statement === "string" ? statement : statement.sql;
            if (armed && stage === "select" && !held && sql.startsWith("SELECT id FROM assistant_threads")) {
              held = true;
              await gate;
            }
            return client.execute(statement);
          },
        });
        const store = cloudAssistantStore({ DB: db }, "u1");
        await store.createThread({ id: T1, now: ISO(0), title: "T" });
        armed = true;
        const clock = fakeTurnClock();
        const recorder = promptRecorder();
        const { deps } = makeDeps({ model: recorder.model });
        await assertHeldQuestion({ clock, deps: { ...deps, store }, heldStore: store, prompts: recorder.prompts, release, store });
        assert.ok(held, `the ${stage} was held`);
      } finally {
        client.close();
      }
    });
  }

  test("the chain's model receives the turn's budget in its context", async () => {
    let budgetLeft: number | null = null;
    const { deps } = makeDeps({
      model: (_endpoint, context) => {
        budgetLeft = context.turnBudget?.remainingMs() ?? null;
        return textModel("ok");
      },
    });
    const clock = fakeTurnClock();
    await readSse(await postTurn({ ...deps, clock }, { text: "oi" }));
    assert.equal(budgetLeft, 240_000);
  });
});
