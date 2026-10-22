import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { readFileSync, readdirSync } from "node:fs";

const directory = new URL("./", import.meta.url);
const migration = readFileSync(new URL("0035_byok_endpoints.sql", directory), "utf8");

const ROW_SQL = `INSERT INTO byok_endpoints (
  owner_id, base_url, key_ciphertext, key_last4, key_id,
  chat_model, embedding_model, transcription_model, capabilities_json,
  created_at, updated_at
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

const rowValues = (owner: string) => [
  owner,
  "https://api.example.test/v1",
  "v1:abcd1234:cXY1Mg==:dQ==",
  "x7kd",
  "abcd1234",
  "gpt-x",
  "embed-x",
  "whisper-x",
  '{"chat":{"ok":null,"error":null,"testedAt":null}}',
  "2026-10-01T10:00:00.000Z",
  "2026-10-01T10:00:00.000Z",
];

function previousDatabase() {
  const db = new Database(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  for (const file of readdirSync(directory).filter((name) => name.endsWith(".sql") && name < "0035").sort()) {
    db.exec(readFileSync(new URL(file, directory), "utf8"));
  }
  return db;
}

test("0035 adds byok_endpoints, refuses an unknown owner, and cascades on account deletion", () => {
  const db = previousDatabase();
  try {
    db.exec(`
      INSERT INTO users (id,email,plan,billing_status,created_at,updated_at)
        VALUES ('owner','owner@example.test','pro','active','2026-10-01','2026-10-01')
    `);
    db.exec(migration);

    // The owner_id is a foreign key to users: an unknown owner is refused.
    expect(() => db.query(ROW_SQL).run(...rowValues("ghost"))).toThrow(/FOREIGN KEY/);
    // owner_id is the primary key: one endpoint per account.
    db.query(ROW_SQL).run(...rowValues("owner"));
    expect(() => db.query(ROW_SQL).run(...rowValues("owner"))).toThrow(/UNIQUE/);

    // The row keeps what the API stored, including the untested capabilities.
    expect(db.query("SELECT * FROM byok_endpoints WHERE owner_id = 'owner'").get())
      .toEqual({
        base_url: "https://api.example.test/v1",
        capabilities_json: '{"chat":{"ok":null,"error":null,"testedAt":null}}',
        chat_model: "gpt-x",
        created_at: "2026-10-01T10:00:00.000Z",
        embedding_model: "embed-x",
        key_ciphertext: "v1:abcd1234:cXY1Mg==:dQ==",
        key_id: "abcd1234",
        key_last4: "x7kd",
        owner_id: "owner",
        transcription_model: "whisper-x",
        updated_at: "2026-10-01T10:00:00.000Z",
      });

    // Deleting the account deletes the row (D1).
    db.exec("DELETE FROM users WHERE id = 'owner'");
    expect(db.query("SELECT * FROM byok_endpoints").all()).toEqual([]);
    expect(db.query("PRAGMA foreign_key_check").all()).toEqual([]);
  } finally {
    db.close();
  }
});
