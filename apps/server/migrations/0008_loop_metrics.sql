-- Anonymous closed-loop funnel metrics. No comments, URLs, selectors, screenshots, or DOM.
CREATE TABLE loop_metrics (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  event TEXT NOT NULL CHECK (event IN ('handoff', 'correction_ready', 'accepted', 'reopened', 'relocation_failed')),
  duration_ms INTEGER,
  agent TEXT,
  location_confidence TEXT,
  degraded INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE INDEX idx_loop_metrics_owner_created ON loop_metrics(owner_id, created_at ASC);
