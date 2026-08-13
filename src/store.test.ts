import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { makeNewPin, makePage } from "./factory";
import { createStore } from "./store";

async function tempStore() {
  const root = await mkdtemp(join(tmpdir(), "ai-feedback-"));
  return createStore(root);
}

describe("store", () => {
  test("take returns null until the user sends pins", async () => {
    // Mutation captured: treating draft pins as a sent bundle.
    const store = await tempStore();
    await store.setPage(makePage());
    await store.addPin(makeNewPin());
    expect(await store.take()).toBeNull();
    expect((await store.status()).hasSent).toBe(false);
    expect((await store.status()).draftCount).toBe(1);
  });

  test("send refuses an empty draft", async () => {
    // Mutation captured: allowing Send with zero pins.
    const store = await tempStore();
    await expect(store.send()).rejects.toThrow(/no pins/i);
  });

  test("take consumes the sent bundle once", async () => {
    // Mutation captured: take leaving sent in place so a second agent rereads stale pins.
    const store = await tempStore();
    await store.setPage(makePage({ url: "http://localhost:5173/" }));
    await store.addPin(makeNewPin({ comment: "Too much padding" }));
    const sent = await store.send();
    expect(sent.pins[0]?.comment).toBe("Too much padding");
    const first = await store.take();
    expect(first?.url).toBe("http://localhost:5173/");
    expect(first?.pins).toHaveLength(1);
    expect(await store.take()).toBeNull();
    expect((await store.status()).hasSent).toBe(false);
    expect((await store.status()).draftCount).toBe(1);
  });

  test("a later send enqueues FIFO and take returns the oldest first", async () => {
    // Mutation captured: replacing the waiting bundle so an earlier send is lost.
    const store = await tempStore();
    await store.replaceDraft(makePage({ url: "http://localhost/a" }), [
      makeNewPin({ comment: "first" }),
    ]);
    await store.send();
    await store.replaceDraft(makePage({ url: "http://localhost/b" }), [
      makeNewPin({ comment: "second" }),
    ]);
    await store.send();
    expect((await store.status()).queued).toBe(2);
    expect((await store.peek())?.pins.map((pin) => pin.comment)).toEqual(["first"]);
    expect((await store.take())?.pins.map((pin) => pin.comment)).toEqual(["first"]);
    expect((await store.status()).queued).toBe(1);
    expect((await store.take())?.pins.map((pin) => pin.comment)).toEqual(["second"]);
    expect(await store.take()).toBeNull();
  });

  test("replaceDraft is the source of truth for the next send", async () => {
    // Mutation captured: merging replaceDraft pins onto leftover draft pins.
    const store = await tempStore();
    await store.addPin(makeNewPin({ comment: "stale" }));
    await store.replaceDraft(makePage(), [makeNewPin({ comment: "fresh" })]);
    const sent = await store.send();
    expect(sent.pins.map((pin) => pin.comment)).toEqual(["fresh"]);
  });

  test("send writes screenshot bytes to disk and records the path", async () => {
    // Mutation captured: storing base64 in state.json instead of a file path.
    const store = await tempStore();
    await store.setPage(makePage());
    const pin = await store.addPin(makeNewPin());
    const png = new TextEncoder().encode("fake-png");
    const sent = await store.send({
      pinCrops: { [pin.id]: png },
      viewportPng: png,
    });
    expect(sent.viewportScreenshotPath?.endsWith(".png")).toBe(true);
    expect(sent.pins[0]?.screenshotPath?.endsWith(`${pin.id}.png`)).toBe(true);
    expect(await Bun.file(sent.viewportScreenshotPath ?? "").text()).toBe("fake-png");
  });

  test("loads a legacy single sent bundle as a one-item queue", async () => {
    // Mutation captured: dropping a pre-queue state.json sent object.
    const root = await mkdtemp(join(tmpdir(), "ai-feedback-legacy-"));
    await mkdir(root, { recursive: true });
    await writeFile(
      join(root, "state.json"),
      `${JSON.stringify({
        draft: {
          pins: [],
          title: "",
          url: "",
          viewport: { dpr: 1, height: 0, width: 0 },
        },
        sent: {
          pins: [{
            box: { height: 1, width: 1, x: 0, y: 0 },
            comment: "legacy",
            createdAt: "2026-08-13T12:00:00.000Z",
            id: "pin_legacy",
            kind: "element",
          }],
          sentAt: "2026-08-13T12:00:00.000Z",
          title: "Old",
          url: "http://localhost/old",
          viewport: { dpr: 1, height: 0, width: 0 },
        },
      })}\n`,
    );
    const store = createStore(root);
    expect((await store.status()).queued).toBe(1);
    expect((await store.take())?.pins[0]?.comment).toBe("legacy");
    expect(await store.take()).toBeNull();
  });
});