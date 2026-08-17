import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { pricingForCountry, type PricingConfig } from "./pricing";

const PRICING_CONFIG: PricingConfig = {
  aiCredits1000BrlCents: 990,
  aiCredits1000UsdCents: 299,
  lifetimeBrlCents: 12_990,
  lifetimeUsdCents: 3_900,
  monthlyBrlCents: 490,
  monthlyUsdCents: 299,
  storage20Gb12MBrlCents: 2_990,
  storage20Gb12MUsdCents: 799,
  storage5Gb12MBrlCents: 990,
  storage5Gb12MUsdCents: 299,
  yearlyBrlCents: 3_990,
  yearlyUsdCents: 1_900,
};

describe("regional pricing", () => {
  test("uses the approved fixed Brazil catalog", () => {
    const pricing = pricingForCountry("br", PRICING_CONFIG);
    assert.equal(pricing.currency, "BRL");
    assert.equal(pricing.discountPercent, null);
    assert.equal(pricing.regional, true);
    assert.deepEqual(pricing.prices, {
      aiCredits1000: { amount: 990, originalAmount: null },
      free: { amount: 0, originalAmount: null },
      lifetime: { amount: 12_990, originalAmount: null },
      month: { amount: 490, originalAmount: null },
      storage20Gb12M: { amount: 2_990, originalAmount: null },
      storage5Gb12M: { amount: 990, originalAmount: null },
      year: { amount: 3_990, originalAmount: null },
    });
  });

  test("uses the approved fixed global catalog outside Brazil", () => {
    const pricing = pricingForCountry("US", PRICING_CONFIG);
    assert.equal(pricing.currency, "USD");
    assert.equal(pricing.regional, false);
    assert.deepEqual(pricing.prices, {
      aiCredits1000: { amount: 299, originalAmount: null },
      free: { amount: 0, originalAmount: null },
      lifetime: { amount: 3_900, originalAmount: null },
      month: { amount: 299, originalAmount: null },
      storage20Gb12M: { amount: 799, originalAmount: null },
      storage5Gb12M: { amount: 299, originalAmount: null },
      year: { amount: 1_900, originalAmount: null },
    });
  });

  test("reads every amount from configuration instead of compiling a fallback", () => {
    const pricing = pricingForCountry("BR", {
      ...PRICING_CONFIG,
      aiCredits1000BrlCents: 101,
      storage20Gb12MBrlCents: 202,
      storage5Gb12MBrlCents: 303,
    });
    assert.equal(pricing.prices.aiCredits1000.amount, 101);
    assert.equal(pricing.prices.storage20Gb12M.amount, 202);
    assert.equal(pricing.prices.storage5Gb12M.amount, 303);
  });
});
