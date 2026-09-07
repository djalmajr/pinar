---
description: Rebuild and reinstall local artifacts after source changes
alwaysApply: true
---

# Rebuild Local Artifacts

After modifying source files, rebuild and reinstall the affected artifacts before handing work back:

## Tray app (macOS/Windows)

When `apps/tray/` or `apps/cli/` files change:

```sh
bun run build:tray
bun apps/cli/src/cli.mjs install
```

Then verify the local server responds at `/api/health`.

## Chrome extension

When `apps/ext/` files change:

```sh
bun run build:ext
```

Then explicitly reload the unpacked extension in Chrome before claiming the new behavior is active.

## Why

Local Pinar artifacts must reflect the source changes for accurate testing and handoff.
