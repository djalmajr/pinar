import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { makeNewPin, makePage } from "./factory";
import { createHandlers } from "./handlers";
import { peekText, statusText, takeText } from "./mcp-tools";
import { createStore } from "./store";

async function handlers() {
  const root = await mkdtemp(join(tmpdir(), "ai-feedback-mcp-"));
  return createHandlers(createStore(root));
}

describe("mcp tool text", () => {
  test("take stays empty until send, then returns comment once", async () => {
    // Mutation captured: feedback_take returning draft pins before Send.
    const api = await handlers();
    await api.setPage(makePage());
    await api.addPin(makeNewPin({ comment: "Increase contrast" }));
    expect(await takeText(api)).toContain("⌘/Ctrl+Enter");
    expect(await statusText(api)).toContain("draftPins: 1");
    expect(await statusText(api)).toContain("sentWaiting: false");
    expect(await statusText(api)).toContain("queued: 0");
    await api.send();
    expect(await statusText(api)).toContain("queued: 1");
    expect(await peekText(api)).toContain("Increase contrast");
    expect(await takeText(api)).toContain("Increase contrast");
    expect(await takeText(api)).toContain("⌘/Ctrl+Enter");
    expect(await statusText(api)).toContain("queued: 0");
  });
});