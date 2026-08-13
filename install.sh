#!/bin/sh
# One-shot install: download Pinar, put the launcher in ~/.pinar/bin, register hooks.
set -eu

repo="${PINAR_REPO:-djalmajr/pinar}"
ref="${PINAR_REF:-main}"

if command -v node >/dev/null 2>&1; then
  runtime=node
elif command -v bun >/dev/null 2>&1; then
  runtime=bun
else
  echo "pinar: need node or bun on PATH" >&2
  exit 1
fi

if command -v curl >/dev/null 2>&1; then
  fetch() { curl -fsSL "$1"; }
elif command -v wget >/dev/null 2>&1; then
  fetch() { wget -qO- "$1"; }
else
  echo "pinar: need curl or wget" >&2
  exit 1
fi

if ! command -v tar >/dev/null 2>&1; then
  echo "pinar: need tar" >&2
  exit 1
fi

case "$ref" in
  main|master) url="https://github.com/${repo}/archive/refs/heads/${ref}.tar.gz" ;;
  *) url="https://github.com/${repo}/archive/refs/tags/${ref}.tar.gz" ;;
esac

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
echo "pinar: downloading ${repo}@${ref}" >&2
fetch "$url" | tar -xz -C "$tmp"
src=$(find "$tmp" -mindepth 1 -maxdepth 1 -type d | head -n 1)
if [ ! -f "$src/src/cli.mjs" ]; then
  echo "pinar: unexpected archive layout" >&2
  exit 1
fi

"$runtime" "$src/src/cli.mjs" install
prefix="${PINAR_HOME:-$HOME/.pinar}"
export PATH="${prefix}/bin:${PATH}"
echo "pinar: launcher ${prefix}/bin/pinar" >&2
echo "pinar: open a new terminal so PATH picks up ~/.pinar/bin" >&2
echo "pinar: Chrome → Load unpacked → ${prefix}/extension" >&2
