import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { pricingForCountry } from "./pricing";

const PricingConfig = {
  brazilDiscountPercent: 35,
  brazilExchangeRate: 5.2014,
  lifetimeUsdCents: 4_900,
  monthlyUsdCents: 290,
  yearlyUsdCents: 1_900,
};

describe("regional pricing", () => {
  test("converts Brazil prices, applies the configured discount, and rounds up to ,90", () => {
    // Mutation captured: removing the regional calculation returns the USD amounts for Brazil.
    const pricing = pricingForCountry("br", PricingConfig);
    assert.equal(pricing.currency, "BRL");
    assert.equal(pricing.discountPercent, 35);
    assert.deepEqual(pricing.prices, {
      free: { amount: 0, originalAmount: null },
      lifetime: { amount: 16_590, originalAmount: 25_487 },
      month: { amount: 990, originalAmount: 1_508 },
      year: { amount: 6_490, originalAmount: 9_883 },
    });
  });

  test("uses environment inputs instead of compiled regional amounts", () => {
    // Mutation captured: hardcoding the first rollout values ignores an updated exchange rate.
    const pricing = pricingForCountry("BR", {
      ...PricingConfig,
      brazilDiscountPercent: 50,
      brazilExchangeRate: 6,
    });
    assert.equal(pricing.prices.month.amount, 890);
    assert.equal(pricing.prices.month.originalAmount, 1_740);
  });

  test("keeps the configured USD amounts outside Brazil", () => {
    // Mutation captured: applying the Brazil branch globally changes the public currency and amount.
    const pricing = pricingForCountry("US", PricingConfig);
    assert.equal(pricing.currency, "USD");
    assert.equal(pricing.regional, false);
    assert.equal(pricing.prices.month.amount, 290);
    assert.equal(pricing.prices.month.originalAmount, null);
  });
});
