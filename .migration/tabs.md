# tabs

2026-08-14, golden pair copied from Tenancit Base Nova, migrated.

## Changed

- `packages/ui/src/components/tabs.tsx`: replaced Radix Tabs with Base UI and the preset's default, segmented, and line variants.
- Leftover scan is clean: no `radix-ui` or `@radix-ui` import remains.

## Left alone

- Theme choice state and icons remain unchanged.

## Behavior changes

- Tabs now use Base UI activation and `data-active` styling.

## Verify by hand

- Move among theme tabs with pointer and arrow keys; confirm one active tab and correct theme application.
