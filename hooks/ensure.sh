#!/bin/sh
# Start the screenshot helper (one instance). Hook hosts may send JSON on stdin;
# drain it so the pipe does not break. Stdout stays empty unless PINAR_HOOK_JSON=1
# (Antigravity PreInvocation expects a JSON object).
set -e
if [ ! -t 0 ]; then
  cat >/dev/null
fi
root=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
status=0
"$root/bin/pinar" || status=$?
if [ "${PINAR_HOOK_JSON:-}" = "1" ]; then
  printf '%s\n' '{}'
  exit 0
fi
exit "$status"
