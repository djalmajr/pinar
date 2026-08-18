import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { reorderIds, reorderSessionIds } from "./session-order";

describe("session order", () => {
  test("moves one item earlier or later without mutating the source", () => {
    const ids = ["first", "second", "third"];
    assert.deepEqual(reorderSessionIds(ids, "second", "earlier"), ["second", "first", "third"]);
    assert.deepEqual(reorderSessionIds(ids, "second", "later"), ["first", "third", "second"]);
    assert.deepEqual(ids, ["first", "second", "third"]);
  });

  test("rejects unknown ids and collection boundaries", () => {
    assert.equal(reorderSessionIds(["first", "second"], "missing", "earlier"), null);
    assert.equal(reorderSessionIds(["first", "second"], "first", "earlier"), null);
    assert.equal(reorderSessionIds(["first", "second"], "second", "later"), null);
  });

  test("provides the same immutable primitive for project ordering", () => {
    assert.deepEqual(reorderIds(["personal", "alpha", "beta"], "beta", "earlier"), [
      "personal",
      "beta",
      "alpha",
    ]);
  });
});
