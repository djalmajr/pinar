ALTER TABLE owner_preferences ADD COLUMN voice_post_processing INTEGER
  NOT NULL DEFAULT 0 CHECK (voice_post_processing IN (0, 1));
