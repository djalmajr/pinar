export interface McpToolDefinition {
  description: string;
  inputSchema: {
    properties?: Record<string, unknown>;
    required?: string[];
    type: "object";
  };
  name: string;
}

export interface McpProtocolHandlers {
  callTool: (name: string, args: Record<string, unknown>) => Promise<unknown>;
  tools: McpToolDefinition[];
}

export class McpToolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "McpToolError";
  }
}

interface JsonRpcRequest {
  id?: number | string | null;
  jsonrpc: "2.0";
  method: string;
  params?: Record<string, unknown>;
}

const MAX_REQUEST_BYTES = 256 * 1024;
const MAX_TOOL_RESPONSE_BYTES = 1024 * 1024;
const PROTOCOL_VERSION = "2025-11-25";

function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    headers: { "Cache-Control": "private, no-store", "Content-Type": "application/json; charset=utf-8" },
    status,
  });
}

function error(id: JsonRpcRequest["id"], code: number, message: string) {
  return { error: { code, message }, id: id ?? null, jsonrpc: "2.0" };
}

function success(id: JsonRpcRequest["id"], result: unknown) {
  return { id: id ?? null, jsonrpc: "2.0", result };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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

function isJsonRpcRequest(value: unknown): value is JsonRpcRequest {
  return isRecord(value)
    && value.jsonrpc === "2.0"
    && typeof value.method === "string"
    && (!Object.hasOwn(value, "id")
      || value.id === null
      || typeof value.id === "string"
      || (typeof value.id === "number" && Number.isFinite(value.id)));
}

export async function handleMcpProtocolRequest(request: Request, handlers: McpProtocolHandlers): Promise<Response> {
  if (request.method === "GET" || request.method === "DELETE") {
    return new Response(null, { headers: { Allow: "POST", "Cache-Control": "private, no-store" }, status: 405 });
  }
  if (request.method !== "POST") return new Response(null, { status: 405 });
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) return response(error(null, -32000, "Forbidden"), 403);
  const contentType = request.headers.get("content-type") || "";
  if (!contentType.toLowerCase().startsWith("application/json")) return response(error(null, -32600, "Content-Type must be application/json"), 415);
  const version = request.headers.get("mcp-protocol-version");
  if (version && version !== PROTOCOL_VERSION) return response(error(null, -32600, "Unsupported protocol version"), 400);
  const raw = await readBody(request);
  if (raw === null) return response(error(null, -32600, "Request too large"), 413);
  let message: unknown;
  try {
    message = JSON.parse(raw);
  } catch {
    return response(error(null, -32700, "Parse error"), 400);
  }
  if (!isJsonRpcRequest(message)) return response(error(null, -32600, "Invalid request"), 400);
  if (!Object.hasOwn(message, "id")) {
    return message.method === "notifications/initialized"
      ? new Response(null, { headers: { "Cache-Control": "private, no-store" }, status: 202 })
      : response(error(null, -32600, "Unsupported notification"), 400);
  }
  const { id, method } = message;
  if (method === "initialize") {
    return response(success(id, {
      capabilities: { tools: { listChanged: false } },
      instructions: "Pinar Cloud tools act only within the authenticated user's current permissions.",
      protocolVersion: PROTOCOL_VERSION,
      serverInfo: { name: "pinar", version: import.meta.env.VITE_PINAR_VERSION ?? "0.5.0" },
    }));
  }
  if (method === "ping") return response(success(id, {}));
  if (method === "tools/list") return response(success(id, { tools: handlers.tools }));
  if (method !== "tools/call") return response(error(id, -32601, "Method not found"));
  const params = message.params;
  const name = params?.name;
  const args = params?.arguments ?? {};
  if (typeof name !== "string" || !isRecord(args)) return response(error(id, -32602, "Invalid tool arguments"));
  if (!handlers.tools.some((tool) => tool.name === name)) return response(error(id, -32602, "Unknown tool"));
  try {
    const result = await handlers.callTool(name, args);
    const contentText = typeof result === "string" ? result : JSON.stringify(result);
    if (typeof contentText !== "string") throw new Error("Invalid tool result");
    const body = success(id, { content: [{ text: contentText, type: "text" }] });
    if (new TextEncoder().encode(JSON.stringify(body)).byteLength > MAX_TOOL_RESPONSE_BYTES) {
      throw new McpToolError("Tool result is too large; narrow the request or query individual sessions");
    }
    return response(body);
  } catch (caught) {
    const message = caught instanceof McpToolError ? caught.message : "Tool failed";
    return response(success(id, { content: [{ text: message, type: "text" }], isError: true }));
  }
}
