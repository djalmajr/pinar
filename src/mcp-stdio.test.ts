import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { makeNewPin, makePage } from "./factory";
import { createStore } from "./store";

function frame(message: unknown): Uint8Array {
  const body = JSON.stringify(message);
  return new TextEncoder().encode(`Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`);
}

async function readUntil(stream: ReadableStream<Uint8Array>, done: (text: string) => boolean): Promise<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let text = "";
  while (true) {
    const chunk = await reader.read();
    if (chunk.done) return text;
    text += decoder.decode(chunk.value, { stream: true });
    if (done(text)) return text;
  }
}

function parseFrames(raw: string): unknown[] {
  const messages: unknown[] = [];
  let rest = raw;
  while (rest.length) {
    const headerEnd = rest.indexOf("\r\n\r\n");
    if (headerEnd < 0) break;
    const header = rest.slice(0, headerEnd);
    const match = /Content-Length:\s*(\d+)/i.exec(header);
    if (!match) break;
    const length = Number(match[1]);
    const start = headerEnd + 4;
    messages.push(JSON.parse(rest.slice(start, start + length)));
    rest = rest.slice(start + length);
  }
  return messages;
}

describe("mcp stdio", () => {
  test("feedback_take returns the sent comment over Content-Length framing", async () => {
    // Mutation captured: stdio server speaking NDJSON instead of Content-Length, so Grok/Claude never see the tool.
    const root = await mkdtemp(join(tmpdir(), "ai-feedback-stdio-"));
    const store = createStore(root);
    await store.replaceDraft(makePage({ url: "http://localhost:3000/dash" }), [
      makeNewPin({ comment: "Sidebar overlaps the table" }),
    ]);
    await store.send();

    const child = Bun.spawn({
      cmd: ["bun", join(import.meta.dir, "cli.ts"), "mcp"],
      env: {
        ...process.env,
        AI_FEEDBACK_HOME: root,
        AI_FEEDBACK_PORT: "0",
      },
      stderr: "pipe",
      stdin: "pipe",
      stdout: "pipe",
    });

    child.stdin.write(frame({ id: 1, jsonrpc: "2.0", method: "initialize", params: {} }));
    child.stdin.write(frame({ jsonrpc: "2.0", method: "notifications/initialized" }));
    child.stdin.write(
      frame({ id: 2, jsonrpc: "2.0", method: "tools/call", params: { name: "feedback_take" } }),
    );
    child.stdin.end();

    const stdout = await readUntil(child.stdout, (text) => text.includes("Sidebar overlaps the table"));
    child.kill();
    await child.exited;
    const messages = parseFrames(stdout) as Array<{ id?: number; result?: { content?: Array<{ text?: string }> } }>;
    const take = messages.find((message) => message.id === 2);
    expect(take?.result?.content?.[0]?.text).toContain("Sidebar overlaps the table");
    expect(take?.result?.content?.[0]?.text).toContain("http://localhost:3000/dash");
  });

  test("replies to Grok-style NDJSON initialize with NDJSON", async () => {
    // Mutation captured: always answering with Content-Length so grok mcp doctor times out.
    const root = await mkdtemp(join(tmpdir(), "ai-feedback-ndjson-"));
    const child = Bun.spawn({
      cmd: ["bun", join(import.meta.dir, "cli.ts"), "mcp"],
      env: { ...process.env, AI_FEEDBACK_HOME: root, AI_FEEDBACK_PORT: "0" },
      stderr: "pipe",
      stdin: "pipe",
      stdout: "pipe",
    });
    child.stdin.write(
      new TextEncoder().encode(
        `${JSON.stringify({
          id: 0,
          jsonrpc: "2.0",
          method: "initialize",
          params: { protocolVersion: "2025-11-25" },
        })}\n`,
      ),
    );
    const stdout = await readUntil(child.stdout, (text) => text.includes("ai-feedback"));
    child.stdin.end();
    child.kill();
    await child.exited;
    expect(stdout.startsWith("{")).toBe(true);
    expect(stdout).toContain("2025-11-25");
    expect(stdout).not.toContain("Content-Length");
  });
});