-- Add explicit share tokens for cloud content. Resources are private by default;
-- anonymous access requires an active share token. Existing resources WITHOUT
-- share tokens will no longer be accessible via their internal IDs (fail-closed).
-- Users must explicitly publish to create a share token.

CREATE TABLE share_tokens (
  id TEXT PRIMARY KEY,
  token TEXT NOT NULL UNIQUE,
  resource_type TEXT NOT NULL CHECK (resource_type IN ('session', 'project', 'collection', 'batch')),
  resource_id TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked')),
  expires_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX idx_share_tokens_token ON share_tokens(token);
CREATE INDEX idx_share_tokens_resource ON share_tokens(resource_type, resource_id);
CREATE INDEX idx_share_tokens_owner ON share_tokens(owner_id, created_at DESC);
CREATE INDEX idx_share_tokens_expiry ON share_tokens(expires_at);

-- For each resource, only one active non-expired share token should exist at a time.
-- This ensures clean revocation and republishing.
CREATE UNIQUE INDEX idx_share_tokens_active_resource 
  ON share_tokens(resource_type, resource_id) 
  WHERE status = 'active';
