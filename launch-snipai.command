#!/bin/bash
# SnipAi -- double-click this file to start the app and open it in your browser.
# Runs in the background afterward, so it's safe to close this window once it says so.
cd "$(dirname "$0")" || exit 1

BOLD=$'\033[1m'; DIM=$'\033[2m'; OK=$'\033[32m'; WARN=$'\033[33m'; ERR=$'\033[31m'; OFF=$'\033[0m'
step() { printf "\n%s==> %s%s\n" "$BOLD" "$1" "$OFF"; }
good() { printf "  %s%s%s\n" "$OK" "$1" "$OFF"; }
warn() { printf "  %s%s%s\n" "$WARN" "$1" "$OFF"; }
bad()  { printf "  %s%s%s\n" "$ERR" "$1" "$OFF"; exit 1; }

PORT=4737
URL="http://localhost:$PORT"
PIDFILE=".snipai.pid"

# Who is on the port, asked properly. See scripts/port-occupant.sh -- the same
# question native/LaunchDecision.swift asks, for the same reason (N8).
. "./scripts/port-occupant.sh"

# There is deliberately no is_snipai() here any more. It asked
# `/api/projects | grep '"projects"'`, and every use of it -- "is it already
# running", "has it come up yet" -- has been replaced by asking the server who
# it is, because that answer is the one that can be wrong in a way that costs
# footage.

# Focuses an existing SnipAi tab in Chrome instead of piling up a new one on
# every launch. Falls back to plain `open` (spawns a new tab) if Chrome isn't
# the browser in play or isn't running yet.
focus_or_open() {
  local url="$1"
  local found
  found=$(osascript 2>/dev/null <<APPLESCRIPT
tell application "Google Chrome"
  if it is running then
    repeat with w in windows
      set tabIndex to 0
      repeat with t in tabs of w
        set tabIndex to tabIndex + 1
        if URL of t contains "localhost:$PORT" then
          set active tab index of w to tabIndex
          set index of w to 1
          activate
          return "found"
        end if
      end repeat
    end repeat
  end if
  return "notfound"
end tell
APPLESCRIPT
)
  [ "$found" = "found" ] && return 0
  open "$url"
}

printf "%sSnipAi%s\n" "$BOLD" "$OFF"

# ---------------------------------------------------------------- who is on the port?
# This used to check for SnipAi's own JSON on /api/projects, which is better
# than checking that the port is open and still not enough: EVERY SnipAi
# server answers "projects", including one serving a different library. So
# this said "Already running" and opened the browser onto somebody else's
# footage (N8). The server states its library now; ask it.
WANT_ROOT=$(snipai_expected_data_root "$PWD")
snipai_probe_port "$PORT"

case "$SNIPAI_OCCUPANT" in
  identified)
    if snipai_same_path "$SNIPAI_OCCUPANT_ROOT" "$WANT_ROOT"; then
      step "Already running"
      good "SnipAi is already up at $URL (pid $SNIPAI_OCCUPANT_PID)"
      good "serving $SNIPAI_OCCUPANT_ROOT -- opening it"
      focus_or_open "$URL/dashboard"
      printf "\n%sDone. You can close this window.%s\n" "$BOLD" "$OFF"
      exit 0
    fi
    step "Refusing to open"
    warn "Port $PORT is already serving a DIFFERENT SnipAi library."
    warn "  on the port: $SNIPAI_OCCUPANT_ROOT  (pid $SNIPAI_OCCUPANT_PID)"
    warn "  asked for:   $WANT_ROOT"
    bad  "Nothing has been started and nothing has been stopped. Opening it would show you the wrong footage -- quit pid $SNIPAI_OCCUPANT_PID, or set SNIPAI_DATA to match, and run this again."
    ;;
  unidentified)
    step "Refusing to open"
    warn "Something is already using port $PORT and it will not say what it is."
    for p in $SNIPAI_OCCUPANT_PIDS; do
      warn "  pid $p: $(ps -ww -o command= -p "$p" 2>/dev/null | cut -c1-100)"
    done
    bad  "Nothing has been started and nothing has been stopped. Quit whatever is on port $PORT and run this again."
    ;;
esac

# ---------------------------------------------------------------- node
step "Node"
if ! command -v node >/dev/null 2>&1; then
  bad "Node isn't installed. Get it from https://nodejs.org, then run this again."
fi
good "node $(node --version)"

# ---------------------------------------------------------------- dependencies
step "Dependencies"
if [ ! -d node_modules ]; then
  warn "not installed yet -- this only happens the first time"
  npm install || bad "npm install failed"
fi
good "ready"

# ---------------------------------------------------------------- build
step "Building"
printf "  %stakes ~10-20s -- rebuilding every launch keeps this running the latest version%s\n" "$DIM" "$OFF"
npm run build || bad "build failed -- see the errors above"
good "built"

# ---------------------------------------------------------------- start
step "Starting"
nohup npm start > .snipai.log 2>&1 &
echo $! > "$PIDFILE"
disown

for i in $(seq 1 30); do
  snipai_probe_port "$PORT"
  [ "$SNIPAI_OCCUPANT" = identified ] && break
  sleep 1
done

if [ "$SNIPAI_OCCUPANT" != identified ]; then
  bad "server didn't come up -- check .snipai.log for errors (a port conflict is the most likely cause)"
fi
# It came up. Confirm it came up against the library we asked for, rather than
# assuming that because we started it. This is the cheap version of the check
# the app makes: the only thing that can go wrong silently here is the wrong
# footage.
if ! snipai_same_path "$SNIPAI_OCCUPANT_ROOT" "$WANT_ROOT"; then
  warn "  started, but it is serving $SNIPAI_OCCUPANT_ROOT"
  warn "  and this launch asked for $WANT_ROOT"
  bad "Not opening it. Stop it with stop-snipai.command and check SNIPAI_DATA."
fi
good "running at $URL (pid $SNIPAI_OCCUPANT_PID), serving $SNIPAI_OCCUPANT_ROOT"

focus_or_open "$URL/dashboard"

step "Summary"
good "SnipAi is running in the background -- closing this window will NOT stop it"
warn "to stop it, double-click stop-snipai.command"
printf "\n%sDone. You can close this window.%s\n" "$BOLD" "$OFF"
