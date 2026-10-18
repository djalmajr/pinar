// F5/S2: the per-user window of POST /api/byok/test (limit.ts): the same
// sliding window as the Cloud's existing limiter, over the same
// auth_rate_limits table, with a module map without a database.

import assert from "node:assert/strict";
import { Database } from "bun:sqlite";
import { readdirSync, readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, test } from "node:test";
import { type CloudEnv } from "../cloud-api";
import { BYOK_TEST_MAX_PER_HOUR, byokTestConsume, resetByokTestWindowsForTests } from "./limit";

const T0 = Date.parse("2026-10-02T12:00:00.000Z");
const HOUR = 60 * 60 * 1000;

function sqliteD1(db: Database): NonNullable<CloudEnv["DB"]> {
  const statement = (query: string) => {
    let params: unknown[] = [];
    const bound = {
      async all() {
        return { results: db.query(query).all(...params) as Record<string, unknown>[] };
      },
      bind(...values: unknown[]) {
        params = values.map((value) => value === undefined ? null : value);
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

async function assertWindow(db: Database | undefined, userId: string) {
  const env: CloudEnv = db === undefined ? {} : { DB: sqliteD1(db) };
  // The first BYOK_TEST_MAX_PER_HOUR tests of the hour pass...
  for (let index = 1; index <= BYOK_TEST_MAX_PER_HOUR; index += 1) {
    assert.equal(await byokTestConsume(env, userId, T0), true, `test ${index} of the window`);
  }
  // ...and the next one is limited, like the Cloud's limiter counts it.
  assert.equal(await byokTestConsume(env, userId, T0 + 60_000), false, "the test after the window");
  // The other user has its own window, and the window restarts after the hour.
  assert.equal(await byokTestConsume(env, `${userId}_other`, T0 + 60_000), true, "the other user is not limited");
  assert.equal(await byokTestConsume(env, userId, T0 + HOUR + 1), true, "the window restarted after the hour");
}

describe("byokTestConsume (F5/S2)", () => {
  beforeEach(() => {
    resetByokTestWindowsForTests();
  });

  afterEach(() => {
    resetByokTestWindowsForTests();
  });

  test("D1: six tests per hour per user, over the existing auth_rate_limits table", async () => {
    const db = migratedDatabase();
    try {
      await assertWindow(db, "usr_limit");
      // The row lands in the existing limiter's table with its own action,
      // and the principal id rests only hashed.
      const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode("byok_test:usr_limit"));
      const scopeHash = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
      const row = db.query("SELECT action, scope_hash, attempts FROM auth_rate_limits WHERE scope_hash = ?").get(scopeHash) as Record<string, unknown>;
      assert.equal(row.action, "byok_test");
      assert.ok(!scopeHash.includes("usr_limit"), "the principal id is not in the table");
    } finally {
      db.close();
    }
  });

  test("memory: the same window without a database", async () => {
    await assertWindow(undefined, "usr_limit");
  });
});
