CREATE TABLE email_challenges_new (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL COLLATE NOCASE,
  user_id TEXT REFERENCES users(id),
  code_hash TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  expires_at TEXT NOT NULL,
  used_at TEXT,
  created_at TEXT NOT NULL
);

INSERT INTO email_challenges_new (id, email, user_id, code_hash, attempts, expires_at, used_at, created_at)
SELECT challenges.id, users.email, challenges.user_id, challenges.code_hash,
  challenges.attempts, challenges.expires_at, challenges.used_at, challenges.created_at
FROM email_challenges AS challenges
JOIN users ON users.id = challenges.user_id;

DROP TABLE email_challenges;
ALTER TABLE email_challenges_new RENAME TO email_challenges;
CREATE INDEX idx_email_challenges_email ON email_challenges(email, created_at DESC);
CREATE INDEX idx_email_challenges_expiry ON email_challenges(expires_at);
