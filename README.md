# Pinar

[![GitHub Sponsors](https://img.shields.io/badge/Sponsor-GitHub%20Sponsors-ea4aaa?style=flat&logo=githubsponsors&logoColor=white)](https://github.com/sponsors/djalmajr)
[![Buy Me A Coffee](https://img.shields.io/badge/Buy%20Me%20a%20Coffee-Donate-yellow?style=flat&logo=buymeacoffee&logoColor=black)](https://buymeacoffee.com/djalmajr)

Pin comments on elements or areas in Chrome and **copy** the bundle (comment, DOM path, coordinates, screenshot) to the clipboard. Paste it anywhere — Grok, Claude, Codex, Slack, notes.

The first saved pin starts a continuous review session, in both local and remote storage. Add comments, press **Esc** to browse, and continue on another page. Once hidden, the toolbar stays hidden across navigation until the extension action or its shortcut is invoked. Pinar captures evidence while the page is still open; it does not revisit URLs at the end. Use **Finish session** or **Ctrl/⌘+Enter** to conclude and hand over all pages together; the *On finish* setting chooses what is copied: **Prompt** (the full text), **Link** (only the session link) or **Off** (nothing). In Pinar Cloud the link is private: an agent needs authenticated access (API key or MCP) unless you share it explicitly, while a local link opens without that. A visible confirmation reports success, while a failed finish keeps the session available for review and retry. The history shows one session with its individual screenshots.

Press **Tab** while annotating to review saved/pending annotations, retry, remove or discard. The review replaces the toolbar until you return to the page. Upload failures keep the local draft and its screenshots for retry. If a screenshot could not be taken before the page changed, recreate that annotation on the original page and remove the pending entry. Finish the draft before changing its server/account. The former manual batch mode is retired; stored captures and existing share links remain compatible.

```
Chrome (Pinar + pins + ⌘↵)
        │  clipboard (Markdown + visual context per capture)
        ▼
Any composer / editor
```

## Install

**macOS:** download [Pinar.app](https://github.com/djalmajr/pinar/releases/latest/download/macos-arm64-Pinar.dmg), open the disk image, and drag **Pinar.app** to `~/Applications`. The menu-bar app starts the local server and registers agent hooks. Shots stay in `~/.pinar/shots`.

**Windows:** download [Pinar Setup](https://github.com/djalmajr/pinar/releases/latest/download/win-x64-Pinar-Setup.zip), extract, and run **Pinar-Setup.exe**. The tray app lands in `%LOCALAPPDATA%\Programs\Pinar` and starts the local server. The standalone helper remains:

```powershell
irm https://pinar.dev/install.ps1 | iex
```

**Linux** still installs the helper binary:

```sh
curl -fsSL https://pinar.dev/install.sh | sh
```

The macOS and Windows apps check GitHub Releases for updates (`stable-macos-arm64-update.json` and `stable-win-x64-update.json` on `/releases/latest/download`). Closed tags (`vX.Y.Z`) publish that Latest channel. Prerelease tags do not.

From a checkout (developers):

```sh
bun run build:tray
bun apps/cli/src/cli.mjs install
```

## Install the extension

Install the official [Pinar extension from the Chrome Web Store](https://chromewebstore.google.com/detail/pinardev/idpeaokdndjedekacfdfbilcolpholbo). A GitHub checkout or unpacked extension folder is not required for normal use.

Independent [extension releases on GitHub](https://github.com/djalmajr/pinar/releases?q=extension) provide the same versioned installable package without waiting for Store approval. They can be loaded unpacked in compatible Chromium browsers: download and extract the ZIP, enable developer mode on the browser's extension-management page, choose **Load unpacked**, and select the directory containing `manifest.json`. Store installation remains recommended for automatic updates.

Extension contributors can still load a development build:

1. Run `bun run build:ext` from this checkout.
2. Open `chrome://extensions` and enable **Developer mode**.
3. Choose **Load unpacked** and select `extension`.
4. After rebuilding, choose **Reload** on the Pinar card before testing the new behavior.

## Usage

A history record is a session containing one or more captures. Opening it always shows a modal; all captures appear together in one pan/zoom canvas, with all annotations in the right panel. Selecting an annotation centers and highlights its image and opens its details. Closing the modal returns to the unchanged history list.

1. Open the page you want to annotate
2. Click the Pinar icon in the Chrome toolbar (pin it from the puzzle-piece menu if it is hidden)
3. Click an element or drag an area, write the comment, press **Enter** to add
4. **⌘↵ / Ctrl+Enter** to finish the session (the toolbar confirms *Session saved* and closes; *On finish* copies the prompt, the link or nothing)

- **Enter** adds the pin
- **Shift+Enter** inserts a newline
- **Esc** in the composer cancels only the unsaved comment; in masking mode, it exits that mode; otherwise, it hides the toolbar and preserves the session and saved pins
- **Tab** opens/closes session review. Inside the comment editor, Tab keeps normal focus navigation.
- The extension icon (or Alt+Shift+P) shows/hides the overlay without deleting pins. After Esc hides everything, use it to reopen Pinar.
- In the review panel, **Discard session** deletes the active session and its evidence. Tab returns to annotation; the page uses its normal cursor while reviewing.
- Hovering the expanded toolbar makes it transparent and passes pointer input to the page. There is no fixed/auto-hide setting or H shortcut.
- See the [continuous session validation guide](docs/continuous-review-validation.md) for the full flow and screenshots.

PNG crops go to `~/.pinar/shots` (Windows: `%USERPROFILE%\.pinar\shots`). The extension cannot write that folder by itself — on macOS, **Pinar.app** starts the local service (menu bar: Start if it shows Off). If the connection is not available, open Pinar and try the capture again.

## Agent access to sessions (MCP)

Coding agents can read stored sessions, manage the local organization, and work on the pin conversations through the Model Context Protocol.

- **Local**: the helper serves a native MCP endpoint at `http://127.0.0.1:<port>/api/mcp` on loopback. It is unauthenticated by design — no login, no API key, and no provider configuration: any agent points its MCP client at that URL, and hostile browser origins are still denied.
- **Cloud**: the MCP surface requires a Pinar API key with the needed scopes, and the key's resource scope bounds what it can list, comment on, or edit. See [Cloud agent access](docs/cloud-agent-access.md) for the key permissions, the full tool matrix, and the wire protocol.

### Local MCP tools

All thirty-six tools are prefixed `pinar`. List tools return `{limit, offset, …}` metadata (limit 1–50, offset 0–10000, default limit 50) without embedded screenshots or session payloads; Markdown tools return the stored Markdown as text; mutations return `ok` with the affected resource(s).

| Tool | Arguments | Returns |
| --- | --- | --- |
| `pinar.list_sessions` | `batchId?`, `collectionId?`, `limit?`, `offset?`, `query?` | session summaries |
| `pinar.get_session_markdown` | `sessionId` | session Markdown |
| `pinar.list_pins` | `sessionId`, `limit?`, `offset?` | pin views (comment, locator, review status) |
| `pinar.get_pin` | `sessionId`, `pinId` | the pin view |
| `pinar.list_pin_comments` | `sessionId`, `pinId` | the pin conversation |
| `pinar.add_pin_comment` | `sessionId`, `pinId`, `body`, `agentName?` | the stored comment; `agentName` is informational and not authenticated |
| `pinar.edit_pin_comment` | `sessionId`, `pinId`, `commentId`, `body` | the updated comment |
| `pinar.edit_pin_note` | `sessionId`, `pinId`, `comment` | the updated pin |
| `pinar.delete_pin_comment` | `sessionId`, `pinId`, `commentId` | `ok`, `deleted` |
| `pinar.list_projects` | `limit?`, `offset?` | project metadata |
| `pinar.get_project_markdown` | `projectId` | project Markdown |
| `pinar.list_collections` | `projectId`, `limit?`, `offset?` | collection metadata |
| `pinar.get_collection_markdown` | `collectionId` | collection Markdown |
| `pinar.list_batches` | `limit?`, `offset?` | batch metadata |
| `pinar.get_batch_markdown` | `batchId` | batch handoff Markdown |
| `pinar.create_project` | `name` | the created project |
| `pinar.rename_project` | `projectId`, `name` | the renamed project |
| `pinar.reorder_projects` | `ids` | the new project order |
| `pinar.delete_project` | `projectId` | `ok`, `deleted`; the protected Personal project is rejected; sessions of the project's collections move to the default destination |
| `pinar.create_collection` | `projectId`, `name`, `parentId?` | the created collection; `null` or omitted parent places it at the root |
| `pinar.rename_collection` | `collectionId`, `name` | the renamed collection |
| `pinar.reorder_collections` | `projectId`, `items` (`{id, parentId: string \| null}`) | the new collection hierarchy |
| `pinar.delete_collection` | `collectionId` | `ok`, `deleted`; the protected Inbox is rejected; child collections are promoted and sessions move to the default destination |
| `pinar.create_batch` | `label` | `ok`, `batch` |
| `pinar.rename_batch` | `batchId`, `label` | `ok`, `batch` |
| `pinar.finish_batch` | `batchId` | `ok`, `batch` (marked finished; sessions stay attached) |
| `pinar.delete_batch` | `batchId` | `ok`, `deleted`; sessions are kept and detached from the batch |
| `pinar.create_session` | `page` (`title`, `url` required; `description?`, each up to 2000 chars), `collectionId?`, `batchId?` | `ok`, the session summary (metadata only; no screenshot) |
| `pinar.update_session` | `sessionId`, `page?`, `reproduction?` (version-1 object: `steps[]` — valid steps carry `at` and `kind` click/input/key/navigate/scroll/wait plus optional `locator`/`thumbnail`/`title`/`url`/`value`; invalid steps are discarded and the list is truncated at 60; `null` clears) | `ok`, the session summary; rejected (`reproduction is invalid`) when the version is not 1 or no step survives |
| `pinar.delete_session` | `sessionId` | `ok`, `deleted`; the session, its pins, comments, and reviews are removed, and the local shot file is deleted when it is the session's canonical screenshot |
| `pinar.move_session` | `sessionId`, `collectionId` | the moved session |
| `pinar.reorder_sessions` | `collectionId`, `ids` | the new session order |
| `pinar.create_pin` | `sessionId`, `comment`, `locator?` (`{cssSelector?, domPath?, innerText?}`) | `ok`, the created pin with an assigned `number`; no screenshot or measured geometry |
| `pinar.delete_pin` | `sessionId`, `pinId` | `ok`, `pinId`, `sessionId` |
| `pinar.conclude_pin` | `sessionId`, `pinId` | `ok`, `changed`, `review` (human accept) |
| `pinar.reopen_pin` | `sessionId`, `pinId` | `ok`, `changed`, `review` (human reopen) |

Names and ids are trimmed, must be nonblank, may not contain control characters, and are limited to 256 characters. The reorder tools require the **complete list** — every project, every collection of the project, or every session of the collection, exactly once — because an omitted resource would keep its old position and duplicate positions would result; partial lists are rejected before any write. `pinar.reorder_collections` validates the whole hierarchy atomically (unique ids, no cycles, no unknown or foreign parents) and keeps the protected root Inbox at the root. `pinar.conclude_pin` and `pinar.reopen_pin` act as the human reviewer (accept/reopen); a repeated action the review state forbids is rejected without changing the state.

The comment tools add comments and edit stored comments or the original pin note; edits preserve the message ids, authorship, and timestamps. The same edit actions are available in the viewer's pin discussion (note: when you can edit pins; comments: any stored comment in the local viewer, and only your own human comments in the Cloud; agent comments are never viewer-editable).

Agent-created sessions and pins are metadata only: `pinar.create_session` stores the `page` without a screenshot, and `pinar.create_pin` stores an optional text `locator` without measured geometry. The extension is the separate writer for the active draft: MCP does not rehydrate or synchronize an in-browser draft, and an explicit later save from the extension replaces the stored session under the same id.

### Transport (Local and Cloud)

Both endpoints run the same TanStack MCP server over HTTP. Only `POST` is accepted (`GET`/`DELETE` return `405`), the body must be `application/json`, and JSON-RPC batch arrays are rejected with `400`. In the legacy `2025-11-25` protocol the client must complete the `initialize` handshake first (a bare `tools/list` returns `400`), keep the `mcp-session-id` header from the response, and send `Accept: application/json, text/event-stream`; the modern `2026-07-28` protocol has no `initialize` and no `mcp-session-id` — the client uses `server/discover` and the calls follow without a legacy session. Legacy HTTP sessions are in-memory and live with the process: after a helper restart (Local) or worker-isolate restart (Cloud), an open session answers `404` and the client reconnects and reinitializes. The server speaks protocol generations `2025-11-25` (legacy; the default of `@modelcontextprotocol/client` 2.2.0) and `2026-07-28` (modern; negotiated with the client's `versionNegotiation` set to `auto` or pinned to the revision), and modern requests do not depend on the legacy session.

Developer notes (legacy transport): request bodies are capped at 256 KiB (larger requests get `413`) and a tool result is capped at 1 MiB (larger results come back as a bounded `isError` envelope: `Tool result is too large; narrow the request or query individual sessions`). Legacy `2025-11-25` sessions are swept lazily about 30 minutes after last use — the sweep only runs when the next request arrives, and `DELETE` returns `405`, so a client cannot end a session explicitly. Concurrent legacy calls within the same session may run against the most recent request's handler context (there is no per-call isolation within a legacy session); when isolation matters, prefer the modern `2026-07-28` protocol, serialize legacy calls, or use a separate connection per session. No production-isolate or live-Cloud behavior was verified for this documentation; no remote/production verification or deploy was authorized.

## Architecture

- `apps/server` is the single TanStack Start application. The Cloudflare build serves `pinar.dev` with marketing, accounts, Stripe, and AI. The Nitro/Bun helper serves the local installation: `/`, `/app`, `/v/*`, `/help/*`, `/releases/*`, `/legal/*`. Pasting `/pricing`, `/sign-in`, or `/success` on loopback redirects to the same path on `https://pinar.dev`. The local API does not proxy pricing or checkout.
- `apps/cli` is the compiled local HTTP helper (embedded in Pinar.app on macOS; still the public installer on Windows/Linux).
- `apps/tray` is the macOS menu-bar app and the Windows notification-area app.
- `apps/extension` is the Chrome extension.
- `packages/ui` and `packages/shared` are consumed by both browser surfaces.

JSON endpoints live under `/api/*`. The private workspace lives at `/app`; the local build opens it directly, while the cloud build requires a web session. Unlisted sharing remains public at `/v/*`, `/p/*`, `/c/*`, and `/shots/*`.

Remote Free installations open `/app` with a five-minute, single-use code created by the extension. Paid and previously paid accounts can also sign in with a six-digit code sent by email. The server stores hashes of codes and session tokens; web sessions last 30 days and authenticated extension devices last 180 days.

The Cloudflare build expects `AUTH_PEPPER`, `STRIPE_SECRET_KEY`, and `STRIPE_WEBHOOK_SECRET` as Worker secrets, plus `EXTENSION_ORIGIN=chrome-extension://<published-extension-id>` as an exact origin allowlist. `ADMIN_API_KEY` is optional and only enables the manual cleanup endpoint. `COMPLIMENTARY_PRO_USER_IDS` is an optional, comma-separated Worker secret containing account IDs to receive standard Pro entitlements without a Stripe subscription. Add an ID only after its owner verifies the account by email; this grant does not add administrative privileges or remove quotas. Its `EMAIL` binding sends from `Pinar <noreply@pinar.dev>`; `pinar.dev` must be enabled in [Cloudflare Email Service](https://developers.cloudflare.com/email-service/get-started/send-emails/), and sending to arbitrary recipients requires a Workers Paid plan under the documented [pricing and limits](https://developers.cloudflare.com/email-service/platform/pricing/). Recreating D1, clearing pre-launch R2 objects, configuring Email Service, and deploying the Worker and extension are coordinated rollout operations rather than build steps.

For hosted-feature development without a deploy, use the isolated Cloudflare runtime described in [Local cloud development](docs/local-cloud-development.md). It runs the Worker code locally with local D1/R2 data and a seeded paid account; it never turns the ordinary local helper into a hosted account.

A public release is not ready until the [closed-loop release gate](docs/release-closed-loop.md) has been proven: pin → agent return → `correction_ready` → accepted, followed by a human review reopen and a second return. Loop metrics stay off unless the user opts in, and never include comments, URLs, selectors, screenshots, or DOM.

Stripe Price IDs and the fixed BRL/USD catalog are non-secret Worker vars in `apps/server/wrangler.jsonc`. Checkout writes the selected offer into Stripe metadata, webhook fulfillment is idempotent, and `/api/account/entitlements` exposes the authenticated credit balance and storage quota. The daily Worker schedule refills active Pro accounts with 200 non-rollover credits each month. Storage add-ons expire after 12 months; uploads above the current quota are blocked, while automatic deletion is intentionally not enabled. Production rollout must subscribe the signed webhook to Checkout completion (including asynchronous success) and subscription update/deletion events before enabling sales.

## Fair Source, plans and policies

Pinar is **Fair Source / source-available**, not OSI-approved Open Source in its
current versions. Nearly all uses are permitted, but offering a competing
commercial product or service is restricted, with future conversion to MIT.
The repository [LICENSE](LICENSE) is the controlling text. Its replacement by
the standardized [FSL-1.1-MIT](https://fsl.software/) template remains pending
legal review; this documentation does not silently change that license.

The code license and the hosted service are separate contracts. The hosted
service has Free and recurring Pro plans. Pro includes 5 GB of base cloud
storage and 200 monthly AI credits without rollover while the subscription is
active. Optional AI-credit and storage packs remain available. The retired
Founder and Lifetime checkout offers are rejected; there is no one-time plan.

Current hosted-service policies are versioned and published at:

- [Terms of Service](https://pinar.dev/legal/terms)
- [Privacy Policy](https://pinar.dev/legal/privacy)
- [Acceptable Use Policy](https://pinar.dev/legal/acceptable-use)
- [Retention Policy](https://pinar.dev/legal/retention)
- [Refund Policy](https://pinar.dev/legal/refunds)
- [Fair Source Policy](https://pinar.dev/legal/fair-source)
- [Subprocessors](https://pinar.dev/legal/subprocessors)

Checkout and remote Free registration record the accepted policy versions.
Migration `0017_remove_founder.sql` removes the retired plan's structures only
when no Founder accounts, credits, captures, purchases, or active/confirmed
reservations remain. Existing records require explicit review before migration.

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

`AGENTS.md` and `CLAUDE.md` describe how an agent should treat the pasted text. In Prompt mode the copy includes `captureId`, `pinId`, and a `pinar-visual-context` JSON block. If it also has `Screenshot: /path/to/file.png`, open that file — it is a single crop with every pin. Cursor uses `.cursor/hooks.json` (`sessionStart`) like the other agents.

```sh
bun test
```
