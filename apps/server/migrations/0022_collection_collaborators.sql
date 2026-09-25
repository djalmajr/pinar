-- Collection collaborators and invitations. Access is scoped to the invited collection
-- without inheritance to subcollections or siblings.

CREATE TABLE collection_collaborators (
  id TEXT PRIMARY KEY,
  collection_id TEXT NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
  owner_id TEXT NOT NULL,
  email TEXT NOT NULL COLLATE NOCASE,
  user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'revoked')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  accepted_at TEXT,
  revoked_at TEXT
);

CREATE INDEX idx_collab_collection ON collection_collaborators(collection_id);
CREATE INDEX idx_collab_email ON collection_collaborators(email);
CREATE INDEX idx_collab_user ON collection_collaborators(user_id);
CREATE UNIQUE INDEX idx_collab_collection_email_active ON collection_collaborators(collection_id, email) WHERE status IN ('pending', 'accepted');
