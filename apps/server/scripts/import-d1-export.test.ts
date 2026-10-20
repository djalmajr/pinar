import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, test } from "node:test";
import { createClient, type Client, type InStatement, type Transaction } from "@libsql/client";
import { Database } from "bun:sqlite";
import { defaultMigrationsDir } from "./migrate-libsql";
import { importD1Export, parseImportArgs } from "./import-d1-export";

const SERVER_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SCRIPT_PATH = join(SERVER_DIR, "scripts", "import-d1-export.ts");
const FIXTURE_PATH = join(SERVER_DIR, "scripts", "fixtures", "d1-export.sample.sql");
const DUMP = readFileSync(FIXTURE_PATH, "utf8");

// The fixture: 30 user tables (`sqlite_sequence` aside) and 35 rows
// (26 in `d1_migrations`, the rest one per table except `ai_credit_grants`
// with two).
const EXPECTED_TABLES = 30;
const EXPECTED_ROWS = 35;

function tempDatabaseFile(): string {
  return join(tmpdir(), `pinar-import-${process.pid}-${randomBytes(8).toString("hex")}.db`);
}

function openClient(file: string): Client {
  return createClient({ intMode: "number", url: `file:${file}` });
}

function closeDatabase(client: Client, file: string) {
  client.close();
  for (const suffix of ["", "-wal", "-shm"]) rmSync(file + suffix, { force: true });
}

/** Tables that hold data: everything but SQLite's own `sqlite_%` tables. */
async function dataTableNames(client: Client): Promise<string[]> {
  const rows = await client.execute(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
  );
  return rows.rows.map((row) => String(row.name));
}

async function runImport(
  client: Client,
  dump: string,
  options: { migrationsDir?: string; dryRun?: boolean } = {},
): Promise<{ result: { tables: number; rows: number; byTable: Array<{ table: string; count: number }> }; log: string[] }> {
  const log: string[] = [];
  const result = await importD1Export(client, dump, {
    migrationsDir: options.migrationsDir ?? defaultMigrationsDir(),
    dryRun: options.dryRun,
    log: (line) => log.push(line),
  });
  return { result, log };
}

/**
 * A real `file:` client whose write transaction throws when it reaches a
 * statement matching `marker` — the shape of a mid-copy failure the dump
 * itself cannot produce (a dump invalid enough to fail the copy is already
 * rejected at the staging step). Everything else is delegated to the real
 * client/transaction.
 */
function clientFailingOnSql(base: Client, marker: RegExp): Client {
  const wrapped = new Proxy(base, {
    get(target, property) {
      const value = Reflect.get(target, property);
      if (property !== "transaction") {
        return typeof value === "function" ? (value as (...args: unknown[]) => unknown).bind(target) : value;
      }
      return (mode: "write") =>
        (target.transaction as (m: "write") => Promise<Transaction>)(mode).then((inner) => {
          let armed = true;
          const fail = (sql: string) => {
            if (armed && marker.test(sql)) {
              armed = false;
              throw new Error("injected mid-copy failure");
            }
          };
          return {
            execute: async (statement: string | InStatement) => {
              fail(typeof statement === "string" ? statement : statement.sql);
              return inner.execute(statement);
            },
            batch: async (statements: Array<InStatement>) => {
              for (const statement of statements) fail(typeof statement === "string" ? statement : statement.sql);
              return inner.batch(statements);
            },
            executeMultiple: (sql: string) => inner.executeMultiple(sql),
            commit: () => inner.commit(),
            rollback: () => inner.rollback(),
            close: () => inner.close(),
            get closed() {
              return inner.closed;
            },
          } as Transaction;
        });
    },
  });
  return wrapped as Client;
}

interface CliRun {
  code: number;
  stderr: string;
  stdout: string;
}

/**
 * A real `file:` client whose `execute` — used only by the post-commit
 * verification, since every write goes through the transaction — returns
 * a forged row count for the first count query of `table`.
 */
function clientWithForgedCount(base: Client, table: string, forged: number): Client {
  let forgedOnce = false;
  const wrapped = new Proxy(base, {
    get(target, property) {
      const value = Reflect.get(target, property);
      if (property !== "execute") {
        return typeof value === "function" ? (value as (...args: unknown[]) => unknown).bind(target) : value;
      }
      return async (sql: string | InStatement) => {
        const statement = typeof sql === "string" ? sql : sql.sql;
        if (!forgedOnce && statement === `SELECT COUNT(*) AS n FROM ${JSON.stringify(table)}`) {
          forgedOnce = true;
          return { columns: ["n"], rows: [{ n: forged }] };
        }
        return (target.execute as (s: string | InStatement) => Promise<unknown>)(sql);
      };
    },
  });
  return wrapped as Client;
}

/**
 * A real `file:` client whose `execute` rejects with `message` on the
 * first statement matching `marker` — the shape of a transport failure
 * on a post-commit verification query.
 */
function clientFailingOnExecute(base: Client, marker: RegExp, message: string): Client {
  let failed = false;
  const wrapped = new Proxy(base, {
    get(target, property) {
      const value = Reflect.get(target, property);
      if (property !== "execute") {
        return typeof value === "function" ? (value as (...args: unknown[]) => unknown).bind(target) : value;
      }
      return async (sql: string | InStatement) => {
        const statement = typeof sql === "string" ? sql : sql.sql;
        if (!failed && marker.test(statement)) {
          failed = true;
          throw new Error(message);
        }
        return (target.execute as (s: string | InStatement) => Promise<unknown>)(sql);
      };
    },
  });
  return wrapped as Client;
}

/**
 * A real `file:` client whose write transaction performs the real commit
 * and only then throws — the shape of a COMMIT sent to the server whose
 * acknowledgement is lost.
 */
function clientWithLostCommitAcknowledgement(base: Client): Client {
  const wrapped = new Proxy(base, {
    get(target, property) {
      const value = Reflect.get(target, property);
      if (property !== "transaction") {
        return typeof value === "function" ? (value as (...args: unknown[]) => unknown).bind(target) : value;
      }
      return (mode: "write") =>
        (target.transaction as (m: "write") => Promise<Transaction>)(mode).then((inner) => {
          return {
            execute: (statement: string | InStatement) => inner.execute(statement),
            batch: (statements: Array<InStatement>) => inner.batch(statements),
            executeMultiple: (sql: string) => inner.executeMultiple(sql),
            commit: async () => {
              await inner.commit();
              throw new Error("simulated lost commit acknowledgement");
            },
            rollback: () => inner.rollback(),
            close: () => inner.close(),
            get closed() {
              return inner.closed;
            },
          } as Transaction;
        });
    },
  });
  return wrapped as Client;
}

// Bun 1.4.3 under load can lose a child's exit with node:child_process
// execFile: the child is gone and the callback never comes (measured: 5 lost
// exits in 6 rounds of `bun run test --rerun-each 30` beside a full suite;
// the same 6 rounds through Bun.spawn lost none). Bun.spawn is used instead, and a
// child that is gone for a second while `exited` still waits fails with that
// diagnosis rather than the runner's generic timeout. A child still running
// keeps the runner's whole budget.
async function spawnCli(args: string[], env: Record<string, string>, cwd: string): Promise<CliRun> {
  const proc = Bun.spawn([process.execPath, SCRIPT_PATH, ...args], {
    cwd,
    env: { ...process.env, ...env },
    stderr: "pipe",
    stdin: "ignore",
    stdout: "pipe",
  });
  let watch: ReturnType<typeof setInterval> | undefined;
  const lost = new Promise<never>((_, reject) => {
    let goneSince = 0;
    watch = setInterval(() => {
      try {
        process.kill(proc.pid, 0);
        goneSince = 0;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ESRCH") return;
        goneSince ||= Date.now();
        if (Date.now() - goneSince < 1_000) return;
        clearInterval(watch);
        reject(new Error(`child ${proc.pid} exited but no exit event reached runCli`));
      }
    }, 250);
  });
  try {
    const [stdout, stderr, code] = await Promise.race([
      Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]),
      lost,
    ]);
    return { code, stderr, stdout };
  } finally {
    clearInterval(watch);
  }
}

function runCli(args: string[], env: Record<string, string>): Promise<CliRun> {
  return spawnCli(args, env, SERVER_DIR);
}

describe("importD1Export", () => {
  test("imports the real fixture: equal counts, ok integrity and the 26 migration names", async () => {
    const file = tempDatabaseFile();
    const client = openClient(file);
    try {
      const { result, log } = await runImport(client, DUMP);
      assert.equal(result.tables, EXPECTED_TABLES);
      assert.equal(result.rows, EXPECTED_ROWS);
      assert.ok(log.includes("users 1"));
      assert.ok(log.includes("d1_migrations 26"));
      assert.equal(log[log.length - 1], `import ok: ${EXPECTED_TABLES} tables, ${EXPECTED_ROWS} rows`);

      // Every table's count equals a fresh staging of the same dump.
      const staging = new Database(":memory:");
      try {
        staging.exec(DUMP);
        for (const entry of result.byTable) {
          const staged = Number((staging.query(`SELECT COUNT(*) AS n FROM ${JSON.stringify(entry.table)}`).get() as { n: number }).n);
          assert.equal(entry.count, staged, `table ${entry.table}`);
        }
      } finally {
        staging.close();
      }

      const integrity = await client.execute("PRAGMA integrity_check");
      assert.equal(String(integrity.rows[0]?.integrity_check ?? integrity.rows[0]?.[0]), "ok");
      const foreignKeys = await client.execute("PRAGMA foreign_key_check");
      assert.deepEqual(foreignKeys.rows, []);

      const history = await client.execute("SELECT name FROM d1_migrations ORDER BY id");
      assert.equal(history.rows.length, 26);
      assert.equal(String(history.rows[0].name), "0001_initial.sql");
      assert.equal(String(history.rows[25].name), "0026_pin_comment_agents.sql");

      // The exported triggers are present in the destination.
      const triggers = (await client.execute("SELECT name FROM sqlite_master WHERE type = 'trigger'")).rows.map(
        (row) => String(row.name),
      );
      assert.deepEqual(triggers.sort(), ["consume_ai_credit_usage", "refund_ai_credit_usage"]);
    } finally {
      closeDatabase(client, file);
    }
  });

  test("refuses a second import into the same destination as not empty", async () => {
    const file = tempDatabaseFile();
    const client = openClient(file);
    try {
      await runImport(client, DUMP);
      await assert.rejects(
        runImport(client, DUMP),
        (error: unknown) =>
          error instanceof Error &&
          error.message.startsWith("target database is not empty: ") &&
          error.message.includes("users"),
      );
    } finally {
      closeDatabase(client, file);
    }
  });

  test("refuses a destination that already has a table, without writing", async () => {
    const file = tempDatabaseFile();
    const client = openClient(file);
    try {
      await client.execute("CREATE TABLE junk (id INTEGER PRIMARY KEY)");
      await client.execute({ sql: "INSERT INTO junk (id) VALUES (?)", args: [1] });
      await assert.rejects(
        runImport(client, DUMP),
        (error: unknown) => error instanceof Error && error.message === "target database is not empty: junk",
      );
      assert.deepEqual(await dataTableNames(client), ["junk"]);
      assert.equal((await client.execute("SELECT * FROM junk")).rows.length, 1);
    } finally {
      closeDatabase(client, file);
    }
  });

  test("refuses an export whose d1_migrations are unknown to the checkout", async () => {
    const file = tempDatabaseFile();
    const dir = mkdtempSync(join(tmpdir(), `pinar-import-migrations-${process.pid}-`));
    const client = openClient(file);
    try {
      // An empty directory: all 26 fixture migrations are unknown.
      await assert.rejects(
        runImport(client, DUMP, { migrationsDir: dir }),
        (error: unknown) =>
          error instanceof Error &&
          error.message.startsWith("export has migrations unknown to this checkout: ") &&
          error.message.includes("0001_initial.sql") &&
          error.message.includes("0026_pin_comment_agents.sql"),
      );
      assert.deepEqual(await dataTableNames(client), []);
    } finally {
      closeDatabase(client, file);
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("refuses an invalid export before touching the destination", async () => {
    const file = tempDatabaseFile();
    const client = openClient(file);
    try {
      const broken = `${DUMP}\nCREATE TRIGGER broken ON no_such_table BEGIN SELECT 1; END;\n`;
      await assert.rejects(
        runImport(client, broken),
        (error: unknown) => error instanceof Error && error.message.startsWith("export file is not valid SQLite: "),
      );
      assert.deepEqual(await dataTableNames(client), []);
    } finally {
      closeDatabase(client, file);
    }
  });

  test("a mid-copy failure rolls back and leaves the destination empty", async () => {
    const file = tempDatabaseFile();
    const base = openClient(file);
    const client = clientFailingOnSql(base, /idx_users_email/);
    try {
      // The injection fires on an index, after all tables and rows were
      // written inside the transaction: the rollback must undo all of it.
      await assert.rejects(
        runImport(client, DUMP),
        (error: unknown) => error instanceof Error && error.message === "import failed: injected mid-copy failure",
      );
      assert.deepEqual(await dataTableNames(base), []);
    } finally {
      closeDatabase(base, file);
    }
  });

  test("--dry-run stages and guards without writing", async () => {
    const file = tempDatabaseFile();
    const client = openClient(file);
    try {
      const { result, log } = await runImport(client, DUMP, { dryRun: true });
      assert.equal(result.tables, EXPECTED_TABLES);
      assert.equal(result.rows, EXPECTED_ROWS);
      assert.ok(log.includes("users 1"));
      assert.equal(log[log.length - 1], `dry run ok: ${EXPECTED_TABLES} tables, ${EXPECTED_ROWS} rows`);
      assert.deepEqual(await dataTableNames(client), []);

      // The guards still apply in a dry run.
      await client.execute("CREATE TABLE junk (id INTEGER PRIMARY KEY)");
      await assert.rejects(
        runImport(client, DUMP, { dryRun: true }),
        (error: unknown) => error instanceof Error && error.message === "target database is not empty: junk",
      );
    } finally {
      closeDatabase(client, file);
    }
  });

  test("triggers are created after the rows load and do not fire during the import", async () => {
    const file = tempDatabaseFile();
    const client = openClient(file);
    try {
      // A reserved usage row that `consume_ai_credit_usage` would consume
      // credits for (grant_cloud_local_pro_expiring has 20 credits) if the
      // trigger were alive while the rows load. The row is spliced in
      // before the dump's `CREATE INDEX`/`CREATE TRIGGER` tail, so the
      // staging load is also trigger-free: staging and destination must
      // stay identical.
      const usageInsert = `INSERT INTO "ai_credit_usages" ("id","request_id","owner_type","owner_id","grant_id","feature","resource_id","model","credits","status","created_at") VALUES('usage_probe','request_probe','account','usr_cloud_local_pro','grant_cloud_local_pro_expiring','session_summary','res_probe','model_probe',1,'reserved','2026-10-15T02:00:00.000Z');`;
      const atIndex = DUMP.indexOf("CREATE INDEX");
      assert.ok(atIndex > 0, "the fixture lists its indexes after the data");
      const dumpWithUsage = `${DUMP.slice(0, atIndex)}\n${usageInsert}\n${DUMP.slice(atIndex)}`;

      // Staging first: the same dump staged in its own database, with the
      // inserted row before the triggers — its grants are the expected
      // values (20 for the initial grant from the fixture, 0 for the
      // expiring one, which the trigger would move to 1 if it fired while
      // the rows load).
      const staging = new Database(":memory:");
      try {
        staging.exec(dumpWithUsage);
        const { result } = await runImport(client, dumpWithUsage);
        const usageEntry = result.byTable.find((entry) => entry.table === "ai_credit_usages");
        assert.equal(usageEntry?.count, 1);

        const stagedGrants = staging.query("SELECT * FROM ai_credit_grants ORDER BY id").all() as Array<Record<string, unknown>>;
        const targetGrants = (await client.execute("SELECT * FROM ai_credit_grants ORDER BY id")).rows;
        assert.equal(targetGrants.length, stagedGrants.length);
        for (let i = 0; i < stagedGrants.length; i++) {
          for (const key of Object.keys(stagedGrants[i])) {
            assert.equal(
              targetGrants[i][key],
              stagedGrants[i][key],
              `ai_credit_grants.${key} of row ${i}: the trigger must not have run during the load`,
            );
          }
        }
        const targetExp = Number((await client.execute("SELECT consumed_credits FROM ai_credit_grants WHERE id = 'grant_cloud_local_pro_expiring'")).rows[0]?.consumed_credits);
        assert.equal(targetExp, 0, "the trigger must not have consumed credits during the load");

        // And the import is live with the trigger: the same row inserted
        // post-import consumes a credit in both databases.
        const insertAfter = "INSERT INTO ai_credit_usages (id, request_id, owner_type, owner_id, grant_id, feature, resource_id, model, credits, status, created_at) VALUES ('usage_after','request_after','account','usr_cloud_local_pro','grant_cloud_local_pro_expiring','session_summary','res_probe','model_probe',1,'reserved','2026-10-15T03:00:00.000Z')";
        staging.query(insertAfter).run();
        const stagedAfter = Number((staging.query("SELECT consumed_credits FROM ai_credit_grants WHERE id = 'grant_cloud_local_pro_expiring'").get() as { consumed_credits: number }).consumed_credits);
        const after = await client.execute(insertAfter);
        assert.equal(after.rowsAffected, 1, "the live trigger accepts a funded reservation");
        const targetAfter = Number((await client.execute("SELECT consumed_credits FROM ai_credit_grants WHERE id = 'grant_cloud_local_pro_expiring'")).rows[0]?.consumed_credits);
        assert.equal(targetAfter, stagedAfter);
        assert.equal(targetAfter, 1);
      } finally {
        staging.close();
      }
    } finally {
      closeDatabase(client, file);
    }
  });

  test("preserves sqlite_sequence, with the AUTOINCREMENT position intact", async () => {
    const file = tempDatabaseFile();
    const client = openClient(file);
    try {
      await runImport(client, DUMP);
      const sequence = (await client.execute("SELECT name, seq FROM sqlite_sequence")).rows;
      assert.deepEqual(
        sequence.map((row) => [String(row.name), Number(row.seq)]),
        [["d1_migrations", 26]],
      );
      // The next auto-generated id continues from the imported sequence.
      await client.execute({ sql: "INSERT INTO d1_migrations (name) VALUES (?)", args: ["0099_probe.sql"] });
      const next = (await client.execute("SELECT id FROM d1_migrations WHERE name = '0099_probe.sql'")).rows[0]?.id;
      assert.equal(Number(next), 27);
    } finally {
      closeDatabase(client, file);
    }
  });

  test("copies rows with referenced tables first when the dump lists a child before its parent", async () => {
    // `child` (with a row) is created and filled before `parent` in
    // `sqlite_master` order; the destination enforces foreign keys.
    const file = tempDatabaseFile();
    const client = openClient(file);
    const dump = [
      'CREATE TABLE child (id INTEGER PRIMARY KEY, parent_id INTEGER NOT NULL REFERENCES parent(id));',
      "INSERT INTO child (id, parent_id) VALUES (1, 1);",
      "CREATE TABLE parent (id INTEGER PRIMARY KEY);",
      "INSERT INTO parent (id) VALUES (1);",
    ].join("\n");
    try {
      const { result } = await runImport(client, dump);
      assert.equal(result.tables, 2);
      assert.equal(result.rows, 2);
      const integrity = await client.execute("PRAGMA integrity_check");
      assert.equal(String(integrity.rows[0]?.integrity_check ?? integrity.rows[0]?.[0]), "ok");
      const foreignKeys = await client.execute("PRAGMA foreign_key_check");
      assert.deepEqual(foreignKeys.rows, []);
      assert.equal((await client.execute("SELECT * FROM child")).rows.length, 1);
      assert.equal((await client.execute("SELECT * FROM parent")).rows.length, 1);
    } finally {
      closeDatabase(client, file);
    }
  });

  test("imports a row whose parent in the same table comes later", async () => {
    // collections.parent_id references collections: a collection moved under
    // a newer one is exported before its parent. Only the deferred foreign
    // keys of the copy transaction accept it.
    const file = tempDatabaseFile();
    const client = openClient(file);
    const dump = [
      "PRAGMA defer_foreign_keys=TRUE;",
      'CREATE TABLE IF NOT EXISTS "folders"(id TEXT PRIMARY KEY, parent_id TEXT REFERENCES folders(id));',
      `INSERT INTO "folders" ("id","parent_id") VALUES('child','parent');`,
      `INSERT INTO "folders" ("id","parent_id") VALUES('parent',NULL);`,
    ].join("\n");
    try {
      const { result } = await runImport(client, dump);
      assert.equal(result.rows, 2);
      const foreignKeys = await client.execute("PRAGMA foreign_key_check");
      assert.deepEqual(foreignKeys.rows, []);
    } finally {
      closeDatabase(client, file);
    }
  });

  test("refuses a view over an excluded table and leaves the destination empty", async () => {
    // SQLite creates the view even though `_cf_KV` is not copied; reading it
    // fails, and that must stop the import before the commit.
    const file = tempDatabaseFile();
    const client = openClient(file);
    const dump = [
      "CREATE TABLE _cf_KV (k TEXT);",
      "CREATE VIEW cf_view AS SELECT * FROM _cf_KV;",
      "CREATE TABLE items (v TEXT);",
      "INSERT INTO items (v) VALUES ('a');",
    ].join("\n");
    try {
      await assert.rejects(runImport(client, dump), /import failed: view cf_view is not usable/);
      const schema = await client.execute("SELECT name FROM sqlite_master WHERE name NOT LIKE 'sqlite_%'");
      assert.deepEqual(schema.rows, []);
    } finally {
      closeDatabase(client, file);
    }
  });

  test("ignores _cf_ tables in the dump", async () => {
    const file = tempDatabaseFile();
    const client = openClient(file);
    try {
      const withCloudflare = `${DUMP}\nCREATE TABLE _cf_KV ("key" TEXT, "value" TEXT);\nINSERT INTO _cf_KV ("key","value") VALUES ('a','b');\n`;
      const { result } = await runImport(client, withCloudflare);
      assert.equal(result.tables, EXPECTED_TABLES);
      assert.ok(!result.byTable.some((entry) => entry.table === "_cf_KV"));
      const tables = await dataTableNames(client);
      assert.ok(!tables.includes("_cf_KV"));
      assert.equal(tables.length, EXPECTED_TABLES);
    } finally {
      closeDatabase(client, file);
    }
  });

  test("imports a 64-bit integer identically, without precision loss", async () => {
    // 2^53 + 1: read as a `number` it rounds to 9007199254740992, so the
    // destination is read back with a `bigint` client (the number mode
    // rejects the value entirely rather than round it).
    const file = tempDatabaseFile();
    const client = openClient(file);
    const big = createClient({ intMode: "bigint", url: `file:${file}` });
    try {
      const dump = [
        "CREATE TABLE fidelity (v INTEGER NOT NULL);",
        "INSERT INTO fidelity (v) VALUES (9007199254740993);",
      ].join("\n");
      const { result } = await runImport(client, dump);
      assert.equal(result.tables, 1);
      assert.equal(result.rows, 1);
      const row = await big.execute("SELECT v FROM fidelity");
      assert.equal(row.rows[0].v, 9007199254740993n);
    } finally {
      big.close();
      closeDatabase(client, file);
    }
  });

  test("recreates views after the indexes and before the triggers that depend on them", async () => {
    // The INSTEAD OF trigger references the view: the import only succeeds
    // if the view is created before the triggers.
    const file = tempDatabaseFile();
    const client = openClient(file);
    try {
      const dump = [
        "CREATE TABLE base (id INTEGER PRIMARY KEY);",
        "INSERT INTO base (id) VALUES (1);",
        "CREATE VIEW base_view AS SELECT id FROM base;",
        "CREATE TRIGGER insert_on_view INSTEAD OF INSERT ON base_view BEGIN INSERT INTO base (id) VALUES (NEW.id); END;",
      ].join("\n");
      const { result } = await runImport(client, dump);
      assert.equal(result.tables, 1);
      assert.equal(result.rows, 1);
      const views = (await client.execute("SELECT name FROM sqlite_master WHERE type = 'view' ORDER BY name")).rows.map(
        (row) => String(row.name),
      );
      assert.deepEqual(views, ["base_view"]);
      // The view is live in the destination: an insert through it fires
      // the INSTEAD OF trigger.
      await client.execute("INSERT INTO base_view (id) VALUES (2)");
      const baseCount = Number((await client.execute("SELECT COUNT(*) AS n FROM base")).rows[0]?.n);
      assert.equal(baseCount, 2);
    } finally {
      closeDatabase(client, file);
    }
  });

  test("ignores indexes and triggers that belong to dropped _cf_ tables", async () => {
    const file = tempDatabaseFile();
    const client = openClient(file);
    try {
      const dump = [
        'CREATE TABLE _cf_KV ("key" TEXT, "value" TEXT);',
        "INSERT INTO _cf_KV (\"key\", \"value\") VALUES ('a', 'b');",
        'CREATE INDEX cf_idx ON _cf_KV ("key");',
        "CREATE TRIGGER cf_trg AFTER INSERT ON _cf_KV BEGIN SELECT 1; END;",
        "CREATE TABLE regular (id INTEGER PRIMARY KEY);",
        "INSERT INTO regular (id) VALUES (1);",
      ].join("\n");
      const { result } = await runImport(client, dump);
      assert.equal(result.tables, 1);
      assert.deepEqual(result.byTable, [{ table: "regular", count: 1 }]);
      assert.deepEqual(await dataTableNames(client), ["regular"]);
      // Neither the internal index nor the internal trigger made it over.
      const objects = await client.execute("SELECT name, type FROM sqlite_master WHERE type IN ('index', 'trigger')");
      assert.deepEqual(objects.rows, []);
    } finally {
      closeDatabase(client, file);
    }
  });

  test("reports a forged post-commit count as a verification failure with the target-written guidance", async () => {
    const file = tempDatabaseFile();
    const base = openClient(file);
    const client = clientWithForgedCount(base, "d1_migrations", 99);
    try {
      await assert.rejects(
        runImport(client, DUMP),
        (error: unknown) =>
          error instanceof Error &&
          error.message ===
            "verification failed: table d1_migrations: 26 rows staged, 99 rows in target; the target was written; restore it from backup or drop and retry",
      );
      // The commit happened: the data is in the target despite the failure.
      assert.equal((await dataTableNames(base)).length, EXPECTED_TABLES);
    } finally {
      closeDatabase(base, file);
    }
  });

  test("reports a transport error on a post-commit verification query as a verification failure", async () => {
    const file = tempDatabaseFile();
    const base = openClient(file);
    // The counts pass (real responses); the first integrity_check is lost.
    const client = clientFailingOnExecute(base, /PRAGMA integrity_check/, "injected verification transport error");
    try {
      await assert.rejects(
        runImport(client, DUMP),
        (error: unknown) =>
          error instanceof Error &&
          error.message ===
            "verification failed: injected verification transport error; the target was written; restore it from backup or drop and retry",
      );
      assert.equal((await dataTableNames(base)).length, EXPECTED_TABLES, "the commit wrote the target before the error");
    } finally {
      closeDatabase(base, file);
    }
  });

  test("treats a lost commit confirmation as an unknown outcome, with the target written", async () => {
    const file = tempDatabaseFile();
    const base = openClient(file);
    const client = clientWithLostCommitAcknowledgement(base);
    try {
      await assert.rejects(
        runImport(client, DUMP),
        (error: unknown) =>
          error instanceof Error &&
          error.message ===
            "import outcome unknown: the commit may have been written; check the target with a new connection before retrying",
      );
      // The commit was performed before the simulated lost acknowledgement:
      // the target carries the data, so a retry must not assume it is empty.
      assert.equal((await dataTableNames(base)).length, EXPECTED_TABLES);
    } finally {
      closeDatabase(base, file);
    }
  });
});

describe("import-d1-export CLI", () => {
  test("exits 2 without DATABASE_URL, without a file, or with an unknown flag", async () => {
    const withoutUrl = await runCli([FIXTURE_PATH], { DATABASE_AUTH_TOKEN: "", DATABASE_URL: "" });
    assert.equal(withoutUrl.code, 2);
    assert.ok(withoutUrl.stderr.includes("DATABASE_URL is required"));

    const withoutFile = await runCli([], { DATABASE_AUTH_TOKEN: "", DATABASE_URL: `file:${tempDatabaseFile()}` });
    assert.equal(withoutFile.code, 2);
    assert.ok(withoutFile.stderr.includes("usage: import-d1-export.ts"));

    const unknownFlag = await runCli([FIXTURE_PATH, "--bogus"], { DATABASE_AUTH_TOKEN: "", DATABASE_URL: `file:${tempDatabaseFile()}` });
    assert.equal(unknownFlag.code, 2);
    assert.ok(unknownFlag.stderr.includes("usage: import-d1-export.ts"));
  });

  test("imports the fixture and prints one line per table", async () => {
    const file = tempDatabaseFile();
    try {
      const run = await runCli([FIXTURE_PATH], { DATABASE_AUTH_TOKEN: "", DATABASE_URL: `file:${file}` });
      assert.equal(run.code, 0, `CLI failed:\n${run.stderr}`);
      assert.ok(run.stdout.includes(`import ${file}`));
      assert.ok(run.stdout.includes("d1_migrations 26"));
      assert.ok(run.stdout.includes(`import ok: ${EXPECTED_TABLES} tables, ${EXPECTED_ROWS} rows`));
      const client = openClient(file);
      try {
        assert.equal((await dataTableNames(client)).length, EXPECTED_TABLES);
      } finally {
        closeDatabase(client, file);
      }
    } finally {
      for (const suffix of ["", "-wal", "-shm"]) rmSync(file + suffix, { force: true });
    }
  });

  test("--dry-run through the CLI writes nothing", async () => {
    const file = tempDatabaseFile();
    try {
      const run = await runCli([FIXTURE_PATH, "--dry-run"], { DATABASE_AUTH_TOKEN: "", DATABASE_URL: `file:${file}` });
      assert.equal(run.code, 0, `CLI failed:\n${run.stderr}`);
      assert.ok(run.stdout.includes(`import ${file} (dry run)`));
      assert.ok(run.stdout.includes(`dry run ok: ${EXPECTED_TABLES} tables, ${EXPECTED_ROWS} rows`));
      const client = openClient(file);
      try {
        assert.deepEqual(await dataTableNames(client), []);
      } finally {
        closeDatabase(client, file);
      }
    } finally {
      for (const suffix of ["", "-wal", "-shm"]) rmSync(file + suffix, { force: true });
    }
  });

  test("exits 1 when the destination is not empty", async () => {
    const file = tempDatabaseFile();
    const client = openClient(file);
    try {
      await client.execute("CREATE TABLE junk (id INTEGER PRIMARY KEY)");
      // Keep the file: the CLI process must see the seeded table.
      client.close();
      const run = await runCli([FIXTURE_PATH], { DATABASE_AUTH_TOKEN: "", DATABASE_URL: `file:${file}` });
      assert.equal(run.code, 1);
      assert.ok(run.stderr.includes("target database is not empty: junk"));
    } finally {
      for (const suffix of ["", "-wal", "-shm"]) rmSync(file + suffix, { force: true });
    }
  });

  test("never prints the credentials of a malformed DATABASE_URL", async () => {
    const run = await runCli(
      [FIXTURE_PATH],
      { DATABASE_AUTH_TOKEN: "TOKEN_SENTINEL", DATABASE_URL: "//user:TEST_SECRET_SENTINEL@127.0.0.1:1/db" },
    );
    assert.notEqual(run.code, 0);
    assert.ok(!run.stdout.includes("TEST_SECRET_SENTINEL"), `stdout leaked the secret:\n${run.stdout}`);
    assert.ok(!run.stderr.includes("TEST_SECRET_SENTINEL"), `stderr leaked the secret:\n${run.stderr}`);
    assert.ok(!run.stdout.includes("TOKEN_SENTINEL"), `stdout leaked the token:\n${run.stdout}`);
    assert.ok(!run.stderr.includes("TOKEN_SENTINEL"), `stderr leaked the token:\n${run.stderr}`);
    assert.ok(!run.stdout.includes("user:"), `stdout leaked the userinfo:\n${run.stdout}`);
    assert.ok(!run.stderr.includes("user:"), `stderr leaked the userinfo:\n${run.stderr}`);
  });
});

describe("parseImportArgs", () => {
  test("accepts a file and an optional --dry-run", () => {
    assert.deepEqual(parseImportArgs(["a.sql"]), { file: "a.sql", dryRun: false });
    assert.deepEqual(parseImportArgs(["a.sql", "--dry-run"]), { file: "a.sql", dryRun: true });
    assert.deepEqual(parseImportArgs(["--dry-run", "a.sql"]), { file: "a.sql", dryRun: true });
    for (const args of [[], ["a.sql", "b.sql"], ["a.sql", "--bogus"], ["--dry-run", "--dry-run"]] as Array<readonly string[]>) {
      assert.throws(() => parseImportArgs(args), /usage/);
    }
  });
});
