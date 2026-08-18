-- Preserve the latest known state for each Stripe subscription so webhook
-- redelivery and out-of-order delivery cannot regress account entitlements.
CREATE TABLE stripe_subscription_states (
  subscription_id TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('active', 'canceled', 'past_due')),
  event_created INTEGER NOT NULL CHECK (event_created > 0),
  event_id TEXT NOT NULL UNIQUE,
  updated_at TEXT NOT NULL
);

CREATE INDEX idx_stripe_subscription_states_customer
  ON stripe_subscription_states(customer_id, event_created DESC);
