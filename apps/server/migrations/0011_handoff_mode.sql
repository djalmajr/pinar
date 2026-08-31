-- Agent-copy detail never changes the saved capture or public viewer payload.
ALTER TABLE owner_preferences
ADD COLUMN handoff_mode TEXT NOT NULL DEFAULT 'compact'
CHECK (handoff_mode IN ('compact', 'full'));
