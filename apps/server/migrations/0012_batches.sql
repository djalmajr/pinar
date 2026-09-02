-- Capture batches are attributes of sessions captured together, not collections.
CREATE TABLE batches (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  label TEXT NOT NULL,
  started_at TEXT NOT NULL,
  finished_at TEXT
);

CREATE INDEX idx_batches_user_started ON batches(user_id, started_at DESC);

ALTER TABLE sessions ADD COLUMN batch_id TEXT;

CREATE INDEX idx_sessions_user_batch ON sessions(user_id, batch_id);
