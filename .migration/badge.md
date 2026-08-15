# badge

2026-08-14, golden pair from Tenancit Base Nova, migrated.

## Changed

- `packages/ui/src/components/badge.tsx`: adopted the Base Nova `useRender` shape and official variants.
- Preserved Pinar's `pro`, `success`, and `warning` variants.
- Leftover scan is clean: no `radix-ui` or `@radix-ui` import remains.

## Left alone

- Product status variants were retained because they are used by pricing and retention states.

## Behavior changes


## Verify by hand

- Check outline, plan, success, and warning badges in light and dark themes.
