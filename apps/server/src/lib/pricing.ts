import type { FounderCapacityState } from "./founder-capacity";

export type PricingCurrency = "BRL" | "USD";

export interface PublicPrice {
  amount: number;
  originalAmount: number | null;
}

export interface PublicPricingPrices {
  aiCredits1000: PublicPrice;
  founder: PublicPrice;
  free: PublicPrice;
  month: PublicPrice;
  storage20Gb12M: PublicPrice;
  storage5Gb12M: PublicPrice;
  year: PublicPrice;
}

export interface PublicPricing {
  country: string | null;
  currency: PricingCurrency;
  discountPercent: number | null;
  founderState: FounderCapacityState;
  prices: PublicPricingPrices;
  regional: boolean;
}

export interface PricingConfig {
  aiCredits1000BrlCents: number;
  aiCredits1000UsdCents: number;
  founderBrlCents: number;
  founderUsdCents: number;
  monthlyBrlCents: number;
  monthlyUsdCents: number;
  storage20Gb12MBrlCents: number;
  storage20Gb12MUsdCents: number;
  storage5Gb12MBrlCents: number;
  storage5Gb12MUsdCents: number;
  yearlyBrlCents: number;
  yearlyUsdCents: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isPublicPrice(value: unknown): value is PublicPrice {
  if (!isRecord(value)) return false;
  return Number.isInteger(value.amount)
    && Number(value.amount) >= 0
    && (value.originalAmount === null
      || (Number.isInteger(value.originalAmount) && Number(value.originalAmount) > Number(value.amount)));
}

export function isPublicPricing(value: unknown): value is PublicPricing {
  if (!isRecord(value) || !isRecord(value.prices)) return false;
  return (value.country === null || typeof value.country === "string")
    && (value.currency === "BRL" || value.currency === "USD")
    && (value.discountPercent === null || Number.isInteger(value.discountPercent))
    && (value.founderState === "available" || value.founderState === "closed" || value.founderState === "sold_out")
    && isPublicPrice(value.prices.aiCredits1000)
    && isPublicPrice(value.prices.founder)
    && isPublicPrice(value.prices.free)
    && isPublicPrice(value.prices.month)
    && isPublicPrice(value.prices.storage20Gb12M)
    && isPublicPrice(value.prices.storage5Gb12M)
    && isPublicPrice(value.prices.year)
    && typeof value.regional === "boolean";
}

function publicPrice(amount: number): PublicPrice {
  return { amount, originalAmount: null };
}

function pricesForBrazil(config: PricingConfig): PublicPricingPrices {
  return {
    aiCredits1000: publicPrice(config.aiCredits1000BrlCents),
    founder: publicPrice(config.founderBrlCents),
    free: publicPrice(0),
    month: publicPrice(config.monthlyBrlCents),
    storage20Gb12M: publicPrice(config.storage20Gb12MBrlCents),
    storage5Gb12M: publicPrice(config.storage5Gb12MBrlCents),
    year: publicPrice(config.yearlyBrlCents),
  };
}

function pricesForGlobal(config: PricingConfig): PublicPricingPrices {
  return {
    aiCredits1000: publicPrice(config.aiCredits1000UsdCents),
    founder: publicPrice(config.founderUsdCents),
    free: publicPrice(0),
    month: publicPrice(config.monthlyUsdCents),
    storage20Gb12M: publicPrice(config.storage20Gb12MUsdCents),
    storage5Gb12M: publicPrice(config.storage5Gb12MUsdCents),
    year: publicPrice(config.yearlyUsdCents),
  };
}

export function pricingForCountry(
  country: string | null,
  config: PricingConfig,
  founderState: FounderCapacityState,
): PublicPricing {
  const normalizedCountry = country?.trim().toUpperCase() || null;
  const regional = normalizedCountry === "BR";
  return {
    country: normalizedCountry,
    currency: regional ? "BRL" : "USD",
    discountPercent: null,
    founderState,
    prices: regional ? pricesForBrazil(config) : pricesForGlobal(config),
    regional,
  };
}
