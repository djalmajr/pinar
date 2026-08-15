# switch

2026-08-14, golden pair from the official Base Nova registry, migrated.

## Changed

- `packages/ui/src/components/switch.tsx`: replaced Radix Root/Thumb with Base UI and Nova size/state classes.
- Leftover scan is clean: no `radix-ui` or `@radix-ui` import remains.

## Left alone

- Settings state ownership remains in the options screen.

## Behavior changes

- Checked and disabled state attributes now follow Base UI conventions.

## Verify by hand

- Toggle both preferences with pointer and keyboard; confirm visual and accessible checked state.
