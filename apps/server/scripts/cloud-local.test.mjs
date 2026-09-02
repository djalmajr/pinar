import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  buildCloudLocalFixture,
  buildCloudLocalSeedSql,
  extensionCodeHash,
  parseCloudLocalOptions,
} from "./cloud-local.mjs";

describe("local cloud runtime options", () => {
  // Mutation captured: changing the default away from the paid cloud profile breaks the expected local entry point.
  test("defaults to the isolated Pro fixture on port 3000", () => {
    assert.deepEqual(parseCloudLocalOptions([]), {
      port: 3000,
      profile: "pro",
      serve: false,
      statePath: ".wrangler/state/cloud-local",
    });
    assert.deepEqual(
      parseCloudLocalOptions(["--serve", "--profile", "founder", "--port", "17384", "--state-path", "fixture-state"]),
      { port: 17384, profile: "founder", serve: true, statePath: "fixture-state" },
    );
    assert.deepEqual(
      parseCloudLocalOptions(["--profile", "free"]),
      { port: 3000, profile: "free", serve: false, statePath: ".wrangler/state/cloud-local" },
    );
    assert.throws(() => parseCloudLocalOptions(["--profile", "enterprise"]), /founder, free, lifetime, pro/);
    assert.throws(() => parseCloudLocalOptions(["--port", "0"]), /between 1 and 65535/);
  });
});

describe("local cloud account fixture", () => {
  // Mutation captured: removing either expiring grant changes the real entitlement balance or its nearest expiry.
  test("seeds an internally consistent Pro account with 200 available credits", () => {
    const fixture = buildCloudLocalFixture("pro", "test-pepper", new Date("2026-08-19T12:00:00.000Z"));
    const sql = buildCloudLocalSeedSql(fixture);

    assert.equal(fixture.nextRefillAt, "2026-09-19T12:00:00.000Z");
    assert.equal(fixture.creditExpiry, "2026-08-26T12:00:00.000Z");
    assert.equal(fixture.extensionCodeHash, extensionCodeHash("test-pepper", "PRCLD826"));
    assert.match(sql, /'pro_monthly'.*200, 20/);
    assert.match(sql, /'purchase'.*20, 0/);
    assert.match(sql, /134217728/);
    assert.match(sql, /ai_credit_refill_at/);
    assert.doesNotMatch(sql, /INSERT INTO storage_grants/);
    assert.doesNotMatch(sql, /\b(?:BEGIN|COMMIT)\b/);
  });

  test("keeps one-time plans free of a monthly refill promise", () => {
    for (const profile of ["founder", "lifetime"]) {
      const fixture = buildCloudLocalFixture(profile, "test-pepper", new Date("2026-08-19T12:00:00.000Z"));
      assert.equal(fixture.nextRefillAt, null);
      assert.doesNotMatch(buildCloudLocalSeedSql(fixture), /'pro_monthly'/);
    }
  });

  // Mutation captured: dropping any statement leaves the free installation unable to
  // sign in, hold its 5 credits, or pass the remote-free legal gate.
  test("seeds a signable free installation with legal acceptance and 5 credits", () => {
    const fixture = buildCloudLocalFixture("free", "test-pepper", new Date("2026-08-19T12:00:00.000Z"));
    const sql = buildCloudLocalSeedSql(fixture);

    assert.match(fixture.installationId, /^ins_[A-Za-z0-9_-]{24}$/);
    assert.match(fixture.installationToken, /^pit_[A-Za-z0-9_-]{43}$/);
    assert.equal(fixture.nextRefillAt, null);
    assert.equal(fixture.extensionCodeHash, extensionCodeHash("test-pepper", "FRCLD826"));
    assert.match(sql, /INSERT INTO installations /);
    assert.match(sql, /INSERT OR IGNORE INTO legal_acceptances /);
    assert.match(sql, /'remote_free'/);
    assert.match(sql, /'free_initial', 'free:ins_cloud_local_free00000000', 5, 0/);
    assert.doesNotMatch(sql, /INSERT INTO users/);
    assert.doesNotMatch(sql, /INSERT INTO sessions/);
  });
});
