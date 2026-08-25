#!/bin/sh
# Pinar installer. macOS opens the desktop DMG. Linux still installs the helper binary.
set -eu

prefix="${PINAR_HOME:-$HOME/.pinar}"
bin_dir="${prefix}/bin"
base_url="${PINAR_BASE_URL:-https://pinar.dev}"
repo="${PINAR_REPO:-djalmajr/pinar}"
ref="${PINAR_REF:-latest}"

os="$(uname -s)"
arch="$(uname -m)"

if command -v curl >/dev/null 2>&1; then
  fetch_file() { curl -fsSL "$1" -o "$2"; }
elif command -v wget >/dev/null 2>&1; then
  fetch_file() { wget -qO "$2" "$1"; }
else
  echo "pinar: need curl or wget to download installer" >&2
  exit 1
fi

github_download() {
  if [ "$ref" = "latest" ]; then
    echo "https://github.com/${repo}/releases/latest/download/$1"
  else
    echo "https://github.com/${repo}/releases/download/${ref}/$1"
  fi
}

if [ "$os" = Darwin ]; then
  case "$arch" in
    arm64|aarch64) dmg_name="macos-arm64-Pinar.dmg" ;;
    x86_64) dmg_name="macos-x64-Pinar.dmg" ;;
    *) echo "pinar: unsupported architecture $arch on macOS" >&2; exit 1 ;;
  esac
  dmg_path="${TMPDIR:-/tmp}/${dmg_name}"
  echo "⚡ Downloading Pinar.app (${dmg_name})..." >&2
  if ! fetch_file "$(github_download "$dmg_name")" "$dmg_path"; then
    echo "pinar: could not download ${dmg_name}. Open https://github.com/${repo}/releases/latest" >&2
    exit 1
  fi
  open "$dmg_path"
  echo "✅ Open the disk image and drag Pinar.app to ~/Applications." >&2
  echo "The menu-bar app starts the local server. Shots stay in ${prefix}/shots." >&2
  exit 0
fi

case "$os" in
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

mkdir -p "$bin_dir" "${prefix}/shots"

echo "⚡ Downloading Pinar standalone binary (${target})..." >&2
target_url="${base_url}/bin/${target}"

if ! fetch_file "$target_url" "${bin_dir}/pinar" 2>/dev/null; then
  github_url="$(github_download "$target")"
  echo "ℹ️ Fetching from ${github_url}..." >&2
  fetch_file "$github_url" "${bin_dir}/pinar"
fi

chmod +x "${bin_dir}/pinar"

"${bin_dir}/pinar" install-hooks

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
