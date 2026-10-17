-- Pin retrieval index (F3): one entry per pin, written per session by the
-- assistant indexer. owner_id is the session owner; every read filters by it.
CREATE TABLE pin_index (
  session_id TEXT NOT NULL,
  pin_id TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  number INTEGER NOT NULL,
  model TEXT NOT NULL,
  vector BLOB,
  doc_text TEXT NOT NULL,
  doc_hash TEXT NOT NULL,
  truncated INTEGER NOT NULL DEFAULT 0,
  caption TEXT,
  ocr TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (session_id, pin_id)
);
CREATE INDEX idx_pin_index_owner ON pin_index(owner_id, session_id);
