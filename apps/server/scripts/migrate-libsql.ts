/**
 * Applies the Pinar D1 migrations (`apps/server/migrations`) to a libSQL
 * database, recording them in `d1_migrations` — the same table `wrangler d1`
 * uses — so a database exported from D1 already carries the history.
 *
 *   bun scripts/migrate-libsql.ts [--dry-run]
 *
 * Reads `DATABASE_URL` (required) and `DATABASE_AUTH_TOKEN` (optional). The
 * token and the full URL are never printed; at most the host is. Each
 * pending file runs in its own write transaction — the file's statements,
 * then the history insert, then commit — so a failure rolls the file back,
 * stops the run, and leaves the database as it was.
 */
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient, type Client } from "@libsql/client";

const MIGRATION_FILE = /^\d{4}_.+\.sql$/;
const HISTORY_TABLE_SQL = `CREATE TABLE IF NOT EXISTS d1_migrations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT UNIQUE,
  applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
)`;
const HISTORY_INSERT_SQL = `INSERT INTO d1_migrations (name) VALUES (?)`;

export interface MigrateLibsqlOptions {
  dryRun?: boolean;
  log?: (line: string) => void;
}

export interface MigrateLibsqlResult {
  applied: string[];
  pending: string[];
  alreadyApplied: string[];
}

/** Migration file names in the directory, in lexicographic (application) order. */
export function migrationFiles(migrationsDir: string): string[] {
  return readdirSync(migrationsDir)
    .filter((name) => MIGRATION_FILE.test(name))
    .sort();
}

/** The `apps/server/migrations` directory, resolved from this file (not the cwd). */
export function defaultMigrationsDir(): string {
  return join(dirname(fileURLToPath(import.meta.url)), "..", "migrations");
}

/**
 * The part of a database URL that may be printed: the host, or the path for
 * `file:` URLs (whose host is empty). Never the full URL, never credentials.
 */
export function databaseTarget(databaseUrl: string): string {
  const parsed = new URL(databaseUrl);
  return parsed.host || parsed.pathname;
}

/** `apply` by default; `--dry-run` is the only accepted flag. */
export function parseMigrateArgs(args: readonly string[]): { dryRun: boolean } {
  if (args.length > 1 || (args.length === 1 && args[0] !== "--dry-run")) {
    throw new CliError("usage: migrate-libsql.ts [--dry-run]", 2);
  }
  return { dryRun: args[0] === "--dry-run" };
}

interface HistoryState {
  names: string[];
}

async function loadHistory(client: Client): Promise<HistoryState> {
  const present = await client.execute(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'd1_migrations'",
  );
  if (present.rows.length === 0) return { names: [] };
  const rows = await client.execute("SELECT name FROM d1_migrations ORDER BY name");
  return {
    names: rows.rows.map((row) => {
      const name = row.name;
      if (typeof name !== "string") {
        throw new Error("d1_migrations.name is not text");
      }
      return name;
    }),
  };
}

/**
 * Applies the pending migrations. A file already present in
 * `d1_migrations` is skipped; a name that is not a file of the directory
 * aborts the run before anything is applied, protecting against running an
 * older checkout against a newer database.
 */
export async function migrateLibsql(
  client: Client,
  migrationsDir: string,
  options: MigrateLibsqlOptions = {},
): Promise<MigrateLibsqlResult> {
  const log = options.log ?? (() => undefined);
  const files = migrationFiles(migrationsDir);
  const history = await loadHistory(client);

  const unknown = history.names.filter((name) => !files.includes(name));
  if (unknown.length > 0) {
    throw new Error(`database has migrations unknown to this checkout: ${unknown.join(", ")}`);
  }

  const appliedNames = new Set(history.names);
  const pending = files.filter((name) => !appliedNames.has(name));
  const alreadyApplied = files.filter((name) => appliedNames.has(name));

  if (options.dryRun) {
    for (const name of pending) log(`pending ${name}`);
    log(`0 applied, ${alreadyApplied.length} already applied`);
    return { applied: [], pending, alreadyApplied };
  }

  // D1 enforces foreign keys always. Setting the pragma on the connection,
  // outside any transaction (where it can still change), is what makes the
  // per-file write transactions run with enforcement on a `file:` client.
  // Over HTTP it guarantees nothing — the client opens a new stream per
  // statement — so each transaction also verifies the pragma as it sees it
  // below and refuses to run without enforcement.
  await client.execute("PRAGMA foreign_keys = ON");
  await client.execute(HISTORY_TABLE_SQL);

  const applied: string[] = [];
  for (const name of pending) {
    const sql = readFileSync(join(migrationsDir, name), "utf8");
    try {
      const transaction = await client.transaction("write");
      try {
        // The transaction's own stream never saw the pragma above over HTTP,
        // and SQLite would ignore `PRAGMA foreign_keys = ON` inside a
        // transaction anyway — so read the pragma as this transaction sees
        // it and refuse (rolling back) when it cannot prove enforcement.
        const foreignKeys = await transaction.execute("PRAGMA foreign_keys");
        if (Number(foreignKeys.rows[0]?.[0]) !== 1) {
          throw new ForeignKeysOffError(`foreign key enforcement is off on the database; refusing to migrate ${name}`);
        }
        await transaction.executeMultiple(sql);
        await transaction.execute({ sql: HISTORY_INSERT_SQL, args: [name] });
        await transaction.commit();
      } finally {
        if (!transaction.closed) transaction.close();
      }
    } catch (error) {
      // A database without enforcement is a configuration problem, not a
      // broken migration: its exact message must reach the caller (and the
      // CLI, with exit 1) without the `migration <name> failed:` wrapping.
      if (error instanceof ForeignKeysOffError) throw error;
      throw new Error(`migration ${name} failed: ${errorMessage(error)}`);
    }
    applied.push(name);
    log(`applied ${name}`);
  }

  log(`${applied.length} applied, ${alreadyApplied.length} already applied`);
  return { applied, pending, alreadyApplied };
}

class CliError extends Error {
  constructor(message: string, readonly exitCode: number) {
    super(message);
  }
}

/** Refuses to migrate a database that reports foreign key enforcement off. */
class ForeignKeysOffError extends Error {}

interface CliEnv {
  DATABASE_AUTH_TOKEN?: string;
  DATABASE_URL?: string;
}

async function runCli(argv: readonly string[], env: CliEnv): Promise<void> {
  const { dryRun } = parseMigrateArgs(argv.slice(2));
  const databaseUrl = env.DATABASE_URL?.trim();
  if (!databaseUrl) {
    throw new CliError("DATABASE_URL is required", 2);
  }
  const authToken = env.DATABASE_AUTH_TOKEN?.trim();
  const client = createClient({
    url: databaseUrl,
    ...(authToken ? { authToken } : {}),
  });
  console.log(`migrate ${databaseTarget(databaseUrl)}${dryRun ? " (dry run)" : ""}`);
  try {
    await migrateLibsql(client, defaultMigrationsDir(), {
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
  runCli(process.argv, process.env).catch((error: unknown) => {
    const code = error instanceof CliError ? error.exitCode : 1;
    // Every error printed here goes through safeErrorMessage: the libSQL
    // client and the transports can echo the URL, the auth token, or the
    // userinfo of a URL the parser rejected, into the error message.
    console.error(safeErrorMessage(error, databaseUrl, authToken));
    process.exitCode = code;
  });
}

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message.length > 0 ? error.message : String(error);
}

/**
 * The error text that may be printed. A malformed `DATABASE_URL` comes back
 * from the parser with the whole input, and transport errors can carry the
 * URL or the auth token, so replace the full URL, the token, and any URL
 * userinfo (the part between `//` and `@`, even in a URL the parser
 * rejects) before anything reaches stdout/stderr.
 */
export function safeErrorMessage(error: unknown, databaseUrl?: string, authToken?: string): string {
  let message = errorMessage(error);
  if (databaseUrl) message = message.split(databaseUrl).join("<DATABASE_URL>");
  if (authToken) message = message.split(authToken).join("<DATABASE_AUTH_TOKEN>");
  return message.replace(/\/\/([^\s@]+)@/g, "//<credentials>@");
}
