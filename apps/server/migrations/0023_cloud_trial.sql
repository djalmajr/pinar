-- Existing accounts remain legacy. New trials are assigned explicitly at account creation.
ALTER TABLE users ADD COLUMN cloud_trial_started_at TEXT;
ALTER TABLE users ADD COLUMN cloud_trial_ends_at TEXT;
