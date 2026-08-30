# Pinar

[![GitHub Sponsors](https://img.shields.io/badge/Sponsor-GitHub%20Sponsors-ea4aaa?style=flat&logo=githubsponsors&logoColor=white)](https://github.com/sponsors/djalmajr)
[![Buy Me A Coffee](https://img.shields.io/badge/Buy%20Me%20a%20Coffee-Donate-yellow?style=flat&logo=buymeacoffee&logoColor=black)](https://buymeacoffee.com/djalmajr)

Pin comments on elements or areas in Chrome and **copy** the bundle (comment, DOM path, coordinates, screenshot) to the clipboard. Paste it anywhere — Grok, Claude, Codex, Slack, notes.

```
Chrome (Pinar + pins + ⌘↵)
        │  clipboard (text/plain + text/html with images)
        ▼
Any composer / editor
```

## Install

**macOS:** download [Pinar.app](https://github.com/djalmajr/pinar/releases/latest/download/macos-arm64-Pinar.dmg), open the disk image, and drag **Pinar.app** to `~/Applications`. The menu-bar app starts the local server and registers agent hooks. Shots stay in `~/.pinar/shots`.

**Windows (PowerShell)** — helper until a desktop app exists:

```powershell
irm https://pinar.dev/install.ps1 | iex
```

**Linux** still installs the helper binary:

```sh
curl -fsSL https://pinar.dev/install.sh | sh
```

The macOS app checks GitHub Releases for updates (`stable-macos-arm64-update.json` on `/releases/latest/download`).

From a checkout (developers):

```sh
bun run build:tray
bun apps/cli/src/cli.mjs install
```

## Load the extension

Pinar is not on the Chrome Web Store. After installing **Pinar.app** (macOS) or the helper (Windows/Linux):

1. Open Chrome and go to `chrome://extensions`
2. Turn on **Developer mode** (toggle in the top-right)
3. Click **Load unpacked**
4. Select the unpacked extension folder — not a Downloads zip:
   - From this checkout after `bun run build:ext`: `extension/dist`
   - Windows / Linux helper installs do not currently copy the extension into `~/.pinar`; use `extension/dist` from a clone until a desktop app exists on those platforms.

Chrome remembers that folder. After you run the installer again, open `chrome://extensions` and click **Reload** on the Pinar card if the overlay looks stale.

## Usage

1. Open the page you want to annotate
2. Click the Pinar icon in the Chrome toolbar (pin it from the puzzle-piece menu if it is hidden)
3. Click an element or drag an area, write the comment, press **Enter** to add
4. **⌘↵ / Ctrl+Enter** to copy (the toolbar shows *Copied* and closes)

- **Enter** adds the pin
- **Shift+Enter** inserts a newline
- **Esc** in the composer closes only the draft; with no draft, it clears all pins and hides the toolbar
- The extension icon only shows or hides the overlay — it does not delete pins

PNG crops go to `~/.pinar/shots` (Windows: `%USERPROFILE%\.pinar\shots`). The extension cannot write that folder by itself — on macOS, **Pinar.app** starts the local server (menu bar: Start if it shows Off). It tries `127.0.0.1:17373` and, if that port is taken by another process, binds the next free port through `17382`. The extension looks for `GET /api/health` with `{"service":"pinar"}` in that range. If `17373` is already Pinar, a second instance is not started. `PINAR_PORT` pins the helper to a single port.

Without the local server, the crop falls back to `Downloads/pinar/`.

## Architecture

- `apps/server` is the single TanStack Start application. The Cloudflare build serves `pinar.dev` with marketing, accounts, Stripe, and AI. The Nitro/Bun helper serves the local installation: `/`, `/app`, `/v/*`, `/legal/*`. Pasting `/pricing`, `/sign-in`, or `/success` on loopback redirects to the same path on `https://pinar.dev`. The local API does not proxy pricing or checkout.
- `apps/cli` is the compiled local HTTP helper (embedded in Pinar.app on macOS; still the public installer on Windows/Linux).
- `apps/tray` is the macOS menu-bar app.
- `apps/extension` is the Chrome extension.
- `packages/ui` and `packages/shared` are consumed by both browser surfaces.

JSON endpoints live under `/api/*`. The private workspace lives at `/app`; the local build opens it directly, while the cloud build requires a web session. Unlisted sharing remains public at `/v/*`, `/p/*`, `/c/*`, and `/shots/*`.

Remote Free installations open `/app` with a five-minute, single-use code created by the extension. Paid and previously paid accounts can also sign in with a six-digit code sent by email. The server stores hashes of codes and session tokens; web sessions last 30 days and authenticated extension devices last 180 days.

The Cloudflare build expects `AUTH_PEPPER`, `STRIPE_SECRET_KEY`, and `STRIPE_WEBHOOK_SECRET` as Worker secrets, plus `EXTENSION_ORIGIN=chrome-extension://<published-extension-id>` as an exact origin allowlist. `ADMIN_API_KEY` is optional and only enables the manual cleanup endpoint. Its `EMAIL` binding sends from `Pinar <noreply@pinar.dev>`; `pinar.dev` must be enabled in [Cloudflare Email Service](https://developers.cloudflare.com/email-service/get-started/send-emails/), and sending to arbitrary recipients requires a Workers Paid plan under the documented [pricing and limits](https://developers.cloudflare.com/email-service/platform/pricing/). Recreating D1, clearing pre-launch R2 objects, configuring Email Service, and deploying the Worker and extension are coordinated rollout operations rather than build steps.

For hosted-feature development without a deploy, use the isolated Cloudflare runtime described in [Local cloud development](docs/local-cloud-development.md). It runs the Worker code locally with local D1/R2 data and a seeded paid account; it never turns the ordinary local helper into a hosted account.

A public release is not ready until the [closed-loop release gate](docs/release-closed-loop.md) has been proven: pin → agent return → `correction_ready` → accepted, including reopen and a second return. Loop metrics stay off unless the user opts in, and never include comments, URLs, selectors, screenshots, or DOM.

Stripe Price IDs and the fixed BRL/USD catalog are non-secret Worker vars in `apps/server/wrangler.jsonc`. Checkout writes the selected offer into Stripe metadata, webhook fulfillment is idempotent, and `/api/account/entitlements` exposes the authenticated credit balance and storage quota. The daily Worker schedule refills active Pro accounts with 200 non-rollover credits each month. Storage add-ons expire after 12 months; uploads above the current quota are blocked, while automatic deletion is intentionally not enabled. Production rollout must subscribe the signed webhook to Checkout completion (including asynchronous success) and subscription update/deletion events before enabling sales.

## Fair Source, plans and policies

Pinar is **Fair Source / source-available**, not OSI-approved Open Source in its
current versions. Nearly all uses are permitted, but offering a competing
commercial product or service is restricted, with future conversion to MIT.
The repository [LICENSE](LICENSE) is the controlling text. Its replacement by
the standardized [FSL-1.1-MIT](https://fsl.software/) template remains pending
legal review; this documentation does not silently change that license.

The code license and the hosted service are separate contracts. The hosted
service currently has Free and recurring Pro plans. **Pinar Founder** is a
limited, server-controlled cohort sold as a one-time purchase with 5 GB of base
cloud storage and 500 initial AI credits, without monthly refill. Founder is not
a promise of unlimited usage or perpetual operation of the hosted service.
Existing `lifetime` accounts and Stripe metadata remain supported only as a
legacy compatibility path; new customer-facing copy uses Founder.

Current hosted-service policies are versioned and published at:

- [Terms of Service](https://pinar.dev/legal/terms)
- [Privacy Policy](https://pinar.dev/legal/privacy)
- [Acceptable Use Policy](https://pinar.dev/legal/acceptable-use)
- [Retention Policy](https://pinar.dev/legal/retention)
- [Refund Policy](https://pinar.dev/legal/refunds)
- [Fair Source Policy](https://pinar.dev/legal/fair-source)
- [Subprocessors](https://pinar.dev/legal/subprocessors)

Checkout and remote Free registration record the accepted policy versions.
Founder uses configurable tranches rather than a permanent hard-coded limit.
Local and staging currently expose the first 100-seat tranche; production
remains closed until a separate authorization configures its switch, capacity,
and both regional Stripe Price IDs. Reaching the configured cap closes new
checkout reservations without deleting the historical Stripe Price.

## Session hooks

Each agent has its own format. **`npx skills add` / skills.sh does not install hooks** — it only copies `SKILL.md`.

The files in this repo also apply when a session opens **in this project**:

| Agent | File | Event |
| --- | --- | --- |
| Cursor | `.cursor/hooks.json` | `sessionStart` |
| Grok | `.grok/hooks/session-start.json` | `SessionStart` |
| Claude | `.claude/settings.json` | `SessionStart` |
| Codex | `.codex/hooks.json` | `SessionStart` (`commandWindows` on Windows) |
| Antigravity | `.agents/hooks.json` | `PreInvocation` (no SessionStart) |
| Pi | `.pi/extensions/pinar.ts` | `session_start` |
| OMP | `.omp/extensions/pinar.ts` | `session_start` |

Extra YAML in `.pi/hook/hooks.yaml` and `.omp/hook/hooks.yaml` only runs if the `pi-yaml-hooks` package is installed.

A local project needs trust the first time: Grok `/hooks-trust`, Codex `/hooks`. Antigravity may prefer the workspace `hooks.json` over the global one — if global hooks disappear in this repo, delete `.agents/hooks.json` and use the global install only.

Re-register hooks from Pinar.app (macOS) or, on Windows/Linux:

```sh
# Windows / Linux helper
pinar install-hooks
```

`AGENTS.md` and `CLAUDE.md` describe how an agent should treat the pasted text. The copy includes `captureId`, `pinId`, and a `pinar-visual-context` JSON block. If it also has `Screenshot: /path/to/file.png`, open that file — it is a single crop with every pin. Cursor uses `.cursor/hooks.json` (`sessionStart`) like the other agents.

```sh
bun test
```
