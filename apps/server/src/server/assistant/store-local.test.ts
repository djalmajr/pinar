import assert from "node:assert/strict";
import { openHistoryDb } from "@pinar/cli/history";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, test } from "node:test";
import { assistantThreadTitle, newAssistantMessageId, newAssistantThreadId, type AssistantMessage } from "./store";
import { localAssistantStore, type LocalAssistantDatabase } from "./store-local";

describe("localAssistantStore", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "pinar-assistant-local-"));
  });

  afterEach(async () => {
    await rm(tempDir, { force: true, recursive: true });
  });

  test("adapts the synchronous history db to the promise store", async () => {
    const db = openHistoryDb(tempDir) as unknown as LocalAssistantDatabase & { close(): void };
    const store = localAssistantStore(db);

    const thread = await store.createThread({
      id: newAssistantThreadId(),
      now: "2026-10-01T00:00:00.000Z",
      title: assistantThreadTitle("  fix   the   header  "),
    });
    assert.equal(thread.title, "fix the header");
    assert.equal(thread.createdAt, "2026-10-01T00:00:00.000Z");
    assert.equal(thread.updatedAt, "2026-10-01T00:00:00.000Z");

    const message: AssistantMessage = {
      createdAt: "2026-10-01T00:01:00.000Z",
      errorCode: null,
      id: newAssistantMessageId(),
      role: "user",
      status: "final",
      text: "Hello",
      threadId: thread.id,
    };
    await store.appendMessage(message);
    assert.equal((await store.getThread(thread.id))?.updatedAt, message.createdAt);

    const reply: AssistantMessage = {
      ...message,
      createdAt: "2026-10-01T00:02:00.000Z",
      id: newAssistantMessageId(),
      role: "assistant",
      text: "Hi there",
    };
    await store.appendMessage(reply);

    // The most recent message only, in chronological order.
    const messages = await store.listMessages(thread.id, { limit: 1 });
    assert.equal(messages.length, 1);
    assert.equal(messages[0].id, reply.id);
    assert.equal(messages[0].role, "assistant");
    assert.equal(messages[0].text, "Hi there");
    assert.equal((await store.listMessages(thread.id, { limit: 10 })).length, 2);

    const list = await store.listThreads({ limit: 10, offset: 0 });
    assert.deepEqual(list.map((item) => item.id), [thread.id]);

    await assert.rejects(
      store.appendMessage({ ...message, id: newAssistantMessageId(), threadId: "ath_missing" }),
      (error: unknown) => error instanceof Error && error.message === "assistant thread not found",
    );
    assert.equal(await store.getThread("ath_missing"), null);
    assert.equal(await store.deleteThread(thread.id), true);
    assert.equal(await store.deleteThread(thread.id), false);
    assert.deepEqual(await store.listMessages(thread.id, { limit: 5 }), []);
    db.close();
  });

  test("survives a reopen of the local history db", async () => {
    const db = openHistoryDb(tempDir) as unknown as LocalAssistantDatabase & { close(): void };
    const store = localAssistantStore(db);
    const thread = await store.createThread({
      id: newAssistantThreadId(),
      now: "2026-10-01T00:00:00.000Z",
      title: "Persisted",
    });
    await store.appendMessage({
      createdAt: "2026-10-01T00:01:00.000Z",
      errorCode: null,
      id: newAssistantMessageId(),
      role: "user",
      status: "final",
      text: "Still here",
      threadId: thread.id,
    });
    db.close();

    const reopened = openHistoryDb(tempDir) as unknown as LocalAssistantDatabase & { close(): void };
    const reopenedStore = localAssistantStore(reopened);
    assert.equal((await reopenedStore.getThread(thread.id))?.title, "Persisted");
    assert.deepEqual((await reopenedStore.listMessages(thread.id, { limit: 5 })).map((item) => item.text), ["Still here"]);
    reopened.close();
  });

  test("keeps the newest of tied timestamps when limiting (rowid tie-break)", async () => {
    const db = openHistoryDb(tempDir) as unknown as LocalAssistantDatabase & { close(): void };
    const store = localAssistantStore(db);
    const thread = await store.createThread({
      id: newAssistantThreadId(),
      now: "2026-10-01T00:00:00.000Z",
      title: "Tied",
    });
    const now = "2026-10-01T00:01:00.000Z";
    const ids = ["amg_tied_m1", "amg_tied_m2", "amg_tied_m3"];
    for (const id of ids) {
      await store.appendMessage({
        createdAt: now,
        errorCode: null,
        id,
        role: "user",
        status: "final",
        text: id,
        threadId: thread.id,
      });
    }

    // Same timestamp: the limit cut must keep the last two inserted.
    assert.deepEqual((await store.listMessages(thread.id, { limit: 2 })).map((item) => item.id), [
      "amg_tied_m2",
      "amg_tied_m3",
    ]);
    assert.deepEqual((await store.listMessages(thread.id, { limit: 10 })).map((item) => item.id), ids);
    db.close();
  });
});
