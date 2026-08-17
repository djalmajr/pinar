import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  FREE_STORAGE_BYTES,
  PAID_STORAGE_BYTES,
  addUtcMonths,
  baseStorageBytes,
  canStoreBytes,
  checkoutOffer,
  legacyCheckoutOffer,
  planForOffer,
  storageEntitlement,
} from "./entitlements";

describe("billing entitlements", () => {
  test("recognizes only catalog offers and keeps legacy plan checkout compatible", () => {
    assert.equal(checkoutOffer("storage_5gb_12m"), "storage_5gb_12m");
    assert.equal(checkoutOffer("unknown"), null);
    assert.equal(legacyCheckoutOffer("year"), "pro_year");
    assert.equal(legacyCheckoutOffer("lifetime"), "lifetime_founder");
    assert.equal(planForOffer("ai_credits_1000"), null);
    assert.equal(planForOffer("lifetime_founder"), "lifetime");
  });

  test("clamps monthly credit periods at the end of shorter months", () => {
    assert.equal(
      addUtcMonths(new Date("2026-01-31T12:30:00.000Z"), 1).toISOString(),
      "2026-02-28T12:30:00.000Z",
    );
    assert.equal(
      addUtcMonths(new Date("2028-01-31T12:30:00.000Z"), 1).toISOString(),
      "2028-02-29T12:30:00.000Z",
    );
  });

  test("applies the approved base storage to Free and paid plans", () => {
    assert.equal(baseStorageBytes("free"), FREE_STORAGE_BYTES);
    assert.equal(baseStorageBytes("pro"), PAID_STORAGE_BYTES);
    assert.equal(baseStorageBytes("lifetime"), PAID_STORAGE_BYTES);
  });

  test("moves expired overage through grace, recovery and cleanup eligibility", () => {
    const common = {
      activeAddOnBytes: 0,
      baseBytes: 100,
      latestExpiredAt: "2026-01-01T00:00:00.000Z",
      nextExpiryAt: null,
      usedBytes: 150,
    };
    assert.equal(storageEntitlement({ ...common, now: new Date("2026-01-15T00:00:00.000Z") }).state, "grace");
    assert.equal(storageEntitlement({ ...common, now: new Date("2026-02-15T00:00:00.000Z") }).state, "recoverable");
    assert.equal(storageEntitlement({ ...common, now: new Date("2026-04-02T00:00:00.000Z") }).state, "cleanup_eligible");
  });

  test("allows replacement within quota but rejects projected overage", () => {
    const entitlement = storageEntitlement({
      activeAddOnBytes: 0,
      baseBytes: 100,
      latestExpiredAt: null,
      nextExpiryAt: null,
      now: new Date("2026-01-01T00:00:00.000Z"),
      usedBytes: 90,
    });
    assert.equal(canStoreBytes(entitlement, 20), false);
    assert.equal(canStoreBytes(entitlement, 20, 10), true);
  });
});
