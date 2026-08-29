-- Structured agent executions and per-pin results. Additive: existing
-- sessions, users, and billing tables are unchanged.
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
