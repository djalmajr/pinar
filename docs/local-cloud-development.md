# Local cloud development

Pinar has three intentionally different runtime targets:

| Target | Command or URL | Data and purpose |
| --- | --- | --- |
| Local helper | `bun run dev:local` | Nitro/Bun, local history, no hosted account or paid features |
| Local cloud runtime | `bun run dev:cloud` | Cloudflare Worker code with isolated local D1/R2 and a deterministic paid fixture |
| Staging | `https://stg.pinar.dev` | Deployed Worker, staging D1/R2, email and Stripe Test/Sandbox lifecycle |

## Run hosted features locally

From the repository root:

```sh
bun run dev:cloud
```

The command:

1. Injects inert secrets only into the spawned local Worker process; it does not create or read `.dev.vars`.
2. Applies every D1 migration to `apps/server/.wrangler/state/cloud-local`.
3. Seeds a Pro account with 200 available AI credits, a monthly refill date, an expiring credit grant, 128 MB of stored session data, and a one-time extension code.
4. Starts the Cloudflare Vite runtime on `http://127.0.0.1:3000` and prints a one-click sign-in URL.

The sign-in URL exchanges the same single-use extension code used by the deployed application. It sets the real HttpOnly web-session cookie and exercises `/api/auth/session`, `/api/account/entitlements`, D1 migrations, and the account UI without API mocks.

Available fixture profiles are `free`, `pro`, `founder`, and `lifetime`:

```sh
bun run dev:cloud -- --profile founder
```

The `free` profile seeds a remote-Free installation instead of a paid account:
an active installation with the current legal bundle accepted, the canonical 5
initial AI credits, and a one-time extension code for the printed sign-in URL.
The full real journey (extension consent, registration, code exchange, capture
upload, and an AI summary consuming one credit) is exercised by
`tests/e2e/cloud/free-extension-flow.e2e.test.ts`.

Re-running the command reapplies only pending migrations, refreshes the selected fixture, and issues the one-time code again. The local Vite plugin and Wrangler commands share the exact persistence path, so there is no separate seed database.

## Automated cloud-runtime gate

```sh
bun run test:e2e:cloud
```

This gate builds the extension options bundle, starts an isolated runtime on port `17384` using `.wrangler/state/cloud-e2e`, authenticates through the real extension-code exchange, checks `runtime: "cloud"`, reads real D1 entitlements, and verifies the account menu in Chromium. It does not intercept account APIs.

The free-extension spec in this gate intentionally triggers one **real Workers
AI inference** per run (`/api/ai/session-summary`) to prove the 5 → 4 credit
consumption end to end. That call goes through the Workers AI binding, so it
depends on network connectivity and Cloudflare credentials from the local
Wrangler login, and it may incur (fractional) Workers AI cost on the
authenticated account. This is the deliberate exception to the "do not trigger
real AI generation" boundary below; offline runs will fail that spec.

## Boundaries

- No D1 or R2 binding is marked `remote: true`; local development cannot read or mutate staging data.
- `vite dev` temporarily caps the local compatibility date at `2026-08-06`, the newest date supported by the checked-in `workerd`; builds and deployments still use `2026-08-16` from `wrangler.jsonc`.
- The injected Stripe values are inert placeholders and are never written into build output. Local fixtures validate application contracts and UI, not Stripe-hosted checkout, webhooks, or Customer Portal.
- The Workers AI binding can call a remote service. Do not trigger real AI generation from this fixture unless that usage is intentional — the free-extension E2E spec is the one intentional exception (see the gate section above).
- Validate subscription creation, cancellation, renewal, email delivery, and Stripe webhooks only in `stg.pinar.dev` with Stripe Test/Sandbox data.
- A local branch is not present on staging until it passes the normal branch, PR, CI, merge, and staging deployment flow.
