import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { readFileSync, readdirSync } from "node:fs";

const directory = new URL("./", import.meta.url);
const migration = readFileSync(new URL("0036_drop_byok_endpoints.sql", directory), "utf8");

test("0036 removes saved Cloud endpoints and encrypted keys while preserving the account", () => {
  const db = new Database(":memory:");
  try {
    db.exec("PRAGMA foreign_keys = ON");
    for (const file of readdirSync(directory).filter((name) => name.endsWith(".sql") && name < "0036").sort()) {
      db.exec(readFileSync(new URL(file, directory), "utf8"));
    }
    db.query(`INSERT INTO users (id,email,plan,billing_status,created_at,updated_at)
      VALUES ('owner','owner@example.test','pro','active','2026-10-01','2026-10-01')`).run();
    db.query(`INSERT INTO byok_endpoints (
      owner_id,base_url,key_ciphertext,key_last4,key_id,chat_model,embedding_model,
      transcription_model,capabilities_json,created_at,updated_at
    ) VALUES ('owner','https://example.test/v1','encrypted-key','last','key-id','chat','embed','voice','{}','2026-10-01','2026-10-01')`).run();
    expect(db.query("SELECT key_ciphertext FROM byok_endpoints").all()).toEqual([{ key_ciphertext: "encrypted-key" }]);
    db.exec(migration);
    expect(db.query("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'byok_endpoints'").all()).toEqual([]);
    expect(() => db.query("SELECT key_ciphertext FROM byok_endpoints").all()).toThrow(/no such table/);
    expect(db.query("SELECT id, email FROM users").all()).toEqual([{ email: "owner@example.test", id: "owner" }]);
    expect(db.query("PRAGMA foreign_key_check").all()).toEqual([]);
  } finally {
    db.close();
  }
});
