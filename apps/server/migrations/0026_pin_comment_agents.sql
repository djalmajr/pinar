-- Agent comments join the pin conversation. The actor is either the
-- signed-in owner (human) or an agent API key (agent). SQLite cannot alter
-- a column CHECK in place, so rebuild the table and keep every stored
-- comment, its ids, timestamps, and the capture index.
CREATE TABLE pin_comments_new (
  id TEXT PRIMARY KEY,
  capture_id TEXT NOT NULL,
  pin_id TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  actor_label TEXT NOT NULL,
  actor_type TEXT NOT NULL CHECK (actor_type IN ('agent', 'human')),
  body TEXT NOT NULL,
  created_at TEXT NOT NULL
);

INSERT INTO pin_comments_new (
  id, capture_id, pin_id, actor_id, actor_label, actor_type, body, created_at
)
SELECT id, capture_id, pin_id, actor_id, actor_label, actor_type, body, created_at
FROM pin_comments;

DROP TABLE pin_comments;
ALTER TABLE pin_comments_new RENAME TO pin_comments;

CREATE INDEX idx_pin_comments_capture ON pin_comments(capture_id, created_at ASC);
