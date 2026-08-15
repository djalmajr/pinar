# project

2026-08-14, whole-project Base Nova preset migration, complete.

## Changed

- Added root `components.json` for preset `b5J6exi2i`.
- `packages/ui/src/styles.css` now uses the mist/sky tokens, Inter font, compact radius, chart tokens, and menu defaults from that preset.
- Added `@base-ui/react`, Inter, shadcn CSS, and `tw-animate-css`; removed all direct Radix dependencies.
- Migrated all ten shared UI wrappers and updated Base UI consumer props.
- Leftover scan is clean: zero wrappers remain on Radix.

## Left alone

- Pinar-specific `pro`, `sponsor`, `success`, and `warning` variants remain available.
- Icons remain supplied by `unplugin-icons` as required by the project.

## Behavior changes

- Overlay, tabs, select, switch, and button interaction semantics now come from Base UI.

## Verify by hand

- Exercise options language, theme, switches, and regeneration dialog; then inspect history and pricing cards at desktop and narrow widths.
