-- A53: the capture's automatic destination (capture filing) charges one
-- credit when it calls the engine (decisions or similarity), like the voice
-- and the assistant. The CHECK of ai_credit_usages did not accept the
-- capture_filing feature, so the table is rebuilt the way 0031 and 0019
-- did: backup → drop → create → copy → indexes → triggers. The triggers
-- come after the copy, so copied reserved rows are not charged again; the
-- grants are not touched.
PRAGMA defer_foreign_keys = on;

CREATE TABLE ai_credit_usages_backup AS SELECT * FROM ai_credit_usages;
DROP TABLE ai_credit_usages;

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
    'voice_pin',
    'assistant_turn',
    'capture_filing'
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
