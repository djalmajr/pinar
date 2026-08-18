const DAY_MS = 24 * 60 * 60 * 1000;

export const FREE_CLOUD_RETENTION_DAYS = 7;
export const PAID_RECOVERY_DAYS = 90;

export function laterExpiry(left: string | null, right: string | null) {
  if (!left) return right;
  if (!right) return left;
  return left > right ? left : right;
}

export function paidRetentionExpiresAt(eligibilityEndedAt: string) {
  const endedAt = new Date(eligibilityEndedAt);
  if (Number.isNaN(endedAt.getTime())) return null;
  return new Date(endedAt.getTime() + PAID_RECOVERY_DAYS * DAY_MS).toISOString();
}
