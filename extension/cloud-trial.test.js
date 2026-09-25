import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import {
  accountTypeLabel,
  cloudSubscriptionRequired,
  formatTrialEnd,
  normalizeCloudTrial,
} from "./cloud-trial.js";

const messages = {
  en: {
    account_trial_active: "Cloud trial",
    account_trial_until: "Cloud trial until {date}",
    account_trial_expired_title: "Cloud trial ended",
  },
  pt: {
    account_trial_active: "Avaliação Cloud",
    account_trial_until: "Avaliação Cloud até {date}",
    account_trial_expired_title: "Avaliação Cloud encerrada",
  },
};
const backgroundSrc = readFileSync(new URL("./background.js", import.meta.url), "utf8");
const i18nSrc = readFileSync(new URL("../packages/shared/src/i18n/index.ts", import.meta.url), "utf8");
const optionsSrc = readFileSync(new URL("../apps/extension/src/options/OptionsApp.tsx", import.meta.url), "utf8");
const active = {
  endsAt: "2026-10-09T10:00:00.000Z",
  startedAt: "2026-09-25T10:00:00.000Z",
  state: "active",
  uploadAllowed: true,
};

describe("cloud trial entitlements", () => {
  test("keeps a complete trial and drops anything the contract does not define", () => {
    assert.deepEqual(normalizeCloudTrial(active), active);
    for (const state of ["disabled", "legacy", "expired", "paid"]) {
      assert.equal(normalizeCloudTrial({ ...active, state, uploadAllowed: state !== "expired" }).state, state);
    }
    assert.equal(normalizeCloudTrial(undefined), null);
    assert.equal(normalizeCloudTrial({ ...active, state: "trialing" }), null);
    assert.equal(normalizeCloudTrial({ ...active, endsAt: 1 }), null);
    assert.equal(normalizeCloudTrial({ ...active, uploadAllowed: "yes" }), null);
  });

  test("names only an active or expired trial and leaves legacy and paid as the plan", () => {
    assert.equal(
      accountTypeLabel("free", active, messages.en, "en"),
      `Cloud trial until ${formatTrialEnd(active.endsAt, "en")}`,
    );
    assert.equal(accountTypeLabel("free", { ...active, endsAt: null }, messages.en, "en"), "Cloud trial");
    assert.equal(accountTypeLabel("free", { ...active, state: "expired", uploadAllowed: false }, messages.en, "en"), "Cloud trial ended");
    assert.equal(accountTypeLabel("free", { ...active, state: "legacy" }, messages.en, "en"), "FREE");
    assert.equal(accountTypeLabel("free", { ...active, state: "disabled" }, messages.en, "en"), "FREE");
    assert.equal(accountTypeLabel("pro", { ...active, state: "paid" }, messages.en, "en"), "PRO");
    assert.equal(accountTypeLabel("free", null, messages.en, "en"), "FREE");
    assert.match(accountTypeLabel("free", active, messages.pt, "pt-BR"), /^Avaliação Cloud até /);
  });

  test("passes trial through storage status without a second entitlements call", () => {
    const status = backgroundSrc.slice(backgroundSrc.indexOf("async function getStorageStatus"), backgroundSrc.indexOf("async function requestAccountEmailCode"));
    assert.match(status, /\/api\/account\/entitlements/);
    assert.equal(status.match(/\/api\/account\/entitlements/g).length, 1);
    assert.match(status, /quotaBytes/);
    assert.match(status, /usedBytes/);
    assert.match(status, /uploadAllowed: storage\.uploadAllowed !== false/);
    assert.match(status, /reachable: response\.ok/);
    assert.match(status, /response\.ok \? normalizeCloudTrial\(body\.trial\) : null/);
    assert.match(optionsSrc, /type: "storage:status"/);
    assert.match(optionsSrc, /storageMode !== "cloud" \|\| session\?\.kind !== "account"/);
    assert.doesNotMatch(optionsSrc, /t\.account_title/);
    assert.match(optionsSrc, /trialForAccount\?\.state === "expired"/);
    assert.match(optionsSrc, /hostedPricingUrl\(settings\.cloudUrl, lang\)/);
    assert.match(optionsSrc, /t\.account_trial_expired/);
    assert.match(optionsSrc, /t\.account_trial_subscribe/);
    assert.doesNotMatch(optionsSrc, /t\.btn_upgrade_pro/);
  });

  test("keeps a 402 subscription failure retryable without clearing the draft", () => {
    const save = backgroundSrc.slice(backgroundSrc.indexOf("async function saveReviewEvidence"), backgroundSrc.indexOf("async function removeReviewEvidence"));
    assert.match(save, /cloudSubscriptionRequired\(response\.status, body\)/);
    assert.match(save, /throw error/);
    assert.match(save, /error\.code = "cloud_subscription_required"/);
    assert.doesNotMatch(save, /write\(null\)|persist\(null\)|discard\(/);
    assert.equal(cloudSubscriptionRequired(402, { code: "cloud_subscription_required" }), true);
    assert.equal(cloudSubscriptionRequired(402, { code: "insufficient_ai_credits" }), false);
    assert.equal(cloudSubscriptionRequired(403, { code: "cloud_subscription_required" }), false);
    assert.match(backgroundSrc, /messages\.overlay_cloud_subscription_required/);
  });

  test("localizes the trial copy in every shipped language", () => {
    for (const language of ["en", "pt", "es", "fr", "de", "zh", "ja"]) {
      assert.match(i18nSrc, new RegExp(`${language}: \\{[\\s\\S]*?account_trial_until: \".*\\{date\\}.*\"`), language);
      assert.match(i18nSrc, new RegExp(`${language}: \\{[\\s\\S]*?account_trial_expired: \".*Pro.*\"`), language);
      assert.match(i18nSrc, new RegExp(`${language}: \\{[\\s\\S]*?overlay_cloud_subscription_required: \".+\"`), language);
    }
  });
});
