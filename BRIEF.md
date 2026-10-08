# Factory brief — DJA-166

**Issue:** [DJA-166 — UI: publicar e revogar link de compartilhamento cloud](https://linear.app/djalmajr/issue/DJA-166/ui-publicar-e-revogar-link-de-compartilhamento-cloud)  
**Team / project:** Fábrica · Pinar: Plataforma · status In Progress  
**Repo:** `djalmajr/pinar` · branch suggestion: `djalmajr/dja-166-ui-publicar-e-revogar-link-de-compartilhamento-cloud`  
**Depends on:** [DJA-117](https://linear.app/djalmajr/issue/DJA-117) (Done, PR [#35](https://github.com/djalmajr/pinar/pull/35) merged `9b38e69` on `main`) — API + migration `0015` fail-closed  
**Runtime:** Herdr on Hetzner `dev` · **not** Cursor Cloud Agents  
**Orquestrador:** `codex` · model **astra** · effort **low**  
**Implementer:** `cursor-agent` · model **cursor-grok-4.6-xhigh** (max) · **never `-fast`**  
**Regra:** BRIEF e prompts vão ao **orch**; orch comanda o impl via `herdr agent prompt|wait|read`. Proibido one-shot só no cursor.

---

## Goal

Ship a **minimal owner-facing UI** so an authenticated cloud owner can **publish**, **copy** a share URL with `?token=sh_*`, and **revoke** that link — without calling the API by hand. Session first; project/collection can follow in the same PR if cheap, otherwise leave as clear follow-up.

DJA-117 already made anonymous cloud access private-by-default and token-gated. Product surface is still missing: owners have no Publish/Revoke control, and several UI links still point at tokenless public URLs.

---

## Context (API already on `main`)

From PR #35 / `apps/server/src/server/cloud-api.ts` + migration `0015_share_tokens.sql`:

| Method | Path | Body / notes |
|--------|------|----------------|
| `POST` | `/api/shares/publish` | `{ resourceType, resourceId, expiresAt? }` · auth required · ownership via authenticated DB lookup · idempotent (returns existing active token) · `201` `{ ok, shareToken: { token, expiresAt } }` |
| `POST` | `/api/shares/revoke` | `{ resourceType, resourceId }` · owner only · `200` `{ ok }` or `404` |
| `GET` | `/api/shares` | lists owner tokens |

- `resourceType`: `session` \| `project` \| `collection` \| `batch`
- Token format: `sh_` + nanoid(32); audit in `share_token_events` (`created` / `revoked`)
- Public routes require `?token=`: `/v/{id}.md`, `/p/{id}.md`, `/c/{id}.md`, `/b/{id}.md`, `/shots/{id}`, `/api/public/projects|collections/...`
- No token / revoked / expired / memory-only → uniform **404** (no metadata leak)
- Cache: public markdown `Cache-Control: public, max-age=60` (stale up to ~60s after revoke — document, do not invent CDN purge in this ticket)

**Canonical share URL (session Markdown):**  
`{origin}/v/{sessionId}.md?token={sh_*}`  
(HTML viewer path for recipients can be `{origin}/v/{sessionId}?token={sh_*}` if the SPA public path already reads `token`; prefer the `.md` URL that the API itself embeds in markdown links.)

---

## Acceptance criteria

- [ ] Authenticated **owner** sees **Publicar** / **Revogar** (or equivalent i18n) for a **session** in cloud workspace/viewer (WebViewer toolbar and/or `SessionActionsMenu`).
- [ ] **Publish** calls `POST /api/shares/publish` with `resourceType: "session"` and shows/copies a URL that **includes** `?token=sh_…`.
- [ ] **Copy link** works (clipboard); after publish, any “open markdown / share” action for that session uses the **tokenized** URL, not bare `/v/{id}.md`.
- [ ] **Revoke** calls `POST /api/shares/revoke`; UI reflects inactive state; opening the old tokenized URL as anonymous yields **404** (after cache window).
- [ ] Non-owners / signed-out users do **not** get publish/revoke controls.
- [ ] No regression on authenticated owner flows (`GET /api/sessions/:id` etc. stay working without share token).
- [ ] Public routes remain fail-closed without token.
- [ ] Optional: expiry control (`expiresAt`) — nice-to-have if UI stays small; otherwise omit and document.
- [ ] i18n: add keys to **all** `apps/server/src/lib/ui-locales/{en,pt,es,fr,de,zh,ja}.ts` (same shape as `en`).
- [ ] `bun run typecheck` and relevant tests green; PR cites **DJA-166**.

---

## Likely touchpoints (code)

**Primary**

- `apps/server/src/pages/WebViewer.tsx` — owner toolbar / page actions; today: copy prompt, open menu; `markdownUrl()` builds **tokenless** `/v/{id}.md`
- `apps/server/src/components/SessionActionsMenu.tsx` — “Open prompt *.md” is `<a href=/v/{id}.md>` **without** token — fix when published
- `apps/server/src/lib/ui-locales/*.ts` — new strings (`share.publish`, `share.revoke`, `share.copyLink`, `share.published`, …)

**Secondary (same PR if small; else follow-up)**

- `apps/server/src/pages/AggregateViewer.tsx` — still fetches `/api/public/...` and `/{p|c}/{id}.md` **without** token (broken for anonymous after DJA-117)
- Listing cards that reuse `SessionActionsMenu`
- Response fields `markdownUrl` / `viewerUrl` from session create still omit token (API cleanup optional; UI must not rely on them for public share)

**Do not reimplement**

- Share token schema, publish ownership checks, public gate, audit tables (already DJA-117)

**Status detection without new endpoint**

- Prefer `GET /api/shares` filtered by `resourceType` + `resourceId`, **or** treat publish as idempotent and refresh UI from response. Avoid adding new API unless strictly necessary.

---

## Constraints (`AGENTS.md` + memory `_rules/gates.md`)

1. Gate: **`bun run typecheck`** (not bare `bunx tsc --noEmit` — server is outside root `include`).
2. Tests: **`bun run test`** — green tests ≠ typecheck.
3. **Do not** start a second long-lived helper; any `127.0.0.1:17373–17382` answering `GET /api/health` with `service: "pinar"` is enough.
4. After local source changes that affect tray/helper: rebuild/reinstall per AGENTS; for **cloud Worker UI** this ticket, focus on server app + typecheck/tests.
5. **Never** mention Cursor in commit messages, PR titles, or PR bodies; strip `Co-authored-by: Cursor` if a hook adds it.
6. PR test plan = **evidence**: check boxes you actually ran; don’t leave unchecked items that tests already cover.
7. Linear (Fábrica): update issue in the same turn the role finishes — In Progress while implementing; In Review + evidence comment when ready for review; Done only after merge (+ `env:staging` only after Worker staging deploy of this change, if applicable).
8. Cloudflare: env-specific Vite build; do **not** deploy production from this brief unless asked. Prefer validating against staging once migration `0015` is applied.
9. Preset UI: shadcn Nova/Base UI (`b5J6exi2i`); reuse existing `Button` / `DropdownMenu` patterns in WebViewer.
10. No credentials in commits, PR, Linear, or memory.

---

## Out of scope

- Re-doing DJA-117 API / migration design
- Real-time multi-user collaboration
- Turning share links into account auth
- CDN purge-on-revoke (note 60s cache only)
- Chrome Web Store / desktop release cut
- Cursor Cloud Agents
- SSH from the orchestrator box into Hetzner as part of *this* plan step (dispatch is a separate human/orchestrator action)

---

## PR requirements

- Branch from latest `main` (includes #35).
- Title e.g. `feat(DJA-166): UI publish/revoke cloud share link`
- Body must cite **DJA-166** and reference DJA-117 / #35 as prerequisite.
- No Cursor attribution.
- Test plan with checked evidence.
- Keep diff focused on UI + i18n (+ minimal client helpers); no drive-by refactors.

---

## Test plan

### Automated

- [ ] `bun run typecheck`
- [ ] `bun run test` (or targeted server tests if full suite has known unrelated fails — document which)

### Manual / staging (migration `0015` must be applied)

- [ ] As owner: open a cloud session → **Publish** → copy URL → open in private/incognito → Markdown (or viewer) loads with token
- [ ] Same URL **without** `?token=` → 404
- [ ] **Revoke** → old token URL → 404 (allow ≤60s cache)
- [ ] Republish → get a working token again (may be new or same per API idempotent active-token rules after revoke creates fresh)
- [ ] Non-owner session / signed-out → no publish/revoke controls
- [ ] Authenticated owner still opens `/v/{id}` workspace viewer via `/api/sessions/:id` without needing a share token
- [ ] Regression: copy prompt / review-on-page / move/delete menus still work

---

## Report back (implementer)

For each item: **done / partial / skipped + reason**. Include PR URL, branch, typecheck/test evidence, and any leftover gaps (project/collection UI, AggregateViewer token wiring, expiry UI).

---

## Suggested dispatch (Herdr — orch + impl)

Host: Hetzner `dev` · user `agent` · workdir `/srv/agents/jobs/DJA-166` · Herdr workspace `factory`

1. Clone `djalmajr/pinar` on `main`, branch `djalmajr/dja-166-ui-publicar-e-revogar-link-de-compartilhamento-cloud`, write this file as `BRIEF.md`.
2. Start **orch-dja166** — Herdr kind `codex`, model **astra**, effort **low**.
3. Start **impl-dja166** — Herdr kind `cursor`, model **cursor-grok-4.6-xhigh** (never `-fast`).
4. Prompt BRIEF **only to orch**. Orch plans, drives impl via `herdr agent prompt|wait|read`, verifies, opens PR with `factory-load-env gh` citing DJA-166.
5. **No** Cursor Cloud Agents. **No** prompting impl directly with the full brief as a one-shot.

