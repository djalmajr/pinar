import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const cli = join(here, "cli.mjs");
const version = JSON.parse(readFileSync(join(here, "..", "package.json"), "utf8")).version;

function runCli(args) {
  const home = mkdtempSync(join(tmpdir(), "pinar-cli-"));
  return spawnSync(process.execPath, [cli, ...args], {
    timeout: 15000,
    encoding: "utf8",
    env: {
      ...process.env,
      PINAR_HOME: join(home, ".pinar"),
      // keep the red phase hermetic: if the CLI wrongly starts the server,
      // it cannot bind this port and fails instead of listening
      PINAR_PORT: "1",
    },
  });
}

describe("cli", () => {
  test("--version prints the package version and exits 0 without starting anything", () => {
    const result = runCli(["--version"]);
    assert.equal(result.status, 0);
    assert.equal(result.stdout, `pinar ${version}\n`);
    assert.equal(result.stderr, "");
  });

  test("-v and version print the same line", () => {
    for (const flag of ["-v", "version"]) {
      const result = runCli([flag]);
      assert.equal(result.status, 0, flag);
      assert.equal(result.stdout, `pinar ${version}\n`, flag);
      assert.equal(result.stderr, "", flag);
    }
  });

  test("an unknown first argument prints usage to stderr and exits 2", () => {
    const result = runCli(["--bogus"]);
    assert.equal(result.status, 2);
    assert.equal(result.stdout, "");
    assert.match(result.stderr, /Usage: pinar <ensure\|serve\|status\|stop\|install\|install-hooks\|--version>/);
  });
});
