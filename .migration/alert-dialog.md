# alert-dialog

2026-08-14, golden pair from the official Base Nova registry, migrated.

## Changed

- `packages/ui/src/components/alert-dialog.tsx`: replaced Radix actions with Base UI Popup, Backdrop, and Close composition.
- `apps/extension/src/options/OptionsApp.tsx`: existing controlled regeneration flow remains compatible.
- Leftover scan is clean: no `radix-ui` or `@radix-ui` import remains.

## Left alone

- Regeneration semantics and remote history transfer are unchanged.

## Behavior changes

- Cancel is a Base UI Close; the action remains controlled by the application and closes after success.

## Verify by hand

- Open regeneration confirmation, cancel it, reopen, and confirm focus handling and action progress.
