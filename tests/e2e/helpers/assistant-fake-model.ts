import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * The PINAR_HOME of the e2e server, derived exactly like playwright.config.ts
 * does. Null when the suite targets an external server (PINAR_E2E_BASE_URL),
 * whose home this process cannot reach.
 */
export function e2eHomeDir(): string | null {
  if (process.env.PINAR_E2E_BASE_URL) return null;
  const port = Number(process.env.PINAR_E2E_PORT ?? 17383);
  return process.env.PINAR_E2E_HOME || join(tmpdir(), `pinar-e2e-${port}`);
}

/**
 * Points the e2e server at the fake model by writing ai.json directly. The
 * AI settings routes are never used: writing a non-BYOK mode through them
 * clears the OS credential vault, which is the real one on this machine.
 * BYOK is never used either, so the server never reads that vault.
 */
export function writeLocalAiSettings(home: string, endpoint: string) {
  writeFileSync(join(home, "ai.json"), JSON.stringify({ endpoint, mode: "local", model: "fake-model" }));
}

export function removeLocalAiSettings(home: string) {
  rmSync(join(home, "ai.json"), { force: true });
}

export type FakeTurn =
  | { kind: "text"; text: string }
  | { kind: "tool"; args: Record<string, unknown>; name: string }
  | { body: string; kind: "fail"; status: number };

export interface FakeModelOptions {
  /**
   * Declares the appliance's decisions extra on the chat model in /v1/models
   * and answers POST /v1/decisions from the enqueueDecision queue. Without
   * it, the chat model has no extra and /v1/decisions answers 404.
   */
  decisions?: boolean;
  /**
   * Lists FAKE_EMBEDDING_MODEL as an embedding model in /v1/models and
   * answers POST /v1/embeddings. Without it, /v1/models lists only the chat
   * model and /v1/embeddings answers 404, as before.
   */
  embeddings?: boolean;
}

/** The decisions extra the appliance declares on a chat model in /v1/models. */
export const FAKE_DECISIONS_EXTRA = { available: true, endpoint: "/v1/decisions", experimental: true, scope: "decisions" };

export interface FakeDecisionRequest {
  instructions?: string;
  model?: string;
  questions?: Array<{ id?: string; options?: string[]; question?: string }>;
  state?: string;
}

/** One scripted answer of POST /v1/decisions: the chosen option and the probability of each option. */
export interface FakeDecision {
  choice: string;
  probabilities: Record<string, number>;
}

export const FAKE_EMBEDDING_MODEL = "fake-embed";
export const FAKE_EMBEDDING_DIMENSIONS = 256;

export interface FakeEmbeddingRequest {
  dimensions?: number;
  input?: string[];
  model?: string;
  prompt_name?: string;
}

export interface FakeModel {
  /** Parsed JSON bodies of every POST /v1/decisions received, answered or not. */
  decisionRequests: FakeDecisionRequest[];
  /** Base URL to put in ai.json (`http://127.0.0.1:<port>/v1`). */
  endpoint: string;
  /** Parsed JSON bodies of every POST /v1/embeddings received, answered or not. */
  embeddingRequests: FakeEmbeddingRequest[];
  /** Script the next chat completion answers, in order. */
  enqueue(...turns: FakeTurn[]): void;
  /**
   * Script the next POST /v1/decisions answer (one decision for the request's
   * first question). Its probabilities must sum to 1, as the appliance's do.
   */
  enqueueDecision(decision: FakeDecision): void;
  /** Parsed JSON bodies of every POST /v1/chat/completions received. */
  requests: Array<{ messages?: Array<{ content?: unknown; role: string }>; tools?: Array<{ function?: { name?: string } }> }>;
  reset(): void;
  stop(): Promise<void>;
}

function embeddingTerms(text: string): string[] {
  return text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((term) => term.length > 2);
}

/**
 * A deterministic bag-of-words vector (the fakeEmbedding of
 * retrieval/runtime-local.test.ts): one hashed dimension per word longer
 * than two letters, without case or accents, plus a small constant so no
 * vector is all zeros. Texts that share words point the same way.
 */
export function fakeEmbedding(text: string): number[] {
  const vector = new Array<number>(FAKE_EMBEDDING_DIMENSIONS).fill(0);
  vector[FAKE_EMBEDDING_DIMENSIONS - 1] = 0.01;
  for (const term of embeddingTerms(text)) {
    let hash = 0;
    for (const character of term) hash = (hash * 31 + character.charCodeAt(0)) % (FAKE_EMBEDDING_DIMENSIONS - 1);
    vector[hash]! += 1;
  }
  return vector;
}

function chunk(delta: Record<string, unknown>, finishReason: string | null) {
  return {
    choices: [{ delta, finish_reason: finishReason, index: 0 }],
    created: 0,
    id: "chatcmpl-fake",
    model: "fake-model",
    object: "chat.completion.chunk",
    ...(finishReason ? { usage: { completion_tokens: 1, prompt_tokens: 1, total_tokens: 2 } } : {}),
  };
}

function sse(response: ServerResponse, chunks: unknown[]) {
  response.writeHead(200, { "cache-control": "no-cache", "content-type": "text/event-stream" });
  for (const item of chunks) response.write(`data: ${JSON.stringify(item)}\n\n`);
  response.end("data: [DONE]\n\n");
}

async function readBody(request: IncomingMessage): Promise<string> {
  let body = "";
  for await (const part of request) body += part;
  return body;
}

/** An OpenAI-compatible model on an ephemeral loopback port, scripted per turn. */
export async function startFakeModel(options: FakeModelOptions = {}): Promise<FakeModel> {
  const queue: FakeTurn[] = [];
  const requests: FakeModel["requests"] = [];
  const embeddingRequests: FakeEmbeddingRequest[] = [];
  const decisionQueue: FakeDecision[] = [];
  const decisionRequests: FakeDecisionRequest[] = [];
  const server: Server = createServer(async (request, response) => {
    const path = new URL(request.url ?? "/", "http://127.0.0.1").pathname;
    if (request.method === "GET" && path === "/v1/models") {
      const models: Array<Record<string, unknown>> = [
        options.decisions ? { decisions: FAKE_DECISIONS_EXTRA, id: "fake-model" } : { id: "fake-model" },
      ];
      if (options.embeddings) models.push({ id: FAKE_EMBEDDING_MODEL, type: "embedding" });
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ data: models }));
      return;
    }
    if (request.method === "POST" && path === "/v1/embeddings") {
      const body = JSON.parse(await readBody(request)) as FakeEmbeddingRequest;
      embeddingRequests.push(body);
      if (!options.embeddings) {
        response.writeHead(404).end();
        return;
      }
      const data = (body.input ?? []).map((text, index) => ({ embedding: fakeEmbedding(text), index, object: "embedding" }));
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ data, model: FAKE_EMBEDDING_MODEL, object: "list" }));
      return;
    }
    if (request.method === "POST" && path === "/v1/decisions") {
      const body = JSON.parse(await readBody(request)) as FakeDecisionRequest;
      decisionRequests.push(body);
      const decision = options.decisions ? decisionQueue.shift() : undefined;
      if (!decision) {
        response.writeHead(options.decisions ? 500 : 404, { "content-type": "text/plain" });
        response.end(options.decisions ? "no scripted decision" : "");
        return;
      }
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ decisions: [{ id: body.questions?.[0]?.id ?? "", ...decision }] }));
      return;
    }
    if (request.method === "POST" && path === "/v1/chat/completions") {
      requests.push(JSON.parse(await readBody(request)));
      const turn = queue.shift() ?? { kind: "text", text: "(no scripted answer)" };
      if (turn.kind === "fail") {
        response.writeHead(turn.status, { "content-type": "text/plain" });
        response.end(turn.body);
        return;
      }
      if (turn.kind === "tool") {
        sse(response, [
          chunk({
            role: "assistant",
            tool_calls: [{
              function: { arguments: JSON.stringify(turn.args), name: turn.name },
              id: `call_${requests.length}`,
              index: 0,
              type: "function",
            }],
          }, null),
          chunk({}, "tool_calls"),
        ]);
        return;
      }
      sse(response, [chunk({ content: turn.text, role: "assistant" }, null), chunk({}, "stop")]);
      return;
    }
    response.writeHead(404).end();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("fake model did not bind");
  return {
    decisionRequests,
    embeddingRequests,
    endpoint: `http://127.0.0.1:${address.port}/v1`,
    enqueue: (...turns) => queue.push(...turns),
    enqueueDecision: (decision) => {
      const total = Object.values(decision.probabilities).reduce((sum, value) => sum + value, 0);
      if (Math.abs(total - 1) > 1e-9) throw new Error(`scripted decision probabilities sum to ${total}, not 1`);
      decisionQueue.push(decision);
    },
    requests,
    reset: () => {
      queue.length = 0;
      requests.length = 0;
      embeddingRequests.length = 0;
      decisionQueue.length = 0;
      decisionRequests.length = 0;
    },
    stop: () => new Promise<void>((resolve) => {
      server.closeAllConnections();
      server.close(() => resolve());
    }),
  };
}
