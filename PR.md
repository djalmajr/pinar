# Explicit and Revocable Cloud Sharing (DJA-117)

Implements explicit, revocable share tokens for cloud content with fail-closed migration.

## Changes

### Database Schema
- **`share_tokens` table**: Stores active/revoked share tokens with expiry support
- **`share_token_events` table**: Audit trail for publish/revoke actions (actor, timestamp)
- **Migration `0015_share_tokens.sql`**: Creates tables, indexes, and unique constraint ensuring one active token per resource

### API Endpoints
- **`POST /api/shares/publish`**: Create/retrieve share token for owned resource (session, project, collection, batch)
- **`POST /api/shares/revoke`**: Revoke active share token (owner only)
- **`GET /api/shares`**: List all share tokens for authenticated user

### Access Control
- All public routes (`/v/`, `/p/`, `/c/`, `/shots/`) now require `?token=<share-token>` query parameter
- Anonymous access without valid token returns uniform 404 (no metadata leakage)
- Share token validation checks status=active and expiry date
- Memory-only mode (no DB) denies all anonymous access (fail-closed)

### Ownership & Security
- Publish uses authenticated DB lookup for ownership verification (separate from public access path)
- Revoke enforces account isolation (user cannot revoke another user's tokens)
- Share tokens use `sh_` prefix with `nanoid` for unpredictability

## Migration Policy

**Fail-closed**: Existing resources without share tokens are **NOT automatically published**. Users must explicitly call `/api/shares/publish` to create a share token for public access. Previously accessible URLs (by internal ID) will return 404 after migration.

## Testing

- **Unit tests**: Memory-only mode correctly denies anonymous access
- **Full end-to-end testing requires staging/production with D1**:
  - Publish session/project/collection/batch and verify token access
  - Revoke token and verify access denial
  - Expired tokens deny access
  - Account isolation (user B cannot revoke user A's token)
  - Screenshot access requires session token
  - Republishing returns existing active token
  - List API returns only owned tokens

### Test Plan Checklist
- [ ] Publish a session in staging, verify `/v/{id}.md?token={token}` works
- [ ] Verify `/v/{id}.md` (no token) returns 404
- [ ] Revoke the token, verify `/v/{id}.md?token={old-token}` now returns 404
- [ ] Publish with expiry, verify access works before expiry and fails after
- [ ] User B attempts to revoke user A's token, verify 404 response
- [ ] Publish same resource twice, verify same token returned
- [ ] Verify `/api/shares` lists only owned tokens
- [ ] Repeat for project (`/p/`), collection (`/c/`), batch routes

## Audit Trail

Following existing patterns (`pin_review_events`, `stripe_events`), the `share_token_events` table records:
- **Action**: `created` or `revoked`
- **Actor**: User ID who performed the action
- **Timestamp**: When the action occurred
- **Share Token ID**: Links to the `share_tokens` table

## UI for Publish/Revoke

**Deferred to follow-up**: A minimal owner-facing control in WebViewer/Settings is recommended. For now, this PR delivers API-complete functionality. Power users and admins can use the API directly or via developer tools.

## Notes

- Cache/CDN: Public routes set `Cache-Control: public, max-age=60`. After revoke, stale cached responses may serve for up to 60 seconds. Consider CDN purge on revoke for instant invalidation (follow-up work).
- Closed tags only deploy production after successful staging validation.
