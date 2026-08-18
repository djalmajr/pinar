import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  laterExpiry,
  paidRetentionExpiresAt,
} from "./retention";

describe("cloud retention", () => {
  test("ends paid recovery exactly 90 days after eligibility ends", () => {
    assert.equal(
      paidRetentionExpiresAt("2026-08-16T12:00:00.000Z"),
      "2026-11-14T12:00:00.000Z",
    );
    assert.equal(paidRetentionExpiresAt("invalid"), null);
  });

  test("uses the later relevant expiry for grace and recovery", () => {
    assert.equal(laterExpiry(null, "2026-08-16T12:00:00.000Z"), "2026-08-16T12:00:00.000Z");
    assert.equal(laterExpiry("2026-08-18T12:00:00.000Z", null), "2026-08-18T12:00:00.000Z");
    assert.equal(
      laterExpiry("2026-08-16T12:00:00.000Z", "2026-08-18T12:00:00.000Z"),
      "2026-08-18T12:00:00.000Z",
    );
  });
});
