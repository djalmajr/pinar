-- Add the new 1 GB offer while keeping historical 5 GB and 20 GB grants readable.
PRAGMA defer_foreign_keys = on;

CREATE TABLE storage_expiry_notices_backup AS SELECT * FROM storage_expiry_notices;
DROP TABLE storage_expiry_notices;

CREATE TABLE storage_grants_new (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  source_type TEXT NOT NULL CHECK (
    source_type IN ('storage_1gb_12m', 'storage_5gb_12m', 'storage_20gb_12m')
  ),
  source_id TEXT NOT NULL UNIQUE,
  byte_count INTEGER NOT NULL CHECK (byte_count > 0),
  starts_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);
INSERT INTO storage_grants_new SELECT * FROM storage_grants;
DROP TABLE storage_grants;
ALTER TABLE storage_grants_new RENAME TO storage_grants;
CREATE INDEX idx_storage_grants_user_expiry ON storage_grants(user_id, expires_at);

CREATE TABLE storage_expiry_notices (
  id TEXT PRIMARY KEY,
  storage_grant_id TEXT NOT NULL REFERENCES storage_grants(id),
  days_before INTEGER NOT NULL CHECK (days_before IN (30, 7, 1)),
  scheduled_for TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'skipped')),
  claimed_at TEXT,
  sent_at TEXT,
  last_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (storage_grant_id, days_before)
);
INSERT INTO storage_expiry_notices SELECT * FROM storage_expiry_notices_backup;
DROP TABLE storage_expiry_notices_backup;
CREATE INDEX idx_storage_expiry_notices_pending
  ON storage_expiry_notices(status, scheduled_for);

PRAGMA defer_foreign_keys = off;
