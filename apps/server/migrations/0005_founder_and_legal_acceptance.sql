-- Add the Pinar Founder plan without invalidating existing Lifetime records.
-- D1 migrations run transactionally; defer foreign-key checks while rebuilding
-- tables whose CHECK constraints need to accept the new plan/source values.
PRAGMA defer_foreign_keys = true;

CREATE TABLE users_founder_migration (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL COLLATE NOCASE UNIQUE,
  plan TEXT NOT NULL DEFAULT 'free' CHECK (plan IN ('free', 'pro', 'founder', 'lifetime')),
  ever_paid INTEGER NOT NULL DEFAULT 0 CHECK (ever_paid IN (0, 1)),
  billing_status TEXT NOT NULL DEFAULT 'active' CHECK (billing_status IN ('active', 'canceled', 'past_due')),
  stripe_customer_id TEXT UNIQUE,
  stripe_subscription_id TEXT UNIQUE,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  ai_credit_refill_at TEXT,
  paid_eligibility_ended_at TEXT
);

INSERT INTO users_founder_migration (
  id, email, plan, ever_paid, billing_status, stripe_customer_id,
  stripe_subscription_id, created_at, updated_at, ai_credit_refill_at
)
SELECT
  id, email, plan, ever_paid, billing_status, stripe_customer_id,
  stripe_subscription_id, created_at, updated_at, ai_credit_refill_at
FROM users;

DROP TABLE users;
ALTER TABLE users_founder_migration RENAME TO users;
CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_stripe_customer ON users(stripe_customer_id);

CREATE TABLE sessions_founder_migration (
  id TEXT PRIMARY KEY,
  url TEXT,
  title TEXT,
  shot_id TEXT,
  shot_url TEXT,
  pin_count INTEGER NOT NULL DEFAULT 0,
  pins_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  user_id TEXT NOT NULL,
  plan TEXT NOT NULL DEFAULT 'free' CHECK (plan IN ('free', 'pro', 'founder', 'lifetime')),
  is_permanent INTEGER NOT NULL DEFAULT 0 CHECK (is_permanent IN (0, 1)),
  byte_size INTEGER NOT NULL DEFAULT 0,
  collection_id TEXT REFERENCES collections(id),
  position INTEGER NOT NULL DEFAULT 0,
  retention_expires_at TEXT
);

INSERT INTO sessions_founder_migration (
  id, url, title, shot_id, shot_url, pin_count, pins_json, created_at,
  user_id, plan, is_permanent, byte_size, collection_id, position
)
SELECT
  id, url, title, shot_id, shot_url, pin_count, pins_json, created_at,
  user_id, plan, is_permanent, byte_size, collection_id, position
FROM sessions;

DROP TABLE sessions;
ALTER TABLE sessions_founder_migration RENAME TO sessions;
CREATE INDEX idx_sessions_created ON sessions(created_at DESC);
CREATE INDEX idx_sessions_user ON sessions(user_id);
CREATE INDEX idx_sessions_plan ON sessions(plan, is_permanent);
CREATE INDEX idx_sessions_collection_position ON sessions(collection_id, position);
CREATE INDEX idx_sessions_retention_expiry ON sessions(retention_expires_at);

-- D1 validates trigger bodies and foreign keys while dropping a referenced
-- table. Rebuild the child usage table alongside its grants so existing usage
-- rows, foreign keys, indexes, and atomic credit triggers all survive.
DROP TRIGGER consume_ai_credit_usage;
DROP TRIGGER refund_ai_credit_usage;

CREATE TABLE ai_credit_grants_founder_migration (
  id TEXT PRIMARY KEY,
  owner_type TEXT NOT NULL CHECK (owner_type IN ('account', 'installation')),
  owner_id TEXT NOT NULL,
  source_type TEXT NOT NULL CHECK (
    source_type IN ('free_initial', 'pro_monthly', 'founder_initial', 'lifetime_initial', 'purchase')
  ),
  source_id TEXT NOT NULL UNIQUE,
  credits INTEGER NOT NULL CHECK (credits > 0),
  consumed_credits INTEGER NOT NULL DEFAULT 0,
  expires_at TEXT,
  created_at TEXT NOT NULL,
  CHECK (consumed_credits >= 0 AND consumed_credits <= credits)
);

INSERT INTO ai_credit_grants_founder_migration (
  id, owner_type, owner_id, source_type, source_id, credits,
  consumed_credits, expires_at, created_at
)
SELECT
  id, owner_type, owner_id, source_type, source_id, credits,
  consumed_credits, expires_at, created_at
FROM ai_credit_grants;

CREATE TABLE ai_credit_usages_founder_migration (
  id TEXT PRIMARY KEY,
  request_id TEXT NOT NULL,
  owner_type TEXT NOT NULL CHECK (owner_type IN ('account', 'installation')),
  owner_id TEXT NOT NULL,
  grant_id TEXT NOT NULL REFERENCES ai_credit_grants_founder_migration(id),
  feature TEXT NOT NULL CHECK (feature IN ('session_summary')),
  resource_id TEXT NOT NULL,
  model TEXT NOT NULL,
  credits INTEGER NOT NULL CHECK (credits > 0),
  status TEXT NOT NULL CHECK (status IN ('reserved', 'succeeded', 'refunded')),
  input_tokens INTEGER,
  output_tokens INTEGER,
  cost_usd_micros INTEGER,
  result_json TEXT,
  error_code TEXT,
  created_at TEXT NOT NULL,
  completed_at TEXT,
  UNIQUE (owner_type, owner_id, request_id)
);

INSERT INTO ai_credit_usages_founder_migration (
  id, request_id, owner_type, owner_id, grant_id, feature, resource_id,
  model, credits, status, input_tokens, output_tokens, cost_usd_micros,
  result_json, error_code, created_at, completed_at
)
SELECT
  id, request_id, owner_type, owner_id, grant_id, feature, resource_id,
  model, credits, status, input_tokens, output_tokens, cost_usd_micros,
  result_json, error_code, created_at, completed_at
FROM ai_credit_usages;

DROP TABLE ai_credit_usages;
DROP TABLE ai_credit_grants;
ALTER TABLE ai_credit_grants_founder_migration RENAME TO ai_credit_grants;
ALTER TABLE ai_credit_usages_founder_migration RENAME TO ai_credit_usages;
CREATE INDEX idx_ai_credit_grants_owner_expiry
  ON ai_credit_grants(owner_type, owner_id, expires_at);
CREATE INDEX idx_ai_credit_usages_owner_created
  ON ai_credit_usages(owner_type, owner_id, created_at DESC);
CREATE INDEX idx_ai_credit_usages_status_created
  ON ai_credit_usages(status, created_at);

CREATE TRIGGER consume_ai_credit_usage
BEFORE INSERT ON ai_credit_usages
WHEN NEW.status = 'reserved'
BEGIN
  UPDATE ai_credit_grants
  SET consumed_credits = consumed_credits + NEW.credits
  WHERE id = NEW.grant_id
    AND owner_type = NEW.owner_type
    AND owner_id = NEW.owner_id
    AND credits - consumed_credits >= NEW.credits
    AND (expires_at IS NULL OR expires_at > NEW.created_at);
  SELECT (CASE WHEN changes() <> 1 THEN RAISE(ABORT, 'insufficient_ai_credits') END);
END;

CREATE TRIGGER refund_ai_credit_usage
AFTER UPDATE OF status ON ai_credit_usages
WHEN OLD.status = 'reserved' AND NEW.status = 'refunded'
BEGIN
  UPDATE ai_credit_grants
  SET consumed_credits = consumed_credits - OLD.credits
  WHERE id = OLD.grant_id
    AND consumed_credits >= OLD.credits;
  SELECT (CASE WHEN changes() <> 1 THEN RAISE(ABORT, 'ai_credit_refund_failed') END);
END;

CREATE TABLE founder_reservations (
  id TEXT PRIMARY KEY,
  checkout_request_id TEXT NOT NULL UNIQUE,
  claim_hash TEXT NOT NULL,
  checkout_session_id TEXT UNIQUE,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'confirmed', 'released')),
  expires_at TEXT NOT NULL,
  confirmed_at TEXT,
  released_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX idx_founder_reservations_capacity
  ON founder_reservations(status, expires_at);

CREATE TABLE founder_purchases (
  id TEXT PRIMARY KEY,
  reservation_id TEXT NOT NULL UNIQUE REFERENCES founder_reservations(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  checkout_session_id TEXT NOT NULL UNIQUE,
  stripe_customer_id TEXT NOT NULL,
  purchased_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX idx_founder_purchases_user ON founder_purchases(user_id);

CREATE TRIGGER confirm_founder_purchase
AFTER INSERT ON founder_purchases
BEGIN
  UPDATE founder_reservations
  SET status = 'confirmed', confirmed_at = NEW.purchased_at, updated_at = NEW.purchased_at
  WHERE id = NEW.reservation_id
    AND status = 'active'
    AND checkout_session_id = NEW.checkout_session_id;
  SELECT (CASE WHEN changes() <> 1 THEN RAISE(ABORT, 'founder_reservation_not_active') END);
END;

CREATE TABLE legal_acceptances (
  id TEXT PRIMARY KEY,
  owner_type TEXT NOT NULL CHECK (owner_type IN ('account', 'installation')),
  owner_id TEXT NOT NULL,
  terms_version TEXT NOT NULL,
  privacy_version TEXT NOT NULL,
  acceptable_use_version TEXT NOT NULL,
  locale TEXT NOT NULL CHECK (locale IN ('en', 'pt')),
  source TEXT NOT NULL CHECK (source IN ('account', 'checkout', 'remote_free')),
  evidence_id TEXT,
  accepted_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (owner_type, owner_id, terms_version)
);

CREATE INDEX idx_legal_acceptances_owner
  ON legal_acceptances(owner_type, owner_id, accepted_at DESC);
