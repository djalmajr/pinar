-- Live capture destination, clipboard, language, and viewer-copy preferences.
ALTER TABLE owner_preferences ADD COLUMN capture_project_id TEXT;
ALTER TABLE owner_preferences ADD COLUMN capture_collection_id TEXT;
ALTER TABLE owner_preferences ADD COLUMN copy_on_finish_batch TEXT
  CHECK (copy_on_finish_batch IN ('off', 'link', 'prompt'));
ALTER TABLE owner_preferences ADD COLUMN copy_viewer_content INTEGER
  CHECK (copy_viewer_content IN (0, 1));
ALTER TABLE owner_preferences ADD COLUMN include_viewer INTEGER
  CHECK (include_viewer IN (0, 1));
ALTER TABLE owner_preferences ADD COLUMN language TEXT;
ALTER TABLE owner_preferences ADD COLUMN sensitive_query_keys TEXT;
