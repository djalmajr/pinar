-- Automatic capture destination (F3.5): the owner's switch, and the mark of a
-- session the server filed by itself (NULL or 'auto'; every move clears it).
ALTER TABLE owner_preferences ADD COLUMN auto_capture_destination INTEGER
  NOT NULL DEFAULT 0 CHECK (auto_capture_destination IN (0, 1));
ALTER TABLE sessions ADD COLUMN filed_by TEXT CHECK (filed_by IN ('auto'));
-- The destination the first filed capture of a batch claimed (A36), so a
-- concurrent first capture of the same batch follows it instead of filing
-- the batch somewhere else.
ALTER TABLE batches ADD COLUMN filing_collection_id TEXT;
