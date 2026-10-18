// The Stripe-hosted USD E2E (tests/e2e/monetizacao/stripe-hosted-usd.e2e.test.ts)
// ran only against staging (https://stg.pinar.dev), which was retired on
// 2026-10-18. No other deployed Stripe Test environment exists, so this runner
// refuses up front; the git history keeps the previous runner for when one does.
throw new Error(
  "Stripe-hosted USD E2E is unavailable: its only target, staging (https://stg.pinar.dev), was retired on 2026-10-18 and no other deployed Stripe Test environment exists",
);
