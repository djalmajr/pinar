import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { collectionsInCreationOrder, LocalExportError, parseLocalExportManifest, type LocalExportCollection } from "./local-export/index";

function manifest(overrides: Record<string, unknown> = {}) {
  return {
    batches: [{ finishedAt: null, id: "batch1", label: "Lote", startedAt: "2026-10-07T00:00:00.000Z" }],
    collections: [
      { createdAt: "t", id: "inbox", isProtected: true, name: "Inbox", parentId: null, position: 0, projectId: "personal", updatedAt: "t" },
      { createdAt: "t", id: "child", isProtected: false, name: "Child", parentId: "inbox", position: 1, projectId: "personal", updatedAt: "t" },
    ],
    exportedAt: "2026-10-07T00:00:00.000Z",
    format: "pinar-local-export",
    projects: [{ createdAt: "t", icon: "user-round", id: "personal", isProtected: true, name: "Personal", position: 0, updatedAt: "t" }],
    schemaVersion: 1,
    sessions: [
      { batchId: "batch1", capture: { page: { title: "A", url: "https://a" }, pins: [] }, collectionId: "child", createdAt: "t", id: "session0001", includeScreenshot: true, position: 0, shot: "shots/shot0001.png" },
      { batchId: null, capture: {}, collectionId: "inbox", createdAt: "t", id: "session0002", includeScreenshot: false, position: 1, shot: null },
    ],
    source: { runtime: "local", version: "0.7.0" },
    ...overrides,
  };
}

describe("local export manifest", () => {
  test("accepts a valid manifest and keeps the ids", () => {
    const parsed = parseLocalExportManifest(manifest());
    assert.deepEqual(parsed.sessions.map((session) => [session.id, session.shot]), [["session0001", "shots/shot0001.png"], ["session0002", null]]);
    assert.equal(parsed.collections[1].parentId, "inbox");
    assert.equal(parsed.source.version, "0.7.0");
  });

  test("refuses other formats and versions", () => {
    assert.throws(() => parseLocalExportManifest({ ...manifest(), format: "other" }), /not a Pinar local export/);
    assert.throws(() => parseLocalExportManifest({ ...manifest(), schemaVersion: 2 }), /unsupported export version/);
  });

  test("refuses broken references and unsafe values", () => {
    const base = manifest();
    assert.throws(() => parseLocalExportManifest({ ...base, sessions: [{ ...base.sessions[0], collectionId: "nope" }] }), /missing collection/);
    assert.throws(() => parseLocalExportManifest({ ...base, sessions: [{ ...base.sessions[0], batchId: "nope" }] }), /missing batch/);
    assert.throws(() => parseLocalExportManifest({ ...base, collections: [{ ...base.collections[0], projectId: "nope" }] }), /missing project/);
    assert.throws(() => parseLocalExportManifest({ ...base, sessions: [{ ...base.sessions[0], shot: "../etc/passwd" }] }), /not a valid path/);
    assert.throws(() => parseLocalExportManifest({ ...base, sessions: [{ ...base.sessions[0], id: "bad id!" }] }), /not a valid id/);
    assert.throws(() => parseLocalExportManifest({ ...base, sessions: [base.sessions[0], { ...base.sessions[1], id: "session0001" }] }), /duplicate id/);
    assert.throws(() => parseLocalExportManifest(null), LocalExportError);
  });

  test("lets several sessions share one screenshot entry", () => {
    const base = manifest();
    const parsed = parseLocalExportManifest({
      ...base,
      sessions: [
        base.sessions[0],
        { ...base.sessions[1], includeScreenshot: true, shot: "shots/shot0001.png" },
        { ...base.sessions[0], id: "session0003" },
      ],
    });
    assert.deepEqual(
      parsed.sessions.map((session) => [session.id, session.shot]),
      [
        ["session0001", "shots/shot0001.png"],
        ["session0002", "shots/shot0001.png"],
        ["session0003", "shots/shot0001.png"],
      ],
    );
  });

  test("orders collections parents first and keeps cycles and orphans at the root", () => {
    const collection = (id: string, parentId: string | null): LocalExportCollection => ({ createdAt: "t", id, isProtected: false, name: id, parentId, position: 0, projectId: "p", updatedAt: "t" });
    const ordered = collectionsInCreationOrder([collection("grandchild", "child"), collection("child", "root"), collection("root", null), collection("orphan", "gone"), collection("a", "b"), collection("b", "a")]);
    const index = (id: string) => ordered.findIndex((item) => item.id === id);
    assert.ok(index("root") < index("child") && index("child") < index("grandchild"));
    assert.equal(ordered.length, 6);
    assert.ok(index("orphan") >= 0 && index("a") >= 0 && index("b") >= 0);
  });
});
