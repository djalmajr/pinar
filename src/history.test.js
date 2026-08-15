import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
});
