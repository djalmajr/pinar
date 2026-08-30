-- Live delivery preference for agent copy and public .md URLs.
CREATE TABLE owner_preferences (
  owner_id TEXT PRIMARY KEY,
  include_screenshot INTEGER NOT NULL DEFAULT 1 CHECK (include_screenshot IN (0, 1)),
  updated_at TEXT NOT NULL
);
