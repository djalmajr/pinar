import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { createMCPClient } from "@tanstack/ai-mcp";
import { handleMcpProtocolRequest, McpToolError, type McpProtocolHandlers } from "./mcp-protocol";

const MCP_ACCEPT = "application/json, text/event-stream";
const INITIALIZE_PARAMS = { capabilities: {}, clientInfo: { name: "protocol-test", version: "0.0.0" }, protocolVersion: "2025-11-25" };
const BASE = "http://127.0.0.1:17373/api/mcp";
const MAX_TOOL_RESPONSE_BYTES = 1024 * 1024;

const TOOLS = [
  { description: "Echo a value", inputSchema: { properties: { value: { type: "string" } }, required: ["value"], type: "object" }, name: "pinar.echo" },
  { description: "Quote-heavy payload", inputSchema: { type: "object" }, name: "pinar.quote" },
  { description: "Non-serializable payload", inputSchema: { type: "object" }, name: "pinar.bigint" },
  { description: "Array tool", inputSchema: { properties: { ids: { items: { type: "string" }, minItems: 1, type: "array" } }, required: ["ids"], type: "object" }, name: "pinar.arr" },
  { description: "Undefined payload", inputSchema: { type: "object" }, name: "pinar.undefined" },
  { description: "Function payload", inputSchema: { type: "object" }, name: "pinar.func" },
  { description: "Symbol payload", inputSchema: { type: "object" }, name: "pinar.symbol" },
];

let callLog: string[] = [];

function makeHandlers(principal: string | null): McpProtocolHandlers {
  return {
    async callTool(name, args) {
      callLog.push(name);
      if (name === "pinar.echo") return { name, principal: principal ?? "none", value: args.value };
      if (name === "pinar.quote") return '"'.repeat(600_000);
      if (name === "pinar.bigint") return 1n;
      if (name === "pinar.undefined") return undefined;
      if (name === "pinar.func") return () => "never";
      if (name === "pinar.symbol") return Symbol("pinar-test");
      throw new McpToolError("Unknown tool");
    },
    caller: principal ? { clientId: `key-${principal}`, principalId: principal } : undefined,
    tools: TOOLS,
  };
}

function mcpRequest(url: string, body: unknown, headers: Record<string, string> = {}) {
  return new Request(url, { body: JSON.stringify(body), headers: { accept: MCP_ACCEPT, "content-type": "application/json", ...headers }, method: "POST" });
}

async function jsonBody(response: Response) {
  return response.json() as Promise<Record<string, unknown>>;
}

function contentText(result: unknown): string {
  const content = isRecord(result) && Array.isArray(result.content) ? result.content : [];
  const first = content[0];
  return isRecord(first) && typeof first.text === "string" ? first.text : "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function openSession(handlers: McpProtocolHandlers) {
  const response = await handleMcpProtocolRequest(mcpRequest(BASE, { id: 1, jsonrpc: "2.0", method: "initialize", params: INITIALIZE_PARAMS }), handlers);
  assert.equal(response.status, 200, "initialize must succeed");
  const session = response.headers.get("mcp-session-id");
  assert.ok(session, "initialize must return a session id");
  return session;
}

describe("sessionful MCP transport", () => {
  test("negotiates 2025-11-25, lists tools, and calls one tool", async () => {
    const handlers = makeHandlers(null);
    const initialized = await handleMcpProtocolRequest(mcpRequest(BASE, { id: 1, jsonrpc: "2.0", method: "initialize", params: INITIALIZE_PARAMS }), handlers);
    assert.equal(initialized.status, 200);
    const initBody = await jsonBody(initialized);
    assert.equal((initBody.result as Record<string, unknown>)?.protocolVersion, "2025-11-25");
    assert.equal((initBody.result as Record<string, unknown>)?.instructions, "Pinar Cloud tools act only within the authenticated user's current permissions.");
    assert.equal(initialized.headers.get("cache-control"), "private, no-store");
    const session = initialized.headers.get("mcp-session-id") ?? "";

    const listed = await jsonBody(await handleMcpProtocolRequest(mcpRequest(BASE, { id: 2, jsonrpc: "2.0", method: "tools/list" }, { "mcp-session-id": session }), handlers));
    const tools = ((listed.result as { tools: Array<{ name: string }> }).tools).map((tool) => tool.name).sort();
    assert.deepEqual(tools, TOOLS.map((tool) => tool.name).sort());

    const called = await jsonBody(await handleMcpProtocolRequest(mcpRequest(BASE, { id: 3, jsonrpc: "2.0", method: "tools/call", params: { arguments: { value: "ok" }, name: "pinar.echo" } }, { "mcp-session-id": session }), handlers));
    assert.equal(JSON.parse(contentText(called.result)).value, "ok");

    const get = await handleMcpProtocolRequest(new Request(BASE, { method: "GET" }), handlers);
    assert.equal(get.status, 405);
    assert.equal(get.headers.get("allow"), "POST");
  });

  test("returns 202 for initialized notification and keeps safe business errors", async () => {
    const handlers = makeHandlers(null);
    const session = await openSession(handlers);
    const notification = await handleMcpProtocolRequest(mcpRequest(BASE, { jsonrpc: "2.0", method: "notifications/initialized" }, { "mcp-session-id": session }), handlers);
    assert.equal(notification.status, 202);
    assert.equal(await notification.text(), "");

    const deniedHandlers = { ...handlers, async callTool() { throw new McpToolError("Denied"); } };
    const denied = await jsonBody(await handleMcpProtocolRequest(mcpRequest(BASE, { id: 4, jsonrpc: "2.0", method: "tools/call", params: { arguments: { value: "x" }, name: "pinar.echo" } }, { "mcp-session-id": session }), deniedHandlers));
    assert.equal((denied.result as { isError?: boolean })?.isError, true);
    assert.equal(contentText(denied.result), "Denied");
  });

  test("rejects oversized bodies, malformed JSON, hostile origins, and bad content types", async () => {
    const handlers = makeHandlers(null);
    const tooLarge = await handleMcpProtocolRequest(mcpRequest(BASE, { id: 1, jsonrpc: "2.0", method: "ping", padding: "x".repeat(300_000) }), handlers);
    assert.equal(tooLarge.status, 413);

    const malformed = await handleMcpProtocolRequest(new Request(BASE, { body: "{", headers: { accept: MCP_ACCEPT, "content-type": "application/json" }, method: "POST" }), handlers);
    assert.equal(malformed.status, 400);
    assert.equal(((await jsonBody(malformed)).error as { code?: number })?.code, -32700);

    let called = false;
    const hostileHandlers = { ...handlers, async callTool() { called = true; return {}; } };
    const hostile = await handleMcpProtocolRequest(
      new Request("https://pinar.test/api/mcp", { body: JSON.stringify({ id: 1, jsonrpc: "2.0", method: "tools/call", params: { name: "pinar.echo" } }), headers: { accept: MCP_ACCEPT, "content-type": "application/json", origin: "https://evil.test" }, method: "POST" }),
      hostileHandlers,
    );
    assert.equal(hostile.status, 403);
    assert.equal(called, false);

    const badType = await handleMcpProtocolRequest(new Request(BASE, { body: "{}", headers: { accept: MCP_ACCEPT, "content-type": "text/plain" }, method: "POST" }), handlers);
    assert.equal(badType.status, 415);

    const put = await handleMcpProtocolRequest(new Request(BASE, { method: "PUT" }), handlers);
    assert.equal(put.status, 405);
  });

  test("bounds the final serialized envelope and sanitizes execution failures", async () => {
    const handlers = makeHandlers(null);
    const session = await openSession(handlers);

    const bigHandlers = { ...handlers, async callTool() { return "x".repeat(2 * 1024 * 1024); } };
    const big = await jsonBody(await handleMcpProtocolRequest(mcpRequest(BASE, { id: 2, jsonrpc: "2.0", method: "tools/call", params: { arguments: { value: "big" }, name: "pinar.echo" } }, { "mcp-session-id": session }), bigHandlers));
    assert.equal((big.result as { isError?: boolean })?.isError, true);
    assert.match(contentText(big.result), /too large/);

    const quoteResponse = await handleMcpProtocolRequest(mcpRequest(BASE, { id: 3, jsonrpc: "2.0", method: "tools/call", params: { arguments: {}, name: "pinar.quote" } }, { "mcp-session-id": session }), handlers);
    const quoteWire = await quoteResponse.text();
    assert.ok(new TextEncoder().encode(quoteWire).byteLength < MAX_TOOL_RESPONSE_BYTES, `escaped envelope must stay under 1MiB, got ${quoteWire.length} chars`);
    const quoteBody = JSON.parse(quoteWire) as { result?: { content?: Array<{ text: string }>; isError?: boolean } };
    assert.equal(quoteBody.result?.isError, true);
    assert.match(String(quoteBody.result?.content?.[0]?.text), /too large/);

    const bigint = await jsonBody(await handleMcpProtocolRequest(mcpRequest(BASE, { id: 4, jsonrpc: "2.0", method: "tools/call", params: { arguments: {}, name: "pinar.bigint" } }, { "mcp-session-id": session }), handlers));
    assert.equal((bigint.result as { isError?: boolean })?.isError, true);
    assert.equal(contentText(bigint.result), "Tool failed");
    assert.ok(!JSON.stringify(bigint).includes("BigInt"), "internal serialization messages must not leak");
  });

  test("rejects JSON-RPC batch arrays before the library with a bounded 400 and no handler calls", async () => {
    const handlers = makeHandlers(null);
    callLog = [];

    const mixed = await handleMcpProtocolRequest(mcpRequest(BASE, [
      { id: 1, jsonrpc: "2.0", method: "initialize", params: INITIALIZE_PARAMS },
      { id: 2, jsonrpc: "2.0", method: "tools/call", params: { arguments: { value: "x" }, name: "pinar.echo" } },
    ]), handlers);
    assert.equal(mixed.status, 400);
    const mixedBody = await jsonBody(mixed);
    assert.equal((mixedBody.error as { code?: number })?.code, -32600);
    assert.equal((mixedBody.error as { message?: string })?.message, "Batch requests are not supported");

    const twentyFive = await handleMcpProtocolRequest(
      mcpRequest(BASE, Array.from({ length: 25 }, (_, index) => ({ id: index + 1, jsonrpc: "2.0", method: "tools/list" }))),
      handlers,
    );
    assert.equal(twentyFive.status, 400);
    assert.equal(callLog.length, 0, "batch members must not reach business handlers");

    const hundred = await handleMcpProtocolRequest(
      mcpRequest(BASE, Array.from({ length: 100 }, (_, index) => ({ id: index + 1, jsonrpc: "2.0", method: "tools/call", params: { arguments: {}, name: "pinar.quote" } }))),
      handlers,
    );
    const hundredWire = await hundred.text();
    assert.equal(hundred.status, 400);
    assert.ok(new TextEncoder().encode(hundredWire).byteLength < 1024, `the batch response must be bounded, got ${hundredWire.length} chars`);
    assert.equal(callLog.length, 0, "a 100-call batch must not run any business tool");

    const modernBatch = await handleMcpProtocolRequest(
      new Request(BASE, {
        body: JSON.stringify([
          { jsonrpc: "2.0", id: "m1", method: "server/discover", params: { _meta: { "io.modelcontextprotocol/protocolVersion": "2026-07-28" } } },
          { jsonrpc: "2.0", id: "m2", method: "tools/call", params: { _meta: { "io.modelcontextprotocol/protocolVersion": "2026-07-28" }, arguments: {}, name: "pinar.quote" } },
        ]),
        headers: { accept: MCP_ACCEPT, "content-type": "application/json", "mcp-method": "tools/call", "mcp-protocol-version": "2026-07-28" },
        method: "POST",
      }),
      handlers,
    );
    assert.equal(modernBatch.status, 400);
    assert.equal(callLog.length, 0, "modern-framed batches must not run any business tool");
  });

  test("undefined, function, and symbol tool results become a safe Tool failed error", async () => {
    const handlers = makeHandlers(null);
    const session = await openSession(handlers);
    for (const name of ["pinar.undefined", "pinar.func", "pinar.symbol"]) {
      const body = await jsonBody(await handleMcpProtocolRequest(mcpRequest(BASE, { id: 9, jsonrpc: "2.0", method: "tools/call", params: { arguments: {}, name } }, { "mcp-session-id": session }), handlers));
      const toolResult = body.result as { content?: Array<{ text?: string }>; isError?: boolean };
      assert.equal(toolResult.isError, true, `${name} must not surface as an empty success`);
      assert.equal(String(toolResult.content?.[0]?.text), "Tool failed");
    }
  });

  test("denies owner-mismatch and ghost sessions, and keeps invalid input out of handlers", async () => {
    const alice = makeHandlers("alice");
    const bob = makeHandlers("bob");
    const aliceSession = await openSession(alice);

    const mismatch = await handleMcpProtocolRequest(mcpRequest(BASE, { id: 2, jsonrpc: "2.0", method: "tools/list" }, { "mcp-session-id": aliceSession }), bob);
    assert.equal(mismatch.status, 404);
    assert.equal(((await jsonBody(mismatch)).error as { code?: number })?.code, -32001);

    const ghost = await handleMcpProtocolRequest(mcpRequest(BASE, { id: 3, jsonrpc: "2.0", method: "tools/list" }, { "mcp-session-id": "ghost" }), alice);
    assert.equal(ghost.status, 404);

    const noSession = await handleMcpProtocolRequest(mcpRequest(BASE, { id: 4, jsonrpc: "2.0", method: "tools/list" }), alice);
    assert.equal(noSession.status, 400);

    callLog = [];
    const unknown = await jsonBody(await handleMcpProtocolRequest(mcpRequest(BASE, { id: 5, jsonrpc: "2.0", method: "tools/call", params: { arguments: {}, name: "pinar.nope" } }, { "mcp-session-id": aliceSession }), alice));
    assert.equal((unknown.error as { code?: number })?.code, -32602);
    assert.equal(callLog.length, 0, "unknown tools must not reach business handlers");

    const invalid = await jsonBody(await handleMcpProtocolRequest(mcpRequest(BASE, { id: 6, jsonrpc: "2.0", method: "tools/call", params: { arguments: { ids: [] }, name: "pinar.arr" } }, { "mcp-session-id": aliceSession }), alice));
    const invalidResult = invalid.result as { content?: Array<{ text: string }>; isError?: boolean };
    assert.equal(invalidResult.isError, true);
    assert.match(String(invalidResult.content?.[0]?.text), /Input validation error/);
    assert.equal(callLog.length, 0, "schema-invalid arguments must not reach business handlers");

    const reinit = await handleMcpProtocolRequest(mcpRequest(BASE, { id: 7, jsonrpc: "2.0", method: "initialize", params: INITIALIZE_PARAMS }, { "mcp-session-id": aliceSession }), alice);
    assert.equal(reinit.status, 400);
  });

  test("bridges absent Accept, refuses explicit bad Accept, and serves the 2026 envelope", async () => {
    const handlers = makeHandlers(null);
    const noAccept = await handleMcpProtocolRequest(
      new Request(BASE, { body: JSON.stringify({ id: 1, jsonrpc: "2.0", method: "initialize", params: INITIALIZE_PARAMS }), headers: { "content-type": "application/json" }, method: "POST" }),
      handlers,
    );
    assert.equal(noAccept.status, 200);
    assert.ok(noAccept.headers.get("mcp-session-id"));

    const badAccept = await handleMcpProtocolRequest(
      new Request(BASE, { body: JSON.stringify({ id: 2, jsonrpc: "2.0", method: "initialize", params: INITIALIZE_PARAMS }), headers: { accept: "text/html", "content-type": "application/json" }, method: "POST" }),
      handlers,
    );
    assert.equal(badAccept.status, 406);

    const discover = await jsonBody(await handleMcpProtocolRequest(
      new Request(BASE, {
        body: JSON.stringify({ jsonrpc: "2.0", id: "d1", method: "server/discover", params: { _meta: { "io.modelcontextprotocol/clientCapabilities": {}, "io.modelcontextprotocol/clientInfo": { name: "p", version: "0" }, "io.modelcontextprotocol/protocolVersion": "2026-07-28" } } }),
        headers: { accept: MCP_ACCEPT, "content-type": "application/json", "mcp-method": "server/discover", "mcp-protocol-version": "2026-07-28" },
        method: "POST",
      }),
      handlers,
    ));
    const discoverResult = discover.result as Record<string, unknown>;
    assert.deepEqual(discoverResult.supportedVersions, ["2026-07-28"]);
    assert.equal(discoverResult.instructions, "Pinar Cloud tools act only within the authenticated user's current permissions.");

    const modern = await jsonBody(await handleMcpProtocolRequest(
      new Request(BASE, {
        body: JSON.stringify({ jsonrpc: "2.0", id: "c1", method: "tools/call", params: { _meta: { "io.modelcontextprotocol/clientCapabilities": {}, "io.modelcontextprotocol/protocolVersion": "2026-07-28" }, arguments: { value: "modern" }, name: "pinar.echo" } }),
        headers: { accept: MCP_ACCEPT, "content-type": "application/json", "mcp-method": "tools/call", "mcp-name": "pinar.echo", "mcp-protocol-version": "2026-07-28" },
        method: "POST",
      }),
      handlers,
    ));
    assert.equal(JSON.parse(contentText(modern.result)).value, "modern");
  });
});

describe("MCP transport over a real HTTP endpoint", () => {
  const TOKENS = { alice: "tok_alice", bob: "tok_bob" } as const;

  function httpHandlers(request: Request): McpProtocolHandlers {
    const header = request.headers.get("authorization") ?? "";
    return makeHandlers(header === `Bearer ${TOKENS.bob}` ? "bob" : "alice");
  }

  let server: ReturnType<typeof Bun.serve> | null = null;
  let url = "";

  const wireCalls: Array<{ body: string; headers: Record<string, string>; method: string }> = [];

  before(() => {
    server = Bun.serve({
      fetch: async (request) => {
        const recorded = request.clone();
        wireCalls.push({
          body: (await recorded.text()).slice(0, 2000),
          headers: Object.fromEntries(request.headers.entries()),
          method: request.method,
        });
        return handleMcpProtocolRequest(request, httpHandlers(request));
      },
      port: 0,
    });
    url = `http://127.0.0.1:${server.port}/api/mcp`;
  });

  after(() => {
    server?.stop(true);
    server = null;
  });

  test("real SDK client completes initialize, list, and call over HTTP", async () => {
    const transport = new StreamableHTTPClientTransport(new URL(url), {
      requestInit: { headers: { authorization: `Bearer ${TOKENS.alice}` } },
    });
    const client = new Client({ name: "pinar-sdk-test", version: "0.0.0" }, { capabilities: {} });
    await client.connect(transport);
    const listed = await client.listTools();
    assert.deepEqual(listed.tools.map((tool) => tool.name).sort(), TOOLS.map((tool) => tool.name).sort());
    const called = await client.callTool({ arguments: { value: "over-http" }, name: "pinar.echo" });
    assert.match(String(called.content[0]?.text), /"principal":"alice"/);
    await client.close();
  });

  test("interleaved principals keep fresh per-request context and cross-owner session reuse is denied", async () => {
    const transportAlice = new StreamableHTTPClientTransport(new URL(url), {
      requestInit: { headers: { authorization: `Bearer ${TOKENS.alice}` } },
    });
    const clientAlice = new Client({ name: "pinar-a", version: "0.0.0" }, { capabilities: {} });
    await clientAlice.connect(transportAlice);
    const transportBob = new StreamableHTTPClientTransport(new URL(url), {
      requestInit: { headers: { authorization: `Bearer ${TOKENS.bob}` } },
    });
    const clientBob = new Client({ name: "pinar-b", version: "0.0.0" }, { capabilities: {} });
    await clientBob.connect(transportBob);

    for (let round = 0; round < 2; round++) {
      const aliceCall = await clientAlice.callTool({ arguments: { value: `a${round}` }, name: "pinar.echo" });
      assert.match(String(aliceCall.content[0]?.text), /"principal":"alice"/, `round ${round}: alice must read her own context`);
      const bobCall = await clientBob.callTool({ arguments: { value: `b${round}` }, name: "pinar.echo" });
      assert.match(String(bobCall.content[0]?.text), /"principal":"bob"/, `round ${round}: bob must read his own context`);
    }

    const init = await fetch(url, { body: JSON.stringify({ id: 1, jsonrpc: "2.0", method: "initialize", params: INITIALIZE_PARAMS }), headers: { accept: MCP_ACCEPT, authorization: `Bearer ${TOKENS.alice}`, "content-type": "application/json" }, method: "POST" });
    const aliceSession = init.headers.get("mcp-session-id") ?? "";
    const crossOwner = await fetch(url, { body: JSON.stringify({ id: 2, jsonrpc: "2.0", method: "tools/list" }), headers: { accept: MCP_ACCEPT, authorization: `Bearer ${TOKENS.bob}`, "content-type": "application/json", "mcp-session-id": aliceSession }, method: "POST" });
    assert.equal(crossOwner.status, 404);
    assert.equal(((await crossOwner.json()) as { error?: { code?: number } }).error?.code, -32001);

    const oversized = await fetch(url, { body: JSON.stringify({ id: 3, jsonrpc: "2.0", method: "ping", padding: "x".repeat(300_000) }), headers: { accept: MCP_ACCEPT, "content-type": "application/json" }, method: "POST" });
    assert.equal(oversized.status, 413);

    const malformed = await fetch(url, { body: "{", headers: { accept: MCP_ACCEPT, "content-type": "application/json" }, method: "POST" });
    assert.equal(malformed.status, 400);

    await clientAlice.close();
    await clientBob.close();
  });

  test("real SDK clients decode the capped modern result as a bounded tool error (auto, pinned 2026, and legacy default)", async () => {
    const runTransition = async (mode: "auto" | { pin: string }) => {
      const transport = new StreamableHTTPClientTransport(new URL(url), {
        requestInit: { headers: { authorization: `Bearer ${TOKENS.alice}` } },
      });
      const client = new Client({ name: "pinar-cap-test", version: "0.0.0" }, { capabilities: {}, versionNegotiation: { mode } });
      await client.connect(transport);
      const small = await client.callTool({ arguments: { value: "before" }, name: "pinar.echo" });
      assert.match(String(small.content[0]?.text), /"value":"before"/, "small results before the oversized one must decode");
      const capped = await client.callTool({ arguments: {}, name: "pinar.quote" });
      assert.equal(capped.isError, true, "the capped modern result must decode as a bounded tool error");
      assert.match(String(capped.content[0]?.text), /too large/);
      const after = await client.callTool({ arguments: { value: "after" }, name: "pinar.echo" });
      assert.match(String(after.content[0]?.text), /"value":"after"/, "small results after the oversized one must decode");
      await client.close();
    };
    const modernBaseline = wireCalls.length;
    await runTransition("auto");
    await runTransition({ pin: "2026-07-28" });

    const modernQuoteCalls = wireCalls
      .slice(modernBaseline)
      .filter((call) => call.method === "POST" && call.body.includes('"name":"pinar.quote"'));
    assert.ok(modernQuoteCalls.length >= 2, "the SDK must issue the oversized quote call in both modern transitions");
    for (const call of modernQuoteCalls) {
      assert.equal(call.headers["mcp-protocol-version"], "2026-07-28", "the SDK's own modern tools/call must carry the negotiated revision");
      assert.ok(call.body.includes("2026-07-28"), "the SDK's own modern tools/call must carry the 2026 protocol version in _meta");
    }

    const negotiationProof = await fetch(url, {
      body: JSON.stringify({ jsonrpc: "2.0", id: "n1", method: "server/discover", params: { _meta: { "io.modelcontextprotocol/clientCapabilities": {}, "io.modelcontextprotocol/clientInfo": { name: "proof", version: "0" }, "io.modelcontextprotocol/protocolVersion": "2026-07-28" } } }),
      headers: { accept: MCP_ACCEPT, "content-type": "application/json", "mcp-method": "server/discover", "mcp-protocol-version": "2026-07-28" },
      method: "POST",
    });
    const negotiation = (await negotiationProof.json()) as { result?: { supportedVersions?: string[] } };
    assert.deepEqual(negotiation.result?.supportedVersions, ["2026-07-28"], "the server must offer the modern revision the client negotiated");

    const transport = new StreamableHTTPClientTransport(new URL(url), {
      requestInit: { headers: { authorization: `Bearer ${TOKENS.alice}` } },
    });
    const client = new Client({ name: "pinar-cap-legacy", version: "0.0.0" }, { capabilities: {} });
    await client.connect(transport);
    const capped = await client.callTool({ arguments: {}, name: "pinar.quote" });
    assert.equal(capped.isError, true);
    assert.match(String(capped.content[0]?.text), /too large/);
    await client.close();
  });

  test("simultaneous Promise.all across distinct principals keeps isolation under the current gates", async () => {
    const clients = await Promise.all(
      (["alice", "bob"] as const).map(async (principal) => {
        const transport = new StreamableHTTPClientTransport(new URL(url), {
          requestInit: { headers: { authorization: `Bearer ${TOKENS[principal]}` } },
        });
        const client = new Client({ name: `pinar-${principal}`, version: "0.0.0" }, { capabilities: {} });
        await client.connect(transport);
        return { client, principal };
      }),
    );
    try {
      const calls = clients.flatMap(({ client, principal }) =>
        Array.from({ length: 10 }, (_, index) =>
          client.callTool({ arguments: { value: `${principal}${index}` }, name: "pinar.echo" }).then((result) => ({ principal, text: String(result.content[0]?.text) })),
        ),
      );
      const results = await Promise.all(calls);
      assert.equal(results.length, 20);
      for (const { principal, text } of results) {
        assert.ok(text.includes(`"principal":"${principal}"`), `a simultaneous call must stay within ${principal}: ${text}`);
      }
      assert.equal(results.filter((item) => item.principal === "alice").length, 10);
      assert.equal(results.filter((item) => item.principal === "bob").length, 10);
    } finally {
      await Promise.all(clients.map(({ client }) => client.close()));
    }
  });

  test("TanStack high-level client completes a callTool round trip over HTTP", async () => {
    const client = await createMCPClient({ transport: { type: "http", url } });
    const result = await client.callTool("pinar.echo", { value: "tanstack" });
    const block = (result.content as Array<{ text?: string }>)[0];
    assert.match(String(block?.text), /"principal":"alice"/);
    await client.close();
  });
});
