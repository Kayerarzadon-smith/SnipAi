#!/bin/bash
# SnipAi -- double-click this file to stop the background server.
cd "$(dirname "$0")" || exit 1

BOLD=$'\033[1m'; OK=$'\033[32m'; WARN=$'\033[33m'; OFF=$'\033[0m'
good() { printf "  %s%s%s\n" "$OK" "$1" "$OFF"; }
warn() { printf "  %s%s%s\n" "$WARN" "$1" "$OFF"; }

printf "%sSnipAi -- stopping%s\n" "$BOLD" "$OFF"

PIDFILE=".snipai.pid"
STOPPED=0

if [ -f "$PIDFILE" ]; then
  PID=$(cat "$PIDFILE")
  if kill "$PID" 2>/dev/null; then
    good "stopped (pid $PID)"
    STOPPED=1
  fi
  rm -f "$PIDFILE"
fi

# Always run this too, not just as a fallback: the pidfile holds npm's PID,
# and killing npm does NOT reliably take down the `next start` child that
# actually holds the port. Restricted to the LISTENER on the port -- never a
# client connection that merely touches that port number (a browser tab
# talking to SnipAi has its own ephemeral socket here and must survive).
PORT_PIDS=$(lsof -ti:4737 -sTCP:LISTEN 2>/dev/null)
if [ -n "$PORT_PIDS" ]; then
  echo "$PORT_PIDS" | xargs kill 2>/dev/null
  sleep 1
  STILL=$(lsof -ti:4737 -sTCP:LISTEN 2>/dev/null)
  if [ -n "$STILL" ]; then
    echo "$STILL" | xargs kill -9 2>/dev/null
  fi
  good "stopped listener(s) on port 4737: $PORT_PIDS"
  STOPPED=1
fi

if [ "$STOPPED" -eq 0 ]; then
  warn "SnipAi doesn't look like it was running"
fi

printf "\n%sDone. You can close this window.%s\n" "$BOLD" "$OFF"
