-- Assistant margin monitor (F4 contract §3, decision A41).
--
-- The index's gateway costs (F4 contract §4): one row per embedding batch or
-- caption, the same fields as the assistant_index_cost log line and nothing
-- else (no owner, text or URL). cost_usd_micros is null when unknown.
CREATE TABLE assistant_index_costs (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('embedding', 'caption')),
  model TEXT NOT NULL,
  cost_usd_micros INTEGER,
  cost_source TEXT NOT NULL CHECK (cost_source IN ('gateway', 'table', 'none')),
  created_at TEXT NOT NULL
);
CREATE INDEX idx_assistant_index_costs_created ON assistant_index_costs(created_at);

-- At most one margin alert email per UTC day: the job claims the day before
-- sending and gives it back when the send fails.
CREATE TABLE assistant_margin_emails (
  day TEXT PRIMARY KEY,
  created_at TEXT NOT NULL
);
