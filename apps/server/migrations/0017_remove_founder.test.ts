import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { readFileSync, readdirSync } from "node:fs";

const directory = new URL("./", import.meta.url);
const migration = readFileSync(new URL("0017_remove_founder.sql", directory), "utf8");
// Execute statements separately, as D1 migrations do. Bun 1.4 on Windows can
// swallow an intermediate constraint error in a multi-statement db.exec call.
function applyRemoval(db: Database) {
  let statement = "";
  let trigger = false;
  for (const line of migration.split("\n")) {
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
function migrate(db: Database) {
  db.exec("BEGIN");
  try {
    applyRemoval(db);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}
function previousDatabase() {
  const db = new Database(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  for (const file of readdirSync(directory).filter(f => f.endsWith(".sql") && f < "0017").sort()) {
    db.exec(readFileSync(new URL(file, directory), "utf8"));
  }
  return db;
}

test("removal preserves Pro, related data and every AI feature without charging twice", () => {
  const db = previousDatabase();
  try {
    db.exec(`
      INSERT INTO users (id,email,plan,stripe_subscription_id,created_at,updated_at)
        VALUES ('pro','pro@example.test','pro','sub_pro','2026-09-14','2026-09-14');
      INSERT INTO installations (id,token_hash,migrated_to_user_id,created_at,updated_at)
        VALUES ('ins','hash','pro','2026-09-14','2026-09-14');
      INSERT INTO sessions (id,user_id,plan,created_at,include_screenshot)
        VALUES ('capture','pro','pro','2026-09-14',0);
      INSERT INTO storage_grants (id,user_id,source_type,source_id,byte_count,starts_at,expires_at,created_at)
        VALUES ('storage','pro','storage_5gb_12m','checkout_storage',5368709120,'2026-09-14','2027-09-14','2026-09-14');
      INSERT INTO ai_credit_grants (id,owner_type,owner_id,source_type,source_id,credits,created_at)
        VALUES ('grant','account','pro','pro_monthly','monthly_pro',200,'2026-09-14');
    `);
    for (const feature of ["session_summary", "component_export", "pin_diagnosis", "design_system", "reproduction", "voice_pin"]) {
      db.query(`INSERT INTO ai_credit_usages
        (id,request_id,owner_type,owner_id,grant_id,feature,resource_id,model,credits,status,created_at)
        VALUES (?,?,'account','pro','grant',?,'capture','test',1,'reserved','2026-09-14')`)
        .run(feature, feature, feature);
    }
    const tables = ["users", "installations", "sessions", "storage_grants", "ai_credit_grants", "ai_credit_usages"];
    const before = tables.map(t => db.query(`SELECT * FROM ${t}`).all());
    migrate(db);
    expect(tables.map(t => db.query(`SELECT * FROM ${t}`).all())).toEqual(before);
    expect(db.query("PRAGMA foreign_key_check").all()).toEqual([]);
    expect(db.query("SELECT name FROM sqlite_master WHERE name LIKE 'founder_%'").all()).toEqual([]);
    db.exec("UPDATE ai_credit_usages SET status='refunded' WHERE id='component_export'");
    expect(db.query("SELECT consumed_credits FROM ai_credit_grants").get()).toEqual({ consumed_credits: 5 });
    expect(() => db.exec("UPDATE users SET plan='founder'")).toThrow();
    expect(() => db.exec("UPDATE sessions SET plan='founder'")).toThrow();
    expect(() => db.exec("UPDATE ai_credit_grants SET source_type='founder_initial'")).toThrow();
  } finally { db.close(); }
});

test("removal refuses existing Founder accounts, grants, captures, or pending checkout", () => {
  const fixtures = [
    "INSERT INTO users (id,email,plan,created_at,updated_at) VALUES ('f','f@example.test','founder','2026-09-14','2026-09-14')",
    "INSERT INTO sessions (id,user_id,plan,created_at) VALUES ('f','f','founder','2026-09-14')",
    "INSERT INTO ai_credit_grants (id,owner_type,owner_id,source_type,source_id,credits,created_at) VALUES ('f','account','f','founder_initial','f',500,'2026-09-14')",
    "INSERT INTO founder_reservations (id,checkout_request_id,claim_hash,expires_at,created_at,updated_at) VALUES ('f','f','f','2026-09-15','2026-09-14','2026-09-14')",
  ];
  for (const fixture of fixtures) {
    const db = previousDatabase();
    try {
      db.exec(fixture);
      expect(() => migrate(db)).toThrow();
      expect(db.query("SELECT name FROM sqlite_master WHERE name='founder_reservations'").get()).not.toBeNull();
      expect(db.query("SELECT name FROM sqlite_master WHERE name='founder_removal_guard'").get()).toBeNull();
    } finally { db.close(); }
  }
});
