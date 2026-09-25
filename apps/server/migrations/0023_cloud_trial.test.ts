import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { readFileSync, readdirSync } from "node:fs";

const directory = new URL("./", import.meta.url);

test("trial migration preserves existing accounts as legacy and accepts explicit trial dates", () => {
  const db = new Database(":memory:");
  try {
    for (const file of readdirSync(directory).filter((name) => name.endsWith(".sql") && name < "0023").sort()) {
      db.exec(readFileSync(new URL(file, directory), "utf8"));
    }
    db.exec("INSERT INTO users (id,email,created_at,updated_at) VALUES ('legacy','legacy@example.test','2026-09-01','2026-09-01')");
    db.exec(readFileSync(new URL("0023_cloud_trial.sql", directory), "utf8"));

    expect(db.query("SELECT cloud_trial_started_at, cloud_trial_ends_at FROM users WHERE id='legacy'").get())
      .toEqual({ cloud_trial_started_at: null, cloud_trial_ends_at: null });
    db.exec("INSERT INTO users (id,email,created_at,updated_at,cloud_trial_started_at,cloud_trial_ends_at) VALUES ('trial','trial@example.test','2026-09-25','2026-09-25','2026-09-25T10:00:00.000Z','2026-10-09T10:00:00.000Z')");
    expect(db.query("SELECT cloud_trial_ends_at FROM users WHERE id='trial'").get())
      .toEqual({ cloud_trial_ends_at: "2026-10-09T10:00:00.000Z" });
  } finally {
    db.close();
  }
});
