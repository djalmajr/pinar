import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, test } from "node:test";
import { openHistoryDb } from "./history.mjs";

describe("history", () => {
  let tempDir;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "pinar-history-test-"));
  });

  afterEach(async () => {
    if (tempDir) await rm(tempDir, { force: true, recursive: true });
  });

  test("saveSession records and retrieves history sessions", () => {
    const db = openHistoryDb(tempDir);
    const session = db.saveSession({
      id: "test-1",
      page: { title: "Test Page", url: "https://example.com" },
      pins: [{ comment: "Fix header", kind: "element", selector: "h1" }],
      shotId: "shot-1",
      shotPath: "/tmp/shot-1.png",
    });

    assert.equal(session.id, "test-1");
    assert.equal(session.page.title, "Test Page");
    assert.equal(session.pins.length, 1);
    assert.equal(session.pins[0].comment, "Fix header");

    const fetched = db.getSession("test-1");
    assert.deepEqual(fetched, session);

    const list = db.listSessions();
    assert.equal(list.length, 1);
    assert.equal(list[0].id, "test-1");
    db.close();
  });

  test("openHistoryDb migrates history created under the old shots root", () => {
    // Mutation captured: fixing shot paths without moving the legacy database makes history appear empty.
    const legacyDb = openHistoryDb(join(tempDir, "shots"));
    legacyDb.saveSession({
      id: "legacy",
      page: { title: "Legacy session" },
      pins: [],
      shotPath: join(tempDir, "shots", "shots", "legacy.png"),
    });
    legacyDb.close();

    const db = openHistoryDb(tempDir);
    assert.equal(db.getSession("legacy")?.page.title, "Legacy session");
    assert.equal(db.getSession("legacy")?.shotPath, join(tempDir, "shots", "legacy.png"));
    db.close();
  });

  test("listSessions filters by search query on title, url, or pin comment", () => {
    const db = openHistoryDb(tempDir);
    db.saveSession({
      id: "s1",
      page: { title: "Billing Settings", url: "https://app.com/billing" },
      pins: [{ comment: "Change card format" }],
    });
    db.saveSession({
      id: "s2",
      page: { title: "User Profile", url: "https://app.com/profile" },
      pins: [{ comment: "Avatar size is wrong" }],
    });

    const billing = db.listSessions({ query: "billing" });
    assert.equal(billing.length, 1);
    assert.equal(billing[0].id, "s1");

    const avatar = db.listSessions({ query: "avatar" });
    assert.equal(avatar.length, 1);
    assert.equal(avatar[0].id, "s2");

    const none = db.listSessions({ query: "nonexistent" });
    assert.equal(none.length, 0);
    db.close();
  });

  test("deleteSession and clearHistory remove entries", () => {
    const db = openHistoryDb(tempDir);
    db.saveSession({ id: "s1", page: { title: "Page 1" }, pins: [] });
    db.saveSession({ id: "s2", page: { title: "Page 2" }, pins: [] });

    assert.equal(db.listSessions().length, 2);

    const deleted = db.deleteSession("s1");
    assert.equal(deleted, true);
    assert.equal(db.listSessions().length, 1);
    assert.equal(db.getSession("s1"), null);

    db.clearHistory();
    assert.equal(db.listSessions().length, 0);
    db.close();
  });

  test("migrates existing sessions into protected Personal and Inbox containers", () => {
    // Mutation captured: removing the backfill leaves legacy sessions without a collection.
    const legacy = new DatabaseSync(join(tempDir, "history.db"));
    legacy.exec(`
      CREATE TABLE sessions (
        id TEXT PRIMARY KEY,
        url TEXT,
        title TEXT,
        shot_id TEXT,
        shot_path TEXT,
        pin_count INTEGER,
        pins_json TEXT,
        created_at TEXT
      );
      INSERT INTO sessions VALUES (
        'legacy-session', 'https://example.test', 'Legacy', 'legacy-shot', '/tmp/legacy.png', 0, '[]', '2026-01-01T00:00:00.000Z'
      );
    `);
    legacy.close();

    const db = openHistoryDb(tempDir);
    const tree = db.getProjectTree();

    assert.equal(tree.projects.length, 1);
    assert.equal(tree.projects[0].name, "Personal");
    assert.equal(tree.projects[0].isProtected, true);
    assert.equal(tree.projects[0].collections.length, 1);
    assert.equal(tree.projects[0].collections[0].name, "Inbox");
    assert.equal(tree.projects[0].collections[0].isProtected, true);
    assert.equal(tree.projects[0].collections[0].sessions[0].id, "legacy-session");
    assert.equal(db.getSession("legacy-session").shotId, "legacy-shot");
    db.close();
  });

  test("moves and reorders sessions and preserves them when deleting containers", () => {
    // Mutation captured: deleting a project before moving sessions makes its captures disappear from history.
    const db = openHistoryDb(tempDir);
    const personal = db.listProjects()[0];
    const inbox = db.listCollections(personal.id)[0];
    const project = db.createProject("Website");
    const review = db.createCollection(project.id, "Review");
    const ready = db.createCollection(project.id, "Ready");
    db.saveSession({ collectionId: review.id, id: "s1", page: { title: "One" } });
    db.saveSession({ collectionId: review.id, id: "s2", page: { title: "Two" } });

    db.reorderSessions(review.id, ["s2", "s1"]);
    assert.deepEqual(db.listSessions({ collectionId: review.id }).map((session) => session.id), ["s2", "s1"]);
    assert.equal(db.moveSession("s1", ready.id).collectionId, ready.id);

    assert.equal(db.deleteProject(project.id), true);
    assert.equal(db.getSession("s1").collectionId, inbox.id);
    assert.equal(db.getSession("s2").collectionId, inbox.id);
    assert.equal(db.listProjects().some((item) => item.id === project.id), false);
    assert.equal(db.deleteProject(personal.id), false);
    assert.equal(db.deleteCollection(inbox.id), false);
    db.close();
  });

  test("nests collections, rejects cycles, and promotes children when a parent is deleted", () => {
    const db = openHistoryDb(tempDir);
    const project = db.createProject("Website");
    const design = db.createCollection(project.id, "Design");
    const review = db.createCollection(project.id, "Review");
    const approved = db.createCollection(project.id, "Approved");

    assert.ok(db.reorderCollections(project.id, [
      { id: design.id, parentId: null },
      { id: review.id, parentId: design.id },
      { id: approved.id, parentId: review.id },
    ]));
    assert.deepEqual(db.listCollections(project.id).map((collection) => ({
      id: collection.id,
      parentId: collection.parentId,
      position: collection.position,
    })), [
      { id: design.id, parentId: null, position: 0 },
      { id: review.id, parentId: design.id, position: 0 },
      { id: approved.id, parentId: review.id, position: 0 },
    ]);
    assert.equal(db.reorderCollections(project.id, [
      { id: design.id, parentId: approved.id },
      { id: review.id, parentId: design.id },
      { id: approved.id, parentId: review.id },
    ]), null);

    assert.equal(db.deleteCollection(review.id), true);
    assert.equal(db.listCollections(project.id).find((item) => item.id === approved.id).parentId, design.id);
    db.close();
  });

  test("falls back to Personal and Inbox when a saved capture destination is invalid", () => {
    // Mutation captured: trusting an unknown collection id creates an orphan session.
    const db = openHistoryDb(tempDir);
    const destination = db.getDefaultDestination();
    const session = db.saveSession({ collectionId: "missing", id: "fallback" });

    assert.equal(session.collectionId, destination.collectionId);
    assert.equal(db.resolveDestination("missing").projectId, destination.projectId);
    db.close();
  });
});
