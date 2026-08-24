#!/bin/sh
# Pinar One-Shot Native Installer
# Downloads pre-compiled standalone binary to ~/.pinar/bin/pinar and registers AI hooks.
set -eu

prefix="${PINAR_HOME:-$HOME/.pinar}"
bin_dir="${prefix}/bin"
base_url="${PINAR_BASE_URL:-https://pinar.dev}"

# Detect OS and Architecture
os="$(uname -s)"
arch="$(uname -m)"

case "$os" in
  Darwin)
    case "$arch" in
      arm64|aarch64) target="pinar-darwin-arm64" ;;
      x86_64) target="pinar-darwin-x64" ;;
      *) echo "pinar: unsupported architecture $arch on macOS" >&2; exit 1 ;;
    esac
    ;;
  Linux)
    case "$arch" in
      x86_64) target="pinar-linux-x64" ;;
      arm64|aarch64) target="pinar-linux-arm64" ;;
      *) echo "pinar: unsupported architecture $arch on Linux" >&2; exit 1 ;;
    esac
    ;;
  *)
    echo "pinar: unsupported OS $os. Use install.ps1 for Windows." >&2
    exit 1
    ;;
esac

# Check downloader
if command -v curl >/dev/null 2>&1; then
  fetch_file() { curl -fsSL "$1" -o "$2"; }
elif command -v wget >/dev/null 2>&1; then
  fetch_file() { wget -qO "$2" "$1"; }
else
  echo "pinar: need curl or wget to download installer" >&2
  exit 1
fi

mkdir -p "$bin_dir" "${prefix}/shots"

echo "⚡ Downloading Pinar standalone binary (${target})..." >&2
target_url="${base_url}/bin/${target}"

# Fallback: if server /bin/ route not yet populated, use fallback or build output
if ! fetch_file "$target_url" "${bin_dir}/pinar" 2>/dev/null; then
  # Fallback to github releases if configured
  repo="${PINAR_REPO:-djalmajr/pinar}"
  ref="${PINAR_REF:-v0.1.1}"
  github_url="https://github.com/${repo}/releases/download/${ref}/${target}"
  echo "ℹ️ Fetching from ${github_url}..." >&2
  fetch_file "$github_url" "${bin_dir}/pinar"
fi

chmod +x "${bin_dir}/pinar"

# Register IDE & AI Agent hooks (Cursor, Claude Code, Antigravity, Windsurf)
"${bin_dir}/pinar" install-hooks

# Add to PATH in shell profile
profile=""
if [ -n "${ZSH_VERSION:-}" ] || [ -f "$HOME/.zshrc" ]; then
  profile="$HOME/.zshrc"
elif [ -f "$HOME/.bashrc" ]; then
  profile="$HOME/.bashrc"
elif [ -f "$HOME/.profile" ]; then
  profile="$HOME/.profile"
fi

if [ -n "$profile" ]; then
  line="export PATH=\"${bin_dir}:\$PATH\""
  if ! grep -q "pinar/bin" "$profile" 2>/dev/null; then
    printf "\n# Pinar AI feedback helper\n%s\n" "$line" >> "$profile"
  fi
fi

export PATH="${bin_dir}:${PATH}"
echo "✅ Pinar standalone binary installed at ${bin_dir}/pinar" >&2

if [ "$(uname -s)" = "Darwin" ]; then
  desktop_dir="${HOME}/Applications"
  desktop_app="${desktop_dir}/Pinar.app"
  desktop_zip="${TMPDIR:-/tmp}/Pinar-macos.zip"
  arch_name="$(uname -m)"
  case "$arch_name" in
    arm64|aarch64) desktop_asset="Pinar-macos-arm64.zip" ;;
    *) desktop_asset="Pinar-macos-x64.zip" ;;
  esac
  mkdir -p "$desktop_dir"
  if fetch_file "${base_url}/bin/${desktop_asset}" "$desktop_zip" 2>/dev/null \
    || fetch_file "https://github.com/${PINAR_REPO:-djalmajr/pinar}/releases/download/${PINAR_REF:-v0.1.1}/${desktop_asset}" "$desktop_zip" 2>/dev/null; then
    rm -rf "$desktop_app"
    unzip -qo "$desktop_zip" -d "$desktop_dir"
    rm -f "$desktop_zip"
    if [ -d "$desktop_app" ]; then
      open -ga "$desktop_app" || true
      echo "✅ Pinar.app installed at ${desktop_app}" >&2
    fi
  else
    echo "ℹ️ Desktop app not published yet. From a checkout: bun run build:tray && bun apps/cli/src/cli.mjs install" >&2
  fi
fi

echo "🎉 Visual Annotations ready for AI Agents!" >&2
