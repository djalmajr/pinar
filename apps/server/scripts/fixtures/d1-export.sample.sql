PRAGMA defer_foreign_keys=TRUE;
CREATE TABLE IF NOT EXISTS "d1_migrations"(
		id         INTEGER PRIMARY KEY AUTOINCREMENT,
		name       TEXT UNIQUE,
		applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
);
INSERT INTO "d1_migrations" ("id","name","applied_at") VALUES(1,'0001_initial.sql','2026-10-15 01:26:35');
INSERT INTO "d1_migrations" ("id","name","applied_at") VALUES(2,'0002_billing_entitlements.sql','2026-10-15 01:26:35');
INSERT INTO "d1_migrations" ("id","name","applied_at") VALUES(3,'0003_ai_usage_and_storage_notices.sql','2026-10-15 01:26:36');
INSERT INTO "d1_migrations" ("id","name","applied_at") VALUES(4,'0004_stripe_subscription_ordering.sql','2026-10-15 01:26:36');
INSERT INTO "d1_migrations" ("id","name","applied_at") VALUES(5,'0005_founder_and_legal_acceptance.sql','2026-10-15 01:26:37');
INSERT INTO "d1_migrations" ("id","name","applied_at") VALUES(6,'0006_agent_executions.sql','2026-10-15 01:26:37');
INSERT INTO "d1_migrations" ("id","name","applied_at") VALUES(7,'0007_pin_reviews.sql','2026-10-15 01:26:38');
INSERT INTO "d1_migrations" ("id","name","applied_at") VALUES(8,'0008_loop_metrics.sql','2026-10-15 01:26:38');
INSERT INTO "d1_migrations" ("id","name","applied_at") VALUES(9,'0009_include_screenshot.sql','2026-10-15 01:26:38');
INSERT INTO "d1_migrations" ("id","name","applied_at") VALUES(10,'0010_owner_preferences.sql','2026-10-15 01:26:39');
INSERT INTO "d1_migrations" ("id","name","applied_at") VALUES(11,'0011_handoff_mode.sql','2026-10-15 01:26:39');
INSERT INTO "d1_migrations" ("id","name","applied_at") VALUES(12,'0012_batches.sql','2026-10-15 01:26:39');
INSERT INTO "d1_migrations" ("id","name","applied_at") VALUES(13,'0013_delivery_preferences.sql','2026-10-15 01:26:40');
INSERT INTO "d1_migrations" ("id","name","applied_at") VALUES(14,'0014_drop_lifetime_plan.sql','2026-10-15 01:26:40');
INSERT INTO "d1_migrations" ("id","name","applied_at") VALUES(15,'0015_share_tokens.sql','2026-10-15 01:26:41');
INSERT INTO "d1_migrations" ("id","name","applied_at") VALUES(16,'0016_ai_features.sql','2026-10-15 01:26:41');
INSERT INTO "d1_migrations" ("id","name","applied_at") VALUES(17,'0017_remove_founder.sql','2026-10-15 01:26:42');
INSERT INTO "d1_migrations" ("id","name","applied_at") VALUES(18,'0018_voice_post_processing.sql','2026-10-15 01:26:42');
INSERT INTO "d1_migrations" ("id","name","applied_at") VALUES(19,'0019_one_time_pro_credits.sql','2026-10-15 01:26:43');
INSERT INTO "d1_migrations" ("id","name","applied_at") VALUES(20,'0020_storage_1gb_add_on.sql','2026-10-15 01:26:43');
INSERT INTO "d1_migrations" ("id","name","applied_at") VALUES(21,'0021_email_first_accounts.sql','2026-10-15 01:26:44');
INSERT INTO "d1_migrations" ("id","name","applied_at") VALUES(22,'0022_collection_collaborators.sql','2026-10-15 01:26:44');
INSERT INTO "d1_migrations" ("id","name","applied_at") VALUES(23,'0023_cloud_trial.sql','2026-10-15 01:26:45');
INSERT INTO "d1_migrations" ("id","name","applied_at") VALUES(24,'0024_pin_comments.sql','2026-10-15 01:26:45');
INSERT INTO "d1_migrations" ("id","name","applied_at") VALUES(25,'0025_agent_api_keys.sql','2026-10-15 01:26:45');
INSERT INTO "d1_migrations" ("id","name","applied_at") VALUES(26,'0026_pin_comment_agents.sql','2026-10-15 01:26:46');
CREATE TABLE installations (
  id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'migrated', 'revoked')),
  migrated_to_user_id TEXT REFERENCES users(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_seen_at TEXT
);
CREATE TABLE web_sessions (
  token_hash TEXT PRIMARY KEY,
  owner_type TEXT NOT NULL CHECK (owner_type IN ('account', 'installation')),
  owner_id TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  revoked_at TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE device_sessions (
  id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  user_id TEXT NOT NULL REFERENCES users(id),
  installation_id TEXT NOT NULL REFERENCES installations(id),
  expires_at TEXT NOT NULL,
  revoked_at TEXT,
  created_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL
);
CREATE TABLE extension_codes (
  code_hash TEXT PRIMARY KEY,
  owner_type TEXT NOT NULL CHECK (owner_type IN ('account', 'installation')),
  owner_id TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used_at TEXT,
  created_at TEXT NOT NULL
);
INSERT INTO "extension_codes" ("code_hash","owner_type","owner_id","expires_at","used_at","created_at") VALUES('e18357b6b8856ca20c34dffe3ec73e596101154a5cd055a91138848f177c70e7','account','usr_cloud_local_pro','2026-10-16T01:26:29.582Z',NULL,'2026-10-15T01:26:29.582Z');
CREATE TABLE auth_rate_limits (
  action TEXT NOT NULL,
  scope_hash TEXT NOT NULL,
  window_started_at TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (action, scope_hash)
);
CREATE TABLE projects (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  name TEXT NOT NULL,
  icon TEXT NOT NULL DEFAULT 'folder-kanban',
  position INTEGER NOT NULL DEFAULT 0,
  is_protected INTEGER NOT NULL DEFAULT 0 CHECK (is_protected IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
INSERT INTO "projects" ("id","owner_id","name","icon","position","is_protected","created_at","updated_at") VALUES('prj_cloud_local_pro','usr_cloud_local_pro','Personal','user-round',0,1,'2026-10-15T01:26:29.582Z','2026-10-15T01:26:29.582Z');
CREATE TABLE collections (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  owner_id TEXT NOT NULL,
  parent_id TEXT REFERENCES collections(id),
  name TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 0,
  is_protected INTEGER NOT NULL DEFAULT 0 CHECK (is_protected IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
, design_system_json TEXT);
INSERT INTO "collections" ("id","project_id","owner_id","parent_id","name","position","is_protected","created_at","updated_at","design_system_json") VALUES('col_cloud_local_pro','prj_cloud_local_pro','usr_cloud_local_pro',NULL,'Inbox',0,1,'2026-10-15T01:26:29.582Z','2026-10-15T01:26:29.582Z',NULL);
CREATE TABLE stripe_events (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  created_at TEXT NOT NULL,
  processed_at TEXT NOT NULL
);
CREATE TABLE stripe_subscription_states (
  subscription_id TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('active', 'canceled', 'past_due')),
  event_created INTEGER NOT NULL CHECK (event_created > 0),
  event_id TEXT NOT NULL UNIQUE,
  updated_at TEXT NOT NULL
);
CREATE TABLE legal_acceptances (
  id TEXT PRIMARY KEY,
  owner_type TEXT NOT NULL CHECK (owner_type IN ('account', 'installation')),
  owner_id TEXT NOT NULL,
  terms_version TEXT NOT NULL,
  privacy_version TEXT NOT NULL,
  acceptable_use_version TEXT NOT NULL,
  locale TEXT NOT NULL CHECK (locale IN ('en', 'pt')),
  source TEXT NOT NULL CHECK (source IN ('account', 'checkout', 'remote_free')),
  evidence_id TEXT,
  accepted_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (owner_type, owner_id, terms_version)
);
INSERT INTO "legal_acceptances" ("id","owner_type","owner_id","terms_version","privacy_version","acceptable_use_version","locale","source","evidence_id","accepted_at","created_at") VALUES('lga_cloud_local_pro','account','usr_cloud_local_pro','2026-09-22','2026-09-22','2026-09-22','en','account','account:usr_cloud_local_pro:2026-09-22','2026-10-15T01:26:29.582Z','2026-10-15T01:26:29.582Z');
CREATE TABLE agent_executions (
  id TEXT PRIMARY KEY,
  idempotency_key TEXT NOT NULL,
  capture_id TEXT NOT NULL,
  agent TEXT NOT NULL CHECK (agent IN ('cursor', 'claude', 'codex', 'grok')),
  created_at TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  UNIQUE (owner_id, idempotency_key)
);
CREATE TABLE agent_pin_results (
  id TEXT PRIMARY KEY,
  execution_id TEXT NOT NULL REFERENCES agent_executions(id) ON DELETE CASCADE,
  pin_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('changed', 'not_located', 'blocked', 'not_applicable')),
  summary TEXT NOT NULL,
  reason TEXT,
  files_json TEXT NOT NULL DEFAULT '[]',
  commit_ref TEXT,
  pull_request TEXT,
  created_at TEXT NOT NULL,
  UNIQUE (execution_id, pin_id)
);
CREATE TABLE pin_reviews (
  capture_id TEXT NOT NULL,
  pin_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('open', 'correction_ready', 'accepted', 'reopened')),
  updated_at TEXT NOT NULL,
  last_execution_id TEXT,
  PRIMARY KEY (capture_id, pin_id)
);
CREATE TABLE pin_review_events (
  id TEXT PRIMARY KEY,
  capture_id TEXT NOT NULL,
  pin_id TEXT NOT NULL,
  actor_type TEXT NOT NULL CHECK (actor_type IN ('agent', 'human')),
  actor_id TEXT NOT NULL,
  origin TEXT NOT NULL CHECK (origin IN ('agent_result', 'human')),
  from_status TEXT NOT NULL CHECK (from_status IN ('open', 'correction_ready', 'accepted', 'reopened')),
  to_status TEXT NOT NULL CHECK (to_status IN ('open', 'correction_ready', 'accepted', 'reopened')),
  execution_id TEXT,
  created_at TEXT NOT NULL
);
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
CREATE TABLE owner_preferences (
  owner_id TEXT PRIMARY KEY,
  include_screenshot INTEGER NOT NULL DEFAULT 1 CHECK (include_screenshot IN (0, 1)),
  updated_at TEXT NOT NULL
, handoff_mode TEXT NOT NULL DEFAULT 'compact'
CHECK (handoff_mode IN ('compact', 'full')), capture_project_id TEXT, capture_collection_id TEXT, copy_on_finish_batch TEXT
  CHECK (copy_on_finish_batch IN ('off', 'link', 'prompt')), copy_viewer_content INTEGER
  CHECK (copy_viewer_content IN (0, 1)), include_viewer INTEGER
  CHECK (include_viewer IN (0, 1)), language TEXT, sensitive_query_keys TEXT, component_target TEXT
  CHECK (component_target IN ('html', 'react-tailwind', 'preact-htm')), voice_post_processing INTEGER
  NOT NULL DEFAULT 0 CHECK (voice_post_processing IN (0, 1)));
CREATE TABLE batches (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  label TEXT NOT NULL,
  started_at TEXT NOT NULL,
  finished_at TEXT
);
CREATE TABLE share_tokens (
  id TEXT PRIMARY KEY,
  token TEXT NOT NULL UNIQUE,
  resource_type TEXT NOT NULL CHECK (resource_type IN ('session', 'project', 'collection', 'batch')),
  resource_id TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked')),
  expires_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE share_token_events (
  id TEXT PRIMARY KEY,
  share_token_id TEXT NOT NULL REFERENCES share_tokens(id),
  actor_id TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('created', 'revoked')),
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS "users" (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL COLLATE NOCASE UNIQUE,
  plan TEXT NOT NULL DEFAULT 'free' CHECK (plan IN ('free', 'pro')),
  ever_paid INTEGER NOT NULL DEFAULT 0 CHECK (ever_paid IN (0, 1)),
  billing_status TEXT NOT NULL DEFAULT 'active' CHECK (billing_status IN ('active', 'canceled', 'past_due')),
  stripe_customer_id TEXT UNIQUE,
  stripe_subscription_id TEXT UNIQUE,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  ai_credit_refill_at TEXT,
  paid_eligibility_ended_at TEXT
, cloud_trial_started_at TEXT, cloud_trial_ends_at TEXT);
INSERT INTO "users" ("id","email","plan","ever_paid","billing_status","stripe_customer_id","stripe_subscription_id","created_at","updated_at","ai_credit_refill_at","paid_eligibility_ended_at","cloud_trial_started_at","cloud_trial_ends_at") VALUES('usr_cloud_local_pro','pro.cloud-local@pinar.test','pro',1,'active',NULL,NULL,'2026-10-15T01:26:29.582Z','2026-10-15T01:26:29.582Z',NULL,NULL,NULL,NULL);
CREATE TABLE IF NOT EXISTS "sessions" (
  id TEXT PRIMARY KEY,
  url TEXT,
  title TEXT,
  shot_id TEXT,
  shot_url TEXT,
  pin_count INTEGER NOT NULL DEFAULT 0,
  pins_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  user_id TEXT NOT NULL,
  plan TEXT NOT NULL DEFAULT 'free' CHECK (plan IN ('free', 'pro')),
  is_permanent INTEGER NOT NULL DEFAULT 0 CHECK (is_permanent IN (0, 1)),
  byte_size INTEGER NOT NULL DEFAULT 0,
  collection_id TEXT REFERENCES collections(id),
  position INTEGER NOT NULL DEFAULT 0,
  retention_expires_at TEXT,
  include_screenshot INTEGER NOT NULL DEFAULT 1 CHECK (include_screenshot IN (0, 1)),
  batch_id TEXT
);
INSERT INTO "sessions" ("id","url","title","shot_id","shot_url","pin_count","pins_json","created_at","user_id","plan","is_permanent","byte_size","collection_id","position","retention_expires_at","include_screenshot","batch_id") VALUES('session_cloud_local_pro','https://example.test/cloud-local','Cloud runtime fixture','','',0,'[]','2026-10-15T01:26:29.582Z','usr_cloud_local_pro','pro',1,134217728,'col_cloud_local_pro',0,NULL,1,NULL);
CREATE TABLE IF NOT EXISTS "ai_credit_grants" (
  id TEXT PRIMARY KEY,
  owner_type TEXT NOT NULL CHECK (owner_type IN ('account', 'installation')),
  owner_id TEXT NOT NULL,
  source_type TEXT NOT NULL CHECK (
    source_type IN ('free_initial', 'pro_initial', 'pro_monthly', 'purchase')
  ),
  source_id TEXT NOT NULL UNIQUE,
  credits INTEGER NOT NULL CHECK (credits > 0),
  consumed_credits INTEGER NOT NULL DEFAULT 0,
  expires_at TEXT,
  created_at TEXT NOT NULL,
  CHECK (consumed_credits >= 0 AND consumed_credits <= credits)
);
INSERT INTO "ai_credit_grants" ("id","owner_type","owner_id","source_type","source_id","credits","consumed_credits","expires_at","created_at") VALUES('grant_cloud_local_pro_initial','account','usr_cloud_local_pro','pro_initial','pro_initial:usr_cloud_local_pro',500,20,'2027-10-15T01:26:29.582Z','2026-10-15T01:26:29.582Z');
INSERT INTO "ai_credit_grants" ("id","owner_type","owner_id","source_type","source_id","credits","consumed_credits","expires_at","created_at") VALUES('grant_cloud_local_pro_expiring','account','usr_cloud_local_pro','purchase','cloud-local:pro:expiring',20,0,'2026-10-22T01:26:29.582Z','2026-10-15T01:26:29.582Z');
CREATE TABLE ai_credit_usages (
  id TEXT PRIMARY KEY,
  request_id TEXT NOT NULL,
  owner_type TEXT NOT NULL CHECK (owner_type IN ('account', 'installation')),
  owner_id TEXT NOT NULL,
  grant_id TEXT NOT NULL REFERENCES ai_credit_grants(id),
  feature TEXT NOT NULL CHECK (feature IN (
    'session_summary',
    'component_export',
    'pin_diagnosis',
    'design_system',
    'reproduction',
    'voice_pin'
  )),
  resource_id TEXT NOT NULL,
  model TEXT NOT NULL,
  credits INTEGER NOT NULL CHECK (credits > 0),
  status TEXT NOT NULL CHECK (status IN ('reserved', 'succeeded', 'refunded')),
  input_tokens INTEGER,
  output_tokens INTEGER,
  cost_usd_micros INTEGER,
  result_json TEXT,
  error_code TEXT,
  created_at TEXT NOT NULL,
  completed_at TEXT,
  UNIQUE (owner_type, owner_id, request_id)
);
CREATE TABLE IF NOT EXISTS "storage_grants" (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  source_type TEXT NOT NULL CHECK (
    source_type IN ('storage_1gb_12m', 'storage_5gb_12m', 'storage_20gb_12m')
  ),
  source_id TEXT NOT NULL UNIQUE,
  byte_count INTEGER NOT NULL CHECK (byte_count > 0),
  starts_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE storage_expiry_notices (
  id TEXT PRIMARY KEY,
  storage_grant_id TEXT NOT NULL REFERENCES storage_grants(id),
  days_before INTEGER NOT NULL CHECK (days_before IN (30, 7, 1)),
  scheduled_for TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'skipped')),
  claimed_at TEXT,
  sent_at TEXT,
  last_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (storage_grant_id, days_before)
);
CREATE TABLE IF NOT EXISTS "email_challenges" (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL COLLATE NOCASE,
  user_id TEXT REFERENCES users(id),
  code_hash TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  expires_at TEXT NOT NULL,
  used_at TEXT,
  created_at TEXT NOT NULL
);
INSERT INTO "email_challenges" ("id","email","user_id","code_hash","attempts","expires_at","used_at","created_at") VALUES('emc_cloud_local_pro','pro.cloud-local@pinar.test','usr_cloud_local_pro','14335bbc545bf7f0a20b658366902104ea699f17988d988cb85b7abfb943191f',0,'2026-10-16T01:26:29.582Z',NULL,'2026-10-15T01:26:29.582Z');
CREATE TABLE collection_collaborators (
  id TEXT PRIMARY KEY,
  collection_id TEXT NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
  owner_id TEXT NOT NULL,
  email TEXT NOT NULL COLLATE NOCASE,
  user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'revoked')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  accepted_at TEXT,
  revoked_at TEXT
);
CREATE TABLE agent_api_keys (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  token_prefix TEXT NOT NULL,
  resource_type TEXT NOT NULL CHECK (resource_type IN ('account', 'project', 'collection', 'session', 'batch')),
  resource_id TEXT,
  permission TEXT NOT NULL DEFAULT 'read' CHECK (permission IN ('read', 'manage', 'share', 'full')),
  expires_at TEXT NOT NULL,
  revoked_at TEXT,
  created_at TEXT NOT NULL,
  last_used_at TEXT,
  CHECK ((resource_type = 'account' AND resource_id IS NULL) OR (resource_type <> 'account' AND resource_id IS NOT NULL))
);
CREATE TABLE IF NOT EXISTS "pin_comments" (
  id TEXT PRIMARY KEY,
  capture_id TEXT NOT NULL,
  pin_id TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  actor_label TEXT NOT NULL,
  actor_type TEXT NOT NULL CHECK (actor_type IN ('agent', 'human')),
  body TEXT NOT NULL,
  created_at TEXT NOT NULL
);
DELETE FROM sqlite_sequence;
INSERT INTO "sqlite_sequence" ("name","seq") VALUES('d1_migrations',26);
CREATE INDEX idx_installations_status ON installations(status);
CREATE INDEX idx_web_sessions_owner ON web_sessions(owner_type, owner_id);
CREATE INDEX idx_web_sessions_expiry ON web_sessions(expires_at);
CREATE INDEX idx_device_sessions_user ON device_sessions(user_id);
CREATE INDEX idx_device_sessions_expiry ON device_sessions(expires_at);
CREATE INDEX idx_extension_codes_expiry ON extension_codes(expires_at);
CREATE INDEX idx_projects_owner_position ON projects(owner_id, position);
CREATE INDEX idx_collections_owner ON collections(owner_id);
CREATE INDEX idx_collections_project_position ON collections(project_id, parent_id, position);
CREATE INDEX idx_stripe_events_processed ON stripe_events(processed_at);
CREATE INDEX idx_stripe_subscription_states_customer
  ON stripe_subscription_states(customer_id, event_created DESC);
CREATE INDEX idx_legal_acceptances_owner
  ON legal_acceptances(owner_type, owner_id, accepted_at DESC);
CREATE INDEX idx_agent_executions_capture ON agent_executions(capture_id, created_at DESC);
CREATE INDEX idx_agent_executions_owner ON agent_executions(owner_id, created_at DESC);
CREATE INDEX idx_agent_pin_results_execution ON agent_pin_results(execution_id);
CREATE INDEX idx_pin_reviews_status ON pin_reviews(status, capture_id);
CREATE INDEX idx_pin_review_events_pin ON pin_review_events(capture_id, pin_id, created_at ASC);
CREATE INDEX idx_loop_metrics_owner_created ON loop_metrics(owner_id, created_at ASC);
CREATE INDEX idx_batches_user_started ON batches(user_id, started_at DESC);
CREATE INDEX idx_share_tokens_token ON share_tokens(token);
CREATE INDEX idx_share_tokens_resource ON share_tokens(resource_type, resource_id);
CREATE INDEX idx_share_tokens_owner ON share_tokens(owner_id, created_at DESC);
CREATE INDEX idx_share_tokens_expiry ON share_tokens(expires_at);
CREATE UNIQUE INDEX idx_share_tokens_active_resource 
  ON share_tokens(resource_type, resource_id) 
  WHERE status = 'active';
CREATE INDEX idx_share_token_events_token ON share_token_events(share_token_id, created_at ASC);
CREATE INDEX idx_share_token_events_actor ON share_token_events(actor_id, created_at DESC);
CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_stripe_customer ON users(stripe_customer_id);
CREATE INDEX idx_sessions_created ON sessions(created_at DESC);
CREATE INDEX idx_sessions_user ON sessions(user_id);
CREATE INDEX idx_sessions_plan ON sessions(plan, is_permanent);
CREATE INDEX idx_sessions_collection_position ON sessions(collection_id, position);
CREATE INDEX idx_sessions_retention_expiry ON sessions(retention_expires_at);
CREATE INDEX idx_sessions_user_batch ON sessions(user_id, batch_id);
CREATE INDEX idx_ai_credit_grants_owner_expiry
  ON ai_credit_grants(owner_type, owner_id, expires_at);
CREATE INDEX idx_ai_credit_usages_owner_created
  ON ai_credit_usages(owner_type, owner_id, created_at DESC);
CREATE INDEX idx_ai_credit_usages_status_created
  ON ai_credit_usages(status, created_at);
CREATE INDEX idx_storage_grants_user_expiry ON storage_grants(user_id, expires_at);
CREATE INDEX idx_storage_expiry_notices_pending
  ON storage_expiry_notices(status, scheduled_for);
CREATE INDEX idx_email_challenges_email ON email_challenges(email, created_at DESC);
CREATE INDEX idx_email_challenges_expiry ON email_challenges(expires_at);
CREATE INDEX idx_collab_collection ON collection_collaborators(collection_id);
CREATE INDEX idx_collab_email ON collection_collaborators(email);
CREATE INDEX idx_collab_user ON collection_collaborators(user_id);
CREATE UNIQUE INDEX idx_collab_collection_email_active ON collection_collaborators(collection_id, email) WHERE status IN ('pending', 'accepted');
CREATE INDEX idx_agent_api_keys_account ON agent_api_keys(account_id, created_at DESC);
CREATE INDEX idx_agent_api_keys_active ON agent_api_keys(account_id, revoked_at, expires_at);
CREATE INDEX idx_pin_comments_capture ON pin_comments(capture_id, created_at ASC);
CREATE TRIGGER consume_ai_credit_usage
BEFORE INSERT ON ai_credit_usages
WHEN NEW.status = 'reserved'
BEGIN
  UPDATE ai_credit_grants
  SET consumed_credits = consumed_credits + NEW.credits
  WHERE id = NEW.grant_id
    AND owner_type = NEW.owner_type
    AND owner_id = NEW.owner_id
    AND credits - consumed_credits >= NEW.credits
    AND (expires_at IS NULL OR expires_at > NEW.created_at);
  SELECT (CASE WHEN changes() <> 1 THEN RAISE(ABORT, 'insufficient_ai_credits') END);
END;
CREATE TRIGGER refund_ai_credit_usage
AFTER UPDATE OF status ON ai_credit_usages
WHEN OLD.status = 'reserved' AND NEW.status = 'refunded'
BEGIN
  UPDATE ai_credit_grants
  SET consumed_credits = consumed_credits - OLD.credits
  WHERE id = OLD.grant_id
    AND consumed_credits >= OLD.credits;
  SELECT (CASE WHEN changes() <> 1 THEN RAISE(ABORT, 'ai_credit_refund_failed') END);
END;