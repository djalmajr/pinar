# button

2026-08-14, Base Nova preset `b5J6exi2i`, migrated with Pinar variants preserved.

## Changed

- `packages/ui/src/components/button.tsx`: replaced the Radix Slot wrapper with the Base UI Button primitive and Nova sizing/variants.
- Preserved `pro` and `sponsor`; normalized icon sizes to `icon-xs`, `icon-sm`, and `icon-lg`.
- Leftover scan is clean: no `radix-ui` or `@radix-ui` import remains.

## Left alone

- Product-specific support colors remain as explicit variants.

## Behavior changes

- Buttons now use Base UI focus, disabled, and active-state behavior.

## Verify by hand

- Tab through primary, outline, icon, sponsor, and destructive buttons; confirm focus rings and click behavior.
