/**
 * D1-compatible database adapter over an injected `@libsql/client` client.
 *
 * On EdgeR the server runs on Deno with the database as a local `sqld`
 * (libSQL) reached over HTTP, so `env.DB` (the `D1Database` contract in
 * `cloud-api.ts`) is backed by a libSQL `Client` instead of the Cloudflare
 * D1 binding. The client is injected: this module never creates one and
 * never reads environment variables.
 *
 * Results mirror D1: rows are plain objects with only their named columns,
 * `meta.changes` is the affected-row count, and `meta.last_row_id` is the
 * last inserted rowid (0 when the statement did not insert).
 */
import type { Client, InStatement, InValue, ResultSet, Value } from "@libsql/client";

/** The subset of the `@libsql/client` `Client` the adapter needs. */
export type LibsqlLike = Pick<Client, "batch" | "execute">;

/** D1-shaped result of a statement. */
export interface LibsqlD1Result {
  meta: { changes: number; last_row_id: number };
  results: Record<string, unknown>[];
}

/** D1-shaped statement. `bind` returns a new statement; the original is left untouched. */
export interface LibsqlD1Statement {
  all(): Promise<LibsqlD1Result>;
  bind(...values: unknown[]): LibsqlD1Statement;
  first(): Promise<Record<string, unknown> | null>;
  run(): Promise<LibsqlD1Result>;
}

/** D1-shaped database over an injected libSQL client. */
export interface LibsqlD1 {
  batch(statements: LibsqlD1Statement[]): Promise<LibsqlD1Result[]>;
  prepare(query: string): LibsqlD1Statement;
}

class LibsqlD1StatementImpl {
  constructor(
    private readonly client: LibsqlLike,
    readonly sql: string,
    readonly args: InValue[],
  ) {}

  bind(...values: unknown[]): LibsqlD1Statement {
    return new LibsqlD1StatementImpl(
      this.client,
      this.sql,
      values.map((value, index) => toLibsqlValue(value, index)),
    );
  }

  async all(): Promise<LibsqlD1Result> {
    return toD1Result(await this.client.execute({ sql: this.sql, args: this.args }));
  }

  async first(): Promise<Record<string, unknown> | null> {
    const { results } = await this.all();
    return results[0] ?? null;
  }

  async run(): Promise<LibsqlD1Result> {
    return this.all();
  }
}

/**
 * Creates the D1-shaped database. The result is assignable to
 * `NonNullable<CloudEnv["DB"]>` without a cast.
 */
export function createLibsqlD1(client: LibsqlLike): LibsqlD1 {
  return {
    async batch(statements: LibsqlD1Statement[]): Promise<LibsqlD1Result[]> {
      const prepared = statements.map((statement, index) => {
        if (!(statement instanceof LibsqlD1StatementImpl)) {
          throw new Error(`batch() statement at index ${index} was not created by this database's prepare()`);
        }
        return statement;
      });
      const inStatements: InStatement[] = prepared.map((statement) => ({
        args: statement.args,
        sql: statement.sql,
      }));
      const resultSets = await client.batch(inStatements, "write");
      return resultSets.map(toD1Result);
    },
    prepare(query: string): LibsqlD1Statement {
      return new LibsqlD1StatementImpl(client, query, []);
    },
  };
}

/**
 * Narrows a D1 bind value to a libSQL input value. D1 booleans bind as
 * 1/0. Anything else is rejected with the same error D1 raises.
 */
function toLibsqlValue(value: unknown, index: number): InValue {
  if (value === null || typeof value === "number" || typeof value === "string") return value;
  if (typeof value === "boolean") return value ? 1 : 0;
  if (value instanceof Uint8Array || value instanceof ArrayBuffer) return value;
  throw new TypeError(`D1_TYPE_ERROR: Type '${typeof value}' not supported for value at index ${index}`);
}

/** D1 value conversions: bigints come back as numbers, blobs as Uint8Arrays. */
function toD1Value(value: Value): unknown {
  if (typeof value === "bigint") return Number(value);
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  return value;
}

function toD1Result(resultSet: ResultSet): LibsqlD1Result {
  return {
    meta: {
      changes: resultSet.rowsAffected,
      last_row_id: Number(resultSet.lastInsertRowid ?? 0),
    },
    results: resultSet.rows.map((row) => {
      const values: Record<string, unknown> = {};
      for (let i = 0; i < resultSet.columns.length; i += 1) {
        values[resultSet.columns[i]] = toD1Value(row[i]);
      }
      return values;
    }),
  };
}
