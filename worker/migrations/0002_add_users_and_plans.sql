-- Create users table
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE,
  license_key TEXT UNIQUE,
  plan TEXT DEFAULT 'free',
  stripe_customer_id TEXT,
  stripe_subscription_id TEXT,
  status TEXT DEFAULT 'active',
  storage_limit_mb INTEGER DEFAULT 5120,
  storage_used_bytes INTEGER DEFAULT 0,
  created_at TEXT,
  updated_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_users_license ON users(license_key);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_stripe ON users(stripe_customer_id);

-- Alter sessions table
ALTER TABLE sessions ADD COLUMN user_id TEXT;
ALTER TABLE sessions ADD COLUMN plan TEXT DEFAULT 'free';
ALTER TABLE sessions ADD COLUMN is_permanent INTEGER DEFAULT 0;
ALTER TABLE sessions ADD COLUMN byte_size INTEGER DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_plan ON sessions(plan, is_permanent);
