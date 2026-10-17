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

export interface FakeModel {
  /** Base URL to put in ai.json (`http://127.0.0.1:<port>/v1`). */
  endpoint: string;
  /** Script the next chat completion answers, in order. */
  enqueue(...turns: FakeTurn[]): void;
  /** Parsed JSON bodies of every POST /v1/chat/completions received. */
  requests: Array<{ messages?: Array<{ content?: unknown; role: string }> }>;
  reset(): void;
  stop(): Promise<void>;
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
export async function startFakeModel(): Promise<FakeModel> {
  const queue: FakeTurn[] = [];
  const requests: FakeModel["requests"] = [];
  const server: Server = createServer(async (request, response) => {
    const path = new URL(request.url ?? "/", "http://127.0.0.1").pathname;
    if (request.method === "GET" && path === "/v1/models") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ data: [{ id: "fake-model" }] }));
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
    endpoint: `http://127.0.0.1:${address.port}/v1`,
    enqueue: (...turns) => queue.push(...turns),
    requests,
    reset: () => {
      queue.length = 0;
      requests.length = 0;
    },
    stop: () => new Promise<void>((resolve) => {
      server.closeAllConnections();
      server.close(() => resolve());
    }),
  };
}
