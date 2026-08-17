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
        "auth_rate_limits",
        "collections",
        "device_sessions",
        "email_challenges",
        "extension_codes",
        "installations",
        "projects",
        "sessions",
        "users",
        "web_sessions",
      ]);
      const source = readFileSync(migrationUrl, "utf8").toLowerCase();
      assert.doesNotMatch(source, /license_key|browser_ticket|browser_session/);
      const projectColumns = db.query<{ name: string }, []>("PRAGMA table_info(projects)")
        .all()
        .map((column) => column.name);
      assert.ok(projectColumns.includes("icon"));
    } finally {
      db.close();
    }
  });
});
