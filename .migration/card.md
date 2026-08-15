# card

2026-08-14, golden pair copied from Tenancit Base Nova, migrated.

## Changed

- `packages/ui/src/components/card.tsx`: adopted Nova card spacing, slots, footer treatment, and size support.
- Added `CardAction` to the public component set.
- Leftover scan is clean: no `radix-ui` or `@radix-ui` import remains.

## Left alone

- Consumer layout classes remain where cards implement product-specific grids.

## Behavior changes


## Verify by hand

- Check history and pricing cards for spacing, footer alignment, clipping, and responsive width.
