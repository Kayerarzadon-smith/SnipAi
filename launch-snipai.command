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

is_snipai() { curl -s -m 2 "$URL/api/projects" | grep -q '"projects"'; }

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

# ---------------------------------------------------------------- already running?
# Checks for SnipAi's own JSON response, not just that *something* answers on
# the port -- another app entirely can be bound there.
if is_snipai; then
  step "Already running"
  good "SnipAi is already up at $URL -- opening it"
  focus_or_open "$URL/dashboard"
  printf "\n%sDone. You can close this window.%s\n" "$BOLD" "$OFF"
  exit 0
fi

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
  is_snipai && break
  sleep 1
done

if ! is_snipai; then
  bad "server didn't come up -- check .snipai.log for errors (a port conflict is the most likely cause)"
fi
good "running at $URL (pid $(cat "$PIDFILE"))"

focus_or_open "$URL/dashboard"

step "Summary"
good "SnipAi is running in the background -- closing this window will NOT stop it"
warn "to stop it, double-click stop-snipai.command"
printf "\n%sDone. You can close this window.%s\n" "$BOLD" "$OFF"
