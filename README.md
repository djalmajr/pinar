# Pinar

Pin comments on elements or areas in Chrome and **copy** the bundle (comment, DOM path, coordinates, screenshot) to the clipboard. Paste it anywhere — Grok, Claude, Codex, Slack, notes.

```
Chrome (Pinar + pins + ⌘↵)
        │  clipboard (text/plain + text/html with images)
        ▼
Any composer / editor
```

## Install

One command downloads the helper to `~/.pinar`, puts the launcher in `~/.pinar/bin`, and registers agent hooks. Requires **Node or Bun**.

**macOS / Linux**

```sh
curl -fsSL https://raw.githubusercontent.com/djalmajr/pinar/main/install.sh | sh
```

**Windows (PowerShell)**

```powershell
irm https://raw.githubusercontent.com/djalmajr/pinar/main/install.ps1 | iex
```

The installer:

1. Syncs `~/.pinar` (Windows: `%USERPROFILE%\.pinar`) with the current runtime: recreates `bin/`, `lib/`, `hooks/`, and `extension/`, and deletes leftover files (`src/`, `AGENTS.md`, tests, old folders)
2. Leaves the launcher at `~/.pinar/bin/pinar` (Windows: `pinar.cmd`)
3. Adds `~/.pinar/bin` to PATH
4. Merges global hooks (does not delete hooks you already have)
5. Keeps `shots/`

Open a new terminal after installing. Then in Chrome: `chrome://extensions` → Developer mode → **Load unpacked** → `~/.pinar/extension` (Windows: `%USERPROFILE%\.pinar\extension`).

Pin a specific ref: `PINAR_REF=v0.1.0` (Unix) or `$env:PINAR_REF = "v0.1.0"` (PowerShell) before the one-liner.

From a clone:

```sh
./bin/pinar install          # macOS / Linux
.\bin\pinar.cmd install      # Windows
```

## Usage

1. Load the extension (`extension/` from the clone, or `~/.pinar/extension` after install)
2. Open the page
3. Click the extension icon
4. Click an element or drag an area, write the comment, press **Enter** to add
5. **⌘↵ / Ctrl+Enter** to copy (the toolbar shows *Copied* and closes)

- **Enter** adds the pin
- **Shift+Enter** inserts a newline
- **Esc** in the composer closes only the draft; with no draft, it clears all pins and hides the toolbar
- The extension icon only shows or hides the overlay — it does not delete pins

PNG crops go to `~/.pinar/shots` (Windows: `%USERPROFILE%\.pinar\shots`). The extension cannot write that folder by itself — the local helper starts at session start. It tries `127.0.0.1:17373` and, if that port is taken by another process, binds the next free port through `17382`. The extension looks for `GET /health` with `{"service":"pinar"}` in that range. If `17373` is already Pinar, the command exits immediately and does not start a second instance. `PINAR_PORT` pins the helper to a single port.

```sh
pinar                 # if ~/.pinar/bin is on PATH
# or, from a clone:
node src/cli.mjs
bun src/cli.mjs
./hooks/ensure.sh
.\hooks\ensure.cmd    # Windows
```

Without the helper, the crop falls back to `Downloads/pinar/`.

## Session hooks

Each agent has its own format. **`npx skills add` / skills.sh does not install hooks** — it only copies `SKILL.md`.

The one-liner above is the right path for any machine. The files in this repo also apply when a session opens **in this project**:

| Agent | File | Event |
| --- | --- | --- |
| Grok | `.grok/hooks/session-start.json` | `SessionStart` |
| Claude | `.claude/settings.json` | `SessionStart` |
| Codex | `.codex/hooks.json` | `SessionStart` (`commandWindows` on Windows) |
| Antigravity | `.agents/hooks.json` | `PreInvocation` (no SessionStart) |
| Pi | `.pi/extensions/pinar.ts` | `session_start` |
| OMP | `.omp/extensions/pinar.ts` | `session_start` |

Extra YAML in `.pi/hook/hooks.yaml` and `.omp/hook/hooks.yaml` only runs if the `pi-yaml-hooks` package is installed.

A local project needs trust the first time: Grok `/hooks-trust`, Codex `/hooks`. Antigravity may prefer the workspace `hooks.json` over the global one — if global hooks disappear in this repo, delete `.agents/hooks.json` and use the global install only.

Re-register hooks without downloading again:

```sh
pinar install-hooks
# or: ./bin/pinar install-hooks
# Windows: .\bin\pinar.cmd install-hooks
```

`AGENTS.md` describes how an agent should treat the pasted text. If the copy has `Screenshot: /path/to/file.png`, open that file — it is a single crop with every pin.

```sh
npm test
```
