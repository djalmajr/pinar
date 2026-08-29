#!/bin/sh
# Start the local Pinar server (one instance). Hook hosts may send JSON on stdin;
# drain it so the pipe does not break. Stdout stays empty unless PINAR_HOOK_JSON=1
# (Antigravity PreInvocation expects a JSON object).
set -e
if [ ! -t 0 ]; then
  cat >/dev/null
fi
status=0
if [ "$(uname -s)" = Darwin ]; then
  pinar_dir="${HOME}/.pinar"
  pid_file="${pinar_dir}/tray.pid"
  launch_lock="${pinar_dir}/tray-launch.lock"
  /bin/mkdir -p "$pinar_dir"
  pid=""
  if [ -r "$pid_file" ]; then
    pid=$(/bin/cat "$pid_file" 2>/dev/null || true)
  fi
  if [ -z "$pid" ] || ! /bin/kill -0 "$pid" 2>/dev/null; then
    if /usr/bin/shlock -p "$$" -f "$launch_lock"; then
      trap '/bin/rm -f "$launch_lock"' 0 1 2 15
      pid=""
      if [ -r "$pid_file" ]; then
        pid=$(/bin/cat "$pid_file" 2>/dev/null || true)
      fi
      if [ -z "$pid" ] || ! /bin/kill -0 "$pid" 2>/dev/null; then
        app="${HOME}/Applications/Pinar.app"
        if [ -d "$app" ]; then
          /usr/bin/open -ga "$app" || status=$?
        else
          /usr/bin/open -ga Pinar || status=$?
        fi
        attempts=0
        while [ "$status" -eq 0 ] && [ "$attempts" -lt 100 ]; do
          if [ -r "$pid_file" ]; then
            pid=$(/bin/cat "$pid_file" 2>/dev/null || true)
            if [ -n "$pid" ] && /bin/kill -0 "$pid" 2>/dev/null; then
              break
            fi
          fi
          attempts=$((attempts + 1))
          /bin/sleep 0.05
        done
      fi
    fi
  fi
else
  root=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
  "$root/bin/pinar" || status=$?
fi
if [ "${PINAR_HOOK_JSON:-}" = "1" ]; then
  printf '%s\n' '{}'
  exit 0
fi
exit "$status"
