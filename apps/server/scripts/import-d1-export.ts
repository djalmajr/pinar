/**
 * Imports a `wrangler d1 export` dump into an **empty** libSQL (sqld)
 * database, all or nothing. The dump is first staged in an in-memory
 * SQLite database; the schema (tables and views), the rows,
 * `sqlite_sequence`, the indexes and the triggers are then copied to the
 * destination in a single write transaction; and only after the commit is
 * the destination verified
 * against the staged copy. `d1_migrations` — the same history table
 * `wrangler d1` uses — comes along in the dump itself, so the migrated
 * destination already carries the history.
 *
 *   bun scripts/import-d1-export.ts <export.sql> [--dry-run]
 *
 * Reads `DATABASE_URL` (required) and `DATABASE_AUTH_TOKEN` (optional).
 * The token and the full URL are never printed; at most the host is.
 *
 * Exit codes: 0 success; 1 guard, import or verification failure; 2
 * invalid usage (missing file, unknown flag, missing `DATABASE_URL`).
 */
import { readFileSync } from "node:fs";
import { createClient, type Client, type InValue } from "@libsql/client";
import { Database } from "bun:sqlite";

import {
  databaseTarget,
  defaultMigrationsDir,
  migrationFiles,
  safeErrorMessage,
} from "./migrate-libsql";

/** Rows of one table are sent to the destination in batches of this size. */
const BATCH_SIZE = 500;
/** Staged objects copied to the destination. */
const COPIED_TABLES_SQL = "type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%'";
/** Staged views copied to the destination (the internal ones are not). */
const COPIED_VIEWS_SQL = "type = 'view' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%'";
/** Tables that may already exist in the destination (internal, not data). */
const EMPTY_TARGET_SQL = "type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_litestream%'";

export interface ImportD1ExportOptions {
  /** The checkout's migrations directory (`defaultMigrationsDir()` in the CLI). */
  migrationsDir: string;
  dryRun?: boolean;
  log?: (line: string) => void;
}

export interface ImportD1ExportResult {
  /** Tables copied (`sqlite_%` and `_cf_%` excluded). */
  tables: number;
  /** Rows copied across those tables. */
  rows: number;
  byTable: Array<{ table: string; count: number }>;
}

/** A usage error: the run has a dedicated exit code. */
class CliError extends Error {
  constructor(message: string, readonly exitCode: number) {
    super(message);
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message.length > 0 ? error.message : String(error);
}

/** Quote an SQL identifier taken from `sqlite_master` (never user input). */
function quote(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

/**
 * Rows read from the staging are bound to the destination as-is:
 * `bun:sqlite` with `safeIntegers` returns 64-bit integers as `bigint`,
 * and the libSQL client binds `bigint` exactly (no lossy `Number` step).
 */
function asCount(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "bigint") return Number(value);
  throw new Error("count is not a number");
}

interface StagedObject {
  name: string;
  sql: string;
  /** The entry's `tbl_name` (indexes and triggers; `null` for the rest). */
  tblName: string | null;
}

/** Objects of `sqlite_master` in creation (`rowid`) order. */
function stagedObjects(staging: Database, clause: string): StagedObject[] {
  const rows = staging.query(`SELECT name, sql, tbl_name FROM sqlite_master WHERE ${clause} ORDER BY rowid`).all() as Array<{
    name: string;
    sql: string | null;
    tbl_name: string | null;
  }>;
  return rows.map((row) => {
    if (typeof row.sql !== "string") throw new Error(`sqlite_master.sql is missing for ${row.name}`);
    return { name: String(row.name), sql: row.sql, tblName: row.tbl_name === null ? null : String(row.tbl_name) };
  });
}

/** The names recorded in the staged `d1_migrations` (empty when absent). */
function stagingHistoryNames(staging: Database): string[] {
  const present = staging.query("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'd1_migrations'").all();
  if (present.length === 0) return [];
  return (staging.query("SELECT name FROM d1_migrations ORDER BY name").all() as Array<{ name: string }>).map((row) => String(row.name));
}

function stagingRowCount(staging: Database, table: string): number {
  const row = staging.query(`SELECT COUNT(*) AS n FROM ${quote(table)}`).get() as { n: unknown } | null;
  if (row === null) throw new Error(`cannot count ${table}`);
  return asCount(row.n);
}

/**
 * The order in which the tables' rows are copied: referenced (parent)
 * tables before the tables that reference them. The copy transaction also
 * sets `PRAGMA defer_foreign_keys = ON` (it holds over both the `file:` and
 * HTTP transports), which is what accepts rows that reference later rows of
 * the same table, such as a collection whose parent was created after it;
 * the parent-first order is a second line for references across tables.
 * Ties — and any cycle — keep the `sqlite_master` order, so the copy is
 * deterministic. A genuine violation still fails the copy and the
 * transaction rolls back.
 */
function copyOrder(staging: Database, tableNames: string[]): string[] {
  const copies = new Set(tableNames);
  const references = new Map<string, string[]>();
  for (const name of tableNames) {
    const fks = staging.query(`PRAGMA foreign_key_list(${JSON.stringify(name)})`).all() as Array<{ table: string }>;
    const refs = [...new Set(fks.map((fk) => String(fk.table)))].filter((ref) => copies.has(ref) && ref !== name);
    references.set(name, refs);
  }
  const order: string[] = [];
  const placed = new Set<string>();
  while (order.length < tableNames.length) {
    let progressed = false;
    for (const name of tableNames) {
      if (placed.has(name)) continue;
      const pending = (references.get(name) ?? []).filter((ref) => !placed.has(ref));
      if (pending.length > 0) continue;
      order.push(name);
      placed.add(name);
      progressed = true;
    }
    if (!progressed) {
      // A cycle among references: keep the `sqlite_master` order for the
      // members and let a real violation fail the copy.
      for (const name of tableNames) {
        if (!placed.has(name)) {
          order.push(name);
          placed.add(name);
        }
      }
    }
  }
  return order;
}

/**
 * Imports the dump. Guards run before any write; the copy runs in a
 * single write transaction, so a failure before the commit rolls it back
 * and the destination stays empty; a failure of the commit confirmation
 * leaves the outcome unknown (the target may have been written);
 * verification runs after the commit, and any failure there reports that
 * the target was written.
 */
export async function importD1Export(
  client: Client,
  dumpSql: string,
  options: ImportD1ExportOptions,
): Promise<ImportD1ExportResult> {
  const log = options.log ?? (() => undefined);
  // `safeIntegers` reads every 64-bit integer from the dump as a `bigint`,
  // so values above 2^53 survive the staging round-trip exactly.
  const staging = new Database(":memory:", { safeIntegers: true });
  try {
    // Step 1 — stage the whole dump in an in-memory SQLite database. The
    // staged database is the source of truth: its `sqlite_master` provides
    // the DDL and its tables the rows.
    try {
      staging.exec(dumpSql);
    } catch (error) {
      throw new Error(`export file is not valid SQLite: ${errorMessage(error)}`);
    }

    // Step 2 — the guards, before any write to the destination.
    const foreign = await client.execute(`SELECT name FROM sqlite_master WHERE ${EMPTY_TARGET_SQL} ORDER BY name`);
    const foreignTables = foreign.rows.map((row) => String(row.name));
    if (foreignTables.length > 0) {
      throw new Error(`target database is not empty: ${foreignTables.join(", ")}`);
    }
    const known = new Set(migrationFiles(options.migrationsDir));
    const unknown = stagingHistoryNames(staging).filter((name) => !known.has(name));
    if (unknown.length > 0) {
      throw new Error(`export has migrations unknown to this checkout: ${unknown.join(", ")}`);
    }

    const tables = stagedObjects(staging, COPIED_TABLES_SQL);
    const byTable = tables.map((table) => ({ table: table.name, count: stagingRowCount(staging, table.name) }));
    const totalRows = byTable.reduce((sum, entry) => sum + entry.count, 0);
    if (options.dryRun) {
      for (const entry of byTable) log(`${entry.table} ${entry.count}`);
      log(`dry run ok: ${tables.length} tables, ${totalRows} rows`);
      return { tables: tables.length, rows: totalRows, byTable };
    }

    // Step 3 — the all-or-nothing copy.
    const views = stagedObjects(staging, COPIED_VIEWS_SQL);
    // Indexes and triggers are only copied when the object they belong to
    // (their `tbl_name`) was copied: the ones of the dropped internal
    // tables (`_cf_%`) would fail on a table that is never created.
    const copiedNames = new Set<string>(tables.map((table) => table.name).concat(views.map((view) => view.name)));
    const indexes = stagedObjects(staging, "type = 'index' AND sql IS NOT NULL").filter(
      (object) => object.tblName !== null && copiedNames.has(object.tblName),
    );
    const triggers = stagedObjects(staging, "type = 'trigger'").filter(
      (object) => object.tblName !== null && copiedNames.has(object.tblName),
    );
    const order = copyOrder(staging, tables.map((table) => table.name));
    const transaction = await client.transaction("write");
    try {
      await transaction.execute("PRAGMA defer_foreign_keys = ON");
      for (const table of tables) {
        await transaction.execute(table.sql);
      }
      for (const name of order) {
        const columns = staging
          .query(`PRAGMA table_info(${JSON.stringify(name)})`)
          .all()
          .map((column) => String((column as { name: unknown }).name));
        const rows = staging.query(`SELECT * FROM ${quote(name)}`).all() as Array<Record<string, InValue>>;
        // `SELECT *` carries the rows' 64-bit integers as `bigint`
        // (the staging opened with `safeIntegers`); the bind below keeps
        // them exact — `InValue` is the domain the libSQL client binds.
        if (rows.length === 0) continue;
        const insert = `INSERT INTO ${quote(name)} (${columns.map(quote).join(", ")}) VALUES (${columns.map(() => "?").join(", ")})`;
        for (let start = 0; start < rows.length; start += BATCH_SIZE) {
          const batch = rows.slice(start, start + BATCH_SIZE);
          await transaction.batch(
            batch.map((row) => ({
              sql: insert,
              args: columns.map((column) => row[column]),
            })),
          );
        }
      }
      const sequencePresent = staging.query("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'sqlite_sequence'").all();
      if (sequencePresent.length > 0) {
        const sequence = staging.query("SELECT name, seq FROM sqlite_sequence").all() as Array<{ name: string; seq: InValue }>;
        if (sequence.length > 0) {
          const targetHasSequence = (
            await transaction.execute("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'sqlite_sequence'")
          ).rows.length > 0;
          if (targetHasSequence) {
            await transaction.execute("DELETE FROM sqlite_sequence");
          } else {
            await transaction.execute("CREATE TABLE sqlite_sequence (name, seq)");
          }
          for (const row of sequence) {
            await transaction.execute({
              sql: "INSERT INTO sqlite_sequence (name, seq) VALUES (?, ?)",
              args: [row.name, row.seq],
            });
          }
        }
      }
      for (const index of indexes) {
        await transaction.execute(index.sql);
      }
      // The views come after the indexes and before the triggers: an
      // INSTEAD OF trigger may reference a view, which must exist first.
      for (const view of views) {
        await transaction.execute(view.sql);
      }
      // SQLite creates a view whose source table is missing (one of the
      // excluded `_cf_%` tables, say) and only fails when it is read, so
      // read every view once before the commit.
      for (const view of views) {
        try {
          await transaction.execute(`SELECT * FROM ${quote(view.name)} LIMIT 0`);
        } catch (error) {
          throw new Error(`view ${view.name} is not usable: ${errorMessage(error)}`);
        }
      }
      // The triggers are created last so they do not fire while the
      // exported rows are inserted.
      for (const trigger of triggers) {
        await transaction.execute(trigger.sql);
      }
    } catch (error) {
      // The failure happened before the commit: closing the transaction
      // rolls it back and the destination stays exactly as it was (the
      // empty guard ran before any write).
      if (!transaction.closed) transaction.close();
      throw new Error(`import failed: ${errorMessage(error)}`);
    }
    try {
      await transaction.commit();
    } catch {
      // The COMMIT was sent and its confirmation failed: the server may
      // have committed it. A close/rollback cannot resolve the ambiguity
      // — and may race the commit — so a new connection is the only way
      // to say whether the target was written.
      throw new Error(
        "import outcome unknown: the commit may have been written; check the target with a new connection before retrying",
      );
    }

    // Step 4 — the proof, after the commit. Any failure from here on —
    // a divergence or a transport error on a verification query — is
    // reported with the target-written guidance.
    try {
      for (const entry of byTable) {
        const destinationCount = asCount(
          (await client.execute(`SELECT COUNT(*) AS n FROM ${quote(entry.table)}`)).rows[0]?.n,
        );
        if (destinationCount !== entry.count) {
          throw new VerificationFailed(
            `table ${entry.table}: ${entry.count} rows staged, ${destinationCount} rows in target`,
          );
        }
      }
      const integrity = await client.execute("PRAGMA integrity_check");
      const integrityValue = integrity.rows[0]?.integrity_check ?? integrity.rows[0]?.[0];
      if (String(integrityValue) !== "ok") {
        throw new VerificationFailed(`integrity_check: ${String(integrityValue)}`);
      }
      const foreignKeys = await client.execute("PRAGMA foreign_key_check");
      if (foreignKeys.rows.length > 0) {
        throw new VerificationFailed(`foreign_key_check: ${JSON.stringify(foreignKeys.rows)}`);
      }
      const stagedViews = (staging
        .query(`SELECT name FROM sqlite_master WHERE ${COPIED_VIEWS_SQL} ORDER BY name`)
        .all() as Array<{ name: string }>).map((row) => String(row.name));
      const targetViews = (await client.execute("SELECT name FROM sqlite_master WHERE type = 'view' ORDER BY name")).rows.map(
        (row) => String(row.name),
      );
      if (stagedViews.length !== targetViews.length || stagedViews.some((name, index) => name !== targetViews[index])) {
        throw new VerificationFailed(`views differ: staged [${stagedViews.join(", ")}], target [${targetViews.join(", ")}]`);
      }
      const stagedHistory = stagingHistoryNames(staging);
      const targetHasHistory = (
        await client.execute("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'd1_migrations'")
      ).rows.length > 0;
      const targetHistory = targetHasHistory
        ? (await client.execute("SELECT name FROM d1_migrations ORDER BY name")).rows.map((row) => String(row.name))
        : [];
      if (
        stagedHistory.length !== targetHistory.length ||
        stagedHistory.some((name, index) => name !== targetHistory[index])
      ) {
        throw new VerificationFailed(
          `d1_migrations: staged [${stagedHistory.join(", ")}], target [${targetHistory.join(", ")}]`,
        );
      }
    } catch (error) {
      const detail = error instanceof VerificationFailed ? error.message : errorMessage(error);
      throw new VerificationFailed(
        `verification failed: ${detail}; the target was written; restore it from backup or drop and retry`,
      );
    }

    for (const entry of byTable) log(`${entry.table} ${entry.count}`);
    log(`import ok: ${byTable.length} tables, ${totalRows} rows`);
    return { tables: byTable.length, rows: totalRows, byTable };
  } finally {
    staging.close();
  }
}

/** Marks a post-commit verification divergence (the target was written). */
class VerificationFailed extends Error {}

/** `<file.sql>` and at most one `--dry-run`; anything else is usage. */
export function parseImportArgs(args: readonly string[]): { file: string; dryRun: boolean } {
  const usage = "usage: import-d1-export.ts <file.sql> [--dry-run]";
  let file: string | undefined;
  let dryRun = false;
  for (const arg of args) {
    if (arg === "--dry-run") {
      if (dryRun) throw new CliError(usage, 2);
      dryRun = true;
    } else if (file === undefined) {
      file = arg;
    } else {
      throw new CliError(usage, 2);
    }
  }
  if (file === undefined) throw new CliError(usage, 2);
  return { file, dryRun };
}

async function runCli(
  argv: readonly string[],
  databaseUrl: string | undefined,
  authToken: string | undefined,
): Promise<void> {
  const { file, dryRun } = parseImportArgs(argv.slice(2));
  if (!databaseUrl) {
    throw new CliError("DATABASE_URL is required", 2);
  }
  let dumpSql: string;
  try {
    dumpSql = readFileSync(file, "utf8");
  } catch {
    throw new CliError(`export file not found: ${file}`, 2);
  }
  const client = createClient({
    url: databaseUrl,
    ...(authToken ? { authToken } : {}),
    intMode: "number",
  });
  console.log(`import ${databaseTarget(databaseUrl)}${dryRun ? " (dry run)" : ""}`);
  try {
    await importD1Export(client, dumpSql, {
      migrationsDir: defaultMigrationsDir(),
      dryRun,
      log: (line) => console.log(line),
    });
  } finally {
    client.close();
  }
}

if (import.meta.main) {
  const databaseUrl = process.env.DATABASE_URL?.trim();
  const authToken = process.env.DATABASE_AUTH_TOKEN?.trim();
  runCli(process.argv, databaseUrl, authToken).catch((error: unknown) => {
    const code = error instanceof CliError ? error.exitCode : 1;
    // Every error printed here goes through safeErrorMessage: the libSQL
    // client and the transports can echo the URL, the auth token, or the
    // userinfo of a URL the parser rejected, into the error message.
    console.error(safeErrorMessage(error, databaseUrl, authToken));
    process.exitCode = code;
  });
}
