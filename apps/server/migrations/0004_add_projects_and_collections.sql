CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  name TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 0,
  is_protected INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_projects_owner_position ON projects(owner_id, position);

CREATE TABLE IF NOT EXISTS collections (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  name TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 0,
  is_protected INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_collections_owner ON collections(owner_id);
CREATE INDEX IF NOT EXISTS idx_collections_project_position ON collections(project_id, position);

ALTER TABLE sessions ADD COLUMN collection_id TEXT;
ALTER TABLE sessions ADD COLUMN position INTEGER DEFAULT 0;

INSERT INTO projects (id, owner_id, name, position, is_protected, created_at, updated_at)
SELECT
  'prj_' || lower(hex(randomblob(12))),
  user_id,
  'Personal',
  0,
  1,
  COALESCE(MIN(created_at), CURRENT_TIMESTAMP),
  CURRENT_TIMESTAMP
FROM sessions
WHERE user_id IS NOT NULL AND user_id <> ''
GROUP BY user_id;

INSERT INTO collections (id, project_id, owner_id, name, position, is_protected, created_at, updated_at)
SELECT
  'col_' || lower(hex(randomblob(12))),
  projects.id,
  projects.owner_id,
  'Inbox',
  0,
  1,
  projects.created_at,
  CURRENT_TIMESTAMP
FROM projects
WHERE projects.is_protected = 1;

UPDATE sessions
SET collection_id = (
  SELECT collections.id
  FROM collections
  WHERE collections.owner_id = sessions.user_id AND collections.is_protected = 1
  LIMIT 1
),
position = (
  SELECT COUNT(*)
  FROM sessions AS previous
  WHERE previous.user_id = sessions.user_id
    AND (
      previous.created_at < sessions.created_at
      OR (previous.created_at = sessions.created_at AND previous.id < sessions.id)
    )
);

CREATE INDEX IF NOT EXISTS idx_sessions_collection_position ON sessions(collection_id, position);
