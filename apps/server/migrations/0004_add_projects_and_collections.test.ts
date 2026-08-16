import { Database } from "bun:sqlite";
import { readFileSync } from "node:fs";
import { describe, expect, test } from "bun:test";

const migrationSql = readFileSync(
  new URL("./0004_add_projects_and_collections.sql", import.meta.url),
  "utf8",
);

describe("projects and collections D1 migration", () => {
  test("creates Personal / Inbox per existing owner and preserves every session payload", () => {
    const db = new Database(":memory:");
    db.exec(`
      CREATE TABLE sessions (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        image_key TEXT NOT NULL,
        pins_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      INSERT INTO sessions (id, user_id, image_key, pins_json, created_at) VALUES
        ('session-b', 'owner-a', 'shots/b.png', '[{"comment":"B"}]', '2026-01-01T00:00:00.000Z'),
        ('session-a', 'owner-a', 'shots/a.png', '[{"comment":"A"}]', '2026-01-01T00:00:00.000Z'),
        ('session-c', 'owner-b', 'shots/c.png', '[{"comment":"C"}]', '2026-02-01T00:00:00.000Z');
    `);

    db.exec(migrationSql);

    expect(db.query("SELECT owner_id, name, position, is_protected FROM projects ORDER BY owner_id").all()).toEqual([
      { is_protected: 1, name: "Personal", owner_id: "owner-a", position: 0 },
      { is_protected: 1, name: "Personal", owner_id: "owner-b", position: 0 },
    ]);
    expect(db.query("SELECT owner_id, name, position, is_protected FROM collections ORDER BY owner_id").all()).toEqual([
      { is_protected: 1, name: "Inbox", owner_id: "owner-a", position: 0 },
      { is_protected: 1, name: "Inbox", owner_id: "owner-b", position: 0 },
    ]);
    expect(db.query(`
      SELECT id, image_key, pins_json, position, collection_id IS NOT NULL AS assigned
      FROM sessions
      ORDER BY user_id, position
    `).all()).toEqual([
      { assigned: 1, id: "session-a", image_key: "shots/a.png", pins_json: '[{"comment":"A"}]', position: 0 },
      { assigned: 1, id: "session-b", image_key: "shots/b.png", pins_json: '[{"comment":"B"}]', position: 1 },
      { assigned: 1, id: "session-c", image_key: "shots/c.png", pins_json: '[{"comment":"C"}]', position: 0 },
    ]);

    db.close();
  });
});
