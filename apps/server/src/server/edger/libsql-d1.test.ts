import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, test } from "node:test";
import { createClient, type Client } from "@libsql/client";
import { createLibsqlD1 } from "./libsql-d1";
import type { CloudEnv } from "../cloud-api";
import { releaseClosedDatabases } from "../../../tests/helpers/native-handles";

function tempDatabaseFile() {
  return join(tmpdir(), `pinar-libsql-d1-${process.pid}-${randomBytes(8).toString("hex")}.db`);
}

function openClient(file: string, intMode: "number" | "bigint" = "number"): Client {
  return createClient({ intMode, url: `file:${file}` });
}

async function closeDatabase(client: Client, file: string) {
  client.close();
  await releaseClosedDatabases();
  for (const suffix of ["", "-wal", "-shm"]) rmSync(file + suffix, { force: true });
}

describe("createLibsqlD1", () => {
  test("returns a database assignable to CloudEnv DB without a cast", async () => {
    const file = tempDatabaseFile();
    const client = openClient(file);
    try {
      const db: NonNullable<CloudEnv["DB"]> = createLibsqlD1(client);
      await db.prepare("CREATE TABLE t (id INTEGER PRIMARY KEY, name TEXT)").run();
      await db.prepare("INSERT INTO t (name) VALUES (?)").bind("seed").run();
      assert.deepEqual(await db.prepare("SELECT name FROM t").first(), { name: "seed" });
    } finally {
      await closeDatabase(client, file);
    }
  });

  test("first() returns the first row, or null when the statement has no rows", async () => {
    const file = tempDatabaseFile();
    const client = openClient(file);
    try {
      const db = createLibsqlD1(client);
      await db.prepare("CREATE TABLE t (id INTEGER PRIMARY KEY, name TEXT)").run();
      assert.equal(await db.prepare("SELECT * FROM t").first(), null);
      await db.prepare("INSERT INTO t (name) VALUES (?)").bind("a").run();
      await db.prepare("INSERT INTO t (name) VALUES (?)").bind("b").run();
      assert.deepEqual(await db.prepare("SELECT name FROM t ORDER BY id").first(), { name: "a" });
    } finally {
      await closeDatabase(client, file);
    }
  });

  test("all() returns named rows and zero meta for a read", async () => {
    const file = tempDatabaseFile();
    const client = openClient(file);
    try {
      const db = createLibsqlD1(client);
      await db.prepare("CREATE TABLE t (id INTEGER PRIMARY KEY, name TEXT)").run();
      await db.prepare("INSERT INTO t (name) VALUES (?)").bind("a").run();
      await db.prepare("INSERT INTO t (name) VALUES (?)").bind("b").run();
      const result = await db.prepare("SELECT id, name FROM t ORDER BY id").all();
      assert.deepEqual(result.results, [
        { id: 1, name: "a" },
        { id: 2, name: "b" },
      ]);
      assert.equal(result.meta.changes, 0);
      assert.equal(result.meta.last_row_id, 0);
      // Rows are plain objects with only their named columns.
      assert.deepEqual(Object.keys(result.results[0]), ["id", "name"]);
    } finally {
      await closeDatabase(client, file);
    }
  });

  test("run() reports meta.changes and meta.last_row_id", async () => {
    const file = tempDatabaseFile();
    const client = openClient(file);
    try {
      const db = createLibsqlD1(client);
      await db.prepare("CREATE TABLE t (id INTEGER PRIMARY KEY, name TEXT)").run();
      const insert = await db.prepare("INSERT INTO t (name) VALUES (?)").bind("a").run();
      assert.equal(insert.meta.changes, 1);
      assert.equal(insert.meta.last_row_id, 1);
      assert.deepEqual(insert.results, []);
      const update = await db.prepare("UPDATE t SET name = ? WHERE id = ?").bind("b", 1).run();
      assert.equal(update.meta.changes, 1);
      assert.equal(update.meta.last_row_id, 1);
      const none = await db.prepare("UPDATE t SET name = ? WHERE id = ?").bind("c", 99).run();
      assert.equal(none.meta.changes, 0);
    } finally {
      await closeDatabase(client, file);
    }
  });

  test("upserts with INSERT ... ON CONFLICT DO UPDATE", async () => {
    const file = tempDatabaseFile();
    const client = openClient(file);
    try {
      const db = createLibsqlD1(client);
      await db.prepare("CREATE TABLE kv (k TEXT PRIMARY KEY, v INTEGER)").run();
      await db.prepare("INSERT INTO kv (k, v) VALUES (?, ?)").bind("k", 1).run();
      const upsert = await db
        .prepare("INSERT INTO kv (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v")
        .bind("k", 2)
        .run();
      assert.equal(upsert.meta.changes, 1);
      assert.deepEqual(await db.prepare("SELECT v FROM kv WHERE k = ?").bind("k").first(), { v: 2 });
    } finally {
      await closeDatabase(client, file);
    }
  });

  test("returns RETURNING rows through run() and first()", async () => {
    const file = tempDatabaseFile();
    const client = openClient(file);
    try {
      const db = createLibsqlD1(client);
      await db.prepare("CREATE TABLE t (id INTEGER PRIMARY KEY, name TEXT)").run();
      const runResult = await db.prepare("INSERT INTO t (name) VALUES (?) RETURNING id, name").bind("a").run();
      assert.deepEqual(runResult.results, [{ id: 1, name: "a" }]);
      assert.deepEqual(
        await db.prepare("INSERT INTO t (name) VALUES (?) RETURNING name").bind("b").first(),
        { name: "b" },
      );
    } finally {
      await closeDatabase(client, file);
    }
  });

  test("matches bound values with COLLATE NOCASE", async () => {
    const file = tempDatabaseFile();
    const client = openClient(file);
    try {
      const db = createLibsqlD1(client);
      await db.prepare("CREATE TABLE t (id INTEGER PRIMARY KEY, name TEXT)").run();
      await db.prepare("INSERT INTO t (name) VALUES (?)").bind("Nova").run();
      assert.deepEqual(
        await db.prepare("SELECT name FROM t WHERE name = ? COLLATE NOCASE").bind("nOvA").first(),
        { name: "Nova" },
      );
    } finally {
      await closeDatabase(client, file);
    }
  });

  test("binds null, boolean and byte values", async () => {
    const file = tempDatabaseFile();
    const client = openClient(file);
    try {
      const db = createLibsqlD1(client);
      await db.prepare("CREATE TABLE t (id INTEGER PRIMARY KEY, flag INTEGER, data BLOB, label TEXT)").run();
      await db.prepare("INSERT INTO t (flag, data, label) VALUES (?, ?, ?)").bind(true, new Uint8Array([1, 2, 3]), null).run();
      const buffer = new ArrayBuffer(2);
      const view = new DataView(buffer);
      view.setUint8(0, 9);
      view.setUint8(1, 8);
      await db.prepare("INSERT INTO t (flag, data, label) VALUES (?, ?, ?)").bind(false, buffer, null).run();
      const rows = await db.prepare("SELECT flag, data, label FROM t ORDER BY id").all();
      assert.deepEqual(rows.results, [
        { flag: 1, data: new Uint8Array([1, 2, 3]), label: null },
        { flag: 0, data: new Uint8Array([9, 8]), label: null },
      ]);
      assert.ok(rows.results[0].data instanceof Uint8Array);
    } finally {
      await closeDatabase(client, file);
    }
  });

  test("binds undefined with the exact D1 type error", async () => {
    const file = tempDatabaseFile();
    const client = openClient(file);
    try {
      const db = createLibsqlD1(client);
      assert.throws(
        () => db.prepare("INSERT INTO t (name) VALUES (?)").bind(undefined),
        (error: unknown) =>
          error instanceof TypeError &&
          error.message === "D1_TYPE_ERROR: Type 'undefined' not supported for value at index 0",
      );
      assert.throws(
        () => db.prepare("SELECT ?").bind(1, undefined),
        (error: unknown) =>
          error instanceof TypeError &&
          error.message === "D1_TYPE_ERROR: Type 'undefined' not supported for value at index 1",
      );
    } finally {
      await closeDatabase(client, file);
    }
  });

  test("bind() returns a new statement and leaves the original unbound", async () => {
    const file = tempDatabaseFile();
    const client = openClient(file);
    try {
      const db = createLibsqlD1(client);
      const statement = db.prepare("SELECT ? AS value");
      const boundA = statement.bind("a");
      const boundB = statement.bind("b");
      assert.notEqual(boundA, statement);
      assert.notEqual(boundA, boundB);
      assert.deepEqual(await boundA.first(), { value: "a" });
      assert.deepEqual(await boundB.first(), { value: "b" });
      // The original statement was never modified by either bind.
      assert.deepEqual(await statement.first(), { value: null });
    } finally {
      await closeDatabase(client, file);
    }
  });

  test("applies a batch atomically and returns the results in order", async () => {
    const file = tempDatabaseFile();
    const client = openClient(file);
    try {
      const db = createLibsqlD1(client);
      await db.prepare("CREATE TABLE t (id INTEGER PRIMARY KEY, name TEXT UNIQUE)").run();
      const results = await db.batch([
        db.prepare("INSERT INTO t (name) VALUES (?)").bind("first"),
        db.prepare("SELECT name FROM t ORDER BY id").bind(),
      ]);
      assert.equal(results.length, 2);
      assert.equal(results[0].meta.changes, 1);
      assert.equal(results[0].meta.last_row_id, 1);
      assert.deepEqual(results[1].results, [{ name: "first" }]);
      await assert.rejects(
        () =>
          db.batch([
            db.prepare("INSERT INTO t (name) VALUES (?)").bind("dup"),
            db.prepare("INSERT INTO t (name) VALUES (?)").bind("dup"),
          ]),
        (error: unknown) => error instanceof Error && /constraint/i.test(error.message),
      );
      // The failed batch left no trace: the second insert was rolled back.
      const rows = await db.prepare("SELECT name FROM t ORDER BY id").all();
      assert.deepEqual(rows.results, [{ name: "first" }]);
    } finally {
      await closeDatabase(client, file);
    }
  });

  test("rejects SQL errors with the libSQL message", async () => {
    const file = tempDatabaseFile();
    const client = openClient(file);
    try {
      const db = createLibsqlD1(client);
      await assert.rejects(
        () => db.prepare("SELECT * FROM missing_table").all(),
        (error: unknown) =>
          error instanceof Error &&
          error.message.includes("missing_table"),
      );
    } finally {
      await closeDatabase(client, file);
    }
  });

  test("converts bigint values to numbers when the client returns bigints", async () => {
    const file = tempDatabaseFile();
    const client = openClient(file, "bigint");
    try {
      const db = createLibsqlD1(client);
      await db.prepare("CREATE TABLE t (id INTEGER PRIMARY KEY, n INTEGER)").run();
      await db.prepare("INSERT INTO t (n) VALUES (?)").bind(7).run();
      const row = await db.prepare("SELECT n FROM t").first();
      assert.equal(row?.n, 7);
      assert.equal(typeof row?.n, "number");
      const insert = await db.prepare("INSERT INTO t (n) VALUES (?)").bind(8).run();
      assert.equal(insert.meta.last_row_id, 2);
      assert.equal(typeof insert.meta.last_row_id, "number");
    } finally {
      await closeDatabase(client, file);
    }
  });
});
