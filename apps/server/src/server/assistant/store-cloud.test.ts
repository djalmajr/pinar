import assert from "node:assert/strict";
import { Database } from "bun:sqlite";
import { readdirSync, readFileSync } from "node:fs";
import { beforeEach, describe, test } from "node:test";
import {
  cleanupAssistantThreads,
  cloudAssistantStore,
  resetCloudAssistantMemoryForTests,
  type AssistantD1Database,
} from "./store-cloud";
import { newAssistantMessageId, newAssistantThreadId, type AssistantMessage, type AssistantStore } from "./store";

const NOW = "2026-10-01T00:00:00.000Z";

// SQLite-as-D1 model: batch() runs inside a transaction and rolls back on
// error, exactly as D1 does (same shim as cloud-mcp.test.ts).
function sqliteD1(db: Database): AssistantD1Database {
  const statement = (query: string) => {
    let params: unknown[] = [];
    const bound = {
      async all() {
        return { results: db.query(query).all(...params) as Record<string, unknown>[] };
      },
      bind(...values: unknown[]) {
        params = values.map((value) => (value === undefined ? null : value));
        return bound;
      },
      async first() {
        return (db.query(query).get(...params) as Record<string, unknown> | null) ?? null;
      },
      async run() {
        db.query(query).run(...params);
        const changes = db.query("SELECT changes() AS changes").get() as { changes: number };
        return { meta: { changes: changes.changes } };
      },
    };
    return bound;
  };
  return {
    async batch(statements) {
      db.exec("BEGIN");
      try {
        const results = [];
        for (const statement of statements) results.push(await statement.run());
        db.exec("COMMIT");
        return results;
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    },
    prepare(query: string) {
      return statement(query);
    },
  };
}

function migratedDatabase(): Database {
  const db = new Database(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  const directory = new URL("../../../migrations/", import.meta.url);
  for (const file of readdirSync(directory).filter((name) => name.endsWith(".sql")).sort()) {
    db.exec(readFileSync(new URL(file, directory), "utf8"));
  }
  return db;
}

/**
 * Records how statements execute: individual `run` calls outside a batch
 * versus statement runs inside `batch`, so a test can prove that cleanup
 * goes through a single atomic batch and never through sequential runs.
 */
function batchSpy(base: AssistantD1Database) {
  const events: string[] = [];
  let inBatch = 0;
  const wrap = (query: string, statement: AssistantD1Statement): AssistantD1Statement => ({
    all: () => statement.all(),
    first: () => statement.first(),
    run: () => {
      events.push(inBatch > 0 ? `batch-run ${query}` : `run ${query}`);
      return statement.run();
    },
    bind: (...values: unknown[]) => wrap(query, statement.bind(...values)),
  });
  const spy: AssistantD1Database = {
    prepare: (query: string) => wrap(query, base.prepare(query)),
    batch: async (statements: AssistantD1Statement[]) => {
      inBatch += 1;
      events.push(`batch(${statements.length})`);
      try {
        return await base.batch(statements);
      } finally {
        inBatch -= 1;
      }
    },
  };
  return { events, spy };
}

/**
 * Like the reviewer's probe: the first cleanup DELETE's execution triggers a
 * side effect (here, a failure standing in for a concurrent append). With a
 * sequential cleanup the first DELETE is already committed; with a single
 * batch the whole step rolls back.
 */
function faultingAfterFirstDelete(base: AssistantD1Database, state: { faulting: boolean }) {
  const failAfterMessagesDelete = (query: string, run: () => Promise<unknown>) => async () => {
    const result = await run();
    if (state.faulting && query.startsWith("DELETE FROM assistant_messages")) {
      throw new Error("fault between the cleanup deletes");
    }
    return result;
  };
  return {
    prepare: (query: string) => {
      const statement = base.prepare(query);
      const bound = statement.bind.bind(statement);
      return {
        all: () => statement.all(),
        first: () => statement.first(),
        run: failAfterMessagesDelete(query, () => statement.run()),
        bind: (...values: unknown[]) => {
          const boundStatement = bound(...values);
          return {
            all: () => boundStatement.all(),
            first: () => boundStatement.first(),
            run: failAfterMessagesDelete(query, () => boundStatement.run()),
            bind: () => boundStatement,
          };
        },
      };
    },
    batch: (statements: AssistantD1Statement[]) => base.batch(statements),
  } as AssistantD1Database;
}

function seedUser(db: Database, id: string, email: string) {
  db.query(
    "INSERT INTO users (id, email, plan, ever_paid, billing_status, created_at, updated_at) VALUES (?, ?, 'pro', 1, 'active', ?, ?)",
  ).run(id, email, NOW, NOW);
}

const messageFor = (threadId: string): AssistantMessage => ({
  createdAt: NOW,
  errorCode: null,
  id: newAssistantMessageId(),
  role: "user",
  status: "final",
  text: "Body",
  threadId,
});

/** The store interface cases shared by the D1 and memory branches. */
async function assertStoreInterface(store: AssistantStore) {
  const first = await store.createThread({ id: "ath_first", now: "2026-10-01T00:00:00.000Z", title: "First" });
  assert.deepEqual(first, { createdAt: "2026-10-01T00:00:00.000Z", id: "ath_first", title: "First", updatedAt: "2026-10-01T00:00:00.000Z" });
  await store.createThread({ id: "ath_second", now: "2026-10-02T00:00:00.000Z", title: "Second" });

  assert.equal(await store.getThread("ath_missing"), null);
  assert.deepEqual((await store.listThreads({ limit: 10, offset: 0 })).map((thread) => thread.id), ["ath_second", "ath_first"]);
  assert.deepEqual((await store.listThreads({ limit: 1, offset: 0 })).map((thread) => thread.id), ["ath_second"]);
  assert.deepEqual((await store.listThreads({ limit: 1, offset: 1 })).map((thread) => thread.id), ["ath_first"]);

  // Appending a message stamps the thread's updated_at and reorders the list.
  const userMessage: AssistantMessage = {
    createdAt: "2026-10-03T00:00:00.000Z",
    errorCode: null,
    id: "amg_one",
    role: "user",
    status: "final",
    text: "One",
    threadId: "ath_first",
  };
  await store.appendMessage(userMessage);
  assert.equal((await store.getThread("ath_first"))?.updatedAt, "2026-10-03T00:00:00.000Z");
  assert.deepEqual((await store.listThreads({ limit: 10, offset: 0 })).map((thread) => thread.id), ["ath_first", "ath_second"]);

  await store.appendMessage({ ...userMessage, createdAt: "2026-10-03T00:01:00.000Z", id: "amg_two", text: "Two" });
  const reply: AssistantMessage = {
    ...userMessage,
    createdAt: "2026-10-03T00:02:00.000Z",
    id: "amg_three",
    role: "assistant",
    text: "Three",
  };
  await store.appendMessage(reply);

  // The N most recent messages, in chronological order.
  const recent = await store.listMessages("ath_first", { limit: 2 });
  assert.deepEqual(recent.map((message) => message.id), ["amg_two", "amg_three"]);
  assert.equal(recent[1].role, "assistant");
  assert.equal((await store.listMessages("ath_first", { limit: 10 })).length, 3);
  assert.deepEqual(await store.listMessages("ath_second", { limit: 10 }), []);

  await assert.rejects(
    store.appendMessage({ ...userMessage, id: "amg_orphan", threadId: "ath_missing" }),
    (error: unknown) => error instanceof Error && error.message === "assistant thread not found",
  );

  assert.equal(await store.deleteThread("ath_second"), true);
  assert.equal(await store.deleteThread("ath_second"), false);
  assert.equal(await store.getThread("ath_second"), null);
  assert.deepEqual(await store.listMessages("ath_second", { limit: 10 }), []);
  assert.equal((await store.listThreads({ limit: 10, offset: 0 })).length, 1);
}

async function assertCleanupRemovesOnlyOldThreads(store: AssistantStore, env: { DB?: AssistantD1Database }) {
  const oldThread = await store.createThread({ id: "ath_old", now: "2026-07-01T00:00:00.000Z", title: "Old" });
  const newThread = await store.createThread({ id: "ath_new", now: "2026-10-01T00:00:00.000Z", title: "New" });
  await store.appendMessage({
    createdAt: "2026-07-02T00:00:00.000Z",
    errorCode: null,
    id: newAssistantMessageId(),
    role: "user",
    status: "final",
    text: "Old body",
    threadId: oldThread.id,
  });
  await store.appendMessage({
    createdAt: "2026-10-02T00:00:00.000Z",
    errorCode: null,
    id: newAssistantMessageId(),
    role: "user",
    status: "final",
    text: "New body",
    threadId: newThread.id,
  });

  const deleted = await cleanupAssistantThreads(env, "2026-09-01T00:00:00.000Z");
  assert.equal(deleted, 1);
  assert.equal(await store.getThread(oldThread.id), null);
  assert.equal((await store.getThread(newThread.id))?.title, "New");
  assert.deepEqual(await store.listMessages(oldThread.id, { limit: 10 }), []);
  assert.equal((await store.listMessages(newThread.id, { limit: 10 })).length, 1);
}

describe("cloudAssistantStore over D1", () => {
  let db: Database;
  let env: { DB: AssistantD1Database };

  beforeEach(() => {
    db = migratedDatabase();
    env = { DB: sqliteD1(db) };
  });

  test("keeps threads ordered, limited, appended, and deleted", async () => {
    seedUser(db, "usr_a", "a@example.test");
    await assertStoreInterface(cloudAssistantStore(env, "usr_a"));
  });

  test("keeps owner B out of owner A's threads", async () => {
    seedUser(db, "usr_a", "a@example.test");
    seedUser(db, "usr_b", "b@example.test");
    const ownerA = cloudAssistantStore(env, "usr_a");
    const ownerB = cloudAssistantStore(env, "usr_b");
    await ownerA.createThread({ id: "ath_a", now: NOW, title: "A only" });
    await ownerA.appendMessage(messageFor("ath_a"));

    assert.equal(await ownerB.getThread("ath_a"), null);
    assert.deepEqual(await ownerB.listThreads({ limit: 10, offset: 0 }), []);
    assert.deepEqual(await ownerB.listMessages("ath_a", { limit: 10 }), []);
    await assert.rejects(
      ownerB.appendMessage({ ...messageFor("ath_a"), id: newAssistantMessageId(), text: "Intruder" }),
      (error: unknown) => error instanceof Error && error.message === "assistant thread not found",
    );
    assert.equal(await ownerB.deleteThread("ath_a"), false);

    // Owner A is untouched.
    assert.equal((await ownerA.getThread("ath_a"))?.title, "A only");
    assert.equal((await ownerA.listMessages("ath_a", { limit: 10 })).length, 1);
    assert.equal(await ownerA.deleteThread("ath_a"), true);
  });

  test("keeps the newest of tied timestamps when limiting (rowid tie-break)", async () => {
    seedUser(db, "usr_a", "a@example.test");
    const store = cloudAssistantStore(env, "usr_a");
    await store.createThread({ id: "ath_tied", now: NOW, title: "Tied" });
    const ids = ["amg_tied_m1", "amg_tied_m2", "amg_tied_m3"];
    for (const id of ids) await store.appendMessage({ ...messageFor("ath_tied"), id });

    // Same timestamp: the limit cut must keep the last two inserted.
    assert.deepEqual((await store.listMessages("ath_tied", { limit: 2 })).map((message) => message.id), [
      "amg_tied_m2",
      "amg_tied_m3",
    ]);
    assert.deepEqual((await store.listMessages("ath_tied", { limit: 10 })).map((message) => message.id), ids);
  });

  test("cleanupAssistantThreads removes only the old threads and their messages", async () => {
    seedUser(db, "usr_a", "a@example.test");
    const store = cloudAssistantStore(env, "usr_a");
    await assertCleanupRemovesOnlyOldThreads(store, env);

    // Only the new thread and its single message remain.
    const remainingThreads = (db.query("SELECT COUNT(*) AS n FROM assistant_threads").get() as { n: number }).n;
    const remainingMessages = (db.query("SELECT COUNT(*) AS n FROM assistant_messages").get() as { n: number }).n;
    assert.equal(Number(remainingThreads), 1);
    assert.equal(Number(remainingMessages), 1);
  });

  test("cleanup deletes the messages and the threads in a single batch", async () => {
    seedUser(db, "usr_a", "a@example.test");
    const store = cloudAssistantStore(env, "usr_a");
    await store.createThread({ id: "ath_old", now: "2026-07-01T00:00:00.000Z", title: "Old" });
    await store.appendMessage({
      createdAt: "2026-07-02T00:00:00.000Z",
      errorCode: null,
      id: newAssistantMessageId(),
      role: "user",
      status: "final",
      text: "Old body",
      threadId: "ath_old",
    });
    await store.createThread({ id: "ath_new", now: "2026-10-01T00:00:00.000Z", title: "New" });

    const { events, spy } = batchSpy(env.DB);
    const deleted = await cleanupAssistantThreads({ DB: spy }, "2026-09-01T00:00:00.000Z");
    assert.equal(deleted, 1);
    assert.equal(await store.getThread("ath_old"), null);
    assert.equal((await store.getThread("ath_new"))?.title, "New");

    // The cleanup's own effect: one batch holding both DELETEs, no sequential runs.
    assert.deepEqual(events.slice(-3), [
      "batch(2)",
      "batch-run DELETE FROM assistant_messages WHERE thread_id IN (SELECT id FROM assistant_threads WHERE updated_at < ?)",
      "batch-run DELETE FROM assistant_threads WHERE updated_at < ?",
    ]);
  });

  test("a failure between the cleanup deletes rolls back the whole batch", async () => {
    seedUser(db, "usr_a", "a@example.test");
    const store = cloudAssistantStore(env, "usr_a");
    await store.createThread({ id: "ath_fault", now: "2026-07-01T00:00:00.000Z", title: "Fault" });
    await store.appendMessage({
      createdAt: "2026-07-02T00:00:00.000Z",
      errorCode: null,
      id: newAssistantMessageId(),
      role: "user",
      status: "final",
      text: "Old body",
      threadId: "ath_fault",
    });

    const state = { faulting: true };
    const faulty = faultingAfterFirstDelete(env.DB, state);
    await assert.rejects(
      cleanupAssistantThreads({ DB: faulty }, "2026-09-01T00:00:00.000Z"),
      (error: unknown) => error instanceof Error && error.message === "fault between the cleanup deletes",
    );

    // The batch rolled back: the old thread and its history are intact.
    assert.equal((await store.getThread("ath_fault"))?.title, "Fault");
    assert.equal((await store.listMessages("ath_fault", { limit: 10 })).length, 1);

    // The retry converges once the fault is gone.
    state.faulting = false;
    assert.equal(await cleanupAssistantThreads({ DB: faulty }, "2026-09-01T00:00:00.000Z"), 1);
    assert.equal(await store.getThread("ath_fault"), null);
  });

  test("deleting the owner cascades to the threads and messages", async () => {
    seedUser(db, "usr_a", "a@example.test");
    const store = cloudAssistantStore(env, "usr_a");
    await store.createThread({ id: "ath_owner", now: NOW, title: "Owner" });
    await store.appendMessage(messageFor("ath_owner"));

    db.query("DELETE FROM users WHERE id = ?").run("usr_a");

    const orphanedThreads = (db.query("SELECT COUNT(*) AS n FROM assistant_threads").get() as { n: number }).n;
    const orphanedMessages = (db.query("SELECT COUNT(*) AS n FROM assistant_messages").get() as { n: number }).n;
    assert.equal(Number(orphanedThreads), 0);
    assert.equal(Number(orphanedMessages), 0);
  });
});

describe("cloudAssistantStore in memory", () => {
  const env = { DB: undefined };

  beforeEach(() => {
    resetCloudAssistantMemoryForTests();
  });

  test("keeps threads ordered, limited, appended, and deleted", async () => {
    await assertStoreInterface(cloudAssistantStore(env, "usr_a"));
  });

  test("keeps owner B out of owner A's threads", async () => {
    const ownerA = cloudAssistantStore(env, "usr_a");
    const ownerB = cloudAssistantStore(env, "usr_b");
    await ownerA.createThread({ id: "ath_a", now: NOW, title: "A only" });
    await ownerA.appendMessage(messageFor("ath_a"));

    assert.equal(await ownerB.getThread("ath_a"), null);
    assert.deepEqual(await ownerB.listThreads({ limit: 10, offset: 0 }), []);
    assert.deepEqual(await ownerB.listMessages("ath_a", { limit: 10 }), []);
    await assert.rejects(
      ownerB.appendMessage({ ...messageFor("ath_a"), id: newAssistantMessageId(), text: "Intruder" }),
      (error: unknown) => error instanceof Error && error.message === "assistant thread not found",
    );
    assert.equal(await ownerB.deleteThread("ath_a"), false);

    assert.equal((await ownerA.getThread("ath_a"))?.title, "A only");
    assert.equal((await ownerA.listMessages("ath_a", { limit: 10 })).length, 1);
    assert.equal(await ownerA.deleteThread("ath_a"), true);
  });

  test("keeps the newest of tied timestamps when limiting (insertion sequence tie-break)", async () => {
    const store = cloudAssistantStore(env, "usr_a");
    await store.createThread({ id: "ath_tied", now: NOW, title: "Tied" });
    const ids = ["amg_tied_m1", "amg_tied_m2", "amg_tied_m3"];
    for (const id of ids) await store.appendMessage({ ...messageFor("ath_tied"), id });

    // Same timestamp: the limit cut must keep the last two inserted.
    assert.deepEqual((await store.listMessages("ath_tied", { limit: 2 })).map((message) => message.id), [
      "amg_tied_m2",
      "amg_tied_m3",
    ]);
    assert.deepEqual((await store.listMessages("ath_tied", { limit: 10 })).map((message) => message.id), ids);
  });

  test("cleanupAssistantThreads removes only the old threads and their messages", async () => {
    const store = cloudAssistantStore(env, "usr_a");
    await assertCleanupRemovesOnlyOldThreads(store, env);
    resetCloudAssistantMemoryForTests();
    assert.deepEqual(await cloudAssistantStore(env, "usr_a").listThreads({ limit: 10, offset: 0 }), []);
  });
});
