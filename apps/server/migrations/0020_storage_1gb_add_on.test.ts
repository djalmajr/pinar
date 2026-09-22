import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { readFileSync, readdirSync } from "node:fs";

const directory = new URL("./", import.meta.url);
const migration = readFileSync(new URL("0020_storage_1gb_add_on.sql", directory), "utf8");

function previousDatabase() {
  const db = new Database(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  for (const file of readdirSync(directory).filter((name) => name.endsWith(".sql") && name < "0020").sort()) {
    db.exec(readFileSync(new URL(file, directory), "utf8"));
  }
  return db;
}

test("storage migration accepts 1 GB grants and preserves historical packages", () => {
  const db = previousDatabase();
  try {
    db.exec(`
      INSERT INTO users (id,email,plan,billing_status,created_at,updated_at)
        VALUES ('pro','pro@example.test','pro','active','2026-09-21','2026-09-21');
      INSERT INTO storage_grants
        (id,user_id,source_type,source_id,byte_count,starts_at,expires_at,created_at)
        VALUES ('legacy','pro','storage_20gb_12m','legacy-storage',21474836480,'2026-09-21','2027-09-21','2026-09-21');
      INSERT INTO storage_expiry_notices
        (id,storage_grant_id,days_before,scheduled_for,status,created_at,updated_at)
        VALUES ('notice','legacy',30,'2027-08-22','pending','2026-09-21','2026-09-21');
    `);

    db.exec(migration);

    expect(db.query("SELECT source_type, byte_count FROM storage_grants WHERE id='legacy'").get())
      .toEqual({ byte_count: 21_474_836_480, source_type: "storage_20gb_12m" });
    expect(() => db.exec(`INSERT INTO storage_grants
      (id,user_id,source_type,source_id,byte_count,starts_at,expires_at,created_at)
      VALUES ('new','pro','storage_1gb_12m','new-storage',1073741824,'2026-09-21','2027-09-21','2026-09-21')`))
      .not.toThrow();
    expect(db.query("SELECT storage_grant_id FROM storage_expiry_notices WHERE id='notice'").get())
      .toEqual({ storage_grant_id: "legacy" });
    expect(db.query("PRAGMA foreign_key_check").all()).toEqual([]);
  } finally {
    db.close();
  }
});
