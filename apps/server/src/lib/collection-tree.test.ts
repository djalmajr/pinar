import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { ProjectTreeCollection } from "@pinar/shared";
import {
  flattenCollections,
  partitionCollectionNavigation,
  reorderCollectionTree,
  visibleCollections,
} from "./collection-tree";

function collection(
  id: string,
  position: number,
  parentId: string | null = null,
  isProtected = false,
): ProjectTreeCollection {
  return {
    createdAt: "2026-01-01T00:00:00.000Z",
    id,
    isProtected,
    name: id,
    ownerId: "owner",
    parentId,
    position,
    projectId: "project",
    sessions: [],
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

describe("collection tree drag projection", () => {
  test("indents and outdents a collection with horizontal drag", () => {
    const root = collection("root", 0);
    const sibling = collection("sibling", 1);
    const last = collection("last", 2);
    const flattened = flattenCollections([root, sibling, last]);

    assert.deepEqual(reorderCollectionTree(flattened, sibling.id, sibling.id, 18), [
      { id: root.id, parentId: null },
      { id: sibling.id, parentId: root.id },
      { id: last.id, parentId: null },
    ]);

    const nested = flattenCollections([root, { ...sibling, parentId: root.id, position: 0 }, last]);
    assert.deepEqual(reorderCollectionTree(nested, sibling.id, sibling.id, -18), [
      { id: root.id, parentId: null },
      { id: sibling.id, parentId: null },
      { id: last.id, parentId: null },
    ]);
  });

  test("moves an entire subtree and keeps descendant ownership", () => {
    const root = collection("root", 0);
    const child = collection("child", 0, root.id);
    const sibling = collection("sibling", 1);

    assert.deepEqual(reorderCollectionTree(
      flattenCollections([root, child, sibling]),
      root.id,
      sibling.id,
      0,
    ), [
      { id: sibling.id, parentId: null },
      { id: root.id, parentId: null },
      { id: child.id, parentId: root.id },
    ]);
  });

  test("keeps the protected Inbox at the root", () => {
    const inbox = collection("inbox", 0, null, true);
    const sibling = collection("sibling", 1);

    assert.deepEqual(reorderCollectionTree(
      flattenCollections([inbox, sibling]),
      inbox.id,
      inbox.id,
      36,
    ), [
      { id: inbox.id, parentId: null },
      { id: sibling.id, parentId: null },
    ]);
  });

  // Mutation captured: using the previous item id instead of its parent reparents sibling folders.
  test("keeps a moved sibling under the same parent", () => {
    const root = collection("root", 0);
    const first = collection("first", 0, root.id);
    const second = collection("second", 1, root.id);

    assert.deepEqual(reorderCollectionTree(
      flattenCollections([root, first, second]),
      first.id,
      second.id,
      0,
    ), [
      { id: root.id, parentId: null },
      { id: second.id, parentId: root.id },
      { id: first.id, parentId: root.id },
    ]);
  });

  // Mutation captured: removing the ancestor scan makes a move after a grandchild jump to the root.
  test("finds the nearest ancestor when dropping after a deeper descendant", () => {
    const root = collection("root", 0);
    const active = collection("active", 0, root.id);
    const sibling = collection("sibling", 1, root.id);
    const grandchild = collection("grandchild", 0, sibling.id);

    assert.deepEqual(reorderCollectionTree(
      flattenCollections([root, active, sibling, grandchild]),
      active.id,
      grandchild.id,
      0,
    ), [
      { id: root.id, parentId: null },
      { id: sibling.id, parentId: root.id },
      { id: grandchild.id, parentId: sibling.id },
      { id: active.id, parentId: root.id },
    ]);
  });
});

describe("collection sidebar navigation", () => {
  test("keeps protected collections fixed and only user folders sortable", () => {
    const inbox = collection("inbox", 0, null, true);
    const nestedUnderInbox = collection("nested-under-inbox", 0, inbox.id);
    const root = collection("root", 1);
    const child = collection("child", 0, root.id);

    const navigation = partitionCollectionNavigation([
      inbox,
      nestedUnderInbox,
      root,
      child,
    ]);

    assert.deepEqual(navigation.fixedCollections.map(({ id }) => id), [inbox.id]);
    assert.deepEqual(
      flattenCollections(navigation.sortableCollections).map(({ collection: item, depth }) => ({
        depth,
        id: item.id,
      })),
      [
        { depth: 0, id: nestedUnderInbox.id },
        { depth: 0, id: root.id },
        { depth: 1, id: child.id },
      ],
    );
  });

  test("hides every descendant of a collapsed collection", () => {
    const root = collection("root", 0);
    const child = collection("child", 0, root.id);
    const grandchild = collection("grandchild", 0, child.id);
    const sibling = collection("sibling", 1);
    const flattened = flattenCollections([root, child, grandchild, sibling]);

    assert.deepEqual(
      visibleCollections(flattened, new Set([root.id])).map(({ collection: item }) => item.id),
      [root.id, sibling.id],
    );
    assert.deepEqual(
      visibleCollections(flattened, new Set([child.id])).map(({ collection: item }) => item.id),
      [root.id, child.id, sibling.id],
    );
  });
});
