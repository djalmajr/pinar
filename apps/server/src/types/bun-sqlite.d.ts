declare module "bun:sqlite" {
  class Statement<Row, Params extends unknown[]> {
    get(...params: Params): Row | null;
  }

  export class Database {
    constructor(filename: string);
    close(): void;
    exec(sql: string): void;
    query<Row, Params extends unknown[]>(sql: string): Statement<Row, Params>;
  }
}
