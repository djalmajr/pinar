import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
import { expect, type Page } from "@playwright/test";
import {
  buildCloudLocalFreeAccountEmailChallengeSql,
  buildCloudLocalProEmailChallengeResetSql,
  buildCloudLocalAuthRateLimitResetSql,
  CloudLocalFreeAccountEmail,
} from "../../../apps/server/scripts/cloud-local.mjs";
import { CURRENT_LEGAL_VERSION } from "../../../apps/server/src/lib/legal-documents";
import { CLOUD_E2E_STATE_PATH } from "../../../playwright.cloud.config";

// The Pro fixture email and its one-shot code (the seeded fixture).
export const CloudLocalProEmail = { code: "826826", email: "pro.cloud-local@pinar.test" };

// The cloud-local server holds the persisted state open for the whole run,
// so a reset is one short write on the same file; if the writer slot is
// busy, the SQLite lock makes the attempt fail fast and the retry converges.
const RESET_ATTEMPTS = 3;
const RESET_RETRY_DELAY_MS = 750;

async function sleep(ms: number) {
  await new Promise((resolveTimer) => setTimeout(resolveTimer, ms));
}

async function runCloudLocalStateSql(sql: string) {
  const workdir = mkdtempSync(resolve(tmpdir(), "pinar-cloud-local-sql-"));
  const file = resolve(workdir, "reset.sql");
  let lastError = "";
  try {
    writeFileSync(file, sql);
    for (let attempt = 1; attempt <= RESET_ATTEMPTS; attempt += 1) {
      const result = spawnSync(
        "bunx",
        ["wrangler", "d1", "execute", "pinar-dev", "--local", "--persist-to", CLOUD_E2E_STATE_PATH, "--file", file, "--yes"],
        { cwd: resolve(process.cwd(), "apps", "server"), env: { ...process.env, CI: "1" }, encoding: "utf8", timeout: 120_000 },
      );
      if (result.status === 0) return;
      lastError = [result.stderr, result.stdout].filter(Boolean).join("\n");
      if (attempt < RESET_ATTEMPTS) await sleep(RESET_RETRY_DELAY_MS);
    }
  } finally {
    rmSync(workdir, { force: true, recursive: true });
  }
  throw new Error(`cloud-local state SQL failed after ${RESET_ATTEMPTS} attempts:\n${lastError}`);
}

// Re-applies the seeded Pro email challenge against the run's persisted state
// (used_at NULL, attempts 0, expiry in the future) and clears the email-code rate
// counters (request and verify, per email per 15 min): the code is one-shot per verify, and the
// full run never depends on which test claimed it first or how many came before.
export async function resetCloudLocalProEmailChallenge() {
  await runCloudLocalStateSql(`${buildCloudLocalProEmailChallengeResetSql()}\n${buildCloudLocalAuthRateLimitResetSql()}`);
}
// The extension flow requests its code through the real options UI, which
// counts against the request limits; clear them right before that.
export async function resetCloudLocalAuthRateLimits() {
  await runCloudLocalStateSql(buildCloudLocalAuthRateLimitResetSql());
}
// Same reset for the fresh free-account sign-in (no account yet; the verify
// endpoint creates the Free account on success).
export async function resetCloudLocalFreeAccountEmailChallenge() {
  await runCloudLocalStateSql(`${buildCloudLocalFreeAccountEmailChallengeSql()}\n${buildCloudLocalAuthRateLimitResetSql()}`);
}

// A new account has to accept the current policies on its first verify (the
// sign-in notice does it by continuing); an existing account already did.
const CURRENT_LEGAL_ACCEPTANCE = {
  acceptableUseVersion: CURRENT_LEGAL_VERSION,
  accepted: true,
  locale: "en",
  privacyVersion: CURRENT_LEGAL_VERSION,
  termsVersion: CURRENT_LEGAL_VERSION,
};

async function verifyEmailCode(
  page: Page,
  email: string,
  code: string,
  returnTo: string,
  extra: Record<string, unknown> = {},
) {
  const signIn = await page.request.post("/api/auth/email-codes/verify", {
    data: { code, email, returnTo, ...extra },
  });
  expect(signIn.ok(), `verify ${email}: ${signIn.status()} ${await signIn.text()}`).toBe(true);
}

// Signs the Cloud Pro fixture into `page`'s context (real session cookie).
// Navigation stays with the caller, exactly as the hand-rolled sign-ins did.
export async function signInCloudPro(page: Page, options: { returnTo?: string } = {}) {
  const returnTo = options.returnTo ?? "/app";
  await resetCloudLocalProEmailChallenge();
  await verifyEmailCode(page, CloudLocalProEmail.email, CloudLocalProEmail.code, returnTo);
}

// Signs the fresh free-account fixture in: first verify creates the Free
// account; later verifies are reset the same way as the Pro challenge.
export async function signInCloudFreeAccount(page: Page, options: { returnTo?: string } = {}) {
  const returnTo = options.returnTo ?? "/app";
  await resetCloudLocalFreeAccountEmailChallenge();
  await verifyEmailCode(page, CloudLocalFreeAccountEmail.email, CloudLocalFreeAccountEmail.code, returnTo, {
    legalAcceptance: CURRENT_LEGAL_ACCEPTANCE,
  });
}
