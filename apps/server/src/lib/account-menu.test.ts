import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  accountMenuIdentity,
  accountUsageSummary,
  formatByteSize,
  formatEntitlementDate,
  storageUsagePercent,
} from "./account-menu";

describe("accountMenuIdentity", () => {
  test("derives a compact identity from an account email", () => {
    assert.deepEqual(
      accountMenuIdentity({
        email: "djalma.jr@example.test",
        kind: "account",
        plan: "pro",
        userId: "usr_account_menu",
      }, "Pinar Free", "Free plan"),
      {
        detail: "djalma.jr@example.test",
        initials: "DJ",
        name: "Djalma Jr",
      },
    );
  });

  test("uses the localized Free identity for an installation", () => {
    assert.deepEqual(
      accountMenuIdentity({
        installationId: "ins_account_menu",
        kind: "installation",
        plan: "free",
      }, "Pinar Free", "Free plan"),
      {
        detail: "Free plan",
        initials: "PF",
        name: "Pinar Free",
      },
    );
  });
});

describe("accountUsageSummary", () => {
  // Mutation captured: replacing the API balance or quota with zero changes
  // both the parsed contract and its observable percentage.
  test("parses the observable credits and storage contract", () => {
    const summary = accountUsageSummary({
      aiCredits: { balance: 700, nextExpiryAt: "2026-09-18T00:00:00.000Z" },
      plan: "founder",
      storage: { quotaBytes: 5 * 1024 ** 3, usedBytes: 512 * 1024 ** 2 },
    });

    assert.deepEqual(summary, {
      aiCredits: 700,
      aiCreditsExpireAt: "2026-09-18T00:00:00.000Z",
      plan: "founder",
      storageQuotaBytes: 5 * 1024 ** 3,
      storageUsedBytes: 512 * 1024 ** 2,
    });
    assert.equal(summary && storageUsagePercent(summary), 10);
  });

  // Mutation captured: coercing a string balance into a number makes an
  // invalid server response look trustworthy in the account panel.
  test("rejects malformed responses instead of displaying invented quotas", () => {
    assert.equal(accountUsageSummary({ aiCredits: { balance: 500 }, plan: "founder" }), null);
    assert.equal(accountUsageSummary({
      aiCredits: { balance: "500", nextExpiryAt: null },
      plan: "founder",
      storage: { quotaBytes: 5 * 1024 ** 3, usedBytes: 0 },
    }), null);
    assert.equal(accountUsageSummary({
      aiCredits: { balance: 500, nextExpiryAt: "not-a-date" },
      plan: "founder",
      storage: { quotaBytes: 5 * 1024 ** 3, usedBytes: 0 },
    }), null);
  });
});

describe("formatByteSize", () => {
  // Mutation captured: using decimal 1000-byte units reports 5.9 GB instead
  // of the binary 5.5 GB quota promised by the backend contract.
  test("uses readable binary units and the selected locale", () => {
    assert.equal(formatByteSize(0, "en"), "0 B");
    assert.equal(formatByteSize(512 * 1024 ** 2, "en"), "512 MB");
    assert.equal(formatByteSize(5.5 * 1024 ** 3, "pt-BR"), "5,5 GB");
  });
});

describe("formatEntitlementDate", () => {
  // Mutation captured: removing the UTC timezone renders the previous day in
  // Brazil and makes the same entitlement appear to expire at different dates.
  test("keeps date-only entitlement expirations stable across local timezones", () => {
    assert.equal(formatEntitlementDate("2026-09-18T00:00:00.000Z", "en"), "Sep 18, 2026");
    assert.equal(formatEntitlementDate("2026-09-18T00:00:00.000Z", "pt-BR"), "18 de set. de 2026");
  });
});
