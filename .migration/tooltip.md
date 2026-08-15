# tooltip

2026-08-14, golden pair copied from Tenancit Base Nova, migrated.

## Changed

- `packages/ui/src/components/tooltip.tsx`: replaced Radix Portal/Content with Base UI Positioner, Popup, and Arrow.
- Leftover scan is clean: no `radix-ui` or `@radix-ui` import remains.

## Left alone

- No current application consumer required a call-site migration.

## Behavior changes

- Provider delay defaults to zero, matching Tenancit.

## Verify by hand

- Hover and keyboard-focus a tooltip trigger; confirm positioning, arrow, and dismissal.
