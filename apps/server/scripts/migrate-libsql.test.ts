import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, test } from "node:test";
import { createClient, type Client } from "@libsql/client";
import { Database } from "bun:sqlite";
import { defaultMigrationsDir, databaseTarget, migrateLibsql, parseMigrateArgs, safeErrorMessage } from "./migrate-libsql";

const SERVER_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SCRIPT_PATH = join(SERVER_DIR, "scripts", "migrate-libsql.ts");
const SCHEMA_PATH = join(SERVER_DIR, "schema.sql");
const TABLE_FILTER = "name NOT LIKE 'sqlite_%' AND name <> 'd1_migrations' AND name NOT GLOB '_cf_*'";

function tempDatabaseFile() {
  return join(tmpdir(), `pinar-migrate-${process.pid}-${randomBytes(8).toString("hex")}.db`);
}

function tempMigrationsDir() {
  return mkdtempSync(join(tmpdir(), `pinar-migrations-${process.pid}-`));
}

function openClient(file: string): Client {
  return createClient({ intMode: "number", url: `file:${file}` });
}

function closeDatabase(client: Client, file: string) {
  client.close();
  for (const suffix of ["", "-wal", "-shm"]) rmSync(file + suffix, { force: true });
}

interface InnerTransaction {
  execute: (statement: string | { sql: string; args?: unknown[] }) => Promise<unknown>;
  executeMultiple: (sql: string) => Promise<unknown>;
  commit: () => Promise<void>;
  close: () => void;
  readonly closed: boolean;
}

/**
 * A `Client` whose write transactions report `PRAGMA foreign_keys` as 0 —
 * the shape of a remote stream that started with enforcement off. A real
 * `file:` connection cannot produce this (the migrator's own
 * connection-level `PRAGMA foreign_keys = ON` would keep it 1 for the
 * transaction), so `transaction` is the only wrapped method: everything
 * else is delegated to the real client/transaction. The wrapper records the
 * calls it saw, so the check's place in the order is asserted, not guessed.
 */
function clientWithForeignKeysOff(client: Client) {
  const calls: string[] = [];
  const wrapped = new Proxy(client, {
    get(target, property) {
      const value = Reflect.get(target, property);
      if (property !== "transaction") {
        return typeof value === "function" ? (value as (...args: unknown[]) => unknown).bind(target) : value;
      }
      return (mode: "write") =>
        (target.transaction as (m: "write") => Promise<InnerTransaction>)(mode).then((inner) => ({
          execute: async (statement: string | { sql: string; args?: unknown[] }) => {
            const sql = typeof statement === "string" ? statement : statement.sql;
            if (/^pragma\s+foreign_keys$/i.test(sql.trim())) {
              calls.push("check");
              const row: Record<string | number, unknown> = { foreign_keys: 0 };
              row[0] = 0;
              return { rows: [row], columns: ["foreign_keys"], rowsAffected: 0 };
            }
            return inner.execute(statement);
          },
          executeMultiple: (sql: string) => {
            calls.push("executeMultiple");
            return inner.executeMultiple(sql);
          },
          commit: () => {
            calls.push("commit");
            return inner.commit();
          },
          close: () => {
            if (!inner.closed) calls.push("rollback");
            inner.close();
          },
          get closed() {
            return inner.closed;
          },
        }));
    },
  });
  return { calls, client: wrapped as Client };
}

async function libsqlTableNames(client: Client): Promise<string[]> {
  const rows = await client.execute(
    `SELECT name FROM sqlite_master WHERE type = 'table' AND ${TABLE_FILTER} ORDER BY name`,
  );
  return rows.rows.map((row) => String(row.name));
}

function sqliteTableNames(db: Database): string[] {
  return db
    .query<{ name: string }, []>(
      `SELECT name FROM sqlite_master WHERE type = 'table' AND ${TABLE_FILTER} ORDER BY name`,
    )
    .all()
    .map((row) => row.name);
}

interface CliRun {
  code: number;
  stderr: string;
  stdout: string;
}

function runCli(args: string[], env: Record<string, string>, cwd: string): Promise<CliRun> {
  return new Promise((resolveRun) => {
    execFile(process.execPath, [SCRIPT_PATH, ...args], { cwd, env: { ...process.env, ...env } }, (error, stdout, stderr) => {
      const code = error === null ? 0 : typeof error.code === "number" ? error.code : 1;
      resolveRun({ code, stderr: String(stderr), stdout: String(stdout) });
    });
  });
}

describe("migrateLibsql", () => {
  test("applies the 33 real migrations to a fresh database and skips them on the second run", async () => {
    const file = tempDatabaseFile();
    const client = openClient(file);
    try {
      const firstLog: string[] = [];
      const first = await migrateLibsql(client, defaultMigrationsDir(), {
        log: (line) => firstLog.push(line),
      });
      assert.equal(first.applied.length, 33);
      assert.deepEqual(first.alreadyApplied, []);
      assert.deepEqual(first.pending.length, 33);
      assert.equal(firstLog[0], "applied 0001_initial.sql");
      assert.equal(firstLog[firstLog.length - 1], "33 applied, 0 already applied");
      let history = await client.execute("SELECT name FROM d1_migrations ORDER BY id");
      assert.equal(history.rows.length, 33);
      assert.equal(String(history.rows[0].name), "0001_initial.sql");
      assert.equal(String(history.rows[27].name), "0028_assistant_proposals.sql");
      assert.equal(String(history.rows[28].name), "0029_pin_index.sql");
      assert.equal(String(history.rows[29].name), "0030_capture_filing.sql");
      assert.equal(String(history.rows[30].name), "0031_assistant_credits.sql");
      assert.equal(String(history.rows[32].name), "0033_capture_filing_credits.sql");

      const secondLog: string[] = [];
      const second = await migrateLibsql(client, defaultMigrationsDir(), {
        log: (line) => secondLog.push(line),
      });
      assert.deepEqual(second.applied, []);
      assert.equal(second.alreadyApplied.length, 33);
      assert.equal(secondLog[secondLog.length - 1], "0 applied, 33 already applied");
      history = await client.execute("SELECT name FROM d1_migrations");
      assert.equal(history.rows.length, 33);
    } finally {
      closeDatabase(client, file);
    }
  });

  test("produces the same table set as schema.sql", async () => {
    const file = tempDatabaseFile();
    const client = openClient(file);
    const canonical = new Database(":memory:");
    try {
      await migrateLibsql(client, defaultMigrationsDir());
      canonical.exec("PRAGMA foreign_keys = ON;");
      canonical.exec(readFileSync(SCHEMA_PATH, "utf8"));
      assert.deepEqual(await libsqlTableNames(client), sqliteTableNames(canonical));
    } finally {
      canonical.close();
      closeDatabase(client, file);
    }
  });

  test("stops at the first broken file and leaves no partial effects", async () => {
    const file = tempDatabaseFile();
    const dir = tempMigrationsDir();
    const client = openClient(file);
    try {
      writeFileSync(
        join(dir, "0001_ok.sql"),
        "CREATE TABLE ok_table (id INTEGER PRIMARY KEY, note TEXT);\nINSERT INTO ok_table (note) VALUES ('seed');\n",
      );
      writeFileSync(
        join(dir, "0002_broken.sql"),
        "CREATE TABLE broken_table (id INTEGER PRIMARY KEY);\nINSERT INTO broken_table (nope) VALUES (1);\nCREATE TABLE never_reached (id INTEGER PRIMARY KEY);\n",
      );
      await assert.rejects(
        migrateLibsql(client, dir),
        (error: unknown) =>
          error instanceof Error &&
          error.message.startsWith("migration 0002_broken.sql failed: ") &&
          error.message.includes("nope"),
      );
      const history = await client.execute("SELECT name FROM d1_migrations");
      assert.deepEqual(history.rows.map((row) => String(row.name)), ["0001_ok.sql"]);
      const tables = await libsqlTableNames(client);
      assert.ok(tables.includes("ok_table"));
      assert.ok(!tables.includes("broken_table"), "the failed file's own statements are rolled back");
      assert.ok(!tables.includes("never_reached"), "statements after the error are not executed");
      const seed = await client.execute("SELECT note FROM ok_table");
      assert.equal(String(seed.rows[0].note), "seed");
    } finally {
      closeDatabase(client, file);
      rmSync(dir, { force: true, recursive: true });
    }
  });

  test("refuses to run when the database has migrations unknown to this checkout", async () => {
    const file = tempDatabaseFile();
    const client = openClient(file);
    try {
      await client.execute(`CREATE TABLE d1_migrations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT UNIQUE,
        applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
      )`);
      await client.execute("INSERT INTO d1_migrations (name) VALUES (?)", ["0001_ghost.sql"]);
      await assert.rejects(
        migrateLibsql(client, defaultMigrationsDir()),
        (error: unknown) =>
          error instanceof Error &&
          error.message === "database has migrations unknown to this checkout: 0001_ghost.sql",
      );
      // Nothing was applied: the first real migration's tables are absent.
      const tables = await libsqlTableNames(client);
      assert.ok(!tables.includes("users"));
      const history = await client.execute("SELECT name FROM d1_migrations");
      assert.deepEqual(history.rows.map((row) => String(row.name)), ["0001_ghost.sql"]);
    } finally {
      closeDatabase(client, file);
    }
  });

  test("dry run lists the pending files without writing anything", async () => {
    const file = tempDatabaseFile();
    const dir = tempMigrationsDir();
    const client = openClient(file);
    try {
      writeFileSync(join(dir, "0001_ok.sql"), "CREATE TABLE ok_table (id INTEGER PRIMARY KEY);\n");
      writeFileSync(join(dir, "0002_broken.sql"), "CREATE TABLE broken_table (id INTEGER PRIMARY KEY);\n");
      const logLines: string[] = [];
      const result = await migrateLibsql(client, dir, {
        dryRun: true,
        log: (line) => logLines.push(line),
      });
      assert.deepEqual(result, {
        applied: [],
        pending: ["0001_ok.sql", "0002_broken.sql"],
        alreadyApplied: [],
      });
      assert.deepEqual(logLines, [
        "pending 0001_ok.sql",
        "pending 0002_broken.sql",
        "0 applied, 0 already applied",
      ]);
      assert.deepEqual(await libsqlTableNames(client), []);
    } finally {
      closeDatabase(client, file);
      rmSync(dir, { force: true, recursive: true });
    }
  });

  test("refuses to migrate when the transaction sees foreign keys off", async () => {
    const file = tempDatabaseFile();
    const dir = tempMigrationsDir();
    const base = openClient(file);
    const { calls, client } = clientWithForeignKeysOff(base);
    try {
      writeFileSync(join(dir, "0001_fk.sql"), "CREATE TABLE fk_table (id INTEGER PRIMARY KEY);\n");
      await assert.rejects(
        migrateLibsql(client, dir),
        (error: unknown) =>
          error instanceof Error &&
          error.message === "foreign key enforcement is off on the database; refusing to migrate 0001_fk.sql",
      );
      // The check ran inside the transaction, before any statement of the
      // file, and the uncommitted transaction was closed (rolled back).
      assert.deepEqual(calls, ["check", "rollback"]);
      const tables = await libsqlTableNames(base);
      assert.ok(!tables.includes("fk_table"), "nothing was applied");
      const history = await base.execute("SELECT name FROM d1_migrations");
      assert.deepEqual(history.rows, []);
    } finally {
      closeDatabase(base, file);
      rmSync(dir, { force: true, recursive: true });
    }
  });

  test("applies migrations with foreign keys enforced inside the file transaction", async () => {
    const file = tempDatabaseFile();
    const dir = tempMigrationsDir();
    const client = openClient(file);
    try {
      writeFileSync(
        join(dir, "0001_fk.sql"),
        [
          "CREATE TABLE fk_parent (id INTEGER PRIMARY KEY);",
          "CREATE TABLE fk_child (id INTEGER PRIMARY KEY, parent_id INTEGER NOT NULL REFERENCES fk_parent(id));",
          "INSERT INTO fk_child (id, parent_id) VALUES (1, 999);",
        ].join("\n"),
      );
      // Turn enforcement off on the client's own connection first: without
      // the migrator's own `PRAGMA foreign_keys = ON` (executed outside the
      // transaction and visible inside it) this file would commit, because
      // the violating insert only fails with enforcement on.
      await client.execute("PRAGMA foreign_keys = OFF");
      await assert.rejects(
        migrateLibsql(client, dir),
        (error: unknown) =>
          error instanceof Error &&
          error.message.startsWith("migration 0001_fk.sql failed: ") &&
          /foreign key/i.test(error.message),
      );
    } finally {
      closeDatabase(client, file);
      rmSync(dir, { force: true, recursive: true });
    }
  });
});

describe("migrate-libsql CLI", () => {
  test("exits 2 with the exact message when DATABASE_URL is missing", async () => {
    const run = await runCli([], { DATABASE_AUTH_TOKEN: "", DATABASE_URL: "" }, SERVER_DIR);
    assert.equal(run.code, 2);
    assert.ok(run.stderr.includes("DATABASE_URL is required"));
  });

  test("never prints the credentials of a malformed DATABASE_URL", async () => {
    const run = await runCli(
      [],
      { DATABASE_AUTH_TOKEN: "", DATABASE_URL: "//user:TEST_SECRET_SENTINEL@127.0.0.1:1/db" },
      SERVER_DIR,
    );
    assert.notEqual(run.code, 0);
    assert.ok(!run.stdout.includes("TEST_SECRET_SENTINEL"), `stdout leaked the secret:\n${run.stdout}`);
    assert.ok(!run.stderr.includes("TEST_SECRET_SENTINEL"), `stderr leaked the secret:\n${run.stderr}`);
    assert.ok(!run.stdout.includes("user:"), `stdout leaked the userinfo:\n${run.stdout}`);
    assert.ok(!run.stderr.includes("user:"), `stderr leaked the userinfo:\n${run.stderr}`);
  });

  test("never prints DATABASE_AUTH_TOKEN when the URL also fails", async () => {
    const run = await runCli(
      [],
      { DATABASE_AUTH_TOKEN: "TOKEN_SENTINEL", DATABASE_URL: "//user:TEST_SECRET_SENTINEL@127.0.0.1:1/db" },
      SERVER_DIR,
    );
    assert.notEqual(run.code, 0);
    const output = `${run.stdout}${run.stderr}`;
    assert.ok(!output.includes("TOKEN_SENTINEL"), `output leaked the token:\n${output}`);
    assert.ok(!output.includes("TEST_SECRET_SENTINEL"), `output leaked the secret:\n${output}`);
    assert.ok(!output.includes("user:"), `output leaked the userinfo:\n${output}`);
  });

  test("dry run lists the pending migrations and writes nothing", async () => {
    const file = tempDatabaseFile();
    try {
      const run = await runCli(["--dry-run"], { DATABASE_URL: `file:${file}` }, SERVER_DIR);
      assert.equal(run.code, 0);
      assert.ok(run.stdout.includes("pending 0001_initial.sql"));
      assert.ok(run.stdout.includes("pending 0027_assistant_threads.sql"));
      assert.ok(run.stdout.includes("pending 0028_assistant_proposals.sql"));
      assert.ok(run.stdout.includes("pending 0029_pin_index.sql"));
      assert.ok(run.stdout.includes("pending 0030_capture_filing.sql"));
      assert.ok(run.stdout.includes("pending 0031_assistant_credits.sql"));
      assert.ok(run.stdout.includes("0 applied, 0 already applied"));
      const client = openClient(file);
      try {
        assert.deepEqual(await libsqlTableNames(client), []);
      } finally {
        closeDatabase(client, file);
      }
    } finally {
      for (const suffix of ["", "-wal", "-shm"]) rmSync(file + suffix, { force: true });
    }
  });

  test("applies the migrations and prints one line per file", async () => {
    const file = tempDatabaseFile();
    // cwd is not the migrations dir: the script must resolve it from itself.
    try {
      const run = await runCli([], { DATABASE_URL: `file:${file}` }, tmpdir());
      assert.equal(run.code, 0);
      assert.ok(run.stdout.includes("applied 0001_initial.sql"));
      assert.ok(run.stdout.includes("applied 0027_assistant_threads.sql"));
      assert.ok(run.stdout.includes("applied 0028_assistant_proposals.sql"));
      assert.ok(run.stdout.includes("applied 0029_pin_index.sql"));
      assert.ok(run.stdout.includes("applied 0030_capture_filing.sql"));
      assert.ok(run.stdout.includes("applied 0031_assistant_credits.sql"));
      assert.ok(run.stdout.includes("applied 0033_capture_filing_credits.sql"));
      assert.ok(run.stdout.includes("33 applied, 0 already applied"));
      const client = openClient(file);
      try {
        const history = await client.execute("SELECT name FROM d1_migrations");
        assert.equal(history.rows.length, 33);
      } finally {
        closeDatabase(client, file);
      }
    } finally {
      for (const suffix of ["", "-wal", "-shm"]) rmSync(file + suffix, { force: true });
    }
  });

  test("exits 1 when the database has unknown migrations", async () => {
    const file = tempDatabaseFile();
    const client = openClient(file);
    try {
      await client.execute(`CREATE TABLE d1_migrations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT UNIQUE,
        applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
      )`);
      await client.execute("INSERT INTO d1_migrations (name) VALUES (?)", ["0001_ghost.sql"]);
      // Keep the file: the CLI process must see the seeded history.
      client.close();
      const run = await runCli([], { DATABASE_URL: `file:${file}` }, SERVER_DIR);
      assert.equal(run.code, 1);
      assert.ok(run.stderr.includes("database has migrations unknown to this checkout: 0001_ghost.sql"));
    } finally {
      for (const suffix of ["", "-wal", "-shm"]) rmSync(file + suffix, { force: true });
    }
  });
});

describe("migrate-libsql helpers", () => {
  test("databaseTarget never returns the full URL or credentials", () => {
    assert.equal(databaseTarget("http://sqld.internal:8080"), "sqld.internal:8080");
    assert.equal(databaseTarget("http://user:secret-token@sqld.internal:8080/path?x=1"), "sqld.internal:8080");
    assert.equal(databaseTarget("file:/tmp/pinar.db"), "/tmp/pinar.db");
  });

  test("parseMigrateArgs accepts only --dry-run", () => {
    assert.deepEqual(parseMigrateArgs([]), { dryRun: false });
    assert.deepEqual(parseMigrateArgs(["--dry-run"]), { dryRun: true });
    assert.throws(() => parseMigrateArgs(["--bogus"]), /usage/);
    assert.throws(() => parseMigrateArgs(["--dry-run", "--bogus"]), /usage/);
  });

  test("safeErrorMessage replaces the URL, the token and any userinfo", () => {
    const url = "//user:SECRET@127.0.0.1:18947/db";
    assert.equal(
      safeErrorMessage(new Error(`URL_INVALID: The URL '${url}' is not in a valid format`), url),
      "URL_INVALID: The URL '<DATABASE_URL>' is not in a valid format",
    );
    assert.equal(
      safeErrorMessage(new Error("transport failed: token abc123 was rejected"), undefined, "abc123"),
      "transport failed: token <DATABASE_AUTH_TOKEN> was rejected",
    );
    assert.equal(
      safeErrorMessage(new Error("bad url http://user:pw@127.0.0.1:1/db")),
      "bad url http://<credentials>@127.0.0.1:1/db",
    );
    assert.equal(safeErrorMessage(new Error("fetch failed at http://127.0.0.1:1/db")), "fetch failed at http://127.0.0.1:1/db");
    assert.equal(safeErrorMessage("just a string error", "http://user:pw@127.0.0.1:1/db"), "just a string error");
    assert.equal(safeErrorMessage(new Error("failed")), "failed");
  });
});
