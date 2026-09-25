import type { AccountPlan } from "@pinar/shared";

const TRIAL_DAYS = 14;
const DAY_MS = 24 * 60 * 60 * 1_000;

export type CloudTrialState = "disabled" | "legacy" | "active" | "expired" | "paid";

export interface CloudTrialAccess {
  endsAt: string | null;
  startedAt: string | null;
  state: CloudTrialState;
  uploadAllowed: boolean;
}

export function newCloudTrialWindow(now: Date) {
  return {
    endsAt: new Date(now.getTime() + TRIAL_DAYS * DAY_MS).toISOString(),
    startedAt: now.toISOString(),
  };
}

export function cloudTrialAccess(input: {
  enabled: boolean;
  endsAt: string | null;
  now: Date;
  plan: AccountPlan;
  startedAt: string | null;
}): CloudTrialAccess {
  const { endsAt, startedAt } = input;
  if (!input.enabled) return { endsAt, startedAt, state: "disabled", uploadAllowed: true };
  if (input.plan !== "free") return { endsAt, startedAt, state: "paid", uploadAllowed: true };
  if (!startedAt && !endsAt) return { endsAt: null, startedAt: null, state: "legacy", uploadAllowed: true };

  const expiry = endsAt ? Date.parse(endsAt) : Number.NaN;
  const active = Boolean(startedAt) && Number.isFinite(expiry) && input.now.getTime() < expiry;
  return { endsAt, startedAt, state: active ? "active" : "expired", uploadAllowed: active };
}
