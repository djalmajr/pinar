import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";

interface WranglerConfig {
  env: {
    production: { vars: Record<string, string> };
    staging: { vars: Record<string, string> };
  };
  vars: Record<string, string>;
}

const config = JSON.parse(
  readFileSync(new URL("../../wrangler.jsonc", import.meta.url), "utf8")
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/,\s*([}\]])/g, "$1"),
) as WranglerConfig;

describe("billing deployment configuration", () => {
  test("keeps only subscription and add-on prices in every environment", () => {
    for (const vars of [config.vars, config.env.staging.vars, config.env.production.vars]) {
      assert.equal(Object.keys(vars).some((key) => /FOUNDER|LIFETIME/.test(key)), false);
      for (const suffix of ["MONTHLY", "YEARLY", "AI_CREDITS_1000", "STORAGE_5GB_12M", "STORAGE_20GB_12M"]) {
        assert.match(vars[`STRIPE_PRICE_${suffix}`], /^price_/);
        assert.match(vars[`STRIPE_PRICE_BR_${suffix}`], /^price_/);
      }
    }
  });
});
