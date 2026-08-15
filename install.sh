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
echo "🎉 Visual Annotations ready for AI Agents!" >&2
