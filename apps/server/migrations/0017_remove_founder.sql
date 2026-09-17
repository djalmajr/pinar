-- Retire the unused one-time plan. Stop if real or fixture Founder data exists;
-- never silently convert a paid purchase into a subscription or discard its ledger.
CREATE TABLE founder_removal_guard (
  remaining INTEGER NOT NULL CHECK (remaining = 0)
);
INSERT INTO founder_removal_guard SELECT
  (SELECT COUNT(*) FROM users WHERE plan = 'founder')
  + (SELECT COUNT(*) FROM sessions WHERE plan = 'founder')
  + (SELECT COUNT(*) FROM ai_credit_grants WHERE source_type = 'founder_initial')
  + (SELECT COUNT(*) FROM founder_purchases)
  + (SELECT COUNT(*) FROM founder_reservations WHERE status IN ('active', 'confirmed'));
DROP TABLE founder_removal_guard;

PRAGMA defer_foreign_keys = on;
DROP TRIGGER confirm_founder_purchase;
DROP TABLE founder_purchases;
DROP TABLE founder_reservations;

CREATE TABLE users_new (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL COLLATE NOCASE UNIQUE,
  plan TEXT NOT NULL DEFAULT 'free' CHECK (plan IN ('free', 'pro')),
  ever_paid INTEGER NOT NULL DEFAULT 0 CHECK (ever_paid IN (0, 1)),
  billing_status TEXT NOT NULL DEFAULT 'active' CHECK (billing_status IN ('active', 'canceled', 'past_due')),
  stripe_customer_id TEXT UNIQUE,
  stripe_subscription_id TEXT UNIQUE,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  ai_credit_refill_at TEXT,
  paid_eligibility_ended_at TEXT
);
INSERT INTO users_new SELECT * FROM users;
DROP TABLE users;
ALTER TABLE users_new RENAME TO users;
CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_stripe_customer ON users(stripe_customer_id);

CREATE TABLE sessions_new (
  id TEXT PRIMARY KEY,
  url TEXT,
  title TEXT,
  shot_id TEXT,
  shot_url TEXT,
  pin_count INTEGER NOT NULL DEFAULT 0,
  pins_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  user_id TEXT NOT NULL,
  plan TEXT NOT NULL DEFAULT 'free' CHECK (plan IN ('free', 'pro')),
  is_permanent INTEGER NOT NULL DEFAULT 0 CHECK (is_permanent IN (0, 1)),
  byte_size INTEGER NOT NULL DEFAULT 0,
  collection_id TEXT REFERENCES collections(id),
  position INTEGER NOT NULL DEFAULT 0,
  retention_expires_at TEXT,
  include_screenshot INTEGER NOT NULL DEFAULT 1 CHECK (include_screenshot IN (0, 1)),
  batch_id TEXT
);
INSERT INTO sessions_new SELECT * FROM sessions;
DROP TABLE sessions;
ALTER TABLE sessions_new RENAME TO sessions;
CREATE INDEX idx_sessions_created ON sessions(created_at DESC);
CREATE INDEX idx_sessions_user ON sessions(user_id);
CREATE INDEX idx_sessions_plan ON sessions(plan, is_permanent);
CREATE INDEX idx_sessions_collection_position ON sessions(collection_id, position);
CREATE INDEX idx_sessions_retention_expiry ON sessions(retention_expires_at);
CREATE INDEX idx_sessions_user_batch ON sessions(user_id, batch_id);

-- Copy usages before installing triggers to avoid charging reserved credits twice.
CREATE TABLE ai_credit_usages_backup AS SELECT * FROM ai_credit_usages;
DROP TABLE ai_credit_usages;
CREATE TABLE ai_credit_grants_new (
  id TEXT PRIMARY KEY,
  owner_type TEXT NOT NULL CHECK (owner_type IN ('account', 'installation')),
  owner_id TEXT NOT NULL,
  source_type TEXT NOT NULL CHECK (
    source_type IN ('free_initial', 'pro_monthly', 'purchase')
  ),
  source_id TEXT NOT NULL UNIQUE,
  credits INTEGER NOT NULL CHECK (credits > 0),
  consumed_credits INTEGER NOT NULL DEFAULT 0,
  expires_at TEXT,
  created_at TEXT NOT NULL,
  CHECK (consumed_credits >= 0 AND consumed_credits <= credits)
);
INSERT INTO ai_credit_grants_new SELECT * FROM ai_credit_grants;
DROP TABLE ai_credit_grants;
ALTER TABLE ai_credit_grants_new RENAME TO ai_credit_grants;
CREATE INDEX idx_ai_credit_grants_owner_expiry
  ON ai_credit_grants(owner_type, owner_id, expires_at);

CREATE TABLE ai_credit_usages (
  id TEXT PRIMARY KEY,
  request_id TEXT NOT NULL,
  owner_type TEXT NOT NULL CHECK (owner_type IN ('account', 'installation')),
  owner_id TEXT NOT NULL,
  grant_id TEXT NOT NULL REFERENCES ai_credit_grants(id),
  feature TEXT NOT NULL CHECK (feature IN (
    'session_summary',
    'component_export',
    'pin_diagnosis',
    'design_system',
    'reproduction',
    'voice_pin'
  )),
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
INSERT INTO ai_credit_usages SELECT * FROM ai_credit_usages_backup;
DROP TABLE ai_credit_usages_backup;
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

PRAGMA defer_foreign_keys = off;
