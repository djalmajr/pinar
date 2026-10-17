import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { readFileSync, readdirSync } from "node:fs";

const directory = new URL("./", import.meta.url);
const migration = readFileSync(new URL("0031_assistant_credits.sql", directory), "utf8");

// One statement at a time, as D1 runs a migration file (same splitter as the
// 0019 test).
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
  for (const file of readdirSync(directory).filter((name) => name.endsWith(".sql") && name < "0031").sort()) {
    db.exec(readFileSync(new URL(file, directory), "utf8"));
  }
  return db;
}

const balance = (db: Database, owner: string) =>
  db.query("SELECT COALESCE(SUM(credits - consumed_credits), 0) AS balance FROM ai_credit_grants WHERE owner_id = ?").get(owner);

const schemaOf = (db: Database, type: "index" | "trigger") =>
  db.query("SELECT name, tbl_name, sql FROM sqlite_master WHERE type = ? AND tbl_name = 'ai_credit_usages' ORDER BY name").all(type)
    .map((row) => ({ ...(row as { name: string; sql: string | null; tbl_name: string }), sql: String((row as { sql: string | null }).sql).replace(/\s+/g, " ") }));

test("0031 keeps the usages, the grants, the balance and the triggers, and accepts assistant_turn", () => {
  const db = previousDatabase();
  try {
    db.exec(`
      INSERT INTO users (id,email,plan,billing_status,created_at,updated_at)
        VALUES ('pro','pro@example.test','pro','active','2026-10-01','2026-10-01');
      INSERT INTO ai_credit_grants
        (id,owner_type,owner_id,source_type,source_id,credits,consumed_credits,expires_at,created_at)
        VALUES ('initial','account','pro','pro_initial','pro_initial:pro',500,0,NULL,'2026-10-01'),
               ('bought','account','pro','purchase','cs_test_1',500,0,NULL,'2026-10-02');
      INSERT INTO ai_credit_usages
        (id,request_id,owner_type,owner_id,grant_id,feature,resource_id,model,credits,status,
         input_tokens,output_tokens,cost_usd_micros,result_json,error_code,created_at,completed_at)
        VALUES ('u_done','voice-1','account','pro','initial','voice_pin','pin-1','whisper',1,'reserved',
                NULL,NULL,NULL,NULL,NULL,'2026-10-03',NULL);
      UPDATE ai_credit_usages SET status='succeeded', input_tokens=10, output_tokens=4, cost_usd_micros=120,
        result_json='{"text":"oi"}', completed_at='2026-10-03' WHERE id='u_done';
      INSERT INTO ai_credit_usages
        (id,request_id,owner_type,owner_id,grant_id,feature,resource_id,model,credits,status,created_at)
        VALUES ('u_refunded','voice-2','account','pro','initial','voice_pin','pin-2','whisper',1,'reserved','2026-10-04');
      UPDATE ai_credit_usages SET status='refunded', error_code='ai_inference_failed', completed_at='2026-10-04' WHERE id='u_refunded';
      INSERT INTO ai_credit_usages
        (id,request_id,owner_type,owner_id,grant_id,feature,resource_id,model,credits,status,created_at)
        VALUES ('u_open','voice-3','account','pro','bought','voice_pin','pin-3','whisper',1,'reserved','2026-10-05');
    `);
    const usagesBefore = db.query("SELECT * FROM ai_credit_usages ORDER BY id").all();
    const grantsBefore = db.query("SELECT * FROM ai_credit_grants ORDER BY id").all();
    const balanceBefore = balance(db, "pro");
    const triggersBefore = schemaOf(db, "trigger");
    const indexesBefore = schemaOf(db, "index");
    expect(balanceBefore).toEqual({ balance: 998 });
    // Before 0031 the feature is refused.
    expect(() => db.exec(`INSERT INTO ai_credit_usages
      (id,request_id,owner_type,owner_id,grant_id,feature,resource_id,model,credits,status,created_at)
      VALUES ('u_early','turn:early','account','pro','initial','assistant_turn','assistant:t','gateway:m',3,'reserved','2026-10-06')`)).toThrow();

    applyStatements(db, migration);

    // The data, the balance and the definitions of the triggers and indexes
    // are the same; the open reservation was not charged again by the copy.
    expect(db.query("SELECT * FROM ai_credit_usages ORDER BY id").all()).toEqual(usagesBefore);
    expect(db.query("SELECT * FROM ai_credit_grants ORDER BY id").all()).toEqual(grantsBefore);
    expect(balance(db, "pro")).toEqual(balanceBefore);
    expect(schemaOf(db, "trigger")).toEqual(triggersBefore);
    expect(schemaOf(db, "index")).toEqual(indexesBefore);
    expect(db.query("SELECT name FROM sqlite_master WHERE name = 'ai_credit_usages_backup'").all()).toEqual([]);
    expect(db.query("PRAGMA foreign_key_check").all()).toEqual([]);

    // The triggers still work, now for an assistant turn: the reservation
    // debits 3, the refund gives them back, and an empty grant refuses.
    db.exec(`INSERT INTO ai_credit_usages
      (id,request_id,owner_type,owner_id,grant_id,feature,resource_id,model,credits,status,created_at)
      VALUES ('u_turn','turn:msg_1','account','pro','initial','assistant_turn','assistant:thread_1','gateway:anthropic/claude-haiku-5.5',3,'reserved','2026-10-06')`);
    expect(balance(db, "pro")).toEqual({ balance: 995 });
    db.exec("UPDATE ai_credit_usages SET status='refunded', error_code='ASSISTANT_TURN_INCOMPLETE' WHERE id='u_turn'");
    expect(balance(db, "pro")).toEqual({ balance: 998 });
    db.exec("UPDATE ai_credit_grants SET consumed_credits = credits - 2 WHERE id = 'bought'");
    expect(() => db.exec(`INSERT INTO ai_credit_usages
      (id,request_id,owner_type,owner_id,grant_id,feature,resource_id,model,credits,status,created_at)
      VALUES ('u_poor','turn:msg_2','account','pro','bought','assistant_turn','assistant:thread_1','gateway:m',3,'reserved','2026-10-06')`))
      .toThrow("insufficient_ai_credits");
    // The same request id of the owner is still unique.
    expect(() => db.exec(`INSERT INTO ai_credit_usages
      (id,request_id,owner_type,owner_id,grant_id,feature,resource_id,model,credits,status,created_at)
      VALUES ('u_twice','turn:msg_1','account','pro','initial','assistant_turn','assistant:thread_1','gateway:m',3,'reserved','2026-10-06')`))
      .toThrow(/UNIQUE/);
    expect(() => db.exec(`INSERT INTO ai_credit_usages
      (id,request_id,owner_type,owner_id,grant_id,feature,resource_id,model,credits,status,created_at)
      VALUES ('u_other','other-1','account','pro','initial','assistant_chat','assistant:thread_1','gateway:m',3,'reserved','2026-10-06')`))
      .toThrow(/CHECK/);
  } finally {
    db.close();
  }
});

test("schema.sql accepts the same features as the migrated database", () => {
  const schema = readFileSync(new URL("../schema.sql", directory), "utf8");
  // The last migration that (re)creates the table leaves the CHECK the
  // migrated database carries.
  const latestTableSql = readdirSync(directory)
    .filter((name) => name.endsWith(".sql"))
    .sort()
    .map((name) => readFileSync(new URL(name, directory), "utf8"))
    .filter((sql) => sql.includes("CREATE TABLE ai_credit_usages ("))
    .at(-1)!;
  const featureCheck = (sql: string) => {
    const table = sql.slice(sql.lastIndexOf("CREATE TABLE ai_credit_usages ("));
    return table.slice(table.indexOf("feature TEXT NOT NULL"), table.indexOf("resource_id TEXT NOT NULL")).replace(/\s+/g, " ");
  };
  expect(featureCheck(schema)).toBe(featureCheck(latestTableSql));
  expect(featureCheck(schema)).toContain("'assistant_turn'");
});
