import assert from "node:assert/strict";
import { Database } from "bun:sqlite";
import { readdirSync, readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, test } from "node:test";
import {
  cleanupOldRecords,
  cloudAssistantToolHost,
  handleCloudApiRequest,
  resetCloudMemoryStateForTests,
  seedCloudWebSessionForTests,
  setCloudNowForTests,
  type CloudEnv,
} from "../../cloud-api";
import type { AssistantD1Database, AssistantD1Statement } from "../store-cloud";
import { decodeVector, type EmbeddingEndpoint } from "./embeddings";
import { embeddingIdentity, indexSession, type PinSource } from "./index";
import { cloudPinIndexStore, markCloudPinIndexOwnerStale, markCloudPinIndexSessionStale, resetCloudPinIndexMemoryForTests } from "./store-cloud";
import { assertPinIndexReplaceAtomic, assertPinIndexStore, INDEXED_AT, pinIndexEntry, pinIndexVector } from "./store.test-helpers";
import type { PinIndexStore } from "./types";

const NOW = "2026-10-01T12:00:00.000Z";
const VALID_PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

// SQLite-as-D1 model: batch() runs inside a transaction and rolls back on
// error, and a statement over D1's 100 bound parameters is refused, as D1
// does (same shim as cloud-mcp.test.ts plus the parameter ceiling).
function sqliteD1(db: Database): AssistantD1Database {
  const statement = (query: string) => {
    let params: unknown[] = [];
    const checked = () => {
      if (params.length > 100) throw new Error("too many SQL variables");
      return params;
    };
    const bound: AssistantD1Statement = {
      async all() {
        return { results: db.query(query).all(...(checked() as never[])) as Record<string, unknown>[] };
      },
      bind(...values: unknown[]) {
        params = values.map((value) => (value === undefined ? null : value));
        return bound;
      },
      async first() {
        return (db.query(query).get(...(checked() as never[])) as Record<string, unknown> | null) ?? null;
      },
      async run() {
        db.query(query).run(...(checked() as never[]));
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

/** D1 itself returns a BLOB as `Array.from` of its bytes; this wrapper reads rows that way. */
function blobsAsArrays(base: AssistantD1Database): AssistantD1Database {
  const wrap = (statement: AssistantD1Statement): AssistantD1Statement => ({
    async all() {
      const result = await statement.all();
      return {
        ...result,
        results: (result.results || []).map((row) =>
          Object.fromEntries(Object.entries(row).map(([key, value]) => [key, value instanceof Uint8Array ? Array.from(value) : value]))
        ),
      };
    },
    bind: (...values: unknown[]) => wrap(statement.bind(...values)),
    first: () => statement.first(),
    run: () => statement.run(),
  });
  return { batch: (statements) => base.batch(statements), prepare: (query) => wrap(base.prepare(query)) };
}

/** Records standalone runs versus runs inside a batch. */
function batchSpy(base: AssistantD1Database) {
  const events: string[] = [];
  let inBatch = 0;
  const wrap = (query: string, statement: AssistantD1Statement): AssistantD1Statement => ({
    all: () => statement.all(),
    bind: (...values: unknown[]) => wrap(query, statement.bind(...values)),
    first: () => statement.first(),
    run: () => {
      events.push(inBatch > 0 ? `batch-run ${query.split(" (")[0]}` : `run ${query.split(" (")[0]}`);
      return statement.run();
    },
  });
  const spy: AssistantD1Database = {
    async batch(statements) {
      inBatch += 1;
      events.push(`batch(${statements.length})`);
      try {
        return await base.batch(statements);
      } finally {
        inBatch -= 1;
      }
    },
    prepare: (query) => wrap(query, base.prepare(query)),
  };
  return { events, spy };
}

function migratedDatabase(): Database {
  const db = new Database(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  const directory = new URL("../../../../migrations/", import.meta.url);
  for (const file of readdirSync(directory).filter((name) => name.endsWith(".sql")).sort()) {
    db.exec(readFileSync(new URL(file, directory), "utf8"));
  }
  return db;
}

function insertUser(db: Database, id: string, email: string) {
  db.query(
    "INSERT INTO users (id, email, plan, ever_paid, billing_status, created_at, updated_at) VALUES (?, ?, 'pro', 1, 'active', ?, ?)",
  ).run(id, email, NOW, NOW);
}

function insertSession(db: Database, id: string, userId: string, input: { createdAt?: string; permanent?: boolean } = {}) {
  db.query(
    "INSERT INTO sessions (id, url, title, shot_id, shot_url, pin_count, pins_json, created_at, user_id, plan, is_permanent, byte_size) "
      + "VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?, 'pro', ?, 1)",
  ).run(
    id,
    `https://example.test/${id}`,
    id,
    id,
    `https://pinar.test/shots/${id}.png`,
    JSON.stringify([{ comment: "Fix", number: 1, pinId: `${id}_p1` }]),
    input.createdAt ?? NOW,
    userId,
    input.permanent === false ? 0 : 1,
  );
}

function pinIndexRows(db: Database) {
  return db.query("SELECT session_id, pin_id, owner_id FROM pin_index ORDER BY session_id, pin_id").all() as Array<{
    owner_id: string;
    pin_id: string;
    session_id: string;
  }>;
}

/** Owner B neither reads nor replaces owner A's entries, and entriesFor never widens the ids asked for. */
async function assertOwnerIsolation(ownerA: PinIndexStore, ownerB: PinIndexStore) {
  const entryA = pinIndexEntry("idx_owner_a", "idx_a_p1", { vector: pinIndexVector(2) });
  await ownerA.replaceSession("idx_owner_a", [entryA]);
  await ownerB.replaceSession("idx_owner_b", [pinIndexEntry("idx_owner_b", "idx_b_p1")]);

  assert.deepEqual(await ownerB.entries("idx_owner_a"), []);
  assert.deepEqual(await ownerB.entriesFor(["idx_owner_a"]), []);
  assert.deepEqual((await ownerB.entriesFor(["idx_owner_a", "idx_owner_b"])).map((entry) => entry.pinId), ["idx_b_p1"]);
  assert.deepEqual(
    await ownerB.staleSessions({ limit: 10, sessions: [{ id: "idx_owner_a", updatedAt: NOW }, { id: "idx_owner_b", updatedAt: "2026-09-01T00:00:00.000Z" }] }),
    ["idx_owner_a"],
  );
  assert.deepEqual((await ownerA.entriesFor(["idx_owner_a", "idx_owner_b"])).map((entry) => entry.pinId), ["idx_a_p1"]);

  // B replacing A's session is refused, for the same pin and for a new one.
  for (const pinId of ["idx_a_p1", "idx_b_new"]) {
    await assert.rejects(
      ownerB.replaceSession("idx_owner_a", [pinIndexEntry("idx_owner_a", pinId, { docText: "Intruder" })]),
      (error: unknown) => error instanceof Error && error.message === "pin index session belongs to another owner",
    );
  }
  await ownerB.deleteSession("idx_owner_a");

  // Owner A is untouched.
  assert.deepEqual(await ownerA.entries("idx_owner_a"), [entryA]);
}


/**
 * markCloudPinIndexSessionStale marks the session dirty, whoever owns it:
 * the session is stale whatever the times say, its entries keep every field
 * (so indexSession can reuse captions and vectors), the mark is never read
 * as an entry, and other sessions are left alone. A replacement after a
 * fresh read clears the mark; one whose read came before a newer mark
 * keeps it.
 */
async function assertMarkStale(env: { DB?: AssistantD1Database }) {
  const ownerA = cloudPinIndexStore(env, "usr_a");
  const ownerB = cloudPinIndexStore(env, "usr_b");
  const entries = [
    pinIndexEntry("idx_mark", "idx_m_p1", { caption: "Botão azul", model: "embeddinggemma-300m", ocr: "Comprar", vector: pinIndexVector(3) }),
    pinIndexEntry("idx_mark", "idx_m_p2", { number: 2 }),
  ];
  await ownerA.replaceSession("idx_mark", entries);
  await ownerB.replaceSession("idx_other", [pinIndexEntry("idx_other", "idx_o_p1")]);
  const listed = [{ id: "idx_mark", updatedAt: INDEXED_AT }];
  assert.deepEqual(await ownerA.staleSessions({ limit: 10, sessions: listed }), []);

  await markCloudPinIndexSessionStale(env, "idx_mark");
  assert.deepEqual(await ownerA.staleSessions({ limit: 10, sessions: listed }), ["idx_mark"]);
  assert.deepEqual(await ownerA.entries("idx_mark"), entries, "the entries are untouched and the mark is not one");
  assert.deepEqual(await ownerA.entriesFor(["idx_mark"]), entries);
  assert.deepEqual(await ownerB.staleSessions({ limit: 10, sessions: [{ id: "idx_other", updatedAt: INDEXED_AT }] }), []);
  assert.equal((await ownerB.entries("idx_other"))[0]!.updatedAt, INDEXED_AT);

  // Even when the listed time is the epoch itself, the mark makes it stale.
  assert.deepEqual(await ownerA.staleSessions({ limit: 10, sessions: [{ id: "idx_mark", updatedAt: new Date(0).toISOString() }] }), ["idx_mark"]);

  // A replacement that read the current mark first applies and leaves the
  // mark clean (the row and its token stay for the session's lifetime).
  const current = await ownerA.readMark!("idx_mark");
  assert.ok(current);
  await ownerA.replaceSession("idx_mark", entries, { readMark: current });
  assert.deepEqual(await ownerA.staleSessions({ limit: 10, sessions: listed }), []);
  assert.equal(await ownerA.readMark!("idx_mark"), current);

  // Two indexings overlap: A reads mark 1, a write makes mark 2, B reads
  // mark 2 and writes the new text, then A finishes last with the old one.
  // A changes nothing: B's text stays, and the session is not stale.
  await markCloudPinIndexSessionStale(env, "idx_mark");
  const readByA = await ownerA.readMark!("idx_mark");
  await markCloudPinIndexSessionStale(env, "idx_mark");
  const readByB = await ownerA.readMark!("idx_mark");
  assert.ok(readByA && readByB && readByA !== readByB);
  const newer = entries.map((entry) => ({ ...entry, docText: `${entry.docText} (new)` }));
  await ownerA.replaceSession("idx_mark", newer, { readMark: readByB });
  await ownerA.replaceSession("idx_mark", entries, { readMark: readByA });
  assert.deepEqual(await ownerA.entries("idx_mark"), newer, "the indexing that read before the edit lost");
  assert.deepEqual(await ownerA.staleSessions({ limit: 10, sessions: listed }), []);

  // The other order: A (old read) finishes first and changes nothing, so
  // the session stays stale until B, with the newer read, writes.
  await markCloudPinIndexSessionStale(env, "idx_mark");
  const oldRead = await ownerA.readMark!("idx_mark");
  await markCloudPinIndexSessionStale(env, "idx_mark");
  await ownerA.replaceSession("idx_mark", entries, { readMark: oldRead });
  assert.deepEqual(await ownerA.entries("idx_mark"), newer);
  assert.deepEqual(await ownerA.staleSessions({ limit: 10, sessions: listed }), ["idx_mark"], "the newer mark keeps it stale");
  await ownerA.replaceSession("idx_mark", entries, { readMark: await ownerA.readMark!("idx_mark") });
  assert.deepEqual(await ownerA.entries("idx_mark"), entries);
  assert.deepEqual(await ownerA.staleSessions({ limit: 10, sessions: listed }), []);

  // A first indexing that read an unmarked session loses to an edit that
  // lands before it writes; the edit is never hidden.
  await ownerA.replaceSession("idx_first", [pinIndexEntry("idx_first", "idx_f_p1")]);
  await ownerA.deleteSession("idx_first");
  const firstRead = await ownerA.readMark!("idx_first");
  assert.equal(firstRead, null);
  await ownerA.replaceSession("idx_first", [pinIndexEntry("idx_first", "idx_f_p1")], { readMark: firstRead });
  assert.deepEqual(await ownerA.staleSessions({ limit: 10, sessions: [{ id: "idx_first", updatedAt: INDEXED_AT }] }), [], "unmarked and unchanged: it applies");

  // Without readMark the replacement is unconditional and leaves the mark.
  await markCloudPinIndexSessionStale(env, "idx_mark");
  await ownerA.replaceSession("idx_mark", entries);
  assert.deepEqual(await ownerA.staleSessions({ limit: 10, sessions: listed }), ["idx_mark"]);

  // Another owner reads the session's mark but never clears it, since its
  // store holds no entries of the session.
  await ownerB.replaceSession("idx_other", [pinIndexEntry("idx_other", "idx_o_p1")], { readMark: await ownerB.readMark!("idx_other") });
  assert.deepEqual(await ownerA.staleSessions({ limit: 10, sessions: listed }), ["idx_mark"]);

  // Emptied, the session has no entries: stale as before, its mark kept.
  await ownerA.replaceSession("idx_mark", [], { readMark: await ownerA.readMark!("idx_mark") });
  assert.deepEqual(await ownerA.staleSessions({ limit: 10, sessions: listed }), ["idx_mark"]);
  assert.deepEqual(await ownerA.entries("idx_mark"), []);

  // A pin whose id reads like a marker is an ordinary pin; an entry
  // without a pin id is refused.
  const lookalike = [pinIndexEntry("idx_look", "__pinar_dirty_mark__")];
  await ownerA.replaceSession("idx_look", lookalike);
  assert.deepEqual(await ownerA.entries("idx_look"), lookalike);
  assert.deepEqual(await ownerA.staleSessions({ limit: 10, sessions: [{ id: "idx_look", updatedAt: INDEXED_AT }] }), []);
  await assert.rejects(ownerA.replaceSession("idx_look", [pinIndexEntry("idx_look", "")]), /no pin id/);

  // A session without entries: nothing to mark, nothing created.
  await markCloudPinIndexSessionStale(env, "idx_none");
  assert.deepEqual(await ownerA.entries("idx_none"), []);
}

describe("markCloudPinIndexSessionStale", () => {
  beforeEach(() => resetCloudPinIndexMemoryForTests());

  test("D1: marks the session dirty, keeps its entries, and survives a racing replacement", async () => {
    const db = migratedDatabase();
    try {
      await assertMarkStale({ DB: sqliteD1(db) });
    } finally {
      db.close();
    }
  });

  test("memory: marks the session dirty, keeps its entries, and survives a racing replacement", async () => {
    await assertMarkStale({ DB: undefined });
  });

  test("best effort: a missing pin_index table or a failing database never throws", async () => {
    const db = migratedDatabase();
    try {
      db.exec("DROP TABLE pin_index");
      await assert.doesNotReject(markCloudPinIndexSessionStale({ DB: sqliteD1(db) }, "idx_mark"));
    } finally {
      db.close();
    }
    const failing: AssistantD1Database = {
      batch: () => Promise.reject(new Error("batch down")),
      prepare: () => {
        throw new Error("database down");
      },
    };
    await assert.doesNotReject(markCloudPinIndexSessionStale({ DB: failing }, "idx_mark"));
  });
});

/**
 * markCloudPinIndexOwnerStale marks every session of the owner with entries
 * dirty (F5 contract §1: the vectors of different embedding models do not
 * mix), keeps every field of the entries, leaves the other owners alone,
 * and keeps the token rules of the per-session mark: a replacement that
 * read the fresh mark clears it.
 */
async function assertOwnerMarkStale(env: { DB?: AssistantD1Database }) {
  const ownerA = cloudPinIndexStore(env, "usr_a");
  const ownerB = cloudPinIndexStore(env, "usr_b");
  const entriesA1 = [pinIndexEntry("idx_owner_a1", "idx_a1_p1", { caption: "Botão", model: "old-model", vector: pinIndexVector(2) })];
  const entriesA2 = [pinIndexEntry("idx_owner_a2", "idx_a2_p1")];
  const entriesB = [pinIndexEntry("idx_owner_b", "idx_b_p1")];
  await ownerA.replaceSession("idx_owner_a1", entriesA1);
  await ownerA.replaceSession("idx_owner_a2", entriesA2);
  await ownerB.replaceSession("idx_owner_b", entriesB);
  const sessionsA = [{ id: "idx_owner_a1", updatedAt: INDEXED_AT }, { id: "idx_owner_a2", updatedAt: INDEXED_AT }];
  assert.deepEqual(await ownerA.staleSessions({ limit: 10, sessions: sessionsA }), []);

  await markCloudPinIndexOwnerStale(env, "usr_a");
  // Both of A's sessions are stale, with every entry kept...
  assert.deepEqual(await ownerA.staleSessions({ limit: 10, sessions: sessionsA }), ["idx_owner_a1", "idx_owner_a2"]);
  assert.deepEqual(await ownerA.entries("idx_owner_a1"), entriesA1);
  // ...B's session is untouched, and B's staleSessions see nothing new.
  assert.deepEqual(await ownerB.staleSessions({ limit: 10, sessions: [{ id: "idx_owner_b", updatedAt: INDEXED_AT }] }), []);
  assert.deepEqual(await ownerB.entries("idx_owner_b"), entriesB);

  // The token rules hold per session: a replacement that read the fresh
  // mark applies and leaves the mark clean; the other session stays stale.
  const markA1 = await ownerA.readMark!("idx_owner_a1");
  assert.ok(markA1);
  await ownerA.replaceSession("idx_owner_a1", entriesA1, { readMark: markA1 });
  assert.deepEqual(await ownerA.staleSessions({ limit: 10, sessions: sessionsA }), ["idx_owner_a2"]);
  // A second owner-wide mark re-marks the cleaned session, with a fresh
  // token: the stale read of the first mark loses to it.
  await markCloudPinIndexOwnerStale(env, "usr_a");
  const markA2 = await ownerA.readMark!("idx_owner_a1");
  assert.ok(markA2 && markA2 !== markA1);
  await ownerA.replaceSession("idx_owner_a1", entriesA1, { readMark: markA1 });
  assert.deepEqual(await ownerA.staleSessions({ limit: 10, sessions: sessionsA }), ["idx_owner_a1", "idx_owner_a2"], "the newer mark keeps them stale");

  // An owner without entries changes nothing: no mark row is created.
  await markCloudPinIndexOwnerStale(env, "usr_none");
  assert.equal(
    await cloudPinIndexStore(env, "usr_none").readMark!("idx_none"),
    null,
    "no mark row for a session the owner never indexed",
  );
}

describe("markCloudPinIndexOwnerStale", () => {
  beforeEach(() => resetCloudPinIndexMemoryForTests());

  test("D1: marks every session of the owner dirty and leaves the other owners alone", async () => {
    const db = migratedDatabase();
    try {
      await assertOwnerMarkStale({ DB: sqliteD1(db) });
    } finally {
      db.close();
    }
  });

  test("memory: marks every session of the owner dirty and leaves the other owners alone", async () => {
    await assertOwnerMarkStale({ DB: undefined });
  });

  test("best effort: a failing database never throws", async () => {
    const failing: AssistantD1Database = {
      batch: () => Promise.reject(new Error("batch down")),
      prepare: () => {
        throw new Error("database down");
      },
    };
    await assert.doesNotReject(markCloudPinIndexOwnerStale({ DB: failing }, "usr_a"));
  });
});

describe("cloudPinIndexStore over D1", () => {
  let db: Database;
  let env: { DB: AssistantD1Database };

  beforeEach(() => {
    db = migratedDatabase();
    env = { DB: sqliteD1(db) };
  });

  afterEach(() => db.close());

  test("keeps entries, entriesFor, staleSessions, and the vector bytes", async () => {
    await assertPinIndexStore(cloudPinIndexStore(env, "usr_a"));
  });

  test("a failure in the middle of the replacement batch leaves the previous entries", async () => {
    await assertPinIndexReplaceAtomic(cloudPinIndexStore(env, "usr_a"));
  });

  test("replaceSession writes the DELETE and the INSERTs in one batch", async () => {
    const { events, spy } = batchSpy(env.DB);
    await cloudPinIndexStore({ DB: spy }, "usr_a").replaceSession("idx_batch", [
      pinIndexEntry("idx_batch", "idx_batch_p1"),
      pinIndexEntry("idx_batch", "idx_batch_p2", { number: 2 }),
    ]);
    assert.deepEqual(events, [
      "batch(3)",
      "batch-run DELETE FROM pin_index WHERE session_id = ? AND owner_id = ? AND pin_id <> ''",
      "batch-run INSERT INTO pin_index",
      "batch-run INSERT INTO pin_index",
    ]);
  });

  test("keeps owner B out of owner A's entries", async () => {
    await assertOwnerIsolation(cloudPinIndexStore(env, "usr_a"), cloudPinIndexStore(env, "usr_b"));
    assert.deepEqual(pinIndexRows(db), [
      { owner_id: "usr_a", pin_id: "idx_a_p1", session_id: "idx_owner_a" },
      { owner_id: "usr_b", pin_id: "idx_b_p1", session_id: "idx_owner_b" },
    ]);
  });

  test("reads the vector back from the array of bytes D1 returns", async () => {
    const entry = pinIndexEntry("idx_array", "idx_array_p1", { vector: pinIndexVector(4) });
    await cloudPinIndexStore(env, "usr_a").replaceSession("idx_array", [entry]);
    const store = cloudPinIndexStore({ DB: blobsAsArrays(env.DB) }, "usr_a");
    assert.deepEqual(await store.entries("idx_array"), [entry]);
    assert.deepEqual(await store.entriesFor(["idx_array"]), [entry]);
  });

  test("entriesFor and staleSessions stay under D1's bound parameter ceiling for 500 sessions", async () => {
    const store = cloudPinIndexStore(env, "usr_a");
    const ids = Array.from({ length: 500 }, (_, index) => `idx_many_${String(index).padStart(3, "0")}`);
    for (const id of [ids[0], ids[95], ids[499]]) await store.replaceSession(id, [pinIndexEntry(id, `${id}_p1`)]);
    // Newest first, as the source lists them: the requested order comes back.
    const requested = [...ids].reverse();
    assert.deepEqual((await store.entriesFor(requested)).map((entry) => entry.sessionId), [ids[499], ids[95], ids[0]]);
    const stale = await store.staleSessions({ limit: 1000, sessions: requested.map((id) => ({ id, updatedAt: "2026-09-01T00:00:00.000Z" })) });
    assert.equal(stale.length, 497);
    assert.ok(!stale.includes(ids[95]));
  });
});

describe("cloudPinIndexStore in memory", () => {
  const env = { DB: undefined };

  beforeEach(() => resetCloudPinIndexMemoryForTests());

  test("keeps entries, entriesFor, staleSessions, and the vector bytes", async () => {
    await assertPinIndexStore(cloudPinIndexStore(env, "usr_a"));
  });

  test("a failure in the middle of a replacement leaves the previous entries", async () => {
    await assertPinIndexReplaceAtomic(cloudPinIndexStore(env, "usr_a"));
  });

  test("keeps owner B out of owner A's entries", async () => {
    await assertOwnerIsolation(cloudPinIndexStore(env, "usr_a"), cloudPinIndexStore(env, "usr_b"));
  });

  test("the Cloud test reset clears the memory branch", async () => {
    await cloudPinIndexStore(env, "usr_a").replaceSession("idx_reset", [pinIndexEntry("idx_reset", "idx_reset_p1")]);
    resetCloudMemoryStateForTests();
    assert.deepEqual(await cloudPinIndexStore(env, "usr_a").entries("idx_reset"), []);
  });
});

describe("pin index lifecycle in the Cloud API", () => {
  beforeEach(() => {
    resetCloudMemoryStateForTests();
    setCloudNowForTests(NOW);
  });

  afterEach(() => resetCloudMemoryStateForTests());

  function route(path: string, env: CloudEnv, init: RequestInit = {}) {
    return handleCloudApiRequest(new Request(`https://pinar.test${path}`, init), env);
  }

  test("D1: deleting a session over HTTP or MCP deletes its entries, and retention deletes the expired ones", async () => {
    const db = migratedDatabase();
    try {
      const env: CloudEnv = { DB: sqliteD1(db) };
      insertUser(db, "usr_a", "a@example.test");
      const account = await seedCloudWebSessionForTests({ email: "a@example.test", id: "usr_a", plan: "pro" }, env);
      for (const id of ["session_http", "session_mcp", "session_kept"]) insertSession(db, id, "usr_a");
      insertSession(db, "session_expired", "usr_a", { createdAt: "2026-08-01T12:00:00.000Z", permanent: false });
      const store = cloudPinIndexStore(env, "usr_a");
      for (const id of ["session_http", "session_mcp", "session_kept", "session_expired"]) {
        await store.replaceSession(id, [pinIndexEntry(id, `${id}_p1`, { vector: pinIndexVector(1) })]);
      }

      const deleted = await route("/api/history/session_http", env, { headers: { cookie: account.cookie }, method: "DELETE" });
      assert.equal(deleted.status, 200);
      assert.deepEqual(await store.entries("session_http"), []);

      const host = cloudAssistantToolHost(env, account.principal, "https://pinar.test", { writes: true });
      assert.deepEqual(await host.callTool("pinar.delete_session", { sessionId: "session_mcp" }), { ok: true, sessionId: "session_mcp" });
      assert.deepEqual(await store.entries("session_mcp"), []);

      const cleaned = await cleanupOldRecords(env);
      assert.equal(cleaned.deletedCount, 1);
      assert.deepEqual(await store.entries("session_expired"), []);
      assert.deepEqual(pinIndexRows(db), [{ owner_id: "usr_a", pin_id: "session_kept_p1", session_id: "session_kept" }]);
    } finally {
      db.close();
    }
  });

  test("memory: deleting a session over HTTP or MCP deletes its entries, and retention deletes the expired ones", async () => {
    const env: CloudEnv = {};
    const account = await seedCloudWebSessionForTests({ email: "a@example.test", plan: "free" }, env);
    for (const id of ["session_http", "session_mcp", "session_kept", "session_expired"]) {
      // A free capture from two months ago is past the 30-day retention.
      const createdAt = id === "session_expired" ? "2026-08-01T12:00:00.000Z" : NOW;
      setCloudNowForTests(createdAt);
      const uploaded = await route("/api/shots", env, {
        body: JSON.stringify({ createdAt, id, image: VALID_PNG, page: { title: id, url: `https://example.test/${id}` }, pins: [{ comment: "Fix", number: 1 }] }),
        headers: { cookie: account.cookie, "content-type": "application/json" },
        method: "POST",
      });
      assert.equal(uploaded.status, 201, id);
    }
    setCloudNowForTests(NOW);
    const store = cloudPinIndexStore(env, account.accountId);
    for (const id of ["session_http", "session_mcp", "session_kept", "session_expired"]) {
      await store.replaceSession(id, [pinIndexEntry(id, `${id}_p1`, { vector: pinIndexVector(1) })]);
    }

    const deleted = await route("/api/history/session_http", env, { headers: { cookie: account.cookie }, method: "DELETE" });
    assert.equal(deleted.status, 200);
    assert.deepEqual(await store.entries("session_http"), []);

    const host = cloudAssistantToolHost(env, account.principal, "https://pinar.test", { writes: true });
    assert.deepEqual(await host.callTool("pinar.delete_session", { sessionId: "session_mcp" }), { ok: true, sessionId: "session_mcp" });
    assert.deepEqual(await store.entries("session_mcp"), []);

    const cleaned = await cleanupOldRecords(env);
    assert.equal(cleaned.deletedCount, 1);
    assert.deepEqual(await store.entries("session_expired"), []);
    assert.deepEqual(
      (await store.entriesFor(["session_http", "session_mcp", "session_kept", "session_expired"])).map((entry) => entry.sessionId),
      ["session_kept"],
    );
  });
});

// F5/S2 review fix: the identity of the stored vector includes the
// endpoint. The probe of the review reproduced the defect through the real
// consumer: index, change the URL keeping the model name, index again — the
// old provider's vector was kept. The mark makes the session stale, and the
// identity is what keeps the consumer from reusing a vector of another
// endpoint with the same model name.
describe("an embedding endpoint change re-embeds through the real consumer and store (F5/S2)", () => {
  const SESSION = "sess_endpoint";
  const OWNER = "usr_endpoint";
  const UPDATED_AT = "2026-10-02T12:00:00.000Z";

  const endpointOf = (baseUrl: string): EmbeddingEndpoint => ({ apiKey: "synthetic", baseUrl, model: "same-model" });

  async function assertEndpointChangeReEmbeds(env: { DB?: AssistantD1Database }) {
    resetCloudPinIndexMemoryForTests();
    const store = cloudPinIndexStore(env, OWNER);
    let embeddedCalls = 0;
    // The first dimension is the call number: the bytes of the second call
    // are distinguishable from the first.
    const fakeFetch: typeof fetch = (async () => {
      embeddedCalls += 1;
      return Response.json({ data: [{ embedding: Array.from({ length: 256 }, (_, index) => (index === 0 ? embeddedCalls : 0)), index: 0 }] });
    }) as typeof fetch;
    const source: PinSource = {
      async comments() {
        return new Map<string, Array<{ author: string; body: string }>>();
      },
      async listSessions() {
        return [{ id: SESSION, updatedAt: UPDATED_AT }];
      },
      async session(id) {
        return id === SESSION
          ? { id, page: { title: "Page", url: "https://example.test" }, pinIds: ["pin-1"], pins: [{ comment: "comment", number: 1, selector: "#pin-1", tag: "div" }] }
          : null;
      },
      async shot() {
        return null;
      },
    };
    const depsOf = (embedding: EmbeddingEndpoint) => ({ chat: null, embedding, fetch: fakeFetch, now: () => new Date(UPDATED_AT), source, store });

    await indexSession(depsOf(endpointOf("https://old.example.test/v1")), SESSION);
    assert.equal(embeddedCalls, 1);
    await markCloudPinIndexOwnerStale(env, OWNER);
    assert.deepEqual(await store.staleSessions({ limit: 10, sessions: [{ id: SESSION, updatedAt: UPDATED_AT }] }), [SESSION], "the mark makes the session stale");

    // The URL changes, the model name stays: the embedding is called again
    // and the vector is the new one.
    const result = await indexSession(depsOf(endpointOf("https://new.example.test/v1")), SESSION);
    assert.equal(result.embedded, 1, "the embedding is called again");
    assert.equal(embeddedCalls, 2);
    const entries = await store.entries(SESSION);
    assert.equal(entries.length, 1);
    assert.equal(entries[0]!.vector === null ? -1 : decodeVector(entries[0]!.vector)[0], 2, "the vector is the one of the second call");
    assert.equal(entries[0]!.model, embeddingIdentity(endpointOf("https://new.example.test/v1")));
    assert.deepEqual(await store.staleSessions({ limit: 10, sessions: [{ id: SESSION, updatedAt: UPDATED_AT }] }), [], "the pass clears the mark");

    // A reindex on the same endpoint reuses the new vector.
    assert.equal((await indexSession(depsOf(endpointOf("https://new.example.test/v1")), SESSION)).embedded, 0);
    assert.equal(embeddedCalls, 2);
  }

  test("D1: the URL change re-embeds the owner's vectors", async () => {
    const db = migratedDatabase();
    try {
      await assertEndpointChangeReEmbeds({ DB: sqliteD1(db) });
    } finally {
      db.close();
    }
  });

  test("memory: the URL change re-embeds the owner's vectors", async () => {
    try {
      await assertEndpointChangeReEmbeds({ DB: undefined });
    } finally {
      resetCloudPinIndexMemoryForTests();
    }
  });
});
