# select

2026-08-14, golden pair copied from Tenancit Base Nova with unplugin-icons adaptation, migrated.

## Changed

- `packages/ui/src/components/select.tsx`: replaced Radix anatomy with Base UI Portal, Positioner, Popup, List, and indicators.
- `apps/extension/src/options/OptionsApp.tsx`: supplied the Base UI `items` model and wrapped options in `SelectGroup`.
- Chevron and check icons continue through `unplugin-icons`.
- Leftover scan is clean: no `radix-ui` or `@radix-ui` import remains.

## Left alone

- The supported language list and translation behavior are unchanged.

## Behavior changes

- Select positioning and keyboard behavior now come from Base UI.

## Verify by hand

- Open the language select, use arrows and typeahead, choose a language, and confirm focus returns to the trigger.
