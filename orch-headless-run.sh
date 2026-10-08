#!/bin/bash
set -euo pipefail
cd /srv/agents/jobs/DJA-166
export PATH="$HOME/.local/bin:/usr/local/bin:$PATH"
LOG=/srv/agents/jobs/DJA-166/orch-headless.log
PIDF=/srv/agents/jobs/DJA-166/orch-headless.pid
: > "$LOG"
echo "[$(date -Is)] starting headless orch claude -p fable" | tee -a "$LOG"
# ensure herdr sees socket
export HERDR_ENV=1
nohup claude -p --model fable --effort low --dangerously-skip-permissions \
  "$(cat /srv/agents/jobs/DJA-166/ORCH-HEADLESS-PROMPT.md)" \
  >>"$LOG" 2>&1 &
echo $! | tee "$PIDF"
echo "[$(date -Is)] pid=$(cat "$PIDF")" | tee -a "$LOG"
