import type { AccountAuthSession, AccountPlan, InstallationAuthSession } from "@pinar/shared";
import { isRecord } from "./api-data";

export interface AccountMenuIdentity {
  detail: string;
  initials: string;
  name: string;
}

export interface AccountUsageSummary {
  aiCredits: number;
  aiCreditsExpireAt: string | null;
  aiCreditsRefillAt: string | null;
  plan: AccountPlan;
  storageExpireAt: string | null;
  storageQuotaBytes: number;
  storageUsedBytes: number;
}

function titleCaseEmailName(email: string) {
  const localPart = email.split("@", 1)[0]?.trim() || email;
  return localPart
    .replace(/[._-]+/g, " ")
    .replace(/\b\p{L}/gu, (letter) => letter.toLocaleUpperCase());
}

function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toLocaleUpperCase() || "P";
}

export function accountMenuIdentity(
  session: AccountAuthSession | InstallationAuthSession,
  freeName: string,
  freeDetail: string,
): AccountMenuIdentity {
  if (session.kind === "account") {
    const name = titleCaseEmailName(session.email);
    return { detail: session.email, initials: initials(name), name };
  }

  return { detail: freeDetail, initials: "PF", name: freeName };
}

function entitlementDate(value: unknown) {
  if (value === null) return null;
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) return undefined;
  return value;
}

export function accountUsageSummary(value: unknown): AccountUsageSummary | null {
  if (!isRecord(value) || !isRecord(value.aiCredits) || !isRecord(value.storage)) return null;
  const plan = value.plan;
  const balance = value.aiCredits.balance;
  const creditsExpireAt = entitlementDate(value.aiCredits.nextExpiryAt);
  const creditsRefillAt = entitlementDate(value.aiCredits.nextRefillAt);
  const quotaBytes = value.storage.quotaBytes;
  const storageExpireAt = entitlementDate(value.storage.nextExpiryAt);
  const usedBytes = value.storage.usedBytes;
  if (plan !== "founder" && plan !== "free" && plan !== "lifetime" && plan !== "pro") return null;
  if (!Number.isFinite(balance) || !Number.isFinite(quotaBytes) || !Number.isFinite(usedBytes)) return null;
  if (creditsExpireAt === undefined || creditsRefillAt === undefined || storageExpireAt === undefined) return null;
  return {
    aiCredits: Math.max(0, Number(balance)),
    aiCreditsExpireAt: creditsExpireAt,
    aiCreditsRefillAt: creditsRefillAt,
    plan,
    storageExpireAt,
    storageQuotaBytes: Math.max(0, Number(quotaBytes)),
    storageUsedBytes: Math.max(0, Number(usedBytes)),
  };
}

export function formatByteSize(bytes: number, locale: string) {
  const safeBytes = Math.max(0, bytes);
  const units = ["B", "KB", "MB", "GB", "TB"];
  const unitIndex = safeBytes === 0
    ? 0
    : Math.min(Math.floor(Math.log(safeBytes) / Math.log(1024)), units.length - 1);
  const value = safeBytes / 1024 ** unitIndex;
  return `${new Intl.NumberFormat(locale, {
    maximumFractionDigits: unitIndex > 0 && value < 10 ? 1 : 0,
  }).format(value)} ${units[unitIndex]}`;
}

export function formatEntitlementDate(isoDate: string, locale: string) {
  return new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeZone: "UTC",
  }).format(new Date(isoDate));
}

export function storageUsagePercent(summary: AccountUsageSummary) {
  if (summary.storageQuotaBytes <= 0) return 0;
  return Math.min(100, Math.max(0, summary.storageUsedBytes / summary.storageQuotaBytes * 100));
}
