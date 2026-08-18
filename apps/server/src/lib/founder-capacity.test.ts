import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  FOUNDER_SOLD_OUT_ERROR,
  evaluateFounderCapacity,
  founderReservationExpiresAt,
} from "./founder-capacity";

describe("Founder capacity", () => {
  // Mutation captured: ignoring active reservations would expose one extra Founder checkout.
  test("counts active reservations against the configured limit", () => {
    const capacity = evaluateFounderCapacity({
      enabled: true,
      limit: 3,
      now: new Date("2026-08-18T12:00:00.000Z"),
      reservations: [
        { expiresAt: "2026-08-18T12:15:00.000Z", status: "active" },
        { expiresAt: "2026-08-18T11:59:59.999Z", status: "active" },
        { expiresAt: "2026-08-18T12:15:00.000Z", status: "released" },
      ],
      sold: 1,
    });

    assert.deepEqual(capacity, {
      activeReservations: 1,
      available: true,
      error: null,
      limit: 3,
      remaining: 1,
      sold: 1,
      state: "available",
    });
  });

  // Mutation captured: using sold > limit instead of sold + reserved >= limit oversells the last slot.
  test("closes the cohort when the last slot is reserved", () => {
    const capacity = evaluateFounderCapacity({
      enabled: true,
      limit: 2,
      now: new Date("2026-08-18T12:00:00.000Z"),
      reservations: [
        { expiresAt: "2026-08-18T12:15:00.000Z", status: "active" },
      ],
      sold: 1,
    });

    assert.deepEqual(capacity, {
      activeReservations: 1,
      available: false,
      error: FOUNDER_SOLD_OUT_ERROR,
      limit: 2,
      remaining: 0,
      sold: 1,
      state: "sold_out",
    });
  });

  test("keeps an attached Checkout counted until Stripe resolves it", () => {
    const capacity = evaluateFounderCapacity({
      enabled: true,
      limit: 1,
      now: new Date("2026-08-18T12:16:00.000Z"),
      reservations: [{
        checkoutAttached: true,
        expiresAt: "2026-08-18T12:15:00.000Z",
        status: "active",
      }],
      sold: 0,
    });

    assert.equal(capacity.activeReservations, 1);
    assert.equal(capacity.available, false);
    assert.equal(capacity.state, "sold_out");
  });

  test("keeps a manually closed cohort unavailable without pretending it sold out", () => {
    const capacity = evaluateFounderCapacity({
      enabled: false,
      limit: 10,
      now: new Date("2026-08-18T12:00:00.000Z"),
      reservations: [],
      sold: 2,
    });

    assert.equal(capacity.available, false);
    assert.equal(capacity.error, FOUNDER_SOLD_OUT_ERROR);
    assert.equal(capacity.remaining, 8);
    assert.equal(capacity.state, "closed");
  });

  test("rejects invalid capacity snapshots instead of opening sales fail-open", () => {
    assert.throws(() => evaluateFounderCapacity({
      enabled: true,
      limit: 0,
      now: new Date("2026-08-18T12:00:00.000Z"),
      reservations: [],
      sold: 0,
    }), /positive integer/);
    assert.throws(() => evaluateFounderCapacity({
      enabled: true,
      limit: 10,
      now: new Date("2026-08-18T12:00:00.000Z"),
      reservations: [],
      sold: -1,
    }), /non-negative integer/);
  });

  test("uses an explicit reservation TTL", () => {
    assert.equal(
      founderReservationExpiresAt(new Date("2026-08-18T12:00:00.000Z"), 15 * 60 * 1_000).toISOString(),
      "2026-08-18T12:15:00.000Z",
    );
    assert.throws(
      () => founderReservationExpiresAt(new Date("2026-08-18T12:00:00.000Z"), 0),
      /positive integer/,
    );
  });
});
