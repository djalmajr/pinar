-- Pin review workflow: open → correction_ready → accepted, and accepted → reopened.
CREATE TABLE pin_reviews (
  capture_id TEXT NOT NULL,
  pin_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('open', 'correction_ready', 'accepted', 'reopened')),
  updated_at TEXT NOT NULL,
  last_execution_id TEXT,
  PRIMARY KEY (capture_id, pin_id)
);

CREATE INDEX idx_pin_reviews_status ON pin_reviews(status, capture_id);

CREATE TABLE pin_review_events (
  id TEXT PRIMARY KEY,
  capture_id TEXT NOT NULL,
  pin_id TEXT NOT NULL,
  actor_type TEXT NOT NULL CHECK (actor_type IN ('agent', 'human')),
  actor_id TEXT NOT NULL,
  origin TEXT NOT NULL CHECK (origin IN ('agent_result', 'human')),
  from_status TEXT NOT NULL CHECK (from_status IN ('open', 'correction_ready', 'accepted', 'reopened')),
  to_status TEXT NOT NULL CHECK (to_status IN ('open', 'correction_ready', 'accepted', 'reopened')),
  execution_id TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX idx_pin_review_events_pin ON pin_review_events(capture_id, pin_id, created_at ASC);
