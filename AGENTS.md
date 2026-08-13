# Pinar

On session start, hooks run `hooks/ensure.sh` or `hooks/ensure.cmd` (same as `pinar` / `node src/cli.mjs`). If the helper is not up:

```sh
pinar
# or: node src/cli.mjs || bun src/cli.mjs
```

That command exits immediately if `127.0.0.1:17373` is already healthy. Do not start a second long-lived process. Prefer `node`; use `bun` only if `node` is missing. Screenshots land in `~/.pinar/screenshots` (Windows: `%USERPROFILE%\.pinar\screenshots`).

Machine-wide install (downloads helper to `~/.pinar`, launcher at `~/.pinar/bin`, then hooks):

```sh
curl -fsSL https://raw.githubusercontent.com/djalmajr/pinar/main/install.sh | sh
```

```powershell
irm https://raw.githubusercontent.com/djalmajr/pinar/main/install.ps1 | iex
```

From a checkout: `./bin/pinar install` or `.\bin\pinar.cmd install`. skills.sh does not install these hooks.

Visual page annotations are copied to the clipboard by the Chrome extension (⌘/Ctrl+Enter).

When the user pastes annotations, or says they copied/annotated a page:

1. Use the pasted markdown/HTML as the source of truth (comment, DOM path, selector, pin coordinates, screenshots).
2. If a pin lists `Screenshot: /absolute/path.png`, open that file with an image tool.
3. If they did not paste, ask them to press ⌘/Ctrl+Enter in Pinar and paste here.
4. Change only what the pins describe.

The extension does not inject a prompt into the composer. The user pastes.
