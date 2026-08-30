-- Whether agent copy and public .md URLs deliver the printed screenshot.
ALTER TABLE sessions ADD COLUMN include_screenshot INTEGER NOT NULL DEFAULT 1;
