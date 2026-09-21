import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { readFileSync, readdirSync } from "node:fs";

const directory = new URL("./", import.meta.url);
const migration = readFileSync(new URL("0019_one_time_pro_credits.sql", directory), "utf8");

function applyStatements(db: Database, sql: string) {
  let statement = "";
  let trigger = false;
  for (const line of sql.split("\n")) {
    if (line.trimStart().startsWith("--")) continue;
    if (/^CREATE TRIGGER/.test(line)) trigger = true;
    statement += line + "\n";
    if (line.trimEnd().endsWith(";") && (!trigger || /^END;/.test(line))) {
      db.exec(statement.trim().replace(/;$/, ""));
      statement = "";
      trigger = false;
    }
  }
}

function previousDatabase() {
  const db = new Database(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  for (const file of readdirSync(directory).filter((name) => name.endsWith(".sql") && name < "0019").sort()) {
    db.exec(readFileSync(new URL(file, directory), "utf8"));
  }
  return db;
}

test("one-time Pro credit migration preserves the ledger and clears refill scheduling", () => {
  const db = previousDatabase();
  try {
    db.exec(`
      INSERT INTO users (id,email,plan,billing_status,created_at,updated_at,ai_credit_refill_at)
        VALUES ('pro','pro@example.test','pro','active','2026-09-21','2026-09-21','2026-10-21');
      INSERT INTO ai_credit_grants
        (id,owner_type,owner_id,source_type,source_id,credits,consumed_credits,expires_at,created_at)
        VALUES ('legacy','account','pro','pro_monthly','legacy-month',200,1,'2026-10-21','2026-09-21');
      INSERT INTO ai_credit_usages
        (id,request_id,owner_type,owner_id,grant_id,feature,resource_id,model,credits,status,created_at)
        VALUES ('usage','request','account','pro','legacy','voice_pin','pin','whisper',1,'succeeded','2026-09-21');
    `);
    applyStatements(db, migration);

    expect(db.query("SELECT ai_credit_refill_at FROM users WHERE id='pro'").get())
      .toEqual({ ai_credit_refill_at: null });
    expect(db.query("SELECT source_type, consumed_credits FROM ai_credit_grants WHERE id='legacy'").get())
      .toEqual({ consumed_credits: 1, source_type: "pro_monthly" });
    expect(db.query("SELECT status FROM ai_credit_usages WHERE id='usage'").get())
      .toEqual({ status: "succeeded" });
    expect(() => db.exec(`INSERT INTO ai_credit_grants
      (id,owner_type,owner_id,source_type,source_id,credits,created_at)
      VALUES ('initial','account','pro','pro_initial','pro_initial:pro',500,'2026-09-21')`)).not.toThrow();
    expect(db.query("PRAGMA foreign_key_check").all()).toEqual([]);
  } finally {
    db.close();
  }
});
