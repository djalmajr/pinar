import { createHandlers } from "./handlers";
import { startHttpServer } from "./http";
import { PEEK_DESCRIPTION, STATUS_DESCRIPTION, TAKE_DESCRIPTION, peekText, statusText, takeText } from "./mcp-tools";
import { type Framing, type JsonRpc, pullMessages, writeStdio } from "./rpc";
import { createStore } from "./store";

const FALLBACK_PROTOCOL = "2025-03-26";
const SERVER_INFO = { name: "ai-feedback", version: "0.1.0" };

const tools = [
  {
    description: STATUS_DESCRIPTION,
    inputSchema: { properties: {}, type: "object" },
    name: "feedback_status",
  },
  {
    description: PEEK_DESCRIPTION,
    inputSchema: { properties: {}, type: "object" },
    name: "feedback_peek",
  },
  {
    description: TAKE_DESCRIPTION,
    inputSchema: { properties: {}, type: "object" },
    name: "feedback_take",
  },
];

let framing: Framing = "lsp";

function result(id: JsonRpc["id"], value: unknown): void {
  writeStdio({ id, jsonrpc: "2.0", result: value }, framing);
}

function fail(id: JsonRpc["id"], message: string): void {
  writeStdio({ error: { code: -32000, message }, id, jsonrpc: "2.0" }, framing);
}

export async function serveMcpStdio(root: string): Promise<void> {
  const handlers = createHandlers(createStore(root));
  let buffer = Buffer.alloc(0);
  const queue: JsonRpc[] = [];
  let pumping = false;

  async function handle(message: JsonRpc): Promise<void> {
    const { id, method } = message;
    if (!method) return;
    if (method === "initialize") {
      const requested = (message.params as { protocolVersion?: string } | undefined)?.protocolVersion;
      result(id, {
        capabilities: { tools: { listChanged: false } },
        protocolVersion: requested ?? FALLBACK_PROTOCOL,
        serverInfo: SERVER_INFO,
      });
      return;
    }
    if (method === "notifications/initialized" || method === "initialized") return;
    if (method === "ping") {
      if (id !== undefined) result(id, {});
      return;
    }
    if (method === "tools/list") {
      result(id, { tools });
      return;
    }
    if (method === "tools/call") {
      const name = (message.params as { name?: string } | undefined)?.name;
      try {
        if (name === "feedback_status") {
          result(id, { content: [{ text: await statusText(handlers), type: "text" }] });
          return;
        }
        if (name === "feedback_peek") {
          result(id, { content: [{ text: await peekText(handlers), type: "text" }] });
          return;
        }
        if (name === "feedback_take") {
          result(id, { content: [{ text: await takeText(handlers), type: "text" }] });
          return;
        }
        fail(id, `Unknown tool: ${name ?? "(missing)"}`);
      } catch (error) {
        fail(id, error instanceof Error ? error.message : String(error));
      }
      return;
    }
    if (id !== undefined) fail(id, `Unknown method: ${method}`);
  }

  async function pump(): Promise<void> {
    if (pumping) return;
    pumping = true;
    while (queue.length > 0) {
      const next = queue.shift();
      if (next) await handle(next);
    }
    pumping = false;
  }

  function ingest(chunk: Buffer): void {
    const combined = Buffer.concat([buffer, chunk]);
    const pulled = pullMessages(combined);
    buffer = Buffer.from(pulled.rest);
    if (pulled.framing) framing = pulled.framing;
    queue.push(...pulled.messages);
    void pump();
  }

  const debugPath = process.env.AI_FEEDBACK_DEBUG;
  if (debugPath) {
    process.stderr.write(`ai-feedback mcp listening stdin, debug=${debugPath}\n`);
  }
  process.stdin.on("data", (chunk: Buffer | string) => {
    const buf = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
    if (debugPath) {
      Bun.write(debugPath, buf, { createPath: true }).catch(() => {
        /* ignore */
      });
      process.stderr.write(`ai-feedback mcp stdin ${buf.length} bytes\n`);
    }
    ingest(buf);
  });
  process.stdin.resume();

  await new Promise<void>((resolve) => {
    process.stdin.on("end", resolve);
    process.stdin.on("close", resolve);
  });
}

export async function bindSidecarHttp(options: {
  port: number;
  root: string;
}): Promise<{ port: number; stop: () => void } | null> {
  try {
    const { server } = startHttpServer(options);
    return { port: server.port ?? options.port, stop: () => server.stop(true) };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/in use|EADDRINUSE|Failed to start server/i.test(message)) return null;
    throw error;
  }
}