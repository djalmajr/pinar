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
