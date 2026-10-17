// Daily margin monitor of the assistant (F4 contract §3, decision A41).
//
// assistantMarginMonitor(env, now) reads the 24 h before `now`
// (completed_at or created_at in (now - 24 h, now]) from D1:
// - per owner, the succeeded assistant_turn usages: revenue = credits ×
//   AI_CREDIT_REVENUE_USD_MICROS, cost = SUM(cost_usd_micros); a turn with
//   a null cost counts in unknownCostTurns, not in the cost;
// - over every turn, the fallbacks of the chain's first link and the turns
//   costed by the price table, from result_json { costSource, fallback };
// - the index's gateway costs (assistant_index_costs) against the window's
//   revenue.
//
// Alerts, one `assistant_margin_alert` line each (owner ids are the
// internal ids; no email or name is ever read):
// - owner_cost_over_revenue: an owner's cost is greater than its revenue;
// - first_link_fallback: more than 20% of the turns fell back, with at
//   least FALLBACK_ALERT_MIN_TURNS turns;
// - table_cost: any turn costed by the table;
// - index_cost: the index cost is greater than 20% of the revenue.
// One `assistant_margin_daily` summary line always goes out, alerts or not.
//
// With OPS_ALERT_EMAIL, env.EMAIL and at least one alert, one email per UTC
// day lists the alerts (owner ids only), from noreply@pinar.dev. The day is
// claimed in assistant_margin_emails before sending (INSERT … ON CONFLICT DO
// NOTHING), so a second run that day sends nothing; a failed send logs
// `assistant_margin_email_failed`, gives the day back and the job goes on.
// Without D1 there is no durable usage to read: the summary says so and no
// alert is raised. On a D1 before migration 0032 (its tables absent from
// sqlite_master), the rest is computed without the index cost: no
// index_cost alert, `indexCosts: "unavailable"` and null index figures in the
// summary; without assistant_margin_emails no email goes out
// (`email: "unavailable"`). The job ends normally either way.
//
// recordAssistantIndexCost is the recorder cloud-api.ts gives the gateway
// calls of the index (pin search, index cron, capture filing); the appliance
// records nothing. cleanupAssistantMarginRecords, run by cleanupOldRecords,
// keeps 30 days of index costs and claimed email days.

import type { CloudEnv } from "../cloud-api";

/** The revenue of one credit in USD micros (US$ 0.003, F4 contract §3). */
export const AI_CREDIT_REVENUE_USD_MICROS = 3000;
export const MARGIN_WINDOW_MS = 24 * 60 * 60 * 1000;
export const FALLBACK_ALERT_MIN_TURNS = 10;
// The 20% limits, compared in integers: part × 5 > whole.
const ALERT_SHARE_DIVISOR = 5;

export type AssistantMarginAlert =
  | { alert: "owner_cost_over_revenue"; costUsdMicros: number; ownerId: string; revenueUsdMicros: number }
  | { alert: "first_link_fallback"; fallbackTurns: number; turns: number }
  | { alert: "table_cost"; ownerIds: string[]; tableTurns: number }
  | { alert: "index_cost"; indexCostUsdMicros: number; revenueUsdMicros: number };

export type AssistantMarginEmail = "already_sent" | "failed" | "no_alerts" | "off" | "sent" | "unavailable";

export interface AssistantMarginSummary {
  costUsdMicros: number;
  database: boolean;
  fallbackTurns: number;
  // null with indexCosts "unavailable": D1 before migration 0032.
  indexCalls: number | null;
  indexCostUsdMicros: number | null;
  indexCosts?: "unavailable";
  indexUnknownCostCalls: number | null;
  owners: number;
  revenueUsdMicros: number;
  tableTurns: number;
  turns: number;
  unknownCostTurns: number;
  windowEnd: string;
  windowStart: string;
}

export interface AssistantMarginReport {
  alerts: AssistantMarginAlert[];
  email: AssistantMarginEmail;
  summary: AssistantMarginSummary;
}

interface OwnerTurns {
  costUsdMicros: number;
  credits: number;
  fallbackTurns: number;
  ownerId: string;
  tableTurns: number;
  turns: number;
  unknownCostTurns: number;
}

type MarginDatabase = NonNullable<CloudEnv["DB"]>;

// A field of result_json, or null when the column is not valid JSON (CASE
// keeps json_extract from reading an invalid value).
const resultField = (path: string) => `CASE WHEN json_valid(result_json) THEN json_extract(result_json, '${path}') END`;

function count(value: unknown): number {
  const number = Number(value ?? 0);
  return Number.isFinite(number) ? number : 0;
}

async function ownerTurns(db: MarginDatabase, from: string, to: string): Promise<OwnerTurns[]> {
  const rows = await db.prepare(`
    SELECT owner_id,
      COUNT(*) AS turns,
      COALESCE(SUM(credits), 0) AS credits,
      COALESCE(SUM(cost_usd_micros), 0) AS cost_usd_micros,
      SUM(CASE WHEN cost_usd_micros IS NULL THEN 1 ELSE 0 END) AS unknown_cost_turns,
      SUM(CASE WHEN ${resultField("$.fallback")} = 1 THEN 1 ELSE 0 END) AS fallback_turns,
      SUM(CASE WHEN ${resultField("$.costSource")} = 'table' THEN 1 ELSE 0 END) AS table_turns
    FROM ai_credit_usages
    WHERE feature = 'assistant_turn' AND status = 'succeeded' AND completed_at > ? AND completed_at <= ?
    GROUP BY owner_id
    ORDER BY owner_id
  `).bind(from, to).all();
  return (rows.results ?? []).map((row) => ({
    costUsdMicros: count(row.cost_usd_micros),
    credits: count(row.credits),
    fallbackTurns: count(row.fallback_turns),
    ownerId: String(row.owner_id),
    tableTurns: count(row.table_turns),
    turns: count(row.turns),
    unknownCostTurns: count(row.unknown_cost_turns),
  }));
}

const INDEX_COSTS_TABLE = "assistant_index_costs";
const EMAILS_TABLE = "assistant_margin_emails";

// The tables of migration 0032 that this D1 has (none before it).
async function marginTables(db: MarginDatabase): Promise<Set<string>> {
  const rows = await db.prepare(
    `SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('${INDEX_COSTS_TABLE}', '${EMAILS_TABLE}')`,
  ).all();
  return new Set((rows.results ?? []).map((row) => String(row.name)));
}

async function indexCosts(db: MarginDatabase, from: string, to: string) {
  const row = await db.prepare(`
    SELECT COUNT(*) AS calls,
      COALESCE(SUM(cost_usd_micros), 0) AS cost_usd_micros,
      SUM(CASE WHEN cost_usd_micros IS NULL THEN 1 ELSE 0 END) AS unknown_cost_calls
    FROM assistant_index_costs
    WHERE created_at > ? AND created_at <= ?
  `).bind(from, to).first();
  return {
    calls: count(row?.calls),
    costUsdMicros: count(row?.cost_usd_micros),
    unknownCostCalls: count(row?.unknown_cost_calls),
  };
}

/**
 * The alerts of one window, in a fixed order: owners (by id), fallback,
 * table, index; no index alert when the index cost is unavailable (null).
 */
export function assistantMarginAlerts(owners: OwnerTurns[], index: { costUsdMicros: number } | null): AssistantMarginAlert[] {
  const alerts: AssistantMarginAlert[] = [];
  let revenue = 0;
  let turns = 0;
  let fallbackTurns = 0;
  for (const owner of owners) {
    const ownerRevenue = owner.credits * AI_CREDIT_REVENUE_USD_MICROS;
    revenue += ownerRevenue;
    turns += owner.turns;
    fallbackTurns += owner.fallbackTurns;
    if (owner.costUsdMicros > ownerRevenue) {
      alerts.push({ alert: "owner_cost_over_revenue", costUsdMicros: owner.costUsdMicros, ownerId: owner.ownerId, revenueUsdMicros: ownerRevenue });
    }
  }
  if (turns >= FALLBACK_ALERT_MIN_TURNS && fallbackTurns * ALERT_SHARE_DIVISOR > turns) {
    alerts.push({ alert: "first_link_fallback", fallbackTurns, turns });
  }
  const tabled = owners.filter((owner) => owner.tableTurns > 0);
  if (tabled.length > 0) {
    alerts.push({ alert: "table_cost", ownerIds: tabled.map((owner) => owner.ownerId), tableTurns: tabled.reduce((sum, owner) => sum + owner.tableTurns, 0) });
  }
  if (index !== null && index.costUsdMicros * ALERT_SHARE_DIVISOR > revenue) {
    alerts.push({ alert: "index_cost", indexCostUsdMicros: index.costUsdMicros, revenueUsdMicros: revenue });
  }
  return alerts;
}

function alertLine(alert: AssistantMarginAlert): string {
  switch (alert.alert) {
    case "owner_cost_over_revenue":
      return `owner_cost_over_revenue: owner ${alert.ownerId}, cost ${alert.costUsdMicros} > revenue ${alert.revenueUsdMicros} USD micros`;
    case "first_link_fallback":
      return `first_link_fallback: ${alert.fallbackTurns} of ${alert.turns} turns answered by a later link`;
    case "table_cost":
      return `table_cost: ${alert.tableTurns} turn(s) costed by the price table, owners ${alert.ownerIds.join(", ")}`;
    case "index_cost":
      return `index_cost: index ${alert.indexCostUsdMicros} > 20% of revenue ${alert.revenueUsdMicros} USD micros`;
  }
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (character) => `&#${character.charCodeAt(0)};`);
}

async function sendAlertEmail(
  env: CloudEnv,
  db: MarginDatabase | undefined,
  alerts: AssistantMarginAlert[],
  now: Date,
  claimable: boolean, // assistant_margin_emails exists
): Promise<AssistantMarginEmail> {
  const to = env.OPS_ALERT_EMAIL?.trim();
  if (!to) return "off";
  if (alerts.length === 0) return "no_alerts";
  if (!env.EMAIL || !db || !claimable) return "unavailable";
  const day = now.toISOString().slice(0, 10);
  const claimed = await db.prepare(
    "INSERT INTO assistant_margin_emails (day, created_at) VALUES (?, ?) ON CONFLICT(day) DO NOTHING RETURNING day",
  ).bind(day, now.toISOString()).first();
  if (!claimed) return "already_sent";
  const lines = alerts.map(alertLine);
  try {
    await env.EMAIL.send({
      from: { email: "noreply@pinar.dev", name: "Pinar" },
      html: `<p>Pinar assistant margin alerts for ${day} (UTC):</p><ul>${lines.map((line) => `<li>${escapeHtml(line)}</li>`).join("")}</ul>`,
      subject: `Pinar assistant margin alerts ${day}`,
      text: `Pinar assistant margin alerts for ${day} (UTC):\n${lines.map((line) => `- ${line}`).join("\n")}\n`,
      to,
    });
    return "sent";
  } catch {
    console.error(JSON.stringify({ message: "assistant_margin_email_failed", day }));
    try {
      await db.prepare("DELETE FROM assistant_margin_emails WHERE day = ?").bind(day).run();
    } catch {
      // The day stays claimed: no other email goes out today.
    }
    return "failed";
  }
}

/** The daily job (F4 contract §3): logs the alerts and the summary, and emails the alerts at most once a day. */
export async function assistantMarginMonitor(env: CloudEnv, now: Date = new Date()): Promise<AssistantMarginReport> {
  const windowEnd = now.toISOString();
  const windowStart = new Date(now.getTime() - MARGIN_WINDOW_MS).toISOString();
  const db = env.DB;
  const tables = db ? await marginTables(db) : new Set<string>();
  const owners = db ? await ownerTurns(db, windowStart, windowEnd) : [];
  // Before migration 0032 the index cost is unavailable (null).
  const index = !db
    ? { calls: 0, costUsdMicros: 0, unknownCostCalls: 0 }
    : tables.has(INDEX_COSTS_TABLE)
      ? await indexCosts(db, windowStart, windowEnd)
      : null;
  const alerts = assistantMarginAlerts(owners, index);
  for (const alert of alerts) console.warn(JSON.stringify({ message: "assistant_margin_alert", ...alert }));
  const email = await sendAlertEmail(env, db, alerts, now, tables.has(EMAILS_TABLE));
  const summary: AssistantMarginSummary = {
    costUsdMicros: owners.reduce((sum, owner) => sum + owner.costUsdMicros, 0),
    database: Boolean(db),
    fallbackTurns: owners.reduce((sum, owner) => sum + owner.fallbackTurns, 0),
    indexCalls: index?.calls ?? null,
    indexCostUsdMicros: index?.costUsdMicros ?? null,
    ...(index === null ? { indexCosts: "unavailable" as const } : {}),
    indexUnknownCostCalls: index?.unknownCostCalls ?? null,
    owners: owners.length,
    revenueUsdMicros: owners.reduce((sum, owner) => sum + owner.credits * AI_CREDIT_REVENUE_USD_MICROS, 0),
    tableTurns: owners.reduce((sum, owner) => sum + owner.tableTurns, 0),
    turns: owners.reduce((sum, owner) => sum + owner.turns, 0),
    unknownCostTurns: owners.reduce((sum, owner) => sum + owner.unknownCostTurns, 0),
    windowEnd,
    windowStart,
  };
  console.info(JSON.stringify({ message: "assistant_margin_daily", ...summary, alerts: alerts.length, email }));
  return { alerts, email, summary };
}

export type AssistantIndexCostKind = "caption" | "embedding";
export type AssistantIndexCostSource = "gateway" | "none" | "table";
export interface AssistantIndexCostEntry {
  costSource: AssistantIndexCostSource;
  costUsdMicros: number | null;
  kind: AssistantIndexCostKind;
  model: string;
}

/**
 * Records one index cost (the fields of the assistant_index_cost log line)
 * for the monitor; nothing without D1.
 */
export async function recordAssistantIndexCost(
  env: Pick<CloudEnv, "DB">,
  entry: AssistantIndexCostEntry,
  now: Date = new Date(),
): Promise<void> {
  if (!env.DB) return;
  await env.DB.prepare(
    "INSERT INTO assistant_index_costs (id, kind, model, cost_usd_micros, cost_source, created_at) VALUES (?, ?, ?, ?, ?, ?)",
  ).bind(crypto.randomUUID(), entry.kind, entry.model, entry.costUsdMicros, entry.costSource, now.toISOString()).run();
}

/** Days the index costs and the claimed email days are kept. */
export const ASSISTANT_MARGIN_RETENTION_DAYS = 30;

/**
 * The daily retention (cleanupOldRecords): deletes the index costs and the
 * claimed email days created more than 30 days before `now`, and keeps the
 * rest. Nothing without D1, or before migration 0032 created the tables.
 */
export async function cleanupAssistantMarginRecords(
  env: Pick<CloudEnv, "DB">,
  now: Date,
): Promise<{ emails: number; indexCosts: number }> {
  const db = env.DB;
  if (!db) return { emails: 0, indexCosts: 0 };
  const tables = await marginTables(db);
  if (!tables.has(INDEX_COSTS_TABLE) || !tables.has(EMAILS_TABLE)) return { emails: 0, indexCosts: 0 };
  const cutoff = new Date(now.getTime() - ASSISTANT_MARGIN_RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const indexCosts = await db.prepare("DELETE FROM assistant_index_costs WHERE created_at < ?").bind(cutoff).run();
  const emails = await db.prepare("DELETE FROM assistant_margin_emails WHERE created_at < ?").bind(cutoff).run();
  return { emails: count(emails.meta?.changes), indexCosts: count(indexCosts.meta?.changes) };
}
