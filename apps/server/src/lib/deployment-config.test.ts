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

function expectFounderOpen(vars: Record<string, string>) {
  assert.equal(vars.FOUNDER_SALES_ENABLED, "true");
  assert.equal(vars.FOUNDER_CAPACITY_LIMIT, "100");
}

describe("Founder deployment configuration", () => {
  test("opens the first 100-seat tranche for local, staging, and production", () => {
    expectFounderOpen(config.vars);
    expectFounderOpen(config.env.staging.vars);
    expectFounderOpen(config.env.production.vars);
  });

  test("reuses equivalent prices under Founder names without removing legacy aliases", () => {
    for (const vars of [config.vars, config.env.staging.vars, config.env.production.vars]) {
      assert.equal(vars.STRIPE_PRICE_FOUNDER, vars.STRIPE_PRICE_LIFETIME);
      assert.equal(vars.STRIPE_PRICE_BR_FOUNDER, vars.STRIPE_PRICE_BR_LIFETIME);
    }
  });

  test("keeps production Founder prices aliased to the live Lifetime catalog", () => {
    const production = config.env.production.vars;

    assert.match(production.STRIPE_PRICE_FOUNDER, /^price_/);
    assert.match(production.STRIPE_PRICE_BR_FOUNDER, /^price_/);
    assert.match(production.STRIPE_PRICE_LIFETIME, /^price_/);
    assert.match(production.STRIPE_PRICE_BR_LIFETIME, /^price_/);
  });

  test("uses Founder pricing names and leaves old pricing names absent", () => {
    for (const vars of [config.vars, config.env.staging.vars, config.env.production.vars]) {
      assert.equal(vars.PRICING_FOUNDER_USD_CENTS, "3900");
      assert.equal(vars.PRICING_FOUNDER_BRL_CENTS, "12990");
      assert.equal(vars.PRICING_LIFETIME_USD_CENTS, undefined);
      assert.equal(vars.PRICING_LIFETIME_BRL_CENTS, undefined);
    }
  });
});
