import { createMCPServer, type MCPServer, type MCPHandleOptions } from "@tanstack/ai-mcp/server";
import { toolDefinition, type SchemaInput } from "@tanstack/ai";

export interface McpToolDefinition {
  description: string;
  inputSchema: {
    properties?: Record<string, unknown>;
    required?: string[];
    type: "object";
  };
  name: string;
}

export interface McpCallerIdentity {
  clientId: string;
  principalId?: string | null;
}

export interface McpProtocolHandlers {
  callTool: (name: string, args: Record<string, unknown>) => Promise<unknown>;
  caller?: McpCallerIdentity;
  instructions?: string;
  tools: McpToolDefinition[];
}

export class McpToolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "McpToolError";
  }
}

const MAX_REQUEST_BYTES = 256 * 1024;
const MAX_TOOL_RESPONSE_BYTES = 1024 * 1024;
const MCP_ACCEPT = "application/json, text/event-stream";
const DEFAULT_CLOUD_INSTRUCTIONS = "Pinar Cloud tools act only within the authenticated user's current permissions.";

const serverCache = new WeakMap<McpToolDefinition[], MCPServer>();

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function serverFor(tools: McpToolDefinition[]): MCPServer {
  const cached = serverCache.get(tools);
  if (cached) return cached;
  const server = createMCPServer({
    name: "pinar",
    sessions: "memory",
    tools: tools.map((tool) =>
      toolDefinition({
        description: tool.description,
        inputSchema: tool.inputSchema as SchemaInput,
        name: tool.name,
      }).server(async (input, ctx) => {
        const handlers = (ctx?.context as { handlers?: McpProtocolHandlers } | null | undefined)?.handlers;
        if (!handlers) throw new McpToolError("Tool failed");
        let text: string;
        try {
          const result = await handlers.callTool(tool.name, (input ?? {}) as Record<string, unknown>);
          text = typeof result === "string" ? result : JSON.stringify(result);
          if (typeof text !== "string") throw new McpToolError("Tool failed");
        } catch (caught) {
          throw caught instanceof McpToolError ? caught : new McpToolError("Tool failed");
        }
        if (new TextEncoder().encode(text).byteLength > MAX_TOOL_RESPONSE_BYTES) {
          throw new McpToolError("Tool result is too large; narrow the request or query individual sessions");
        }
        return text;
      }),
    ),
    version: import.meta.env.VITE_PINAR_VERSION ?? "0.5.0",
  });
  serverCache.set(tools, server);
  return server;
}

function authInfoFor(handlers: McpProtocolHandlers): MCPHandleOptions["authInfo"] {
  const caller = handlers.caller;
  if (!caller) return undefined;
  return {
    clientId: caller.clientId,
    extra: { sub: caller.principalId ?? null },
    scopes: [],
    token: caller.clientId,
  };
}

async function readBody(request: Request): Promise<string | null> {
  if (!request.body) return "";
  const reader = request.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let body = "";
  let length = 0;
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      length += next.value.byteLength;
      if (length > MAX_REQUEST_BYTES) {
        await reader.cancel();
        return null;
      }
      body += decoder.decode(next.value, { stream: true });
    }
    body += decoder.decode();
    return body;
  } catch {
    return "";
  } finally {
    reader.releaseLock();
  }
}

function rpcError(id: number | string | null, code: number, message: string) {
  return { error: { code, message }, id: id ?? null, jsonrpc: "2.0" };
}

function guardResponse(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    headers: { "Cache-Control": "private, no-store", "Content-Type": "application/json; charset=utf-8" },
    status,
  });
}

export async function handleMcpProtocolRequest(request: Request, handlers: McpProtocolHandlers): Promise<Response> {
  if (request.method === "GET" || request.method === "DELETE") {
    return new Response(null, { headers: { Allow: "POST", "Cache-Control": "private, no-store" }, status: 405 });
  }
  if (request.method !== "POST") return new Response(null, { status: 405 });
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) return guardResponse(rpcError(null, -32000, "Forbidden"), 403);
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().startsWith("application/json")) {
    return guardResponse(rpcError(null, -32600, "Content-Type must be application/json"), 415);
  }
  const raw = await readBody(request);
  if (raw === null) return guardResponse(rpcError(null, -32600, "Request too large"), 413);
  const headers = new Headers(request.headers);
  if (headers.get("accept") === null) headers.set("accept", MCP_ACCEPT);
  let isHandshake = headers.get("mcp-method") === "server/discover";
  let isToolCall = headers.get("mcp-method") === "tools/call";
  let isBatch = false;
  try {
    const message: unknown = JSON.parse(raw);
    if (Array.isArray(message)) {
      isBatch = true;
    } else if (isRecord(message)) {
      if (message.method === "initialize") isHandshake = true;
      if (message.method === "tools/call") isToolCall = true;
    }
  } catch {
    // The library reports malformed bodies with its own parse error.
  }
  if (isBatch) return guardResponse(rpcError(null, -32600, "Batch requests are not supported"), 400);
  const response = await serverFor(handlers.tools).handle(new Request(request.url, { body: raw, headers, method: "POST" }), {
    authInfo: authInfoFor(handlers),
    context: { handlers },
  });
  const finalHeaders = new Headers(response.headers);
  finalHeaders.set("Cache-Control", "private, no-store");
  if (!(response.headers.get("content-type") ?? "").includes("application/json")) {
    return new Response(response.body, { headers: finalHeaders, status: response.status, statusText: response.statusText });
  }
  const body = await response.text();
  let finalBody = body;
  if (isHandshake) {
    try {
      const parsed: unknown = JSON.parse(body);
      if (isRecord(parsed) && isRecord(parsed.result) && typeof (parsed.result as Record<string, unknown>).instructions !== "string") {
        const result = parsed.result as Record<string, unknown>;
        const meta = isRecord(result._meta) ? result._meta : null;
        const hasServerInfo = isRecord(result.serverInfo) || (meta !== null && isRecord(meta["io.modelcontextprotocol/serverInfo"]));
        if (hasServerInfo) {
          result.instructions = handlers.instructions ?? DEFAULT_CLOUD_INSTRUCTIONS;
          finalBody = JSON.stringify(parsed);
        }
      }
    } catch {
      // Non-JSON or unexpected handshake bodies pass through unchanged.
    }
  }
  if (isToolCall && response.status === 200 && new TextEncoder().encode(finalBody).byteLength > MAX_TOOL_RESPONSE_BYTES) {
    let id: number | string | null = null;
    let hasResultType = false;
    try {
      const parsed: unknown = JSON.parse(finalBody);
      if (isRecord(parsed)) {
        if (typeof parsed.id === "string" || typeof parsed.id === "number") id = parsed.id;
        const result = isRecord(parsed.result) ? parsed.result : null;
        hasResultType = result !== null && typeof result.resultType === "string";
      }
    } catch {
      // Keep the null id when the oversized envelope is not parseable.
    }
    finalBody = JSON.stringify({
      id: id ?? null,
      jsonrpc: "2.0",
      result: {
        ...(hasResultType ? { resultType: "complete" } : {}),
        content: [{ text: "Tool result is too large; narrow the request or query individual sessions", type: "text" }],
        isError: true,
      },
    });
  }
  return new Response(finalBody, { headers: finalHeaders, status: response.status, statusText: response.statusText });
}
