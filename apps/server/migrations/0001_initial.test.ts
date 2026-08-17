import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { describe, test } from "node:test";
import { Database } from "bun:sqlite";

const migrationUrl = new URL("./0001_initial.sql", import.meta.url);
const schemaUrl = new URL("../schema.sql", import.meta.url);

describe("initial cloud schema", () => {
  test("is the only migration and matches the canonical schema", () => {
    const migrationFiles = readdirSync(new URL(".", import.meta.url))
      .filter((name) => name.endsWith(".sql"));
    assert.deepEqual(migrationFiles, ["0001_initial.sql"]);
    assert.equal(readFileSync(migrationUrl, "utf8"), readFileSync(schemaUrl, "utf8"));
  });

  test("creates the authentication and workspace tables without legacy credentials", () => {
    const db = new Database(":memory:");
    try {
      db.exec("PRAGMA foreign_keys = ON;");
      db.exec(readFileSync(migrationUrl, "utf8"));
      const tables = db.query<{ name: string }, []>(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
      ).all().map((row) => row.name);
      assert.deepEqual(tables, [
        "ai_credit_grants",
        "auth_rate_limits",
        "collections",
        "device_sessions",
        "email_challenges",
        "extension_codes",
        "installations",
        "projects",
        "sessions",
        "storage_grants",
        "stripe_events",
        "users",
        "web_sessions",
      ]);
      const source = readFileSync(migrationUrl, "utf8").toLowerCase();
      assert.doesNotMatch(source, /license_key|browser_ticket|browser_session/);
      const projectColumns = db.query<{ name: string }, []>("PRAGMA table_info(projects)")
        .all()
        .map((column) => column.name);
      assert.ok(projectColumns.includes("icon"));
      const userColumns = db.query<{ name: string }, []>("PRAGMA table_info(users)")
        .all()
        .map((column) => column.name);
      assert.ok(userColumns.includes("ai_credit_refill_at"));
      db.exec(`
        INSERT INTO installations (id, token_hash, created_at, updated_at)
        VALUES ('ins_test', 'hash_test', '2026-08-17T00:00:00.000Z', '2026-08-17T00:00:00.000Z');
        INSERT INTO ai_credit_grants (
          id, owner_type, owner_id, source_type, source_id, credits, created_at
        ) VALUES (
          'grant_test', 'installation', 'ins_test', 'free_initial', 'free:ins_test', 5,
          '2026-08-17T00:00:00.000Z'
        );
      `);
      assert.throws(
        () => db.query("UPDATE ai_credit_grants SET consumed_credits = 6 WHERE id = 'grant_test'").run(),
        /constraint/i,
      );
      assert.throws(
        () => db.query(
          "INSERT INTO sessions (id, created_at, user_id, byte_size) VALUES ('bad_size', 'now', 'owner', -1)",
        ).run(),
        /constraint/i,
      );
    } finally {
      db.close();
    }
  });
});
