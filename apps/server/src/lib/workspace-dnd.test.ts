import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  collectionIdFromOver,
  isSessionDragData,
  sessionDragId,
  sessionIdsForDrop,
  shouldStartWorkspaceDrag,
} from "./workspace-dnd";

describe("workspace session drag", () => {
  test("prefixes session drag ids so they cannot collide with collections", () => {
    assert.equal(sessionDragId("col_inbox"), "session:col_inbox");
  });

  test("moves the whole selection when the dragged session is selected", () => {
    assert.deepEqual(
      sessionIdsForDrop("a", new Set(["a", "b"])),
      ["a", "b"],
    );
  });

  test("moves only the dragged session when it is not in the selection", () => {
    assert.deepEqual(sessionIdsForDrop("c", new Set(["a", "b"])), ["c"]);
    assert.deepEqual(sessionIdsForDrop("a", new Set()), ["a"]);
  });

  test("accepts drops only on known collection ids", () => {
    const collections = new Set(["col_a", "col_b"]);
    assert.equal(collectionIdFromOver("col_b", collections), "col_b");
    assert.equal(collectionIdFromOver("session:a", collections), null);
    assert.equal(collectionIdFromOver(undefined, collections), null);
  });

  test("recognizes session drag payloads", () => {
    assert.equal(isSessionDragData({ sessionIds: ["a"], type: "session" }), true);
    assert.equal(isSessionDragData({ type: "collection" }), false);
    assert.equal(isSessionDragData({ sessionIds: [""], type: "session" }), false);
  });

  test("starts from item content but not checkboxes or no-dnd targets", () => {
    function target(hits: string[]) {
      return {
        closest(selector: string) {
          const parts = selector.split(",").map((part) => part.trim());
          return parts.some((part) => hits.includes(part)) ? {} : null;
        },
      };
    }
    assert.equal(shouldStartWorkspaceDrag({ target: target(["[data-slot=checkbox]"]) } as unknown as Event), false);
    assert.equal(shouldStartWorkspaceDrag({ target: target(["a"]) } as unknown as Event), true);
    assert.equal(shouldStartWorkspaceDrag({ target: target(["[data-no-dnd]"]) } as unknown as Event), false);
    assert.equal(shouldStartWorkspaceDrag({ target: target([]) } as unknown as Event), true);
  });
});
