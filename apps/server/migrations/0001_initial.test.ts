import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { describe, test } from "node:test";
import { Database } from "bun:sqlite";

const migrationsUrl = new URL("./", import.meta.url);
const schemaUrl = new URL("../schema.sql", import.meta.url);

function migrationFiles() {
  return readdirSync(migrationsUrl)
    .filter((name) => name.endsWith(".sql"))
    .sort();
}

function applyMigrations(db: Database, files = migrationFiles()) {
  for (const name of files) db.exec(readFileSync(new URL(name, migrationsUrl), "utf8"));
}

function databaseShape(db: Database) {
  const tables = db.query<{ name: string }, []>(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
  ).all().map((row) => row.name);
  const indexes = db.query<{ name: string }, []>(
    "SELECT name FROM sqlite_master WHERE type = 'index' AND name NOT LIKE 'sqlite_%' ORDER BY name",
  ).all().map((row) => row.name);
  const columns = Object.fromEntries(tables.map((table) => [
    table,
    db.query<{
      dflt_value: string | null;
      name: string;
      notnull: number;
      pk: number;
      type: string;
    }, []>(`PRAGMA table_info(${table})`).all(),
  ]));
  return { columns, indexes, tables };
}

describe("cloud schema migrations", () => {
  test("applies the additive migration chain to the canonical schema", () => {
    assert.deepEqual(migrationFiles(), [
      "0001_initial.sql",
      "0002_billing_entitlements.sql",
      "0003_ai_usage_and_storage_notices.sql",
    ]);
    const migrated = new Database(":memory:");
    const canonical = new Database(":memory:");
    try {
      migrated.exec("PRAGMA foreign_keys = ON;");
      canonical.exec("PRAGMA foreign_keys = ON;");
      applyMigrations(migrated);
      canonical.exec(readFileSync(schemaUrl, "utf8"));
      assert.deepEqual(databaseShape(migrated), databaseShape(canonical));
    } finally {
      migrated.close();
      canonical.close();
    }
  });

  test("preserves existing 0001 data while adding billing entitlements", () => {
    const db = new Database(":memory:");
    try {
      db.exec("PRAGMA foreign_keys = ON;");
      applyMigrations(db, ["0001_initial.sql"]);
      db.exec(`
        INSERT INTO users (id, email, created_at, updated_at)
        VALUES ('usr_existing', 'existing@example.test', '2026-08-16T00:00:00.000Z', '2026-08-16T00:00:00.000Z');
        INSERT INTO sessions (id, created_at, user_id, byte_size)
        VALUES ('existing_session', '2026-08-16T00:00:00.000Z', 'usr_existing', 42);
      `);

      applyMigrations(db, [
        "0002_billing_entitlements.sql",
        "0003_ai_usage_and_storage_notices.sql",
      ]);

      assert.equal(
        db.query<{ count: number }, []>("SELECT COUNT(*) AS count FROM users WHERE id = 'usr_existing'").get()?.count,
        1,
      );
      assert.equal(
        db.query<{ byte_size: number }, []>("SELECT byte_size FROM sessions WHERE id = 'existing_session'").get()?.byte_size,
        42,
      );
      const tables = databaseShape(db).tables;
      assert.ok(tables.includes("ai_credit_grants"));
      assert.ok(tables.includes("ai_credit_usages"));
      assert.ok(tables.includes("storage_grants"));
      assert.ok(tables.includes("storage_expiry_notices"));
      assert.ok(tables.includes("stripe_events"));
      const userColumns = db.query<{ name: string }, []>("PRAGMA table_info(users)")
        .all()
        .map((column) => column.name);
      assert.ok(userColumns.includes("ai_credit_refill_at"));

      db.exec(`
        INSERT INTO ai_credit_grants (
          id, owner_type, owner_id, source_type, source_id, credits, created_at
        ) VALUES (
          'grant_test', 'account', 'usr_existing', 'free_initial', 'free:usr_existing', 5,
          '2026-08-17T00:00:00.000Z'
        );
      `);
      assert.throws(
        () => db.query("UPDATE ai_credit_grants SET consumed_credits = 6 WHERE id = 'grant_test'").run(),
        /constraint/i,
      );
      db.exec(`
        INSERT INTO ai_credit_usages (
          id, request_id, owner_type, owner_id, grant_id, feature, resource_id, model, credits, status, created_at
        ) VALUES (
          'usage_test', 'request_000000000001', 'account', 'usr_existing', 'grant_test',
          'session_summary', 'session_test', '@cf/test/model', 1, 'reserved', '2026-08-17T00:00:00.000Z'
        );
      `);
      assert.equal(
        db.query<{ consumed_credits: number }, []>(
          "SELECT consumed_credits FROM ai_credit_grants WHERE id = 'grant_test'",
        ).get()?.consumed_credits,
        1,
      );
      db.exec("UPDATE ai_credit_usages SET status = 'refunded' WHERE id = 'usage_test'");
      assert.equal(
        db.query<{ consumed_credits: number }, []>(
          "SELECT consumed_credits FROM ai_credit_grants WHERE id = 'grant_test'",
        ).get()?.consumed_credits,
        0,
      );

      const source = migrationFiles()
        .map((name) => readFileSync(new URL(name, migrationsUrl), "utf8"))
        .join("\n")
        .toLowerCase();
      assert.doesNotMatch(source, /license_key|browser_ticket|browser_session/);
    } finally {
      db.close();
    }
  });
});
