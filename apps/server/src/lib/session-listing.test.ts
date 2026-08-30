import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { flattenCollectionSessions, sessionListingCopy } from "./session-listing";

describe("session listing copy", () => {
  test("keeps a real page title and description above the URL", () => {
    assert.deepEqual(
      sessionListingCopy({
        description: " Rotate this API key field. ",
        title: "API keys",
        url: "https://example.test/settings",
      }),
      {
        description: "Rotate this API key field.",
        title: "API keys",
        url: "https://example.test/settings",
      },
    );
  });

  test("omits empty title and description so the listing can be just the URL", () => {
    assert.deepEqual(
      sessionListingCopy({ title: "   ", url: "https://example.test/blank" }),
      { description: "", title: "", url: "https://example.test/blank" },
    );
  });

  test("hides the generic Pinar document title on local and product URLs", () => {
    assert.equal(
      sessionListingCopy({ title: "Pinar", url: "http://127.0.0.1:17373/app" }).title,
      "",
    );
    assert.equal(
      sessionListingCopy({ title: "Pinar", url: "https://pinar.dev/docs" }).title,
      "",
    );
  });

  test("keeps Pinar as a title on unrelated hosts", () => {
    assert.equal(
      sessionListingCopy({ title: "Pinar", url: "https://example.test/pinar" }).title,
      "Pinar",
    );
  });

  test("reuses a single collection session list so All sessions does not copy Inbox", () => {
    const sessions = [{ id: "a" }, { id: "b" }];
    const flattened = flattenCollectionSessions([{ sessions }]);
    assert.equal(flattened, sessions);
  });

  test("concatenates sessions across collections without mutating the sources", () => {
    const inbox = [{ id: "a" }];
    const studio = [{ id: "b" }];
    assert.deepEqual(
      flattenCollectionSessions([{ sessions: inbox }, { sessions: studio }]),
      [{ id: "a" }, { id: "b" }],
    );
    assert.deepEqual(inbox, [{ id: "a" }]);
  });

  test("returns a stable empty list when there are no collections", () => {
    assert.equal(flattenCollectionSessions(undefined), flattenCollectionSessions([]));
    assert.deepEqual(flattenCollectionSessions(undefined), []);
  });
});
