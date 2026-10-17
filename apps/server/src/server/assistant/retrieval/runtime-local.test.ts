import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, test } from "node:test";
import { writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { openHistoryDb } from "@pinar/cli/history";
import { shotsDir } from "@pinar/cli/paths";
import { handleApiRequest, historyDatabase, resetLocalApiForTests } from "../../api.local";
import { localAssistantDeps } from "../local-deps";
import { resetThinkingControlCacheForTests } from "../models";
import { resetRetrievalCapabilitiesCacheForTests } from "./detect";
import { PIN_EMBEDDING_DIMENSIONS } from "./embeddings";
import type { PinIndexEntry, PinIndexStore, PinSource } from "./index";
import {
  createLocalPinIndexRuntime,
  LOCAL_PIN_INDEX_DELAY_MS,
  LOCAL_PIN_INDEX_MAX_CONTINUATIONS,
  LOCAL_PIN_INDEX_SEARCH_BUDGET_MS,
  LOCAL_PIN_INDEX_SEARCH_MAX_SESSIONS,
  localPinIndexRuntime,
  localPinSearch,
  observePinIndexWrites,
  setLocalPinIndexOptionsForTests,
  type LocalPinIndexRuntime,
  type PinIndexTimers,
} from "./runtime-local";
import { localPinSource } from "./source-local";
import { localPinIndexStore } from "./store-local";

const ORIGIN = "http://127.0.0.1:17373";
const BASE_URL = "http://127.0.0.1:9/v1";
const VALID_PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

// ---------- fakes ----------

// Timers under the test's control: nothing fires until advance().
function fakeTimers() {
  let clock = 0;
  let sequence = 0;
  const waiting = new Map<number, { at: number; callback: () => void }>();
  const timers: PinIndexTimers = {
    clear: (handle) => {
      waiting.delete(handle as number);
    },
    set: (callback, ms) => {
      sequence += 1;
      waiting.set(sequence, { at: clock + ms, callback });
      return sequence;
    },
  };
  return {
    advance(ms: number) {
      clock += ms;
      const due = [...waiting.entries()].filter(([, timer]) => timer.at <= clock).sort((a, b) => a[1].at - b[1].at || a[0] - b[0]);
      for (const [handle, timer] of due) {
        waiting.delete(handle);
        timer.callback();
      }
    },
    timers,
    waiting: () => waiting.size,
  };
}

function terms(text: string): string[] {
  return text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((term) => term.length > 2);
}

// A bag-of-words vector: texts sharing words point the same way.
function fakeEmbedding(text: string): number[] {
  const vector = new Array<number>(PIN_EMBEDDING_DIMENSIONS).fill(0);
  vector[PIN_EMBEDDING_DIMENSIONS - 1] = 0.01;
  for (const term of terms(text)) {
    let hash = 0;
    for (const character of term) hash = (hash * 31 + character.charCodeAt(0)) % (PIN_EMBEDDING_DIMENSIONS - 1);
    vector[hash]! += 1;
  }
  return vector;
}

interface ApplianceCall {
  body: Record<string, any> | null;
  path: string;
}

// An OpenAI-compatible appliance on a fake fetch: /models declares an
// embedding model and image input for the chat model, /embeddings answers
// fakeEmbedding vectors and /chat/completions captions every marker. POSTs
// wait for `gate` when it is set, and the in-flight count is recorded.
function fakeAppliance() {
  const calls: ApplianceCall[] = [];
  const state = { gate: null as Promise<void> | null, inFlight: 0, maxInFlight: 0, modelsDown: false };
  const fetchFn = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = new URL(String(input)).pathname.replace(/^\/v1/, "");
    const body = typeof init?.body === "string" ? (JSON.parse(init.body) as Record<string, any>) : null;
    calls.push({ body, path });
    if (path === "/models" && state.modelsDown) return new Response("down", { status: 503 });
    if (path === "/models") {
      return Response.json({
        data: [
          { id: "chat-model", modalities: { input: ["text", "image"], output: ["text"] }, type: "chat" },
          { id: "embed-model", type: "embedding" },
        ],
      });
    }
    state.inFlight += 1;
    state.maxInFlight = Math.max(state.maxInFlight, state.inFlight);
    try {
      if (state.gate) await state.gate;
      if (path === "/embeddings") {
        return Response.json({ data: (body!.input as string[]).map((text, index) => ({ embedding: fakeEmbedding(text), index })) });
      }
      if (path === "/chat/completions") {
        const markers = String(body!.messages[1].content[0].text);
        const numbers = [...markers.matchAll(/^#(\d+):/gm)].map((match) => Number(match[1]));
        const pins = numbers.map((number) => ({ caption: `Marcador ${number} legenda`, number, ocr: `texto ${number}` }));
        return Response.json({ choices: [{ message: { content: JSON.stringify({ pins }), role: "assistant" } }] });
      }
      return new Response("not found", { status: 404 });
    } finally {
      state.inFlight -= 1;
    }
  }) as typeof fetch;
  return {
    calls,
    documents: () => calls.filter((call) => call.path === "/embeddings" && call.body?.prompt_name === "document"),
    fetch: fetchFn,
    posts: () => calls.filter((call) => call.path !== "/models"),
    state,
    visions: () => calls.filter((call) => call.path === "/chat/completions"),
  };
}

function deferred() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

async function ticks(count = 20) {
  for (let index = 0; index < count; index += 1) await new Promise((resolve) => setTimeout(resolve, 0));
}

// ---------- local app helpers ----------

let root = "";
let previousHome: string | undefined;
let appliance = fakeAppliance();
let clock = fakeTimers();
const runtimesSeen = new Set<LocalPinIndexRuntime>();

function writeAiSettings() {
  writeFileSync(join(root, "ai.json"), JSON.stringify({ endpoint: BASE_URL, mode: "local", model: "chat-model" }));
}

type IndexHistory = ReturnType<typeof historyDatabase> & {
  listPinIndexEntries(sessionId: string): PinIndexEntry[];
  listPinIndexEntriesFor(sessionIds: string[]): PinIndexEntry[];
};

function database(): IndexHistory {
  return historyDatabase() as IndexHistory;
}

function runtime(): LocalPinIndexRuntime {
  const current = localPinIndexRuntime(historyDatabase());
  assert.ok(current, "historyDatabase() hands out the observed database");
  runtimesSeen.add(current);
  return current;
}

async function settle() {
  await runtime().idle();
}

function api(path: string, init: RequestInit = {}) {
  return handleApiRequest(new Request(`${ORIGIN}${path}`, init));
}

async function jsonApi(path: string, method: string, body: unknown) {
  const response = await api(path, { body: JSON.stringify(body), headers: { "content-type": "application/json" }, method });
  assert.ok(response.status < 300, `${method} ${path}: ${response.status} ${await response.clone().text()}`);
  return (await response.json()) as Record<string, any>;
}

// A capture through POST /api/shots: the session and its PNG screenshot.
async function capture(id: string, title: string, pins: Array<Record<string, unknown>>) {
  await jsonApi("/api/shots", "POST", { id, image: VALID_PNG, page: { title, url: `https://site.example/${id}` }, pins });
}

const MCP_ACCEPT = "application/json, text/event-stream";

// One tool of the local MCP at /api/mcp, the way an external agent calls it.
async function mcpTool(name: string, args: Record<string, unknown>) {
  const initialized = await api("/api/mcp", {
    body: JSON.stringify({
      id: 0,
      jsonrpc: "2.0",
      method: "initialize",
      params: { capabilities: {}, clientInfo: { name: "pin-index-test", version: "0.0.0" }, protocolVersion: "2025-11-25" },
    }),
    headers: { accept: MCP_ACCEPT, "content-type": "application/json" },
    method: "POST",
  });
  assert.equal(initialized.status, 200);
  const session = initialized.headers.get("mcp-session-id");
  assert.ok(session);
  const response = await api("/api/mcp", {
    body: JSON.stringify({ id: 1, jsonrpc: "2.0", method: "tools/call", params: { arguments: args, name } }),
    headers: { accept: MCP_ACCEPT, "content-type": "application/json", "mcp-protocol-version": "2025-11-25", "mcp-session-id": session },
    method: "POST",
  });
  assert.equal(response.status, 200);
  const body = (await response.json()) as { result: { content: Array<{ text: string }>; isError?: boolean } };
  assert.notEqual(body.result.isError, true, `${name}: ${body.result.content[0]?.text}`);
  return JSON.parse(body.result.content[0]!.text) as Record<string, any>;
}

function entries(sessionId: string) {
  return database().listPinIndexEntries(sessionId);
}

describe("local pin index runtime", () => {
  beforeEach(async () => {
    previousHome = process.env.PINAR_HOME;
    root = await mkdtemp(join(tmpdir(), "pinar-pin-runtime-"));
    process.env.PINAR_HOME = root;
    resetLocalApiForTests();
    resetThinkingControlCacheForTests();
    resetRetrievalCapabilitiesCacheForTests();
    appliance = fakeAppliance();
    clock = fakeTimers();
    setLocalPinIndexOptionsForTests({ fetch: appliance.fetch, timers: clock.timers });
  });

  afterEach(async () => {
    try {
      for (const seen of runtimesSeen) await seen.idle();
    } finally {
      runtimesSeen.clear();
      appliance.state.gate = null;
      resetLocalApiForTests();
      setLocalPinIndexOptionsForTests(null);
      resetThinkingControlCacheForTests();
      resetRetrievalCapabilitiesCacheForTests();
      if (previousHome === undefined) delete process.env.PINAR_HOME;
      else process.env.PINAR_HOME = previousHome;
      await rm(root, { force: true, recursive: true });
    }
  });

  test("the first search indexes what is pending and finds the pin by its comment", async () => {
    writeAiSettings();
    await capture("cap_checkout", "Checkout", [
      { comment: "O contraste do botão comprar está baixo", kind: "element", pinId: "pin_contrast", selector: "button.buy", tag: "button", text: "Comprar" },
      { comment: "Logo desalinhado no topo", pinId: "pin_logo" },
    ]);
    await capture("cap_payment", "Pagamento", [{ comment: "Formulário de cartão demora para carregar", pinId: "pin_slow" }]);
    await jsonApi("/api/sessions/cap_checkout/pins/pin_logo/comments", "POST", { body: "Revisar o espaçamento do cabeçalho" });
    const empty = await mcpTool("pinar.create_session", { page: { title: "Sem pins", url: "https://site.example/empty" } });

    // The writes are only scheduled: nothing ran yet.
    assert.ok(clock.waiting() > 0);
    assert.deepEqual(appliance.posts(), []);
    assert.deepEqual(database().listPinIndexEntriesFor(["cap_checkout", "cap_payment", empty.session.id]), []);

    const search = localPinSearch(historyDatabase());
    assert.ok(search);
    const hits = await search.search({ limit: 3, query: "contraste do botão" });
    assert.deepEqual(hits[0], {
      caption: "Marcador 1 legenda",
      comment: "O contraste do botão comprar está baixo",
      number: 1,
      pinId: "pin_contrast",
      score: hits[0]!.score,
      sessionId: "cap_checkout",
      sessionTitle: "Checkout",
      url: "https://site.example/cap_checkout",
    });
    assert.ok(hits[0]!.score > (hits[1]?.score ?? 0));

    // The first pass indexed both sessions with pins, with captions from
    // one vision call per session on the PNG screenshot, and embeddings.
    assert.deepEqual(entries("cap_checkout").map((entry) => [entry.pinId, entry.caption, entry.model]), [
      ["pin_contrast", "Marcador 1 legenda", "embed-model"],
      ["pin_logo", "Marcador 2 legenda", "embed-model"],
    ]);
    assert.ok(entries("cap_checkout")[1]!.docText.includes("Revisar o espaçamento do cabeçalho"), "the conversation comment is in the document");
    assert.equal(entries("cap_payment").length, 1);
    assert.equal(appliance.visions().length, 2);
    for (const vision of appliance.visions()) {
      assert.ok(String(vision.body!.messages[1].content[1].image_url.url).startsWith("data:image/png;base64,"));
    }
    assert.equal(appliance.calls.filter((call) => call.path === "/embeddings" && call.body?.prompt_name === "query").length, 1);
  });

  test("a session without pins is never pending", async () => {
    writeAiSettings();
    await capture("cap_one", "Uma", [{ comment: "Um pin", pinId: "p1" }]);
    const empty = await mcpTool("pinar.create_session", { page: { title: "Vazia", url: "https://site.example/vazia" } });
    await localPinSearch(historyDatabase())!.search({ limit: 5, query: "pin" });

    const source = localPinSource(database(), shotsDir(root));
    const listed = await source.listSessions({ limit: 100, offset: 0 });
    assert.deepEqual(listed.map((session) => session.id), ["cap_one"]);
    assert.deepEqual(await localPinIndexStore(database()).staleSessions({ limit: 10, sessions: listed }), []);
    assert.deepEqual(entries(empty.session.id), []);
    assert.equal(appliance.visions().length, 1, "only the session with a pin was captioned");
  });

  test("saving or commenting schedules the session; edits within 2 s become one indexing", async () => {
    writeAiSettings();
    assert.equal(LOCAL_PIN_INDEX_DELAY_MS, 2_000);
    await capture("cap_edit", "Edição", [{ comment: "Primeira nota", pinId: "pin_a" }, { comment: "Outra nota", pinId: "pin_b" }]);
    clock.advance(LOCAL_PIN_INDEX_DELAY_MS - 1);
    await settle();
    assert.equal(appliance.documents().length, 0, "not before 2 s");
    clock.advance(1);
    await settle();
    assert.equal(appliance.documents().length, 1, "saving the session indexed it once, without a search");
    assert.equal(entries("cap_edit").length, 2);

    // A route comment, then a pin note edit 1.5 s later: one indexing 2 s
    // after the last edit, holding both.
    await jsonApi("/api/sessions/cap_edit/pins/pin_a/comments", "POST", { body: "Comentário pela rota" });
    clock.advance(1_500);
    await settle();
    await jsonApi("/api/sessions/cap_edit/pins/pin_b", "PATCH", { comment: "Nota editada" });
    clock.advance(LOCAL_PIN_INDEX_DELAY_MS - 1);
    await settle();
    assert.equal(appliance.documents().length, 1);
    clock.advance(1);
    await settle();
    assert.equal(appliance.documents().length, 2, "two edits under 2 s apart: one indexing");
    const [first, second] = entries("cap_edit");
    assert.ok(first!.docText.includes("Comentário pela rota"));
    assert.ok(second!.docText.includes("Pin #2: Nota editada"));
    assert.equal(appliance.documents().at(-1)!.body!.input.length, 2, "both changed documents in one request");

    // The local MCP at /api/mcp (external agents) schedules too.
    await mcpTool("pinar.add_pin_comment", { body: "Comentário de um agente", pinId: "pin_b", sessionId: "cap_edit" });
    clock.advance(LOCAL_PIN_INDEX_DELAY_MS);
    await settle();
    assert.equal(appliance.documents().length, 3);
    assert.ok(entries("cap_edit")[1]!.docText.includes("Comentário de um agente"));

    // A confirmed assistant proposal runs through the write host of the
    // assistant deps, the same observed database.
    const deps = localAssistantDeps(new Request(`${ORIGIN}/api/assistant/turn`, { method: "POST" }));
    await deps.writeHost.callTool("pinar.edit_pin_note", { comment: "Nota por proposta confirmada", pinId: "pin_a", sessionId: "cap_edit" });
    clock.advance(LOCAL_PIN_INDEX_DELAY_MS);
    await settle();
    assert.equal(appliance.documents().length, 4);
    assert.ok(entries("cap_edit")[0]!.docText.includes("Pin #1: Nota por proposta confirmada"));

    // A move changes no document: nothing is scheduled.
    const tree = await mcpTool("pinar.list_projects", { limit: 50 });
    assert.ok(tree.projects.length > 0);
    const posts = appliance.posts().length;
    const project = await mcpTool("pinar.create_project", { name: "Outro" });
    const collection = await mcpTool("pinar.create_collection", { name: "Destino", projectId: project.project.id });
    await mcpTool("pinar.move_session", { collectionId: collection.collection.id, sessionId: "cap_edit" });
    assert.equal(clock.waiting(), 0);
    clock.advance(LOCAL_PIN_INDEX_DELAY_MS);
    await settle();
    assert.equal(appliance.posts().length, posts);
  });

  test("the queue never runs two indexings at the same time", async () => {
    writeAiSettings();
    const gate = deferred();
    appliance.state.gate = gate.promise;
    await capture("cap_a", "A", [{ comment: "Nota de A", pinId: "pa" }]);
    await capture("cap_b", "B", [{ comment: "Nota de B", pinId: "pb" }]);
    clock.advance(LOCAL_PIN_INDEX_DELAY_MS); // both sessions are due at once
    await ticks();
    assert.equal(appliance.posts().length, 1, "only the first session reached the endpoint");
    assert.equal(appliance.state.inFlight, 1);

    // A write to the running session while it runs: indexed again after, not alongside.
    await jsonApi("/api/sessions/cap_a/pins/pa/comments", "POST", { body: "Durante a indexação" });
    clock.advance(LOCAL_PIN_INDEX_DELAY_MS);
    await ticks();
    assert.equal(appliance.posts().length, 1);

    gate.release();
    await settle();
    assert.equal(appliance.state.maxInFlight, 1, "never two requests in flight");
    const order = appliance.visions().map((call) => (String(call.body!.messages[1].content[0].text).includes("Nota de A") ? "A" : "B"));
    assert.deepEqual(order, ["A", "B"]);
    assert.ok(entries("cap_a")[0]!.docText.includes("Durante a indexação"), "the write during the run was indexed afterwards");
    assert.equal(entries("cap_b").length, 1);
  });

  test("a deleted session leaves the queue, and one deleted while indexing loses its entries", async () => {
    writeAiSettings();
    await capture("cap_gone", "Some", [{ comment: "Vai sumir", pinId: "pg" }]);
    assert.equal((await api("/api/history/cap_gone", { method: "DELETE" })).status, 200);
    assert.equal(clock.waiting(), 0, "the waiting timer was cancelled");
    clock.advance(LOCAL_PIN_INDEX_DELAY_MS);
    await settle();
    assert.deepEqual(appliance.posts(), []);

    const gate = deferred();
    appliance.state.gate = gate.promise;
    await capture("cap_race", "Corrida", [{ comment: "Apagada no meio", pinId: "pr" }]);
    clock.advance(LOCAL_PIN_INDEX_DELAY_MS);
    await ticks();
    assert.equal(appliance.posts().length, 1, "the indexing is running");
    assert.equal((await api("/api/history/cap_race", { method: "DELETE" })).status, 200);
    gate.release();
    await settle();
    assert.deepEqual(entries("cap_race"), [], "the entries written by the run were removed");
  });

  test("a session deleted during the first-search pass loses its entries", async () => {
    writeAiSettings();
    await capture("cap_first", "Primeira", [{ comment: "Apagada na primeira busca", pinId: "pf" }]);
    const gate = deferred();
    appliance.state.gate = gate.promise;
    const searching = localPinSearch(historyDatabase())!.search({ limit: 5, query: "apagada" });
    await ticks();
    assert.equal(appliance.posts().length, 1, "the first-search pass is indexing the session");
    assert.equal((await api("/api/history/cap_first", { method: "DELETE" })).status, 200);
    gate.release();
    assert.deepEqual(await searching, []);
    await settle();
    assert.deepEqual(entries("cap_first"), [], "the entries written by the pass were removed");
  });

  test("the turn's signal stops the search, never the indexing pass", async () => {
    writeAiSettings();
    await capture("cap_turn", "Turno", [{ comment: "Indexada mesmo com o turno cortado", pinId: "pt" }]);
    const search = localPinSearch(historyDatabase())!;
    const queries = () => appliance.calls.filter((call) => call.path === "/embeddings" && call.body?.prompt_name === "query");

    // Already aborted: nothing is asked.
    await assert.rejects(search.search({ limit: 5, query: "turno", signal: AbortSignal.abort() }));
    assert.deepEqual(appliance.calls, []);

    // Aborted during the first-search pass: the pass ends and writes its
    // entries, the question is never embedded.
    const gate = deferred();
    appliance.state.gate = gate.promise;
    const turn = new AbortController();
    const searching = search.search({ limit: 5, query: "turno", signal: turn.signal });
    await ticks();
    assert.equal(appliance.posts().length, 1, "the pass is indexing the session");
    turn.abort();
    gate.release();
    await assert.rejects(searching);
    await settle();
    assert.equal(entries("cap_turn").length, 1, "the pass finished");
    assert.deepEqual(queries(), []);

    const hits = await search.search({ limit: 5, query: "turno" });
    assert.deepEqual(hits.map((hit) => hit.pinId), ["pt"]);
    assert.equal(queries().length, 1);
  });

  test("capabilities that come back after a failed /models reindex with embeddings", async () => {
    writeAiSettings();
    appliance.state.modelsDown = true;
    await capture("cap_cap", "Capacidades", [{ comment: "Contraste do rodapé", pinId: "pc" }]);
    const search = localPinSearch(historyDatabase())!;
    assert.equal((await search.search({ limit: 5, query: "contraste rodapé" })).length, 1, "text search while /models is down");
    assert.equal(entries("cap_cap")[0]!.vector, null);
    assert.equal(appliance.documents().length, 0);

    appliance.state.modelsDown = false;
    resetRetrievalCapabilitiesCacheForTests(); // the 1-minute failure cache expired
    const hits = await search.search({ limit: 5, query: "contraste rodapé" });
    assert.equal(hits.length, 1);
    assert.notEqual(entries("cap_cap")[0]!.vector, null, "the entry got its vector");
    assert.equal(appliance.documents().length, 1);
    assert.equal(appliance.visions().length, 1, "and its caption");

    await search.search({ limit: 5, query: "contraste rodapé" });
    assert.equal(appliance.documents().length, 1, "the same capabilities run no new pass");
  });

  test("background passes stop after LOCAL_PIN_INDEX_MAX_CONTINUATIONS; the next search resumes", async () => {
    assert.equal(LOCAL_PIN_INDEX_MAX_CONTINUATIONS, 10);
    // A store that never counts a session as indexed, and a clock that
    // admits one session per pass: every pass leaves work behind.
    const listed = ["a", "b"].map((id) => ({ id, updatedAt: "2026-01-01T00:00:00.000Z" }));
    const source: PinSource = {
      async comments() {
        return new Map();
      },
      async listSessions({ limit, offset }) {
        return listed.slice(offset, offset + limit);
      },
      async session(id) {
        return { id, page: { title: id, url: `https://site.example/${id}` }, pinIds: [`${id}1`], pins: [{ comment: `nota ${id}`, number: 1 }] };
      },
      async shot() {
        return null;
      },
    };
    const replaced: string[] = [];
    const store: PinIndexStore = {
      async deleteSession() {},
      async entries() {
        return [];
      },
      async entriesFor() {
        return [];
      },
      async replaceSession(id) {
        replaced.push(id);
      },
      async staleSessions({ sessions }) {
        return sessions.map((item) => item.id);
      },
    };
    let now = Date.now();
    const looping = createLocalPinIndexRuntime({
      endpoint: async () => ({ baseUrl: BASE_URL, kind: "openai-compatible", model: "chat-model", thinkingControl: false }),
      fetch: appliance.fetch,
      now: () => new Date((now += 15_000)),
      source,
      store,
      timers: clock.timers,
    });
    try {
      await looping.search.search({ limit: 5, query: "nota" });
      await looping.idle();
      assert.equal(replaced.length, 1 + LOCAL_PIN_INDEX_MAX_CONTINUATIONS);
      await looping.search.search({ limit: 5, query: "nota" });
      await looping.idle();
      assert.equal(replaced.length, 2 * (1 + LOCAL_PIN_INDEX_MAX_CONTINUATIONS), "work left behind makes the next search run a pass");
    } finally {
      looping.stop();
    }
  });

  test("without AI configured the queue calls nothing and there is no pin search", async () => {
    await capture("cap_off", "Sem IA", [{ comment: "Nota", pinId: "po" }]);
    await jsonApi("/api/sessions/cap_off/pins/po/comments", "POST", { body: "Comentário" });
    await mcpTool("pinar.edit_pin_note", { comment: "Editada", pinId: "po", sessionId: "cap_off" });
    clock.advance(LOCAL_PIN_INDEX_DELAY_MS);
    await settle();
    assert.deepEqual(appliance.calls, [], "no request of any kind");
    assert.deepEqual(entries("cap_off"), []);
    const request = new Request(`${ORIGIN}/api/assistant/turn`, { method: "POST" });
    assert.equal(localAssistantDeps(request).pinSearch, undefined);

    writeAiSettings();
    assert.ok(localAssistantDeps(request).pinSearch, "the local deps pass the pin search once the AI is configured");
    assert.equal(localAssistantDeps(request).pinSearch, localPinSearch(historyDatabase()));
  });

  test("a first search that runs out of budget leaves the rest to the background queue", async () => {
    assert.equal(LOCAL_PIN_INDEX_SEARCH_BUDGET_MS, 20_000);
    assert.equal(LOCAL_PIN_INDEX_SEARCH_MAX_SESSIONS, 500);
    writeAiSettings();
    // Every reading of the indexing clock moves it 15 s forward, so the
    // 20 s budget admits one session per pass. It starts at the real time,
    // after the captures' createdAt, so an indexed session is not stale.
    let now = Date.now();
    setLocalPinIndexOptionsForTests({ fetch: appliance.fetch, now: () => new Date((now += 15_000)), timers: clock.timers });
    resetLocalApiForTests();
    await capture("cap_1", "Um", [{ comment: "Primeira sessão", pinId: "p1" }]);
    await capture("cap_2", "Dois", [{ comment: "Segunda sessão", pinId: "p2" }]);
    await capture("cap_3", "Três", [{ comment: "Terceira sessão", pinId: "p3" }]);

    const search = localPinSearch(historyDatabase())!;
    await search.search({ limit: 5, query: "sessão" });
    const indexedAfterSearch = ["cap_1", "cap_2", "cap_3"].filter((id) => entries(id).length > 0);
    assert.equal(indexedAfterSearch.length, 1, "the first pass stopped at its budget");
    await settle();
    assert.deepEqual(["cap_1", "cap_2", "cap_3"].filter((id) => entries(id).length > 0), ["cap_1", "cap_2", "cap_3"], "the queue indexed the rest in the background");
    assert.equal(appliance.visions().length, 3, "each session was captioned once");
    assert.equal(appliance.documents().length, 3, "each session was embedded once");
  });
});

describe("observePinIndexWrites", () => {
  let rawRoot = "";

  beforeEach(async () => {
    rawRoot = await mkdtemp(join(tmpdir(), "pinar-pin-observe-"));
  });

  afterEach(async () => {
    await rm(rawRoot, { force: true, recursive: true });
  });

  test("schedules exactly the writes that change a pin document; delete forgets; close stops", () => {
    const events: string[] = [];
    const raw = openHistoryDb(rawRoot) as unknown as Record<string, (...args: any[]) => any>;
    const db = observePinIndexWrites(raw, {
      forget: (id) => events.push(`forget:${id}`),
      schedule: (id) => events.push(`schedule:${id}`),
      stop: () => events.push("stop"),
    });
    const step = (label: string, run: () => unknown) => {
      events.length = 0;
      run();
      return [label, [...events]];
    };
    const saved = db.saveSession({ id: "s1", page: { title: "T", url: "https://u.example" }, pins: [{ comment: "A", pinId: "p1" }] });
    assert.equal(saved.id, "s1");
    const comment = db.addPinComment("s1", "p1", "oi", null);
    const collection = db.createCollection(db.getDefaultDestination().projectId, "Outra");
    const results = [
      step("saveSession", () => db.saveSession({ id: "s1", page: { title: "T2", url: "https://u.example" }, pins: [{ comment: "A", pinId: "p1" }] })),
      step("updateSession", () => db.updateSession("s1", { title: "Novo título" })),
      step("updateSession missing", () => db.updateSession("nope", { title: "x" })),
      step("updatePinNote", () => db.updatePinNote("s1", "p1", "nota")),
      step("addPin", () => db.addPin("s1", { comment: "B", coords: { x: 0, y: 0 }, id: "p2", number: 2, pinId: "p2", type: "point" })),
      step("addPinComment", () => db.addPinComment("s1", "p1", "mais um", null)),
      step("updatePinComment", () => db.updatePinComment("s1", "p1", comment.id, "editado")),
      step("deletePinComment", () => db.deletePinComment("s1", "p1", comment.id)),
      step("deletePin", () => db.deletePin("s1", "p2")),
      step("deletePin missing", () => db.deletePin("s1", "p2")),
      step("moveSession", () => db.moveSession("s1", collection.id)),
      step("applyPinReview", () => db.applyPinReview("s1", "p1", "accept", { actorId: "local", actorType: "human", origin: "human" })),
      step("getSession", () => db.getSession("s1")),
      step("listSessions", () => db.listSessions({ limit: 5, offset: 0, query: "" })),
    ];
    assert.deepEqual(results, [
      ["saveSession", ["schedule:s1"]],
      ["updateSession", ["schedule:s1"]],
      ["updateSession missing", []],
      ["updatePinNote", ["schedule:s1"]],
      ["addPin", ["schedule:s1"]],
      ["addPinComment", ["schedule:s1"]],
      ["updatePinComment", ["schedule:s1"]],
      ["deletePinComment", ["schedule:s1"]],
      ["deletePin", ["schedule:s1"]],
      ["deletePin missing", []],
      ["moveSession", []],
      ["applyPinReview", []],
      ["getSession", []],
      ["listSessions", []],
    ]);

    events.length = 0;
    assert.throws(() => db.addPinComment("s1", "no-such-pin", "x", null));
    assert.deepEqual(events, [], "a write that throws schedules nothing");

    assert.deepEqual(step("deleteSession", () => db.deleteSession("s1")), ["deleteSession", ["forget:s1"]]);
    assert.equal(db.getSession("s1"), null);
    assert.deepEqual(step("close", () => db.close()), ["close", ["stop"]]);
  });

  test("a scheduling failure never breaks the write", () => {
    const raw = openHistoryDb(rawRoot) as unknown as Record<string, (...args: any[]) => any>;
    const db = observePinIndexWrites(raw, {
      forget: () => {
        throw new Error("forget failed");
      },
      schedule: () => {
        throw new Error("schedule failed");
      },
      stop: () => {
        throw new Error("stop failed");
      },
    });
    const saved = db.saveSession({ id: "s1", page: { title: "T", url: "https://u.example" }, pins: [{ comment: "A", pinId: "p1" }] });
    assert.equal(saved.id, "s1");
    assert.equal(db.deleteSession("s1"), true);
    db.close();
  });
});
