import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  buildCloudLocalFixture,
  buildCloudLocalFreeAccountEmailChallengeSql,
  buildCloudLocalProEmailChallengeResetSql,
  buildCloudLocalSeedSql,
  buildCloudLocalAuthRateLimitResetSql,
  CloudLocalFreeAccountEmail,
  emailCodeHash,
  extensionCodeHash,
  parseCloudLocalOptions,
  proEmailChallengeUpsertSql,
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
      parseCloudLocalOptions(["--serve", "--profile", "pro", "--port", "17384", "--state-path", "fixture-state"]),
      { port: 17384, profile: "pro", serve: true, statePath: "fixture-state" },
    );
    assert.deepEqual(
      parseCloudLocalOptions(["--profile", "free"]),
      { port: 3000, profile: "free", serve: false, statePath: ".wrangler/state/cloud-local" },
    );
    assert.throws(() => parseCloudLocalOptions(["--profile", "enterprise"]), /free, pro/);
    assert.throws(() => parseCloudLocalOptions(["--port", "0"]), /between 1 and 65535/);
  });
});

describe("local cloud email challenge reset", () => {
  // Mutation captured: the seed and the e2e reset diverging (a duplicated
  // statement with a different expiry or the wrong conflict clause) would
  // leave a consumed challenge unrescuable in a full run.
  test("the Pro reset re-applies the seed's own upsert statement with a future expiry", () => {
    const fixture = buildCloudLocalFixture("pro", "test-pepper", new Date("2026-08-19T12:00:00.000Z"));
    const statement = proEmailChallengeUpsertSql(fixture);
    const reset = buildCloudLocalProEmailChallengeResetSql(new Date("2026-08-19T12:00:00.000Z"));

    // Single source of truth: the seed carries the exact statement.
    assert.ok(buildCloudLocalSeedSql(fixture).includes(statement));
    // The reset is the same shape against the production pepper: it clears
    // usage, zeroes attempts and pushes the expiry 24h past the reset
    // instant (deterministic when the instant is pinned).
    assert.equal(reset, buildCloudLocalProEmailChallengeResetSql(new Date("2026-08-19T12:00:00.000Z")));
    assert.match(reset, /^INSERT INTO email_challenges \(id, email, user_id, code_hash, attempts, expires_at, used_at, created_at\) VALUES \('emc_cloud_local_pro', 'pro\.cloud-local@pinar\.test', 'usr_cloud_local_pro', '[0-9a-f]{64}', 0, '2026-08-20T12:00:00\.000Z', NULL, '2026-08-19T12:00:00\.000Z'\) ON CONFLICT\(id\) DO UPDATE SET code_hash=excluded\.code_hash, attempts=0, expires_at=excluded\.expires_at, used_at=NULL, created_at=excluded\.created_at;$/);
  });

  // Mutation captured: the Free challenge hashing the wrong code, or binding
  // an account, would stop the fresh free-account sign-in the viewer e2e
  // relies on.
  test("the free-account challenge targets a known code with no account yet", () => {
    const sql = buildCloudLocalFreeAccountEmailChallengeSql(new Date("2026-08-19T12:00:00.000Z"));

    assert.equal(CloudLocalFreeAccountEmail.code, "268268");
    assert.match(sql, /^INSERT INTO email_challenges \(id, email, user_id, code_hash, attempts, expires_at, used_at, created_at\) VALUES \('emc_cloud_local_free_account', 'free\.cloud-local@pinar\.test', NULL, '[0-9a-f]{64}', 0, '2026-08-20T12:00:00\.000Z', NULL, '2026-08-19T12:00:00\.000Z'\) ON CONFLICT\(id\) DO UPDATE SET code_hash=excluded\.code_hash, attempts=0, expires_at=excluded\.expires_at, used_at=NULL, created_at=excluded\.created_at;$/);
    assert.doesNotMatch(sql, /emc_cloud_local_pro/);
    assert.doesNotMatch(sql, /usr_cloud_local/);
  });
});

describe("local cloud auth rate limit reset", () => {
  // Mutation captured: clearing the wrong actions (or every action) would
  // either leave the email-code limits in place or hide the other rate limits.
  test("clears only the email-code request and verify counters", () => {
    assert.equal(
      buildCloudLocalAuthRateLimitResetSql(),
      "DELETE FROM auth_rate_limits WHERE action IN ('email-code', 'email-code-verify');",
    );
  });
});

describe("local cloud account fixture", () => {
  // Mutation captured: removing either expiring grant changes the real entitlement balance or its nearest expiry.
  test("seeds an internally consistent Pro account with one initial credit grant", () => {
    const fixture = buildCloudLocalFixture("pro", "test-pepper", new Date("2026-08-19T12:00:00.000Z"));
    const sql = buildCloudLocalSeedSql(fixture);

    assert.equal(fixture.nextRefillAt, null);
    assert.equal(fixture.initialCreditExpiry, "2027-08-19T12:00:00.000Z");
    assert.equal(fixture.creditExpiry, "2026-08-26T12:00:00.000Z");
    assert.equal(fixture.extensionCodeHash, extensionCodeHash("test-pepper", "PRCLD826"));
    assert.equal(fixture.emailCodeHash, emailCodeHash("test-pepper", "pro.cloud-local@pinar.test", "826826"));
    assert.match(sql, /INSERT INTO email_challenges /);
    assert.match(sql, /INSERT OR IGNORE INTO legal_acceptances .*'account'/);
    assert.match(sql, /'pro_initial'.*500, 20/);
    assert.match(sql, /DELETE FROM ai_credit_grants .*'pro_initial:usr_cloud_local_pro'/);
    assert.match(sql, /'purchase'.*20, 0/);
    assert.match(sql, /134217728/);
    assert.match(sql, /ai_credit_refill_at/);
    assert.doesNotMatch(sql, /INSERT INTO storage_grants/);
    assert.doesNotMatch(sql, /\b(?:BEGIN|COMMIT)\b/);
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
