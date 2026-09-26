CREATE TABLE agent_api_keys (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  token_prefix TEXT NOT NULL,
  resource_type TEXT NOT NULL CHECK (resource_type IN ('account', 'project', 'collection', 'session', 'batch')),
  resource_id TEXT,
  permission TEXT NOT NULL DEFAULT 'read' CHECK (permission IN ('read', 'manage', 'share', 'full')),
  expires_at TEXT NOT NULL,
  revoked_at TEXT,
  created_at TEXT NOT NULL,
  last_used_at TEXT,
  CHECK ((resource_type = 'account' AND resource_id IS NULL) OR (resource_type <> 'account' AND resource_id IS NOT NULL))
);

CREATE INDEX idx_agent_api_keys_account ON agent_api_keys(account_id, created_at DESC);
CREATE INDEX idx_agent_api_keys_active ON agent_api_keys(account_id, revoked_at, expires_at);
