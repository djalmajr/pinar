-- Additive billing schema for databases that already applied 0001_initial.sql.
ALTER TABLE users ADD COLUMN ai_credit_refill_at TEXT;

CREATE TABLE ai_credit_grants (
  id TEXT PRIMARY KEY,
  owner_type TEXT NOT NULL CHECK (owner_type IN ('account', 'installation')),
  owner_id TEXT NOT NULL,
  source_type TEXT NOT NULL CHECK (source_type IN ('free_initial', 'pro_monthly', 'lifetime_initial', 'purchase')),
  source_id TEXT NOT NULL UNIQUE,
  credits INTEGER NOT NULL CHECK (credits > 0),
  consumed_credits INTEGER NOT NULL DEFAULT 0,
  expires_at TEXT,
  created_at TEXT NOT NULL,
  CHECK (consumed_credits >= 0 AND consumed_credits <= credits)
);

CREATE INDEX idx_ai_credit_grants_owner_expiry
  ON ai_credit_grants(owner_type, owner_id, expires_at);

CREATE TABLE storage_grants (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  source_type TEXT NOT NULL CHECK (source_type IN ('storage_5gb_12m', 'storage_20gb_12m')),
  source_id TEXT NOT NULL UNIQUE,
  byte_count INTEGER NOT NULL CHECK (byte_count > 0),
  starts_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX idx_storage_grants_user_expiry ON storage_grants(user_id, expires_at);

CREATE TABLE stripe_events (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  created_at TEXT NOT NULL,
  processed_at TEXT NOT NULL
);

CREATE INDEX idx_stripe_events_processed ON stripe_events(processed_at);
