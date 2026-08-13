import { describe, expect, test } from "bun:test";
import { encodeMessage, pullMessages } from "./rpc";

describe("pullMessages", () => {
  test("reads Content-Length frames with CRLF and LF separators", () => {
    // Mutation captured: accepting only \\r\\n\\r\\n so Grok's LF frames never parse.
    const crlf = encodeMessage({ id: 1, jsonrpc: "2.0", method: "initialize" });
    const lf = crlf.replaceAll("\r\n", "\n");
    const { messages } = pullMessages(Buffer.from(crlf + lf));
    expect(messages.map((message) => message.id)).toEqual([1, 1]);
  });

  test("reads newline-delimited JSON without a Content-Length header", () => {
    // Mutation captured: dropping NDJSON initialize, so the agent waits forever.
    const line = `${JSON.stringify({ id: 7, jsonrpc: "2.0", method: "ping" })}\n`;
    const { framing, messages, rest } = pullMessages(Buffer.from(line));
    expect(framing).toBe("ndjson");
    expect(messages[0]?.id).toBe(7);
    expect(rest.length).toBe(0);
  });
});