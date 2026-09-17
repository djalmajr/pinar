import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { REPRODUCTION_LIMITS } from "@pinar/shared";
import { SESSION_PATCH_MAX_BYTES } from "./session-patch";

describe("session patch payload", () => {
  test("fits the largest valid reproduction timeline with all thumbnails", () => {
    const thumbnailBytes = REPRODUCTION_LIMITS.maxSteps * REPRODUCTION_LIMITS.maxThumbnailLength;
    assert.ok(SESSION_PATCH_MAX_BYTES > thumbnailBytes + 100_000);
  });
});
