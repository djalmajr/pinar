-- F5/S1: the Pro BYOK endpoint (F5 contract §3). The API key never rests in
-- the clear: key_ciphertext is `v1:<key_id>:<iv b64>:<ct b64>` (server/
-- byok/crypto.ts), key_id is the master-key fingerprint that makes rotation
-- possible, and key_last4 is the only part of the key the UI ever sees.
-- capabilities_json holds the per-capability test results of S2 (ok/error
-- and the test date; embeddings the tested dims). Deleting the account
-- deletes the row.
CREATE TABLE byok_endpoints (
  owner_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  base_url TEXT NOT NULL,
  key_ciphertext TEXT NOT NULL,
  key_last4 TEXT NOT NULL,
  key_id TEXT NOT NULL,
  chat_model TEXT NOT NULL,
  embedding_model TEXT NOT NULL,
  transcription_model TEXT NOT NULL,
  capabilities_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
