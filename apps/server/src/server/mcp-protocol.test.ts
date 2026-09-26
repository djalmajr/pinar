import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { handleMcpProtocolRequest, McpToolError, type McpProtocolHandlers } from "./mcp-protocol";

const handlers: McpProtocolHandlers = {
  async callTool(name, args) {
    if (args.fail === true) throw new McpToolError("Denied");
    return { name, value: args.value };
  },
  tools: [{ description: "Echo a value", inputSchema: { properties: { value: { type: "string" } }, type: "object" }, name: "pinar.echo" }],
};

function request(body: unknown, headers: HeadersInit = {}) {
  return new Request("https://pinar.test/mcp", {
    body: JSON.stringify(body),
    headers: { "content-type": "application/json", ...Object.fromEntries(new Headers(headers)) },
    method: "POST",
  });
}

async function json(response: Response) {
  return response.json() as Promise<Record<string, unknown>>;
}

describe("stateless MCP transport", () => {
  test("negotiates 2025-11-25, lists tools, and calls one tool", async () => {
    const initialized = await handleMcpProtocolRequest(request({ id: 1, jsonrpc: "2.0", method: "initialize", params: { protocolVersion: "2025-11-25" } }), handlers);
    assert.equal(initialized.status, 200);
    assert.equal((await json(initialized)).result?.protocolVersion, "2025-11-25");
    const listed = await json(await handleMcpProtocolRequest(request({ id: 2, jsonrpc: "2.0", method: "tools/list" }), handlers));
    assert.equal(listed.result?.tools?.[0]?.name, "pinar.echo");
    const called = await json(await handleMcpProtocolRequest(request({ id: 3, jsonrpc: "2.0", method: "tools/call", params: { arguments: { value: "ok" }, name: "pinar.echo" } }), handlers));
    assert.equal(JSON.parse(called.result?.content?.[0]?.text).value, "ok");
  });

  test("refuses cross-origin calls before invoking a tool", async () => {
    let called = false;
    const denied = await handleMcpProtocolRequest(request({ id: 1, jsonrpc: "2.0", method: "tools/call", params: { name: "pinar.echo" } }, { origin: "https://evil.test" }), {
      ...handlers,
      async callTool() { called = true; return {}; },
    });
    assert.equal(denied.status, 403);
    assert.equal(called, false);
  });

  test("returns 202 for initialized notification and a safe tool error", async () => {
    const notification = await handleMcpProtocolRequest(request({ jsonrpc: "2.0", method: "notifications/initialized" }), handlers);
    assert.equal(notification.status, 202);
    assert.equal(await notification.text(), "");
    const denied = await json(await handleMcpProtocolRequest(request({ id: 4, jsonrpc: "2.0", method: "tools/call", params: { arguments: { fail: true }, name: "pinar.echo" } }), handlers));
    assert.equal(denied.result?.isError, true);
    assert.equal(denied.result?.content?.[0]?.text, "Denied");
  });

  test("rejects an oversized body, malformed JSON, and unsupported version", async () => {
    const tooLarge = await handleMcpProtocolRequest(request({ id: 1, jsonrpc: "2.0", method: "ping", padding: "x".repeat(300_000) }), handlers);
    assert.equal(tooLarge.status, 413);
    const malformed = await handleMcpProtocolRequest(new Request("https://pinar.test/mcp", { body: "{", headers: { "content-type": "application/json" }, method: "POST" }), handlers);
    assert.equal(malformed.status, 400);
    const badVersion = await handleMcpProtocolRequest(request({ id: 1, jsonrpc: "2.0", method: "ping" }, { "mcp-protocol-version": "2001-01-01" }), handlers);
    assert.equal(badVersion.status, 400);
  });

  test("returns Markdown directly and bounds serialized tool responses", async () => {
    const markdown = await json(await handleMcpProtocolRequest(request({ id: 1, jsonrpc: "2.0", method: "tools/call", params: { name: "pinar.echo" } }), {
      ...handlers,
      async callTool() { return "# Private session\nA note"; },
    }));
    assert.equal(markdown.result?.content?.[0]?.text, "# Private session\nA note");
    const large = await json(await handleMcpProtocolRequest(request({ id: 2, jsonrpc: "2.0", method: "tools/call", params: { name: "pinar.echo" } }), {
      ...handlers,
      async callTool() { return "x".repeat(2 * 1024 * 1024); },
    }));
    assert.equal(large.result?.isError, true);
    assert.match(String(large.result?.content?.[0]?.text), /too large/);
  });
});
