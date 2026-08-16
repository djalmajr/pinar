ALTER TABLE collections ADD COLUMN parent_id TEXT;

DROP INDEX IF EXISTS idx_collections_project_position;
CREATE INDEX IF NOT EXISTS idx_collections_project_position
ON collections(project_id, parent_id, position);
