import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { describe, test } from "node:test";
import { Database } from "bun:sqlite";
import {
  APPLY_STRIPE_SUBSCRIPTION_STATE_SQL,
  UPSERT_STRIPE_SUBSCRIPTION_STATE_SQL,
} from "../src/server/stripe-subscription-state";

const migrationsUrl = new URL("./", import.meta.url);
const schemaUrl = new URL("../schema.sql", import.meta.url);

function migrationFiles() {
  return readdirSync(migrationsUrl)
    .filter((name) => name.endsWith(".sql"))
    .sort();
}

function applyMigrations(db: Database, files = migrationFiles()) {
  for (const name of files) db.exec(readFileSync(new URL(name, migrationsUrl), "utf8"));
}

function databaseShape(db: Database) {
  const tables = db.query<{ name: string }, []>(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
  ).all().map((row) => row.name);
  const indexes = db.query<{ name: string }, []>(
    "SELECT name FROM sqlite_master WHERE type = 'index' AND name NOT LIKE 'sqlite_%' ORDER BY name",
  ).all().map((row) => row.name);
  const columns = Object.fromEntries(tables.map((table) => [
    table,
    db.query<{
      dflt_value: string | null;
      name: string;
      notnull: number;
      pk: number;
      type: string;
    }, []>(`PRAGMA table_info(${table})`).all(),
  ]));
  return { columns, indexes, tables };
}

describe("cloud schema migrations", () => {
  test("applies the additive migration chain to the canonical schema", () => {
    assert.deepEqual(migrationFiles(), [
      "0001_initial.sql",
      "0002_billing_entitlements.sql",
      "0003_ai_usage_and_storage_notices.sql",
      "0004_stripe_subscription_ordering.sql",
      "0005_founder_and_legal_acceptance.sql",
      "0006_agent_executions.sql",
      "0007_pin_reviews.sql",
      "0008_loop_metrics.sql",
    ]);
    const migrated = new Database(":memory:");
    const canonical = new Database(":memory:");
    try {
      migrated.exec("PRAGMA foreign_keys = ON;");
      canonical.exec("PRAGMA foreign_keys = ON;");
      applyMigrations(migrated);
      canonical.exec(readFileSync(schemaUrl, "utf8"));
      assert.deepEqual(databaseShape(migrated), databaseShape(canonical));
    } finally {
      migrated.close();
      canonical.close();
    }
  });

  test("preserves existing 0001 data while adding billing entitlements", () => {
    const db = new Database(":memory:");
    try {
      db.exec("PRAGMA foreign_keys = ON;");
      applyMigrations(db, ["0001_initial.sql"]);
      db.exec(`
        INSERT INTO users (id, email, plan, ever_paid, created_at, updated_at)
        VALUES ('usr_existing', 'existing@example.test', 'lifetime', 1, '2026-08-16T00:00:00.000Z', '2026-08-16T00:00:00.000Z');
        INSERT INTO sessions (id, created_at, user_id, plan, is_permanent, byte_size)
        VALUES ('existing_session', '2026-08-16T00:00:00.000Z', 'usr_existing', 'lifetime', 1, 42);
      `);

      applyMigrations(db, [
        "0002_billing_entitlements.sql",
        "0003_ai_usage_and_storage_notices.sql",
        "0004_stripe_subscription_ordering.sql",
        "0005_founder_and_legal_acceptance.sql",
      ]);

      assert.equal(
        db.query<{ plan: string }, []>("SELECT plan FROM users WHERE id = 'usr_existing'").get()?.plan,
        "lifetime",
      );
      assert.equal(
        db.query<{ byte_size: number }, []>("SELECT byte_size FROM sessions WHERE id = 'existing_session'").get()?.byte_size,
        42,
      );
      const tables = databaseShape(db).tables;
      assert.ok(tables.includes("ai_credit_grants"));
      assert.ok(tables.includes("ai_credit_usages"));
      assert.ok(tables.includes("storage_grants"));
      assert.ok(tables.includes("storage_expiry_notices"));
      assert.ok(tables.includes("stripe_events"));
      assert.ok(tables.includes("stripe_subscription_states"));
      assert.ok(tables.includes("founder_purchases"));
      assert.ok(tables.includes("founder_reservations"));
      assert.ok(tables.includes("legal_acceptances"));
      const userColumns = db.query<{ name: string }, []>("PRAGMA table_info(users)")
        .all()
        .map((column) => column.name);
      assert.ok(userColumns.includes("ai_credit_refill_at"));
      assert.ok(userColumns.includes("paid_eligibility_ended_at"));
      const sessionColumns = db.query<{ name: string }, []>("PRAGMA table_info(sessions)")
        .all()
        .map((column) => column.name);
      assert.ok(sessionColumns.includes("retention_expires_at"));

      db.exec(`
        INSERT INTO users (id, email, plan, ever_paid, created_at, updated_at)
        VALUES ('usr_founder', 'founder@example.test', 'founder', 1,
          '2026-08-18T00:00:00.000Z', '2026-08-18T00:00:00.000Z');
        INSERT INTO sessions (id, created_at, user_id, plan, is_permanent, byte_size)
        VALUES ('founder_session', '2026-08-18T00:00:00.000Z', 'usr_founder', 'founder', 1, 84);
        INSERT INTO ai_credit_grants (
          id, owner_type, owner_id, source_type, source_id, credits, created_at
        ) VALUES (
          'grant_founder', 'account', 'usr_founder', 'founder_initial',
          'founder:usr_founder', 500, '2026-08-18T00:00:00.000Z'
        );
        INSERT INTO legal_acceptances (
          id, owner_type, owner_id, terms_version, privacy_version,
          acceptable_use_version, locale, source, accepted_at, created_at
        ) VALUES (
          'accept_founder', 'account', 'usr_founder', '2026-08-18', '2026-08-18',
          '2026-08-18', 'pt', 'checkout', '2026-08-18T00:00:00.000Z',
          '2026-08-18T00:00:00.000Z'
        );
      `);
      assert.equal(
        db.query<{ credits: number }, []>(
          "SELECT credits FROM ai_credit_grants WHERE source_type = 'founder_initial'",
        ).get()?.credits,
        500,
      );
      assert.equal(
        db.query<{ count: number }, []>(
          "SELECT COUNT(*) AS count FROM legal_acceptances WHERE owner_id = 'usr_founder'",
        ).get()?.count,
        1,
      );
      const duplicateAcceptance = db.query(`
        INSERT INTO legal_acceptances (
          id, owner_type, owner_id, terms_version, privacy_version,
          acceptable_use_version, locale, source, accepted_at, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      assert.throws(() => duplicateAcceptance.run(
        "accept_founder_duplicate",
        "account",
        "usr_founder",
        "2026-08-18",
        "2026-08-18",
        "2026-08-18",
        "pt",
        "account",
        "2026-08-18T00:01:00.000Z",
        "2026-08-18T00:01:00.000Z",
      ), /unique/i);

      db.exec(`
        INSERT INTO ai_credit_grants (
          id, owner_type, owner_id, source_type, source_id, credits, created_at
        ) VALUES (
          'grant_test', 'account', 'usr_existing', 'free_initial', 'free:usr_existing', 5,
          '2026-08-17T00:00:00.000Z'
        );
      `);
      assert.throws(
        () => db.query("UPDATE ai_credit_grants SET consumed_credits = 6 WHERE id = 'grant_test'").run(),
        /constraint/i,
      );
      db.exec(`
        INSERT INTO ai_credit_usages (
          id, request_id, owner_type, owner_id, grant_id, feature, resource_id, model, credits, status, created_at
        ) VALUES (
          'usage_test', 'request_000000000001', 'account', 'usr_existing', 'grant_test',
          'session_summary', 'session_test', '@cf/test/model', 1, 'reserved', '2026-08-17T00:00:00.000Z'
        );
      `);
      assert.equal(
        db.query<{ consumed_credits: number }, []>(
          "SELECT consumed_credits FROM ai_credit_grants WHERE id = 'grant_test'",
        ).get()?.consumed_credits,
        1,
      );
      db.exec("UPDATE ai_credit_usages SET status = 'refunded' WHERE id = 'usage_test'");
      assert.equal(
        db.query<{ consumed_credits: number }, []>(
          "SELECT consumed_credits FROM ai_credit_grants WHERE id = 'grant_test'",
        ).get()?.consumed_credits,
        0,
      );

      const source = migrationFiles()
        .map((name) => readFileSync(new URL(name, migrationsUrl), "utf8"))
        .join("\n")
        .toLowerCase();
      assert.doesNotMatch(source, /license_key|browser_ticket|browser_session/);
    } finally {
      db.close();
    }
  });

  test("preserves existing AI usage while rebuilding Founder-compatible grants", () => {
    const db = new Database(":memory:");
    try {
      db.exec("PRAGMA foreign_keys = ON;");
      applyMigrations(db, [
        "0001_initial.sql",
        "0002_billing_entitlements.sql",
        "0003_ai_usage_and_storage_notices.sql",
        "0004_stripe_subscription_ordering.sql",
      ]);
      db.exec(`
        INSERT INTO users (id, email, plan, ever_paid, created_at, updated_at)
        VALUES ('usr_ai_existing', 'ai-existing@example.test', 'lifetime', 1,
          '2026-08-17T00:00:00.000Z', '2026-08-17T00:00:00.000Z');
        INSERT INTO ai_credit_grants (
          id, owner_type, owner_id, source_type, source_id, credits, created_at
        ) VALUES (
          'grant_ai_existing', 'account', 'usr_ai_existing', 'lifetime_initial',
          'legacy:ai-existing', 500, '2026-08-17T00:00:00.000Z'
        );
        INSERT INTO ai_credit_usages (
          id, request_id, owner_type, owner_id, grant_id, feature, resource_id,
          model, credits, status, created_at
        ) VALUES (
          'usage_ai_existing', 'request_ai_existing', 'account', 'usr_ai_existing',
          'grant_ai_existing', 'session_summary', 'session_ai_existing',
          '@cf/test/model', 1, 'reserved', '2026-08-17T00:01:00.000Z'
        );
      `);

      applyMigrations(db, ["0005_founder_and_legal_acceptance.sql"]);

      assert.equal(
        db.query<{ consumed_credits: number; source_type: string }, []>(
          "SELECT consumed_credits, source_type FROM ai_credit_grants WHERE id = 'grant_ai_existing'",
        ).get()?.consumed_credits,
        1,
      );
      assert.equal(
        db.query<{ count: number }, []>(
          "SELECT COUNT(*) AS count FROM ai_credit_usages WHERE id = 'usage_ai_existing'",
        ).get()?.count,
        1,
      );
      db.exec("UPDATE ai_credit_usages SET status = 'refunded' WHERE id = 'usage_ai_existing'");
      assert.equal(
        db.query<{ consumed_credits: number }, []>(
          "SELECT consumed_credits FROM ai_credit_grants WHERE id = 'grant_ai_existing'",
        ).get()?.consumed_credits,
        0,
      );
    } finally {
      db.close();
    }
  });

  test("keeps D1 subscription state monotonic and scoped to the current subscription", () => {
    const db = new Database(":memory:");
    try {
      db.exec("PRAGMA foreign_keys = ON;");
      applyMigrations(db);
      db.exec(`
        INSERT INTO users (
          id, email, plan, ever_paid, billing_status, stripe_customer_id,
          stripe_subscription_id, created_at, updated_at
        ) VALUES
          ('usr_ordered', 'ordered@example.test', 'pro', 1, 'active', 'cus_ordered',
           'sub_ordered', '2026-08-17T00:00:00.000Z', '2026-08-17T00:00:00.000Z'),
          ('usr_founder', 'founder@example.test', 'founder', 1, 'active', 'cus_founder',
           'sub_founder', '2026-08-17T00:00:00.000Z', '2026-08-17T00:00:00.000Z'),
          ('usr_current', 'current@example.test', 'pro', 1, 'active', 'cus_current',
           'sub_current', '2026-08-17T00:00:00.000Z', '2026-08-17T00:00:00.000Z');
      `);
      const upsert = db.query(UPSERT_STRIPE_SUBSCRIPTION_STATE_SQL);
      const apply = db.query(APPLY_STRIPE_SUBSCRIPTION_STATE_SQL);

      upsert.run(
        "sub_ordered",
        "cus_ordered",
        "canceled",
        200,
        "evt_ordered_canceled",
        "2026-08-17T00:03:20.000Z",
      );
      apply.run(
        "sub_ordered",
        "sub_ordered",
        "sub_ordered",
        "2026-08-17T00:03:20.000Z",
        "cus_ordered",
        "sub_ordered",
        "sub_ordered",
      );
      upsert.run(
        "sub_ordered",
        "cus_ordered",
        "active",
        100,
        "evt_ordered_stale_active",
        "2026-08-17T00:01:40.000Z",
      );
      apply.run(
        "sub_ordered",
        "sub_ordered",
        "sub_ordered",
        "2026-08-17T00:04:00.000Z",
        "cus_ordered",
        "sub_ordered",
        "sub_ordered",
      );
      upsert.run(
        "sub_ordered",
        "cus_ordered",
        "active",
        200,
        "evt_ordered_same_second_active",
        "2026-08-17T00:03:20.000Z",
      );
      apply.run(
        "sub_ordered",
        "sub_ordered",
        "sub_ordered",
        "2026-08-17T00:04:10.000Z",
        "cus_ordered",
        "sub_ordered",
        "sub_ordered",
      );
      assert.deepEqual(
        db.query<{ billing_status: string; plan: string }, []>(
          "SELECT billing_status, plan FROM users WHERE id = 'usr_ordered'",
        ).get(),
        { billing_status: "canceled", plan: "free" },
      );

      upsert.run(
        "sub_founder",
        "cus_founder",
        "canceled",
        200,
        "evt_founder_canceled",
        "2026-08-17T00:03:20.000Z",
      );
      apply.run(
        "sub_founder",
        "sub_founder",
        "sub_founder",
        "2026-08-17T00:03:20.000Z",
        "cus_founder",
        "sub_founder",
        "sub_founder",
      );
      assert.deepEqual(
        db.query<{ billing_status: string; plan: string }, []>(
          "SELECT billing_status, plan FROM users WHERE id = 'usr_founder'",
        ).get(),
        { billing_status: "canceled", plan: "founder" },
      );

      upsert.run(
        "sub_previous",
        "cus_current",
        "canceled",
        300,
        "evt_previous_canceled",
        "2026-08-17T00:05:00.000Z",
      );
      apply.run(
        "sub_previous",
        "sub_previous",
        "sub_previous",
        "2026-08-17T00:05:00.000Z",
        "cus_current",
        "sub_previous",
        "sub_previous",
      );
      assert.deepEqual(
        db.query<{ billing_status: string; plan: string; stripe_subscription_id: string }, []>(
          "SELECT billing_status, plan, stripe_subscription_id FROM users WHERE id = 'usr_current'",
        ).get(),
        { billing_status: "active", plan: "pro", stripe_subscription_id: "sub_current" },
      );
    } finally {
      db.close();
    }
  });

  test("adds agent execution tables without rewriting existing sessions", () => {
    const db = new Database(":memory:");
    try {
      db.exec("PRAGMA foreign_keys = ON;");
      applyMigrations(db, [
        "0001_initial.sql",
        "0002_billing_entitlements.sql",
        "0003_ai_usage_and_storage_notices.sql",
        "0004_stripe_subscription_ordering.sql",
        "0005_founder_and_legal_acceptance.sql",
      ]);
      db.exec(`
        INSERT INTO users (id, email, plan, ever_paid, created_at, updated_at)
        VALUES ('usr_existing', 'existing@example.test', 'lifetime', 1, '2026-08-16T00:00:00.000Z', '2026-08-16T00:00:00.000Z');
        INSERT INTO sessions (id, created_at, user_id, plan, is_permanent, byte_size)
        VALUES ('existing_session', '2026-08-16T00:00:00.000Z', 'usr_existing', 'lifetime', 1, 42);
      `);
      applyMigrations(db, ["0006_agent_executions.sql"]);
      assert.equal(
        db.query<{ byte_size: number }, []>("SELECT byte_size FROM sessions WHERE id = 'existing_session'").get()?.byte_size,
        42,
      );
      const tables = databaseShape(db).tables;
      assert.ok(tables.includes("agent_executions"));
      assert.ok(tables.includes("agent_pin_results"));
      db.exec(`
        INSERT INTO agent_executions (
          id, idempotency_key, capture_id, agent, created_at, owner_id, payload_hash
        ) VALUES (
          'aex_existing', 'exec_cursor_01', 'existing_session', 'cursor',
          '2026-08-29T00:00:00.000Z', 'usr_existing', 'hash'
        );
        INSERT INTO agent_pin_results (
          id, execution_id, pin_id, status, summary, files_json, created_at
        ) VALUES (
          'ars_existing', 'aex_existing', 'pin_cta', 'changed', 'Updated CTA', '[]',
          '2026-08-29T00:00:00.000Z'
        );
      `);
      assert.equal(
        db.query<{ status: string }, []>(
          "SELECT status FROM agent_pin_results WHERE execution_id = 'aex_existing'",
        ).get()?.status,
        "changed",
      );
    } finally {
      db.close();
    }
  });

  test("adds pin review tables without rewriting agent executions", () => {
    const db = new Database(":memory:");
    try {
      db.exec("PRAGMA foreign_keys = ON;");
      applyMigrations(db);
      assert.ok(databaseShape(db).tables.includes("pin_reviews"));
      assert.ok(databaseShape(db).tables.includes("pin_review_events"));
      db.exec(`
        INSERT INTO pin_reviews (capture_id, pin_id, status, updated_at)
        VALUES ('existing_session', 'pin_cta', 'open', '2026-08-29T00:00:00.000Z');
      `);
      assert.equal(
        db.query<{ status: string }, []>(
          "SELECT status FROM pin_reviews WHERE capture_id = 'existing_session'",
        ).get()?.status,
        "open",
      );
    } finally {
      db.close();
    }
  });

  test("adds loop metric tables without rewriting pin reviews", () => {
    const db = new Database(":memory:");
    try {
      db.exec("PRAGMA foreign_keys = ON;");
      applyMigrations(db);
      assert.ok(databaseShape(db).tables.includes("loop_metrics"));
      db.exec(`
        INSERT INTO loop_metrics (id, owner_id, event, duration_ms, degraded, created_at)
        VALUES ('lm_test', 'ins_test', 'handoff', 40, 0, '2026-08-30T00:00:00.000Z');
      `);
      assert.equal(
        db.query<{ event: string }, []>(
          "SELECT event FROM loop_metrics WHERE id = 'lm_test'",
        ).get()?.event,
        "handoff",
      );
    } finally {
      db.close();
    }
  });
});
