export type CloudTrialState = "disabled" | "legacy" | "active" | "expired" | "paid";

export interface CloudTrial {
  endsAt: string | null;
  startedAt: string | null;
  state: CloudTrialState;
  uploadAllowed: boolean;
}

export function normalizeCloudTrial(value: unknown): CloudTrial | null;
export function formatTrialEnd(endsAt: string | null, language: string): string | null;
export function accountTypeLabel(
  plan: string,
  trial: CloudTrial | null,
  messages: {
    account_trial_active: string;
    account_trial_until: string;
    account_trial_expired_title: string;
  },
  language: string,
): string;
export function cloudSubscriptionRequired(status: number, body: { code?: string } | null | undefined): boolean;
