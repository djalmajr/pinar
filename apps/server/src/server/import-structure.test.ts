import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { LocalExportCollection, LocalExportProject } from "@pinar/shared";
import {
  type ImportedCollectionRecord,
  type ImportedProjectRecord,
  importedId,
  importStructure,
  ImportStructureError,
  type ImportStructureStore,
  MAX_IMPORTED_PROJECTS,
  MAX_IMPORTED_SESSIONS,
} from "./import-structure";

interface StoredRow {
  isProtected: boolean;
  ownerId: string;
}

function memoryStore(ownerId: string) {
  const projects = new Map<string, ImportedProjectRecord & StoredRow>();
  const collections = new Map<string, ImportedCollectionRecord & StoredRow>();
  const store: ImportStructureStore = {
    protectedDestination: async () => ({ collectionId: "cloud-inbox", projectId: "cloud-personal" }),
    upsertCollection: async (collection) => {
      const existing = collections.get(collection.id);
      if (existing && (existing.ownerId !== ownerId || existing.isProtected)) return false;
      collections.set(collection.id, { ...collection, isProtected: false, ownerId });
      return true;
    },
    upsertProject: async (project) => {
      const existing = projects.get(project.id);
      if (existing && (existing.ownerId !== ownerId || existing.isProtected)) return false;
      projects.set(project.id, { ...project, isProtected: false, ownerId });
      return true;
    },
  };
  return { collections, projects, store };
}

const input = (
  projects: LocalExportProject[],
  collections: LocalExportCollection[],
  extra: { batchIds?: string[]; sessionIds?: string[] } = {},
) => ({ batchIds: extra.batchIds ?? [], collections, projects, sessionIds: extra.sessionIds ?? [] });

const project = (id: string, isProtected = false): LocalExportProject => ({ createdAt: "t", icon: "folder", id, isProtected, name: id, position: 0, updatedAt: "t" });
const collection = (id: string, projectId: string, parentId: string | null = null, isProtected = false): LocalExportCollection => ({ createdAt: "t", id, isProtected, name: id, parentId, position: 0, projectId, updatedAt: "t" });

describe("import structure", () => {
  test("maps the local personal project and inbox onto the account's own", async () => {
    const { collections, projects, store } = memoryStore("me");
    const result = await importStructure(store, "me", input(
      [project("personal", true)],
      [collection("inbox", "personal", null, true), collection("notes", "personal", "inbox")],
    ));
    assert.deepEqual(result.projectIds, { personal: "cloud-personal" });
    assert.equal(result.collectionIds.inbox, "cloud-inbox");
    assert.equal(result.collectionIds.notes, await importedId("me", "collection", "notes"));
    assert.equal(projects.size, 0);
    assert.deepEqual([...collections.values()].map((item) => [item.projectId, item.parentId]), [["cloud-personal", "cloud-inbox"]]);
  });

  test("derives every id from the owner, nests children under their parents and is repeatable", async () => {
    const { collections, projects, store } = memoryStore("me");
    const value = input(
      [project("work")],
      [collection("grandchild", "work", "child"), collection("child", "work", "root"), collection("root", "work")],
      { batchIds: ["b1"], sessionIds: ["s1", "s2"] },
    );
    const first = await importStructure(store, "me", value);
    const second = await importStructure(store, "me", value);
    assert.deepEqual(first, second);
    assert.equal(projects.size, 1);
    assert.equal(collections.size, 3);
    assert.equal(collections.get(first.collectionIds.grandchild)?.parentId, first.collectionIds.child);
    assert.equal(collections.get(first.collectionIds.child)?.parentId, first.collectionIds.root);
    assert.deepEqual(Object.keys(first.sessionIds), ["s1", "s2"]);
    assert.match(first.sessionIds.s1, /^[A-Za-z0-9_-]{22}$/);
    assert.match(first.batchIds.b1, /^[A-Za-z0-9_-]{22}$/);
    assert.notEqual(first.projectIds.work, "work");
  });

  test("gives another account different ids for the same export, every time", async () => {
    const value = input([project("work")], [collection("root", "work"), collection("child", "work", "root")], { batchIds: ["b1"], sessionIds: ["s1"] });
    const mine = await importStructure(memoryStore("me").store, "me", value);
    const theirs = memoryStore("other");
    const first = await importStructure(theirs.store, "other", value);
    const second = await importStructure(theirs.store, "other", value);
    assert.deepEqual(first, second);
    assert.notEqual(first.projectIds.work, mine.projectIds.work);
    assert.notEqual(first.collectionIds.root, mine.collectionIds.root);
    assert.notEqual(first.sessionIds.s1, mine.sessionIds.s1);
    assert.notEqual(first.batchIds.b1, mine.batchIds.b1);
    assert.equal(theirs.projects.size, 1);
    assert.equal(theirs.collections.size, 2);
  });

  test("stops when a derived id is held by another account or a protected row", async () => {
    const value = input([project("work")], [collection("root", "work")]);
    const foreign = memoryStore("me");
    foreign.projects.set(await importedId("me", "project", "work"), { createdAt: "t", icon: "x", id: "x", isProtected: false, name: "theirs", ownerId: "someone-else", position: 0, updatedAt: "t" });
    await assert.rejects(importStructure(foreign.store, "me", value), (error: unknown) => error instanceof ImportStructureError && error.status === 409);
    const guarded = memoryStore("me");
    guarded.collections.set(await importedId("me", "collection", "root"), { createdAt: "t", id: "x", isProtected: true, name: "Inbox", ownerId: "me", parentId: null, position: 0, projectId: "p", updatedAt: "t" });
    await assert.rejects(importStructure(guarded.store, "me", value), (error: unknown) => error instanceof ImportStructureError && error.status === 409);
    assert.equal([...guarded.collections.values()][0]?.name, "Inbox");
  });

  test("puts a parent from another project, a missing parent or a cycle at the root", async () => {
    const { collections, store } = memoryStore("me");
    const result = await importStructure(store, "me", input(
      [project("p1"), project("p2")],
      [collection("a", "p1"), collection("cross", "p2", "a"), collection("orphan", "p1", "gone"), collection("x", "p1", "y"), collection("y", "p1", "x")],
    ));
    assert.equal(collections.get(result.collectionIds.cross)?.parentId, null);
    assert.equal(collections.get(result.collectionIds.orphan)?.parentId, null);
    const cycle = [collections.get(result.collectionIds.x)?.parentId, collections.get(result.collectionIds.y)?.parentId];
    assert.ok(cycle.includes(null));
  });

  test("refuses oversized imports", async () => {
    const { store } = memoryStore("me");
    const projects = Array.from({ length: MAX_IMPORTED_PROJECTS + 1 }, (_, index) => project(`p${index}`));
    await assert.rejects(importStructure(store, "me", input(projects, [])), ImportStructureError);
    const sessionIds = Array.from({ length: MAX_IMPORTED_SESSIONS + 1 }, (_, index) => `s${index}`);
    await assert.rejects(importStructure(store, "me", input([], [], { sessionIds })), ImportStructureError);
  });
});
