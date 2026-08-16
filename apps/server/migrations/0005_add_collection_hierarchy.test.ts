import { Database } from "bun:sqlite";
import { readFileSync } from "node:fs";
import { describe, expect, test } from "bun:test";

const migrationSql = readFileSync(
  new URL("./0005_add_collection_hierarchy.sql", import.meta.url),
  "utf8",
);

describe("collection hierarchy D1 migration", () => {
  test("keeps existing collections at the root and adds the sibling-order index", () => {
    const db = new Database(":memory:");
    db.exec(`
      CREATE TABLE collections (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        owner_id TEXT NOT NULL,
        name TEXT NOT NULL,
        position INTEGER NOT NULL DEFAULT 0,
        is_protected INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX idx_collections_project_position ON collections(project_id, position);
      INSERT INTO collections VALUES
        ('inbox', 'personal', 'owner', 'Inbox', 0, 1, '2026-01-01', '2026-01-01'),
        ('review', 'personal', 'owner', 'Review', 1, 0, '2026-01-01', '2026-01-01');
    `);

    db.exec(migrationSql);

    expect(db.query("SELECT id, parent_id FROM collections ORDER BY position").all()).toEqual([
      { id: "inbox", parent_id: null },
      { id: "review", parent_id: null },
    ]);
    expect(db.query("PRAGMA index_info(idx_collections_project_position)").all()).toEqual([
      { cid: 1, name: "project_id", seqno: 0 },
      { cid: 8, name: "parent_id", seqno: 1 },
      { cid: 4, name: "position", seqno: 2 },
    ]);

    db.close();
  });
});
