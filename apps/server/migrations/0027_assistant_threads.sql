-- In-app assistant conversations, one owner per thread.
CREATE TABLE assistant_threads (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_assistant_threads_owner_updated ON assistant_threads(owner_id, updated_at DESC);
CREATE TABLE assistant_messages (
  id TEXT PRIMARY KEY,
  thread_id TEXT NOT NULL REFERENCES assistant_threads(id) ON DELETE CASCADE,
  owner_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  text TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('final', 'error')),
  error_code TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_assistant_messages_thread_created ON assistant_messages(thread_id, created_at);
