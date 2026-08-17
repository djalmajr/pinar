export type PricingCurrency = "BRL" | "USD";

export interface PublicPrice {
  amount: number;
  originalAmount: number | null;
}

export interface PublicPricingPrices {
  free: PublicPrice;
  lifetime: PublicPrice;
  month: PublicPrice;
  year: PublicPrice;
}

export interface PublicPricing {
  country: string | null;
  currency: PricingCurrency;
  discountPercent: number | null;
  prices: PublicPricingPrices;
  regional: boolean;
}

export interface PricingConfig {
  brazilDiscountPercent: number;
  brazilExchangeRate: number;
  lifetimeUsdCents: number;
  monthlyUsdCents: number;
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
    && isPublicPrice(value.prices.free)
    && isPublicPrice(value.prices.lifetime)
    && isPublicPrice(value.prices.month)
    && isPublicPrice(value.prices.year)
    && typeof value.regional === "boolean";
}

function regionalAmount(baseAmount: number, exchangeRate: number, discountPercent: number) {
  const discountedAmount = baseAmount * exchangeRate * (1 - discountPercent / 100);
  return Math.ceil((discountedAmount - 90) / 100) * 100 + 90;
}

function brazilPrice(baseAmount: number, config: PricingConfig): PublicPrice {
  return {
    amount: regionalAmount(baseAmount, config.brazilExchangeRate, config.brazilDiscountPercent),
    originalAmount: Math.round(baseAmount * config.brazilExchangeRate),
  };
}

function brazilPrices(config: PricingConfig): PublicPricingPrices {
  return {
    free: { amount: 0, originalAmount: null },
    lifetime: brazilPrice(config.lifetimeUsdCents, config),
    month: brazilPrice(config.monthlyUsdCents, config),
    year: brazilPrice(config.yearlyUsdCents, config),
  };
}

function globalPrices(config: PricingConfig): PublicPricingPrices {
  return {
    free: { amount: 0, originalAmount: null },
    lifetime: { amount: config.lifetimeUsdCents, originalAmount: null },
    month: { amount: config.monthlyUsdCents, originalAmount: null },
    year: { amount: config.yearlyUsdCents, originalAmount: null },
  };
}

export function pricingForCountry(country: string | null, config: PricingConfig): PublicPricing {
  const normalizedCountry = country?.trim().toUpperCase() || null;
  if (normalizedCountry === "BR") {
    return {
      country: normalizedCountry,
      currency: "BRL",
      discountPercent: config.brazilDiscountPercent,
      prices: brazilPrices(config),
      regional: true,
    };
  }
  return {
    country: normalizedCountry,
    currency: "USD",
    discountPercent: null,
    prices: globalPrices(config),
    regional: false,
  };
}
