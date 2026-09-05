export type StripeSubscriptionStatus = "active" | "canceled" | "past_due";

export const UPSERT_STRIPE_SUBSCRIPTION_STATE_SQL =
  "INSERT INTO stripe_subscription_states "
  + "(subscription_id, customer_id, status, event_created, event_id, updated_at) VALUES (?, ?, ?, ?, ?, ?) "
  + "ON CONFLICT(subscription_id) DO UPDATE SET customer_id = excluded.customer_id, "
  + "status = excluded.status, event_created = excluded.event_created, event_id = excluded.event_id, "
  + "updated_at = excluded.updated_at "
  + "WHERE excluded.event_created > stripe_subscription_states.event_created "
  + "OR (excluded.event_created = stripe_subscription_states.event_created "
  + "AND CASE excluded.status WHEN 'canceled' THEN 3 WHEN 'past_due' THEN 2 ELSE 1 END "
  + "> CASE stripe_subscription_states.status WHEN 'canceled' THEN 3 WHEN 'past_due' THEN 2 ELSE 1 END)";

export const APPLY_STRIPE_SUBSCRIPTION_STATE_SQL =
  "UPDATE users SET "
  + "plan = CASE WHEN plan = 'founder' THEN plan "
  + "WHEN (SELECT status FROM stripe_subscription_states WHERE subscription_id = ?) = 'active' "
  + "THEN 'pro' ELSE 'free' END, "
  + "billing_status = (SELECT status FROM stripe_subscription_states WHERE subscription_id = ?), "
  + "ever_paid = 1, stripe_subscription_id = COALESCE(NULLIF(stripe_subscription_id, ''), ?), "
  + "updated_at = ? WHERE stripe_customer_id = ? "
  + "AND (stripe_subscription_id IS NULL OR stripe_subscription_id = '' OR stripe_subscription_id = ?) "
  + "AND EXISTS (SELECT 1 FROM stripe_subscription_states WHERE subscription_id = ?)";

export function stripeSubscriptionStatus(
  eventType: string,
  status: string,
): StripeSubscriptionStatus | null {
  if (eventType === "customer.subscription.deleted" || status === "canceled") return "canceled";
  if (status === "active" || status === "trialing") return "active";
  if (["incomplete", "incomplete_expired", "past_due", "paused", "unpaid"].includes(status)) {
    return "past_due";
  }
  return null;
}

function stripeSubscriptionStatusRank(status: StripeSubscriptionStatus) {
  if (status === "canceled") return 3;
  if (status === "past_due") return 2;
  return 1;
}

interface StripeSubscriptionStateVersion {
  eventCreated: number;
  status: StripeSubscriptionStatus;
}

export function stripeSubscriptionStateShouldReplace(
  existing: StripeSubscriptionStateVersion | undefined,
  incoming: StripeSubscriptionStateVersion,
) {
  return !existing
    || incoming.eventCreated > existing.eventCreated
    || (incoming.eventCreated === existing.eventCreated
      && stripeSubscriptionStatusRank(incoming.status) > stripeSubscriptionStatusRank(existing.status));
}
