-- Assistant write proposals: nothing runs before the owner confirms.
CREATE TABLE assistant_proposals (
  id TEXT PRIMARY KEY,
  thread_id TEXT NOT NULL REFERENCES assistant_threads(id) ON DELETE CASCADE,
  owner_id TEXT NOT NULL,
  message_id TEXT NOT NULL,
  tool TEXT NOT NULL,
  args_json TEXT NOT NULL,
  display_json TEXT NOT NULL,
  summary TEXT NOT NULL,
  risk TEXT NOT NULL CHECK (risk IN ('reversible', 'irreversible', 'external')),
  fingerprint TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('proposed', 'executing', 'executed', 'failed', 'rejected', 'expired', 'undoing', 'undone')),
  error_code TEXT,
  result_json TEXT,
  undo_json TEXT,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  executed_at TEXT,
  undo_expires_at TEXT,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_assistant_proposals_thread_created ON assistant_proposals(thread_id, created_at);
ALTER TABLE assistant_messages ADD COLUMN ask_json TEXT;
