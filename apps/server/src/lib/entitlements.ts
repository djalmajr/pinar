import type { AccountPlan } from "@pinar/shared";

export type CheckoutOffer =
  | "ai_credits_1000"
  | "lifetime_founder"
  | "pro_month"
  | "pro_year"
  | "storage_20gb_12m"
  | "storage_5gb_12m";

export type StorageState = "available" | "cleanup_eligible" | "grace" | "over_quota" | "recoverable";

export interface StorageEntitlement {
  activeAddOnBytes: number;
  baseBytes: number;
  graceEndsAt: string | null;
  nextExpiryAt: string | null;
  quotaBytes: number;
  recoveryEndsAt: string | null;
  state: StorageState;
  uploadAllowed: boolean;
  usedBytes: number;
}

export interface StorageEntitlementInput {
  activeAddOnBytes: number;
  baseBytes: number;
  latestExpiredAt: string | null;
  nextExpiryAt: string | null;
  now: Date;
  usedBytes: number;
}

export const FREE_AI_CREDITS = 5;
export const FREE_STORAGE_BYTES = 250 * 1024 * 1024;
export const LIFETIME_AI_CREDITS = 500;
export const PAID_STORAGE_BYTES = 5 * 1024 * 1024 * 1024;
export const PRO_MONTHLY_AI_CREDITS = 200;
export const PURCHASED_AI_CREDITS = 1_000;
export const STORAGE_20GB_BYTES = 20 * 1024 * 1024 * 1024;
export const STORAGE_5GB_BYTES = 5 * 1024 * 1024 * 1024;

const DAY_MS = 24 * 60 * 60 * 1000;
export function checkoutOffer(value: unknown): CheckoutOffer | null {
  if (value === "ai_credits_1000"
    || value === "lifetime_founder"
    || value === "pro_month"
    || value === "pro_year"
    || value === "storage_20gb_12m"
    || value === "storage_5gb_12m") return value;
  return null;
}

export function legacyCheckoutOffer(value: unknown): CheckoutOffer {
  if (value === "year") return "pro_year";
  if (value === "lifetime") return "lifetime_founder";
  return "pro_month";
}

export function planForOffer(offer: CheckoutOffer): AccountPlan | null {
  if (offer === "lifetime_founder") return "lifetime";
  if (offer === "pro_month" || offer === "pro_year") return "pro";
  return null;
}

export function isSubscriptionOffer(offer: CheckoutOffer) {
  return offer === "pro_month" || offer === "pro_year";
}

export function addUtcMonths(date: Date, months: number) {
  const next = new Date(date);
  const day = next.getUTCDate();
  next.setUTCDate(1);
  next.setUTCMonth(next.getUTCMonth() + months);
  const lastDay = new Date(Date.UTC(next.getUTCFullYear(), next.getUTCMonth() + 1, 0)).getUTCDate();
  next.setUTCDate(Math.min(day, lastDay));
  return next;
}

export function addUtcYears(date: Date, years: number) {
  return addUtcMonths(date, years * 12);
}

export function baseStorageBytes(plan: AccountPlan) {
  return plan === "free" ? FREE_STORAGE_BYTES : PAID_STORAGE_BYTES;
}

export function storageEntitlement(input: StorageEntitlementInput): StorageEntitlement {
  const quotaBytes = input.baseBytes + input.activeAddOnBytes;
  const uploadAllowed = input.usedBytes < quotaBytes;
  if (input.usedBytes <= quotaBytes) {
    return {
      activeAddOnBytes: input.activeAddOnBytes,
      baseBytes: input.baseBytes,
      graceEndsAt: null,
      nextExpiryAt: input.nextExpiryAt,
      quotaBytes,
      recoveryEndsAt: null,
      state: "available",
      uploadAllowed,
      usedBytes: input.usedBytes,
    };
  }
  if (!input.latestExpiredAt) {
    return {
      activeAddOnBytes: input.activeAddOnBytes,
      baseBytes: input.baseBytes,
      graceEndsAt: null,
      nextExpiryAt: input.nextExpiryAt,
      quotaBytes,
      recoveryEndsAt: null,
      state: "over_quota",
      uploadAllowed: false,
      usedBytes: input.usedBytes,
    };
  }
  const expiredAt = new Date(input.latestExpiredAt);
  const graceEndsAt = new Date(expiredAt.getTime() + 30 * DAY_MS);
  const recoveryEndsAt = new Date(expiredAt.getTime() + 90 * DAY_MS);
  const state = input.now <= graceEndsAt
    ? "grace"
    : input.now <= recoveryEndsAt
      ? "recoverable"
      : "cleanup_eligible";
  return {
    activeAddOnBytes: input.activeAddOnBytes,
    baseBytes: input.baseBytes,
    graceEndsAt: graceEndsAt.toISOString(),
    nextExpiryAt: input.nextExpiryAt,
    quotaBytes,
    recoveryEndsAt: recoveryEndsAt.toISOString(),
    state,
    uploadAllowed: false,
    usedBytes: input.usedBytes,
  };
}

export function canStoreBytes(
  entitlement: StorageEntitlement,
  incomingBytes: number,
  replacedBytes = 0,
) {
  return entitlement.usedBytes - replacedBytes + incomingBytes <= entitlement.quotaBytes;
}
