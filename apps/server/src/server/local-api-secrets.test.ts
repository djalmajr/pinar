import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "../../../..");

const LOCAL_API_SOURCES = [
  "api.local.ts",
  "local-api-policy.ts",
  "local-api-trust.ts",
  "local-capability.ts",
];

describe("local API secret hygiene", () => {
  test("local API sources do not log requests or capability material", () => {
    for (const name of LOCAL_API_SOURCES) {
      const source = readFileSync(join(here, name), "utf8");
      assert.doesNotMatch(source, /console\.(log|info|debug|warn)/, name);
    }
  });

  test("extension local fetch does not put the capability in a URL or console line", () => {
    const source = readFileSync(join(repoRoot, "extension/background.js"), "utf8");
    assert.match(source, /localFetch\(base, "\/api\/shots"/);
    assert.doesNotMatch(source, /\/api\/local\/capability\?/);
    assert.doesNotMatch(source, /console\.(?:log|info|debug|warn|error)\([^)]*token/);
  });
});
