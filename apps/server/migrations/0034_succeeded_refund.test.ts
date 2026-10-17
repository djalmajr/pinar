import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { readFileSync, readdirSync } from "node:fs";

const directory = new URL("./", import.meta.url);
const migration = readFileSync(new URL("0034_succeeded_refund.sql", directory), "utf8");

// One statement at a time, as D1 runs a migration file (same splitter as the
// 0031 and 0033 tests).
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
  for (const file of readdirSync(directory).filter((name) => name.endsWith(".sql") && name < "0034").sort()) {
    db.exec(readFileSync(new URL(file, directory), "utf8"));
  }
  return db;
}

const balance = (db: Database, owner: string) =>
  db.query("SELECT COALESCE(SUM(credits - consumed_credits), 0) AS balance FROM ai_credit_grants WHERE owner_id = ?").get(owner);

const SEED = `
  INSERT INTO users (id,email,plan,billing_status,created_at,updated_at)
    VALUES ('pro','pro@example.test','pro','active','2026-10-01','2026-10-01');
  INSERT INTO ai_credit_grants
    (id,owner_type,owner_id,source_type,source_id,credits,consumed_credits,expires_at,created_at)
    VALUES ('initial','account','pro','pro_initial','pro_initial:pro',500,0,NULL,'2026-10-01');
  INSERT INTO ai_credit_usages
    (id,request_id,owner_type,owner_id,grant_id,feature,resource_id,model,credits,status,
     input_tokens,output_tokens,cost_usd_micros,result_json,error_code,created_at,completed_at)
    VALUES ('u_done','repro-1','account','pro','initial','reproduction','reproduction:s1','mock',1,'reserved',
            NULL,NULL,NULL,NULL,NULL,'2026-10-03',NULL);
  UPDATE ai_credit_usages SET status='succeeded', result_json='{"steps":[]}', completed_at='2026-10-03' WHERE id='u_done';
  INSERT INTO ai_credit_usages
    (id,request_id,owner_type,owner_id,grant_id,feature,resource_id,model,credits,status,created_at)
    VALUES ('u_open','capture:cap_1','account','pro','initial','capture_filing','capture:cap_1','mock',1,'reserved','2026-10-04');
`;

test("0034 keeps the usages and the grants, and credits back a refunded succeeded usage", () => {
  const db = previousDatabase();
  try {
    db.exec(SEED);
    const usagesBefore = db.query("SELECT * FROM ai_credit_usages ORDER BY id").all();
    const grantsBefore = db.query("SELECT * FROM ai_credit_grants ORDER BY id").all();
    expect(balance(db, "pro")).toEqual({ balance: 498 });

    applyStatements(db, migration);

    // The data and the balance are the same; the refund trigger now accepts
    // the succeeded origin, and nothing else changed.
    expect(db.query("SELECT * FROM ai_credit_usages ORDER BY id").all()).toEqual(usagesBefore);
    expect(db.query("SELECT * FROM ai_credit_grants ORDER BY id").all()).toEqual(grantsBefore);
    expect(balance(db, "pro")).toEqual({ balance: 498 });
    expect(db.query("PRAGMA foreign_key_check").all()).toEqual([]);
    expect(String(db.query("SELECT sql FROM sqlite_master WHERE type = 'trigger' AND name = 'refund_ai_credit_usage'").get()?.sql))
      .toContain("OLD.status IN ('reserved', 'succeeded')");

    // The new transition: a consumed usage whose result was not persisted is
    // refunded and the credit comes back.
    db.exec("UPDATE ai_credit_usages SET status='refunded', error_code='ai_result_not_stored' WHERE id='u_done'");
    expect(balance(db, "pro")).toEqual({ balance: 499 });
    // The old transition still works, and a second refund of the same usage
    // debits nothing: the grant is credited back at most once.
    db.exec("UPDATE ai_credit_usages SET status='refunded', error_code='reservation_timeout' WHERE id='u_open'");
    expect(balance(db, "pro")).toEqual({ balance: 500 });
    db.exec("UPDATE ai_credit_usages SET status='refunded' WHERE id='u_done'");
    expect(balance(db, "pro")).toEqual({ balance: 500 });
  } finally {
    db.close();
  }
});

test("schema.sql carries the same refund trigger as the migrated database", () => {
  const schema = readFileSync(new URL("../schema.sql", directory), "utf8");
  const triggerOf = (sql: string) => {
    const trigger = sql.slice(sql.indexOf("CREATE TRIGGER refund_ai_credit_usage"));
    return trigger.slice(0, trigger.indexOf("END;") + 4).replace(/\s+/g, " ");
  };
  expect(triggerOf(schema)).toBe(triggerOf(migration));
  expect(triggerOf(schema)).toContain("OLD.status IN ('reserved', 'succeeded')");
});
