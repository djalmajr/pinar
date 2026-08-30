import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { projectTreeFingerprint, resolveSelectedCollectionId } from "./workspace-tree-sync";

describe("workspace tree sync", () => {
  test("changes fingerprint when pin review counts change", () => {
    const session = {
      id: "cap_1",
      reviewCounts: { accepted: 0, correction_ready: 0, open: 1, reopened: 0 },
    };
    const before = projectTreeFingerprint([{ collections: [{ sessions: [session] }] }]);
    const after = projectTreeFingerprint([{
      collections: [{
        sessions: [{
          ...session,
          reviewCounts: { accepted: 0, correction_ready: 1, open: 0, reopened: 0 },
        }],
      }],
    }]);
    assert.notEqual(before, after);
  });

  test("keeps the same fingerprint for identical trees", () => {
    const projects = [{ id: "prj", collections: [] }];
    assert.equal(projectTreeFingerprint(projects), projectTreeFingerprint(projects));
  });

  test("keeps All sessions selected when the current id is already null", () => {
    assert.equal(
      resolveSelectedCollectionId(null, null, new Set(["col_inbox"])),
      null,
    );
  });

  test("hydrates a stored collection only before the user picks All sessions", () => {
    assert.equal(
      resolveSelectedCollectionId(null, "col_inbox", new Set(["col_inbox"])),
      "col_inbox",
    );
    assert.equal(
      resolveSelectedCollectionId("col_inbox", "col_inbox", new Set(["col_inbox"])),
      "col_inbox",
    );
  });

  test("clears a collection that disappeared from the tree", () => {
    assert.equal(
      resolveSelectedCollectionId("col_gone", "col_gone", new Set(["col_inbox"])),
      null,
    );
  });
});
