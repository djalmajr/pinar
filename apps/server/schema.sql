-- Cloudflare D1 schema for Pinar accounts, authentication, and captures.
CREATE TABLE users (
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

CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_stripe_customer ON users(stripe_customer_id);

CREATE TABLE installations (
  id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'migrated', 'revoked')),
  migrated_to_user_id TEXT REFERENCES users(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_seen_at TEXT
);

CREATE INDEX idx_installations_status ON installations(status);

CREATE TABLE ai_credit_grants (
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

CREATE INDEX idx_ai_credit_grants_owner_expiry
  ON ai_credit_grants(owner_type, owner_id, expires_at);

CREATE TABLE ai_credit_usages (
  id TEXT PRIMARY KEY,
  request_id TEXT NOT NULL,
  owner_type TEXT NOT NULL CHECK (owner_type IN ('account', 'installation')),
  owner_id TEXT NOT NULL,
  grant_id TEXT NOT NULL REFERENCES ai_credit_grants(id),
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

CREATE TABLE storage_expiry_notices (
  id TEXT PRIMARY KEY,
  storage_grant_id TEXT NOT NULL REFERENCES storage_grants(id),
  days_before INTEGER NOT NULL CHECK (days_before IN (30, 7, 1)),
  scheduled_for TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'skipped')),
  claimed_at TEXT,
  sent_at TEXT,
  last_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (storage_grant_id, days_before)
);

CREATE INDEX idx_storage_expiry_notices_pending
  ON storage_expiry_notices(status, scheduled_for);

CREATE TABLE stripe_events (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  created_at TEXT NOT NULL,
  processed_at TEXT NOT NULL
);

CREATE INDEX idx_stripe_events_processed ON stripe_events(processed_at);

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

CREATE TABLE web_sessions (
  token_hash TEXT PRIMARY KEY,
  owner_type TEXT NOT NULL CHECK (owner_type IN ('account', 'installation')),
  owner_id TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  revoked_at TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX idx_web_sessions_owner ON web_sessions(owner_type, owner_id);
CREATE INDEX idx_web_sessions_expiry ON web_sessions(expires_at);

CREATE TABLE device_sessions (
  id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  user_id TEXT NOT NULL REFERENCES users(id),
  installation_id TEXT NOT NULL REFERENCES installations(id),
  expires_at TEXT NOT NULL,
  revoked_at TEXT,
  created_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL
);

CREATE INDEX idx_device_sessions_user ON device_sessions(user_id);
CREATE INDEX idx_device_sessions_expiry ON device_sessions(expires_at);

CREATE TABLE extension_codes (
  code_hash TEXT PRIMARY KEY,
  owner_type TEXT NOT NULL CHECK (owner_type IN ('account', 'installation')),
  owner_id TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used_at TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX idx_extension_codes_expiry ON extension_codes(expires_at);

CREATE TABLE email_challenges (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  code_hash TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  expires_at TEXT NOT NULL,
  used_at TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX idx_email_challenges_user ON email_challenges(user_id, created_at DESC);
CREATE INDEX idx_email_challenges_expiry ON email_challenges(expires_at);

CREATE TABLE auth_rate_limits (
  action TEXT NOT NULL,
  scope_hash TEXT NOT NULL,
  window_started_at TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (action, scope_hash)
);

CREATE TABLE projects (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  name TEXT NOT NULL,
  icon TEXT NOT NULL DEFAULT 'folder-kanban',
  position INTEGER NOT NULL DEFAULT 0,
  is_protected INTEGER NOT NULL DEFAULT 0 CHECK (is_protected IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX idx_projects_owner_position ON projects(owner_id, position);

CREATE TABLE collections (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  owner_id TEXT NOT NULL,
  parent_id TEXT REFERENCES collections(id),
  name TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 0,
  is_protected INTEGER NOT NULL DEFAULT 0 CHECK (is_protected IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX idx_collections_owner ON collections(owner_id);
CREATE INDEX idx_collections_project_position ON collections(project_id, parent_id, position);

CREATE TABLE sessions (
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
  retention_expires_at TEXT,
  include_screenshot INTEGER NOT NULL DEFAULT 1 CHECK (include_screenshot IN (0, 1))
);

CREATE INDEX idx_sessions_created ON sessions(created_at DESC);
CREATE INDEX idx_sessions_user ON sessions(user_id);
CREATE INDEX idx_sessions_plan ON sessions(plan, is_permanent);
CREATE INDEX idx_sessions_collection_position ON sessions(collection_id, position);
CREATE INDEX idx_sessions_retention_expiry ON sessions(retention_expires_at);

CREATE TABLE agent_executions (
  id TEXT PRIMARY KEY,
  idempotency_key TEXT NOT NULL,
  capture_id TEXT NOT NULL,
  agent TEXT NOT NULL CHECK (agent IN ('cursor', 'claude', 'codex', 'grok')),
  created_at TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  UNIQUE (owner_id, idempotency_key)
);

CREATE INDEX idx_agent_executions_capture ON agent_executions(capture_id, created_at DESC);
CREATE INDEX idx_agent_executions_owner ON agent_executions(owner_id, created_at DESC);

CREATE TABLE agent_pin_results (
  id TEXT PRIMARY KEY,
  execution_id TEXT NOT NULL REFERENCES agent_executions(id) ON DELETE CASCADE,
  pin_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('changed', 'not_located', 'blocked', 'not_applicable')),
  summary TEXT NOT NULL,
  reason TEXT,
  files_json TEXT NOT NULL DEFAULT '[]',
  commit_ref TEXT,
  pull_request TEXT,
  created_at TEXT NOT NULL,
  UNIQUE (execution_id, pin_id)
);

CREATE INDEX idx_agent_pin_results_execution ON agent_pin_results(execution_id);

CREATE TABLE pin_reviews (
  capture_id TEXT NOT NULL,
  pin_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('open', 'correction_ready', 'accepted', 'reopened')),
  updated_at TEXT NOT NULL,
  last_execution_id TEXT,
  PRIMARY KEY (capture_id, pin_id)
);

CREATE INDEX idx_pin_reviews_status ON pin_reviews(status, capture_id);

CREATE TABLE pin_review_events (
  id TEXT PRIMARY KEY,
  capture_id TEXT NOT NULL,
  pin_id TEXT NOT NULL,
  actor_type TEXT NOT NULL CHECK (actor_type IN ('agent', 'human')),
  actor_id TEXT NOT NULL,
  origin TEXT NOT NULL CHECK (origin IN ('agent_result', 'human')),
  from_status TEXT NOT NULL CHECK (from_status IN ('open', 'correction_ready', 'accepted', 'reopened')),
  to_status TEXT NOT NULL CHECK (to_status IN ('open', 'correction_ready', 'accepted', 'reopened')),
  execution_id TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX idx_pin_review_events_pin ON pin_review_events(capture_id, pin_id, created_at ASC);

CREATE TABLE loop_metrics (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  event TEXT NOT NULL CHECK (event IN ('handoff', 'correction_ready', 'accepted', 'reopened', 'relocation_failed')),
  duration_ms INTEGER,
  agent TEXT,
  location_confidence TEXT,
  degraded INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE INDEX idx_loop_metrics_owner_created ON loop_metrics(owner_id, created_at ASC);

CREATE TABLE owner_preferences (
  owner_id TEXT PRIMARY KEY,
  include_screenshot INTEGER NOT NULL DEFAULT 1 CHECK (include_screenshot IN (0, 1)),
  updated_at TEXT NOT NULL
);
