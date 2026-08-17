-- Atomic AI credit consumption plus durable inference telemetry.
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
  SELECT CASE WHEN changes() <> 1 THEN RAISE(ABORT, 'insufficient_ai_credits') END;
END;

CREATE TRIGGER refund_ai_credit_usage
AFTER UPDATE OF status ON ai_credit_usages
WHEN OLD.status = 'reserved' AND NEW.status = 'refunded'
BEGIN
  UPDATE ai_credit_grants
  SET consumed_credits = consumed_credits - OLD.credits
  WHERE id = OLD.grant_id
    AND consumed_credits >= OLD.credits;
  SELECT CASE WHEN changes() <> 1 THEN RAISE(ABORT, 'ai_credit_refund_failed') END;
END;

-- Delivery ledger for the 30, 7, and 1 day storage-expiry notices.
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
