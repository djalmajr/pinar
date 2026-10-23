import assert from "node:assert/strict";
import { openHistoryDb } from "@pinar/cli/history";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, test } from "node:test";
import { assistantThreadTitle, newAssistantMessageId, newAssistantThreadId, newAssistantProposalId, type AssistantMessage, type AssistantProposalRecord } from "./store";
import { localAssistantStore, type LocalAssistantDatabase } from "./store-local";
import { releaseClosedDatabases } from "../../../tests/helpers/native-handles";

describe("localAssistantStore", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "pinar-assistant-local-"));
  });

  afterEach(async () => {
    await releaseClosedDatabases();
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
      ask: null,
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
      ask: { options: ["Confirm", "Reject"], question: "Move it?" },
      createdAt: "2026-10-01T00:02:00.000Z",
      errorCode: null,
      id: newAssistantMessageId(),
      role: "assistant",
      status: "final",
      text: "Hi there",
      threadId: thread.id,
    };
    await store.appendMessage(reply);

    // The most recent message only, in chronological order.
    const messages = await store.listMessages(thread.id, { limit: 1 });
    assert.equal(messages.length, 1);
    assert.equal(messages[0].id, reply.id);
    assert.equal(messages[0].role, "assistant");
    assert.equal(messages[0].text, "Hi there");
    assert.deepEqual(messages[0].ask, { options: ["Confirm", "Reject"], question: "Move it?" });
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
      ask: null,
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
        ask: null,
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

  test("adapts the proposal methods and keeps them durable", async () => {
    const db = openHistoryDb(tempDir) as unknown as LocalAssistantDatabase & { close(): void };
    const store = localAssistantStore(db);
    const thread = await store.createThread({
      id: "ath_prop",
      now: "2026-10-01T00:00:00.000Z",
      title: "Proposals",
    });

    await assert.rejects(
      store.createProposal(proposalFor({ threadId: "ath_missing" })),
      (error: unknown) => error instanceof Error && error.message === "assistant thread not found",
    );

    const first = proposalFor({ id: "apr_first_local_000000000000" });
    const second = proposalFor({
      createdAt: "2026-10-01T00:02:00.000Z",
      executedAt: "2026-10-01T00:03:00.000Z",
      id: "apr_second_local_00000000000",
      result: { failed: 0, moved: 2 },
      status: "executed",
      undo: { calls: [{ args: { collectionId: "col_origin", sessionId: "s1" }, tool: "pinar.move_session" }], postFingerprint: "bb".repeat(32) },
      undoExpiresAt: "2026-10-01T00:13:00.000Z",
      updatedAt: "2026-10-01T00:03:00.000Z",
    });
    const third = proposalFor({ createdAt: "2026-10-01T00:03:00.000Z", id: "apr_third_local_000000000000" });
    await store.createProposal(first);
    await store.createProposal(second);
    await store.createProposal(third);

    assert.equal(await store.getProposal("apr_missing_local_0000000000"), null);
    // The JSON fields round-trip through the adapter.
    assert.deepEqual(await store.getProposal(second.id), second);
    assert.deepEqual((await store.listProposals(thread.id)).map((proposal) => proposal.id), [first.id, second.id, third.id]);

    const executing = await store.transitionProposal({ from: ["proposed"], id: first.id, now: "2026-10-01T00:04:00.000Z", to: "executing" });
    assert.equal(executing?.status, "executing");
    assert.equal(executing?.updatedAt, "2026-10-01T00:04:00.000Z");
    assert.equal(await store.transitionProposal({ from: ["proposed"], id: first.id, now: "2026-10-01T00:05:00.000Z", to: "executing" }), null);

    // requireBefore expired → null; inside the window → the patch lands.
    assert.equal(
      await store.transitionProposal({
        from: ["executing"],
        id: first.id,
        now: "2026-10-01T00:11:00.000Z",
        patch: { executedAt: "2026-10-01T00:11:00.000Z" },
        requireBefore: "expiresAt",
        to: "executed",
      }),
      null,
    );
    const executed = await store.transitionProposal({
      from: ["executing"],
      id: first.id,
      now: "2026-10-01T00:06:00.000Z",
      patch: { result: { moved: 2 }, undo: { calls: [], postFingerprint: "cc".repeat(32) }, undoExpiresAt: "2026-10-01T00:16:00.000Z" },
      requireBefore: "expiresAt",
      to: "executed",
    });
    assert.deepEqual(executed?.result, { moved: 2 });
    assert.deepEqual(executed?.undo, { calls: [], postFingerprint: "cc".repeat(32) });

    // Two back-to-back transitions from "proposed": only the first wins.
    const firstClaim = await store.transitionProposal({ from: ["proposed"], id: third.id, now: "2026-10-01T00:07:00.000Z", to: "executing" });
    const secondClaim = await store.transitionProposal({ from: ["proposed"], id: third.id, now: "2026-10-01T00:07:01.000Z", to: "rejected" });
    assert.equal(firstClaim?.status, "executing");
    assert.equal(secondClaim, null);

    db.close();
    const reopened = openHistoryDb(tempDir) as unknown as LocalAssistantDatabase & { close(): void };
    const reopenedStore = localAssistantStore(reopened);
    // The transitions and the JSON payloads survive a reopen.
    assert.equal((await reopenedStore.getProposal(first.id))?.status, "executed");
    assert.deepEqual((await reopenedStore.getProposal(first.id))?.result, { moved: 2 });
    assert.equal((await reopenedStore.getProposal(second.id))?.status, "executed");
    assert.equal((await reopenedStore.getProposal(third.id))?.status, "executing");
    assert.deepEqual((await reopenedStore.listProposals(thread.id)).map((proposal) => proposal.id), [first.id, second.id, third.id]);

    assert.equal(await reopenedStore.deleteThread(thread.id), true);
    assert.equal(await reopenedStore.getProposal(first.id), null);
    assert.deepEqual(await reopenedStore.listProposals(thread.id), []);
    reopened.close();
  });
});

const proposalFor = (overrides: Partial<AssistantProposalRecord> = {}): AssistantProposalRecord => ({
  args: { collectionId: "col_target", sessionIds: ["s1", "s2"] },
  createdAt: "2026-10-01T00:01:00.000Z",
  display: { action: "move_sessions", params: { collection: "Target", count: 2 } },
  errorCode: null,
  executedAt: null,
  expiresAt: "2026-10-01T00:11:00.000Z",
  fingerprint: "aa".repeat(32),
  id: newAssistantProposalId(),
  messageId: "amg_prop",
  result: null,
  risk: "reversible",
  status: "proposed",
  summary: 'Move 2 sessions to "Target"',
  threadId: "ath_prop",
  tool: "pinar.move_sessions",
  undo: null,
  undoExpiresAt: null,
  updatedAt: "2026-10-01T00:01:00.000Z",
  ...overrides,
});
