import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { Session } from "@pinar/shared";
import { directSessionShareIds, selectedSharedCaptures } from "./shared-capture-selection";
import type { SessionGroup } from "./session-groups";

function capture(id: string, isShared: boolean): Session {
  return {
    createdAt: "2026-09-25T00:00:00.000Z",
    id,
    isShared,
    page: { title: id, url: `https://example.test/${id}` },
    pins: [],
  };
}

describe("selectedSharedCaptures", () => {
  test("revokes only direct session links in visible selected groups", () => {
    // Mutation captured: treating inherited project sharing as a session link revokes the wrong resource.
    const first = capture("first", true);
    const inheritedShare = capture("inherited", true);
    const second = capture("second", true);
    const hidden = capture("hidden", true);
    const groups: SessionGroup[] = [
      { ...first, captures: [first, inheritedShare, second], isShared: true },
      hidden,
    ];

    const tokens = [
      { token: "one", resourceType: "session", resourceId: "first" },
      { token: "two", resourceType: "session", resourceId: "second" },
      { token: "three", resourceType: "project", resourceId: "project" },
      { token: "four", resourceType: "session", resourceId: "hidden" },
      { token: "five", resourceType: "session", resourceId: "revoked", revokedAt: "2026-09-25T00:00:00.000Z" },
    ];
    assert.deepEqual([...directSessionShareIds(tokens)].sort(), ["first", "hidden", "second"]);
    assert.deepEqual(
      selectedSharedCaptures({
        directlySharedCaptureIds: directSessionShareIds(tokens),
        groups,
        selectedGroupIds: new Set(["first", "hidden"]),
        visibleGroupIds: new Set(["first"]),
      }),
      [
        { captureId: "first", groupId: "first" },
        { captureId: "second", groupId: "first" },
      ],
    );
  });
});
