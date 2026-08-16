-- Cloudflare D1 Database schema for Pinar history and subscriptions
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE,
  license_key TEXT UNIQUE,
  plan TEXT DEFAULT 'free',
  stripe_customer_id TEXT,
  stripe_subscription_id TEXT,
  status TEXT DEFAULT 'active',
  storage_limit_mb INTEGER DEFAULT 5120,
  storage_used_bytes INTEGER DEFAULT 0,
  created_at TEXT,
  updated_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_users_license ON users(license_key);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_stripe ON users(stripe_customer_id);

CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  name TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 0,
  is_protected INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_projects_owner_position ON projects(owner_id, position);

CREATE TABLE IF NOT EXISTS collections (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  parent_id TEXT,
  name TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 0,
  is_protected INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_collections_owner ON collections(owner_id);
CREATE INDEX IF NOT EXISTS idx_collections_project_position ON collections(project_id, parent_id, position);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  url TEXT,
  title TEXT,
  shot_id TEXT,
  shot_url TEXT,
  pin_count INTEGER,
  pins_json TEXT,
  created_at TEXT,
  user_id TEXT,
  plan TEXT DEFAULT 'free',
  is_permanent INTEGER DEFAULT 0,
  byte_size INTEGER DEFAULT 0,
  collection_id TEXT,
  position INTEGER DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_sessions_created ON sessions(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_plan ON sessions(plan, is_permanent);
CREATE INDEX IF NOT EXISTS idx_sessions_collection_position ON sessions(collection_id, position);

CREATE TABLE IF NOT EXISTS installations (
  id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_seen_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_installations_status ON installations(status);

CREATE TABLE IF NOT EXISTS browser_tickets (
  token_hash TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  plan TEXT NOT NULL DEFAULT 'free',
  is_permanent INTEGER NOT NULL DEFAULT 0,
  expires_at TEXT NOT NULL,
  used_at TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_browser_tickets_expiry ON browser_tickets(expires_at);

CREATE TABLE IF NOT EXISTS browser_sessions (
  token_hash TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  plan TEXT NOT NULL DEFAULT 'free',
  is_permanent INTEGER NOT NULL DEFAULT 0,
  expires_at TEXT NOT NULL,
  revoked_at TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_browser_sessions_owner ON browser_sessions(owner_id);
CREATE INDEX IF NOT EXISTS idx_browser_sessions_expiry ON browser_sessions(expires_at);
