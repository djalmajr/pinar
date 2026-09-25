const TRIAL_STATES = new Set(["disabled", "legacy", "active", "expired", "paid"]);

export function normalizeCloudTrial(value) {
  if (!value || typeof value !== "object") return null;
  if (!TRIAL_STATES.has(value.state)) return null;
  if (value.startedAt !== null && typeof value.startedAt !== "string") return null;
  if (value.endsAt !== null && typeof value.endsAt !== "string") return null;
  if (typeof value.uploadAllowed !== "boolean") return null;
  return {
    endsAt: value.endsAt,
    startedAt: value.startedAt,
    state: value.state,
    uploadAllowed: value.uploadAllowed,
  };
}

export function formatTrialEnd(endsAt, language) {
  if (typeof endsAt !== "string" || !endsAt) return null;
  const time = Date.parse(endsAt);
  if (!Number.isFinite(time)) return null;
  return new Intl.DateTimeFormat(language || "en", { dateStyle: "medium" }).format(new Date(time));
}

export function accountTypeLabel(plan, trial, messages, language) {
  if (trial?.state === "active") {
    const date = formatTrialEnd(trial.endsAt, language);
    if (date) return messages.account_trial_until.replaceAll("{date}", date);
    return messages.account_trial_active;
  }
  if (trial?.state === "expired") return messages.account_trial_expired_title;
  return String(plan || "").toUpperCase();
}

export function cloudSubscriptionRequired(status, body) {
  return status === 402 && body?.code === "cloud_subscription_required";
}
