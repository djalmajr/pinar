// The assistant margin monitor (F4 contract §3) over a migrated SQLite-as-D1
// and a fake email binding. No real endpoint or email is reached.

import assert from "node:assert/strict";
import { Database } from "bun:sqlite";
import { readdirSync, readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, test } from "node:test";
import { cleanupOldRecords, setCloudNowForTests, type CloudEnv } from "../cloud-api";
import { runtimeEnv } from "../cloud-env";
import { edgerCloudEnv } from "../edger/env";
import { createEdgerFetch } from "../../edger-server-entry";
import {
  AI_CREDIT_REVENUE_USD_MICROS,
  ASSISTANT_MARGIN_RETENTION_DAYS,
  assistantMarginMonitor,
  FALLBACK_ALERT_MIN_TURNS,
  recordAssistantIndexCost,
} from "./margin-monitor";

const NOW = new Date("2026-10-17T03:00:00.000Z");
const INSIDE = "2026-10-16T12:00:00.000Z";
const OPS = "ops-alerts@pinar.test";

// ---------- D1 shim (same model as cloud-mcp.test.ts), with the SQL it ran ----------

function sqliteD1(db: Database, queries: string[] = []): NonNullable<CloudEnv["DB"]> {
  const statement = (query: string) => {
    let params: unknown[] = [];
    const bound = {
      async all() {
        queries.push(query);
        return { results: db.query(query).all(...params) as Record<string, unknown>[] };
      },
      bind(...values: unknown[]) {
        params = values.map((value) => (value === undefined ? null : value));
        return bound;
      },
      async first() {
        queries.push(query);
        return (db.query(query).get(...params) as Record<string, unknown> | null) ?? null;
      },
      async run() {
        queries.push(query);
        db.query(query).run(...params);
        const changes = db.query("SELECT changes() AS changes").get() as { changes: number };
        return { meta: { changes: changes.changes } };
      },
    };
    return bound;
  };
  return {
    async batch(statements: Array<{ run(): Promise<unknown> }>) {
      return Promise.all(statements.map((item) => item.run()));
    },
    prepare(query: string) {
      return statement(query);
    },
  } as unknown as NonNullable<CloudEnv["DB"]>;
}

// Every migration, or all but the one whose file name starts with `skip`.
function migratedDatabase(options: { skip?: string } = {}) {
  const db = new Database(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  const directory = new URL("../../../migrations/", import.meta.url);
  for (const file of readdirSync(directory).filter((name) => name.endsWith(".sql")).sort()) {
    if (options.skip && file.startsWith(options.skip)) continue;
    db.exec(readFileSync(new URL(file, directory), "utf8"));
  }
  return db;
}

// ---------- fixtures ----------

const userEmail = (ownerId: string) => `${ownerId}.person@private.example`;

function insertOwner(db: Database, ownerId: string) {
  db.query("INSERT INTO users (id, email, plan, ever_paid, billing_status, created_at, updated_at) VALUES (?, ?, 'pro', 1, 'active', ?, ?)")
    .run(ownerId, userEmail(ownerId), INSIDE, INSIDE);
  db.query(
    "INSERT INTO ai_credit_grants (id, owner_type, owner_id, source_type, source_id, credits, consumed_credits, created_at) VALUES (?, 'account', ?, 'purchase', ?, 100000, 0, ?)",
  ).run(`grant_${ownerId}`, ownerId, `purchase_${ownerId}`, INSIDE);
}

let sequence = 0;

// One assistant turn of `ownerId`, reserved then settled the way the turn
// meter settles it (result_json { costSource, fallback, link }).
function insertTurn(db: Database, input: {
  completedAt?: string;
  cost: number | null;
  costSource?: "appliance" | "gateway" | "none" | "table";
  credits?: number;
  fallback?: boolean;
  feature?: "assistant_turn" | "voice_pin";
  ownerId: string;
  resultJson?: string | null;
  status?: "refunded" | "reserved" | "succeeded";
}) {
  sequence += 1;
  const id = `usage_${sequence}`;
  const completedAt = input.completedAt ?? INSIDE;
  db.query(
    "INSERT INTO ai_credit_usages (id, request_id, owner_type, owner_id, grant_id, feature, resource_id, model, credits, status, created_at) VALUES (?, ?, 'account', ?, ?, ?, 'assistant:thread', 'gateway:anthropic/claude-haiku-5.5', ?, 'reserved', ?)",
  ).run(id, `turn:${id}`, input.ownerId, `grant_${input.ownerId}`, input.feature ?? "assistant_turn", input.credits ?? 3, completedAt);
  const status = input.status ?? "succeeded";
  if (status === "reserved") return;
  if (status === "refunded") {
    db.query("UPDATE ai_credit_usages SET status = 'refunded', error_code = 'x', completed_at = ? WHERE id = ?").run(completedAt, id);
    return;
  }
  const resultJson = input.resultJson !== undefined
    ? input.resultJson
    : JSON.stringify({ costSource: input.costSource ?? "gateway", fallback: input.fallback ?? false, link: input.fallback ? 1 : 0 });
  db.query("UPDATE ai_credit_usages SET status = 'succeeded', cost_usd_micros = ?, result_json = ?, completed_at = ? WHERE id = ?")
    .run(input.cost, resultJson, completedAt, id);
}

interface SentEmail {
  from: unknown;
  html: string;
  subject: string;
  text: string;
  to: unknown;
}

function fakeEmail(failures = 0) {
  const sent: SentEmail[] = [];
  let left = failures;
  const binding = {
    async send(message: SentEmail) {
      if (left > 0) {
        left -= 1;
        throw new Error("email service down");
      }
      sent.push(message);
      return { messageId: `m${sent.length}` };
    },
  } as unknown as NonNullable<CloudEnv["EMAIL"]>;
  return { binding, sent };
}

// Every console line of the run, by method.
const lines: Array<{ method: string; text: string }> = [];
const methods = ["log", "info", "warn", "error", "debug"] as const;
const originals = new Map<string, unknown>();

const logged = (message: string) =>
  lines.map((line) => line.text).filter((text) => text.startsWith("{")).map((text) => JSON.parse(text) as Record<string, unknown>).filter((line) => line.message === message);

describe("assistantMarginMonitor", () => {
  let db: Database;
  let queries: string[];

  beforeEach(() => {
    db = migratedDatabase();
    queries = [];
    lines.length = 0;
    for (const method of methods) {
      originals.set(method, console[method]);
      console[method] = (...args: unknown[]) => {
        lines.push({ method, text: args.map(String).join(" ") });
      };
    }
  });

  afterEach(() => {
    for (const method of methods) console[method] = originals.get(method) as never;
    db.close();
  });

  const env = (overrides: Partial<CloudEnv> = {}): CloudEnv => ({ DB: sqliteD1(db, queries), ...overrides });

  test("revenue is 3000 USD micros per credit", () => {
    assert.equal(AI_CREDIT_REVENUE_USD_MICROS, 3000);
    assert.equal(FALLBACK_ALERT_MIN_TURNS, 10);
  });

  test("an owner whose cost is greater than its revenue alerts; a cost equal to the revenue does not", async () => {
    for (const owner of ["usr_equal", "usr_over"]) insertOwner(db, owner);
    // One turn of 3 credits is 9000 USD micros of revenue.
    insertTurn(db, { cost: 9000, ownerId: "usr_equal" });
    insertTurn(db, { cost: 9001, ownerId: "usr_over" });
    const report = await assistantMarginMonitor(env(), NOW);
    assert.deepEqual(report.alerts, [{ alert: "owner_cost_over_revenue", costUsdMicros: 9001, ownerId: "usr_over", revenueUsdMicros: 9000 }]);
    assert.deepEqual(logged("assistant_margin_alert"), [
      { message: "assistant_margin_alert", alert: "owner_cost_over_revenue", costUsdMicros: 9001, ownerId: "usr_over", revenueUsdMicros: 9000 },
    ]);
    assert.equal(report.summary.revenueUsdMicros, 18000);
    assert.equal(report.summary.costUsdMicros, 18001);
  });

  test("appliance turns (cost 0, costSource appliance) count in the revenue and never raise table_cost or owner_cost", async () => {
    insertOwner(db, "usr_appliance");
    insertTurn(db, { cost: 0, costSource: "appliance", ownerId: "usr_appliance" });
    insertTurn(db, { cost: 0, costSource: "appliance", ownerId: "usr_appliance" });
    const report = await assistantMarginMonitor(env(), NOW);
    assert.deepEqual(report.alerts, []);
    assert.equal(report.summary.turns, 2);
    assert.equal(report.summary.revenueUsdMicros, 18000, "the credits of the appliance turns are revenue");
    assert.equal(report.summary.costUsdMicros, 0);
    assert.equal(report.summary.tableTurns, 0, "never costed by the table");
    assert.equal(report.summary.unknownCostTurns, 0, "cost 0 is a known cost");
    // Control: a table turn of the same owner still alerts.
    insertTurn(db, { cost: 100, costSource: "table", ownerId: "usr_appliance" });
    assert.deepEqual((await assistantMarginMonitor(env(), NOW)).alerts, [{ alert: "table_cost", ownerIds: ["usr_appliance"], tableTurns: 1 }]);
  });

  test("an owner's revenue counts every credit of its turns, and a turn without a known cost is not a cost", async () => {
    insertOwner(db, "usr_many");
    insertTurn(db, { cost: 9000, ownerId: "usr_many" });
    insertTurn(db, { cost: 9000, ownerId: "usr_many" });
    insertTurn(db, { cost: null, costSource: "none", ownerId: "usr_many" });
    const report = await assistantMarginMonitor(env(), NOW);
    assert.deepEqual(report.alerts, []);
    assert.equal(report.summary.revenueUsdMicros, 27000);
    assert.equal(report.summary.costUsdMicros, 18000);
    assert.equal(report.summary.unknownCostTurns, 1);
  });

  async function fallbackRun(turns: number, fallbacks: number) {
    db.query("DELETE FROM ai_credit_usages").run();
    for (let index = 0; index < turns; index += 1) insertTurn(db, { cost: 1000, fallback: index < fallbacks, ownerId: "usr_fallback" });
    return (await assistantMarginMonitor(env(), NOW)).alerts.filter((alert) => alert.alert === "first_link_fallback");
  }

  test("first link fallback: more than 20% of at least 10 turns alerts; below either limit it does not", async () => {
    insertOwner(db, "usr_fallback");
    assert.deepEqual(await fallbackRun(9, 5), [], "9 turns, more than half fell back: below the minimum");
    assert.deepEqual(await fallbackRun(10, 2), [], "10 turns, exactly 20%");
    assert.deepEqual(await fallbackRun(10, 3), [{ alert: "first_link_fallback", fallbackTurns: 3, turns: 10 }]);
    assert.deepEqual(await fallbackRun(50, 11), [{ alert: "first_link_fallback", fallbackTurns: 11, turns: 50 }], "22% of 50");
  });

  test("the fallback rate is over every owner's turns together", async () => {
    for (const owner of ["usr_a", "usr_b"]) insertOwner(db, owner);
    for (let index = 0; index < 5; index += 1) insertTurn(db, { cost: 0, fallback: index < 2, ownerId: "usr_a" });
    for (let index = 0; index < 5; index += 1) insertTurn(db, { cost: 0, fallback: index < 1, ownerId: "usr_b" });
    const report = await assistantMarginMonitor(env(), NOW);
    assert.deepEqual(report.alerts, [{ alert: "first_link_fallback", fallbackTurns: 3, turns: 10 }]);
  });

  test("any turn costed by the price table alerts, naming its owners", async () => {
    for (const owner of ["usr_a", "usr_b", "usr_c"]) insertOwner(db, owner);
    insertTurn(db, { cost: 100, costSource: "gateway", ownerId: "usr_a" });
    assert.deepEqual((await assistantMarginMonitor(env(), NOW)).alerts, [], "no table turn, no alert");
    insertTurn(db, { cost: 100, costSource: "table", ownerId: "usr_c" });
    insertTurn(db, { cost: 100, costSource: "table", ownerId: "usr_b" });
    insertTurn(db, { cost: 100, costSource: "table", ownerId: "usr_c" });
    assert.deepEqual((await assistantMarginMonitor(env(), NOW)).alerts, [{ alert: "table_cost", ownerIds: ["usr_b", "usr_c"], tableTurns: 3 }]);
  });

  test("a result_json that is not JSON counts as neither fallback nor table", async () => {
    insertOwner(db, "usr_odd");
    insertTurn(db, { cost: 0, ownerId: "usr_odd", resultJson: "{not json" });
    insertTurn(db, { cost: 0, ownerId: "usr_odd", resultJson: null });
    const report = await assistantMarginMonitor(env(), NOW);
    assert.equal(report.summary.turns, 2);
    assert.equal(report.summary.fallbackTurns, 0);
    assert.equal(report.summary.tableTurns, 0);
  });

  test("the index cost over 20% of the day's revenue alerts; exactly 20% does not", async () => {
    insertOwner(db, "usr_a");
    insertTurn(db, { cost: 0, ownerId: "usr_a" }); // 9000 of revenue
    const recordedAt = new Date("2026-10-16T20:00:00.000Z");
    await recordAssistantIndexCost(env(), { costSource: "gateway", costUsdMicros: 1000, kind: "embedding", model: "alibaba/qwen3-embedding-0.6b" }, recordedAt);
    await recordAssistantIndexCost(env(), { costSource: "table", costUsdMicros: 800, kind: "caption", model: "anthropic/claude-haiku-5.5" }, recordedAt);
    await recordAssistantIndexCost(env(), { costSource: "none", costUsdMicros: null, kind: "caption", model: "anthropic/claude-haiku-5.5" }, recordedAt);
    const atLimit = await assistantMarginMonitor(env(), NOW);
    assert.deepEqual(atLimit.alerts, [], "1800 is exactly 20% of 9000");
    assert.deepEqual([atLimit.summary.indexCalls, atLimit.summary.indexCostUsdMicros, atLimit.summary.indexUnknownCostCalls], [3, 1800, 1]);

    await recordAssistantIndexCost(env(), { costSource: "gateway", costUsdMicros: 1, kind: "embedding", model: "alibaba/qwen3-embedding-0.6b" }, recordedAt);
    assert.deepEqual((await assistantMarginMonitor(env(), NOW)).alerts, [{ alert: "index_cost", indexCostUsdMicros: 1801, revenueUsdMicros: 9000 }]);
  });

  test("an index cost with no revenue at all alerts; nothing at all does not", async () => {
    assert.deepEqual((await assistantMarginMonitor(env(), NOW)).alerts, []);
    await recordAssistantIndexCost(env(), { costSource: "gateway", costUsdMicros: 1, kind: "caption", model: "m" }, new Date("2026-10-16T20:00:00.000Z"));
    assert.deepEqual((await assistantMarginMonitor(env(), NOW)).alerts, [{ alert: "index_cost", indexCostUsdMicros: 1, revenueUsdMicros: 0 }]);
  });

  test("only the window counts: succeeded assistant turns completed in the 24 h before now, and index costs of those 24 h", async () => {
    insertOwner(db, "usr_a");
    const start = new Date(NOW.getTime() - 24 * 60 * 60 * 1000).toISOString();
    insertTurn(db, { completedAt: NOW.toISOString(), cost: 1, ownerId: "usr_a" }); // in: the end is inclusive
    insertTurn(db, { completedAt: new Date(NOW.getTime() - 24 * 60 * 60 * 1000 + 1).toISOString(), cost: 2, ownerId: "usr_a" }); // in
    insertTurn(db, { completedAt: start, cost: 4, ownerId: "usr_a" }); // out: the start is exclusive
    insertTurn(db, { completedAt: new Date(NOW.getTime() + 1).toISOString(), cost: 8, ownerId: "usr_a" }); // out: after now
    insertTurn(db, { cost: 16, ownerId: "usr_a", status: "refunded" });
    insertTurn(db, { cost: 32, ownerId: "usr_a", status: "reserved" });
    insertTurn(db, { cost: 64, feature: "voice_pin", ownerId: "usr_a" });
    await recordAssistantIndexCost(env(), { costSource: "gateway", costUsdMicros: 5, kind: "embedding", model: "m" }, new Date(start));
    await recordAssistantIndexCost(env(), { costSource: "gateway", costUsdMicros: 7, kind: "embedding", model: "m" }, NOW);
    const report = await assistantMarginMonitor(env(), NOW);
    assert.deepEqual([report.summary.turns, report.summary.costUsdMicros, report.summary.revenueUsdMicros], [2, 3, 18000]);
    assert.deepEqual([report.summary.indexCalls, report.summary.indexCostUsdMicros], [1, 7]);
    assert.deepEqual([report.summary.windowStart, report.summary.windowEnd], [start, NOW.toISOString()]);
  });

  test("the assistant_margin_daily summary always goes out, alerts or not, with D1 or without", async () => {
    await assistantMarginMonitor(env(), NOW);
    await assistantMarginMonitor({}, NOW);
    const summaries = logged("assistant_margin_daily");
    assert.equal(summaries.length, 2);
    assert.deepEqual(Object.keys(summaries[0]!), [
      "message", "costUsdMicros", "database", "fallbackTurns", "indexCalls", "indexCostUsdMicros", "indexUnknownCostCalls",
      "owners", "revenueUsdMicros", "tableTurns", "turns", "unknownCostTurns", "windowEnd", "windowStart", "alerts", "email",
    ]);
    assert.deepEqual([summaries[0]!.database, summaries[0]!.alerts, summaries[0]!.email], [true, 0, "off"]);
    assert.deepEqual([summaries[1]!.database, summaries[1]!.turns, summaries[1]!.alerts], [false, 0, 0]);
  });

  describe("before migration 0032", () => {
    // The same fixtures on a D1 without the two tables of 0032.
    let before0032: Database;
    beforeEach(() => {
      before0032 = migratedDatabase({ skip: "0032" });
      insertOwner(before0032, "usr_over");
      insertTurn(before0032, { cost: 20000, ownerId: "usr_over" }); // over its 9000 of revenue
    });
    afterEach(() => {
      before0032.close();
    });

    test("without either table: the rest is computed, no index cost nor email, and the job ends ok in the daily cron", async () => {
      const tables = before0032.query("SELECT name FROM sqlite_master WHERE name LIKE 'assistant_%' AND type = 'table' ORDER BY name").all();
      assert.ok(!JSON.stringify(tables).includes("assistant_index_costs") && !JSON.stringify(tables).includes("assistant_margin_emails"), JSON.stringify(tables));
      const email = fakeEmail();
      const report = await assistantMarginMonitor({ DB: sqliteD1(before0032), EMAIL: email.binding, OPS_ALERT_EMAIL: OPS }, NOW);
      assert.deepEqual(report.alerts, [{ alert: "owner_cost_over_revenue", costUsdMicros: 20000, ownerId: "usr_over", revenueUsdMicros: 9000 }]);
      assert.equal(report.email, "unavailable");
      assert.equal(email.sent.length, 0);
      const [summary] = logged("assistant_margin_daily");
      assert.deepEqual(summary, {
        message: "assistant_margin_daily",
        costUsdMicros: 20000,
        database: true,
        fallbackTurns: 0,
        indexCalls: null,
        indexCostUsdMicros: null,
        indexCosts: "unavailable",
        indexUnknownCostCalls: null,
        owners: 1,
        revenueUsdMicros: 9000,
        tableTurns: 0,
        turns: 1,
        unknownCostTurns: 0,
        windowEnd: NOW.toISOString(),
        windowStart: new Date(NOW.getTime() - 24 * 60 * 60 * 1000).toISOString(),
        alerts: 1,
        email: "unavailable",
      });

      const fetchCron = createEdgerFetch({
        jobs: [{ name: "assistantMarginMonitor", run: () => assistantMarginMonitor({ DB: sqliteD1(before0032), EMAIL: email.binding, OPS_ALERT_EMAIL: OPS }, NOW) }],
        log: () => {},
        tanstackFetch: async () => new Response("tanstack"),
      });
      const response = await fetchCron(new Request("https://pinar.test/_internal/cron/daily", { headers: { "x-edger-internal": "true" }, method: "POST" }));
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), { ok: true, jobs: [{ job: "assistantMarginMonitor", ok: true }] });

      // Control: once 0032 runs on the same D1, the index cost is read and the email goes out.
      before0032.exec(readFileSync(new URL("../../../migrations/0032_assistant_margin.sql", import.meta.url), "utf8"));
      const after = await assistantMarginMonitor({ DB: sqliteD1(before0032), EMAIL: email.binding, OPS_ALERT_EMAIL: OPS }, NOW);
      assert.equal(after.email, "sent");
      assert.deepEqual([after.summary.indexCalls, after.summary.indexCostUsdMicros, "indexCosts" in after.summary], [0, 0, false]);
    });

    test("with the index costs but without the email days, the index cost is read and no email goes out", async () => {
      const db0032 = migratedDatabase();
      try {
        insertOwner(db0032, "usr_over");
        insertTurn(db0032, { cost: 20000, ownerId: "usr_over" });
        await recordAssistantIndexCost({ DB: sqliteD1(db0032) }, { costSource: "gateway", costUsdMicros: 5, kind: "embedding", model: "m" }, new Date("2026-10-16T20:00:00.000Z"));
        db0032.exec("DROP TABLE assistant_margin_emails");
        const email = fakeEmail();
        const report = await assistantMarginMonitor({ DB: sqliteD1(db0032), EMAIL: email.binding, OPS_ALERT_EMAIL: OPS }, NOW);
        assert.equal(report.email, "unavailable");
        assert.equal(email.sent.length, 0);
        assert.deepEqual([report.summary.indexCalls, report.summary.indexCostUsdMicros, "indexCosts" in report.summary], [1, 5, false]);
      } finally {
        db0032.close();
      }
    });
  });

  describe("email", () => {
    function alerting(ownerId = "usr_over") {
      insertOwner(db, ownerId);
      insertTurn(db, { cost: 20000, ownerId });
    }

    test("with OPS_ALERT_EMAIL and an alert: one email from noreply@pinar.dev listing the owner ids", async () => {
      alerting();
      insertOwner(db, "usr_table");
      insertTurn(db, { cost: 10, costSource: "table", ownerId: "usr_table" });
      const email = fakeEmail();
      const report = await assistantMarginMonitor(env({ EMAIL: email.binding, OPS_ALERT_EMAIL: OPS }), NOW);
      assert.equal(report.email, "sent");
      assert.equal(email.sent.length, 1);
      const [message] = email.sent;
      assert.deepEqual(message!.from, { email: "noreply@pinar.dev", name: "Pinar" });
      assert.equal(message!.to, OPS);
      assert.equal(message!.subject, "Pinar assistant margin alerts 2026-10-17");
      assert.equal(message!.text, [
        "Pinar assistant margin alerts for 2026-10-17 (UTC):",
        "- owner_cost_over_revenue: owner usr_over, cost 20000 > revenue 9000 USD micros",
        "- table_cost: 1 turn(s) costed by the price table, owners usr_table",
        "",
      ].join("\n"));
      assert.ok(message!.html.includes("<li>owner_cost_over_revenue: owner usr_over, cost 20000 &#62; revenue 9000 USD micros</li>"));
    });

    test("at most one a day: a second run that day sends nothing; the next day sends again", async () => {
      alerting();
      const email = fakeEmail();
      const withEmail = env({ EMAIL: email.binding, OPS_ALERT_EMAIL: OPS });
      assert.equal((await assistantMarginMonitor(withEmail, NOW)).email, "sent");
      const later = new Date(NOW.getTime() + 60 * 60 * 1000);
      const second = await assistantMarginMonitor(withEmail, later);
      assert.equal(second.email, "already_sent");
      assert.equal(second.alerts.length, 1, "the alert is still logged");
      assert.equal(email.sent.length, 1);

      const nextDay = new Date(NOW.getTime() + 24 * 60 * 60 * 1000);
      insertTurn(db, { completedAt: new Date(nextDay.getTime() - 1000).toISOString(), cost: 20000, ownerId: "usr_over" });
      assert.equal((await assistantMarginMonitor(withEmail, nextDay)).email, "sent");
      assert.equal(email.sent.length, 2);
      assert.deepEqual(db.query("SELECT day FROM assistant_margin_emails ORDER BY day").all(), [{ day: "2026-10-17" }, { day: "2026-10-18" }]);
    });

    test("no email without OPS_ALERT_EMAIL, without an alert or without the email binding", async () => {
      const email = fakeEmail();
      assert.equal((await assistantMarginMonitor(env({ EMAIL: email.binding, OPS_ALERT_EMAIL: OPS }), NOW)).email, "no_alerts");
      alerting();
      assert.equal((await assistantMarginMonitor(env({ EMAIL: email.binding }), NOW)).email, "off");
      assert.equal((await assistantMarginMonitor(env({ EMAIL: email.binding, OPS_ALERT_EMAIL: "  " }), NOW)).email, "off");
      assert.equal((await assistantMarginMonitor(env({ OPS_ALERT_EMAIL: OPS }), NOW)).email, "unavailable");
      assert.equal(email.sent.length, 0);
      assert.deepEqual(db.query("SELECT day FROM assistant_margin_emails").all(), []);
    });

    test("a failed send is logged, gives the day back and does not fail the job; the next run that day sends", async () => {
      alerting();
      const email = fakeEmail(1);
      const withEmail = env({ EMAIL: email.binding, OPS_ALERT_EMAIL: OPS });
      const failed = await assistantMarginMonitor(withEmail, NOW);
      assert.equal(failed.email, "failed");
      assert.deepEqual(logged("assistant_margin_email_failed"), [{ message: "assistant_margin_email_failed", day: "2026-10-17" }]);
      assert.deepEqual(db.query("SELECT day FROM assistant_margin_emails").all(), []);
      assert.equal(logged("assistant_margin_daily").at(-1)!.email, "failed");
      assert.equal((await assistantMarginMonitor(withEmail, NOW)).email, "sent");
      assert.equal(email.sent.length, 1);
    });

    test("in the daily cron, a failing email leaves the job and the others ok", async () => {
      alerting();
      const email = fakeEmail(1);
      const ran: string[] = [];
      const cronLogs: string[] = [];
      const fetchCron = createEdgerFetch({
        jobs: [
          { name: "assistantMarginMonitor", run: () => assistantMarginMonitor(env({ EMAIL: email.binding, OPS_ALERT_EMAIL: OPS }), NOW) },
        ],
        log: (line) => cronLogs.push(line),
        tanstackFetch: async () => new Response("tanstack"),
      });
      const response = await fetchCron(new Request("https://pinar.test/_internal/cron/daily", { headers: { "x-edger-internal": "true" }, method: "POST" }));
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), { ok: true, jobs: [{ job: "assistantMarginMonitor", ok: true }] });
      assert.deepEqual(ran, []);
      assert.deepEqual(logged("assistant_margin_email_failed").length, 1);
    });
  });

  test("privacy: no email address of a user in any log line or email, and no read of the users table", async () => {
    for (const owner of ["usr_over", "usr_table", "usr_quiet"]) insertOwner(db, owner);
    insertTurn(db, { cost: 20000, ownerId: "usr_over" });
    insertTurn(db, { cost: 10, costSource: "table", ownerId: "usr_table" });
    for (let index = 0; index < 10; index += 1) insertTurn(db, { cost: 0, fallback: index < 5, ownerId: "usr_quiet" });
    await recordAssistantIndexCost(env(), { costSource: "gateway", costUsdMicros: 999999, kind: "caption", model: "m" }, new Date("2026-10-16T20:00:00.000Z"));
    const email = fakeEmail();
    const report = await assistantMarginMonitor(env({ EMAIL: email.binding, OPS_ALERT_EMAIL: OPS }), NOW);
    assert.deepEqual(report.alerts.map((alert) => alert.alert), ["owner_cost_over_revenue", "first_link_fallback", "table_cost", "index_cost"]);
    const outputs = [...lines.map((line) => line.text), ...email.sent.flatMap((message) => [message.subject, message.text, message.html])];
    assert.ok(outputs.length > 4);
    for (const output of outputs) {
      assert.ok(!output.includes("@private.example"), output);
      for (const owner of ["usr_over", "usr_table", "usr_quiet"]) assert.ok(!output.includes(userEmail(owner)), output);
    }
    assert.ok(queries.length > 0);
    for (const query of queries) assert.ok(!/\busers\b/.test(query), query);
  });

  test("recordAssistantIndexCost writes the log line's fields only, and nothing without D1", async () => {
    await recordAssistantIndexCost(env(), { costSource: "table", costUsdMicros: 20, kind: "embedding", model: "openai/text-embedding-3-small" }, NOW);
    await recordAssistantIndexCost({}, { costSource: "table", costUsdMicros: 20, kind: "embedding", model: "x" }, NOW);
    const rows = db.query("SELECT kind, model, cost_usd_micros, cost_source, created_at FROM assistant_index_costs").all();
    assert.deepEqual(rows, [{ cost_source: "table", cost_usd_micros: 20, created_at: NOW.toISOString(), kind: "embedding", model: "openai/text-embedding-3-small" }]);
    assert.deepEqual(db.query("PRAGMA table_info(assistant_index_costs)").all().map((column) => (column as { name: string }).name), [
      "id", "kind", "model", "cost_usd_micros", "cost_source", "created_at",
    ]);
  });
});

describe("OPS_ALERT_EMAIL in the env", () => {
  test("EdgeR reads it by name, blank as absent, and the runtime env keeps it", () => {
    assert.equal(edgerCloudEnv((name) => (name === "OPS_ALERT_EMAIL" ? OPS : undefined)).OPS_ALERT_EMAIL, OPS);
    assert.equal(edgerCloudEnv((name) => (name === "OPS_ALERT_EMAIL" ? "  " : undefined)).OPS_ALERT_EMAIL, undefined);
    assert.equal(runtimeEnv({ OPS_ALERT_EMAIL: OPS }).OPS_ALERT_EMAIL, OPS);
  });

  test("the EdgeR manifest declares it empty, and the smoke scrubs it", () => {
    const manifest = Bun.YAML.parse(readFileSync(new URL("../../../edger/manifest.yaml", import.meta.url), "utf8")) as { env: Record<string, string> };
    assert.equal(manifest.env.OPS_ALERT_EMAIL, "");
    assert.match(readFileSync(new URL("../../../scripts/edger-smoke.mjs", import.meta.url), "utf8"), /^ {2}"OPS_ALERT_EMAIL",$/m);
  });
});

describe("the daily retention of the margin records (cleanupOldRecords)", () => {
  const DAY = 24 * 60 * 60 * 1000;
  const at = (daysAgo: number, extraMs = 0) => new Date(NOW.getTime() - daysAgo * DAY - extraMs).toISOString();

  afterEach(() => {
    setCloudNowForTests(null);
  });

  test("deletes the index costs and the email days older than 30 days and keeps the rest", async () => {
    const db = migratedDatabase();
    try {
      assert.equal(ASSISTANT_MARGIN_RETENTION_DAYS, 30);
      const env: CloudEnv = { DB: sqliteD1(db) };
      // Older than 30 days by 1 ms, exactly 30 days, 29 days, now.
      for (const [index, createdAt] of [at(30, 1), at(30), at(29), NOW.toISOString()].entries()) {
        db.query("INSERT INTO assistant_index_costs (id, kind, model, cost_usd_micros, cost_source, created_at) VALUES (?, 'embedding', 'm', 1, 'gateway', ?)")
          .run(`cost_${index}`, createdAt);
      }
      for (const [day, createdAt] of [["2026-09-01", at(46)], ["2026-09-17", at(30)], ["2026-10-16", at(1)]] as const) {
        db.query("INSERT INTO assistant_margin_emails (day, created_at) VALUES (?, ?)").run(day, createdAt);
      }
      setCloudNowForTests(NOW.toISOString());
      const cleaned = await cleanupOldRecords(env);
      assert.deepEqual(cleaned.assistantMargin, { emails: 1, indexCosts: 1 });
      assert.deepEqual(db.query("SELECT id FROM assistant_index_costs ORDER BY id").all(), [{ id: "cost_1" }, { id: "cost_2" }, { id: "cost_3" }]);
      assert.deepEqual(db.query("SELECT day FROM assistant_margin_emails ORDER BY day").all(), [{ day: "2026-09-17" }, { day: "2026-10-16" }]);
    } finally {
      db.close();
    }
  });

  test("before migration 0032, or without D1, the rest of the cleanup still runs", async () => {
    const db = migratedDatabase({ skip: "0032" });
    try {
      setCloudNowForTests(NOW.toISOString());
      const cleaned = await cleanupOldRecords({ DB: sqliteD1(db) });
      assert.deepEqual(cleaned.assistantMargin, { emails: 0, indexCosts: 0 });
      assert.equal(cleaned.deletedCount, 0);
      assert.deepEqual((await cleanupOldRecords({})).assistantMargin, { emails: 0, indexCosts: 0 });
    } finally {
      db.close();
    }
  });
});
