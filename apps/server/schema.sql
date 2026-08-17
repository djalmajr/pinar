-- Cloudflare D1 schema for Pinar accounts, authentication, and captures.
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL COLLATE NOCASE UNIQUE,
  plan TEXT NOT NULL DEFAULT 'free' CHECK (plan IN ('free', 'pro', 'lifetime')),
  ever_paid INTEGER NOT NULL DEFAULT 0 CHECK (ever_paid IN (0, 1)),
  billing_status TEXT NOT NULL DEFAULT 'active' CHECK (billing_status IN ('active', 'canceled', 'past_due')),
  stripe_customer_id TEXT UNIQUE,
  stripe_subscription_id TEXT UNIQUE,
  ai_credit_refill_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
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
  plan TEXT NOT NULL DEFAULT 'free' CHECK (plan IN ('free', 'pro', 'lifetime')),
  is_permanent INTEGER NOT NULL DEFAULT 0 CHECK (is_permanent IN (0, 1)),
  byte_size INTEGER NOT NULL DEFAULT 0 CHECK (byte_size >= 0),
  collection_id TEXT REFERENCES collections(id),
  position INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX idx_sessions_created ON sessions(created_at DESC);
CREATE INDEX idx_sessions_user ON sessions(user_id);
CREATE INDEX idx_sessions_plan ON sessions(plan, is_permanent);
CREATE INDEX idx_sessions_collection_position ON sessions(collection_id, position);
