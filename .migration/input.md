# input

2026-08-14, golden pair copied from Tenancit Base Nova, migrated.

## Changed

- `packages/ui/src/components/input.tsx`: moved to the Base UI Input primitive with Nova focus and invalid states.
- Leftover scan is clean: no `radix-ui` or `@radix-ui` import remains.

## Left alone

- Search and license input layouts remain consumer concerns.

## Behavior changes

- Disabled inputs no longer receive pointer events, matching the preset.

## Verify by hand

- Focus, type in, disable, and mark an input invalid; confirm ring and text remain legible.
