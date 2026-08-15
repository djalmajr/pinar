# dialog

2026-08-14, golden pair copied from Tenancit Base Nova with unplugin-icons adaptation, migrated.

## Changed

- `packages/ui/src/components/dialog.tsx`: replaced Radix with Base UI Popup, Backdrop, Viewport, and render composition.
- Close icon continues through `unplugin-icons`.
- Leftover scan is clean: no `radix-ui` or `@radix-ui` import remains.

## Left alone

- No current application consumer required a call-site migration.

## Behavior changes

- Optional outside scrolling and close-button rendering now follow Base UI.

## Verify by hand

- Open a dialog, press Escape, click its backdrop, and confirm focus returns to the trigger.
