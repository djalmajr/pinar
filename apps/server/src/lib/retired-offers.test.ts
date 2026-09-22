import { expect, test } from "bun:test";
import { checkoutOffer, legacyCheckoutOffer, baseStorageBytes, PRO_INITIAL_AI_CREDITS } from "./entitlements";

test("retired one-time plans cannot become a catalog offer or a subscription", () => {
  for (const offer of ["founder", "lifetime_founder", "lifetime"]) {
    expect(checkoutOffer(offer)).toBeNull();
    expect(legacyCheckoutOffer(offer)).toBeNull();
  }
  expect(legacyCheckoutOffer("month")).toBeNull();
  expect(legacyCheckoutOffer("year")).toBe("pro_year");
  expect(baseStorageBytes("pro")).toBe(2 * 1024 ** 3);
  expect(PRO_INITIAL_AI_CREDITS).toBe(500);
});
