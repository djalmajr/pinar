-- Human comments on a pin. Agent results stay in agent executions.
CREATE TABLE pin_comments (
  id TEXT PRIMARY KEY,
  capture_id TEXT NOT NULL,
  pin_id TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  actor_label TEXT NOT NULL,
  actor_type TEXT NOT NULL CHECK (actor_type = 'human'),
  body TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX idx_pin_comments_capture ON pin_comments(capture_id, created_at ASC);
