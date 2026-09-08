#!/bin/bash
# Processes any video sitting in inbox/. Called by the watcher, or run by hand.
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT" || exit 1
mkdir -p inbox edited logs

# only one run at a time
exec 9>logs/.lock
flock -n 9 2>/dev/null || { command -v flock >/dev/null || true; }

shopt -s nullglob nocaseglob
for f in inbox/*.mp4 inbox/*.mov inbox/*.m4v; do
  [ -f "$f" ] || continue
  base="$(basename "$f")"

  # wait for the copy to finish -- size must hold steady
  last=-1
  for _ in $(seq 1 60); do
    cur=$(stat -f%z "$f" 2>/dev/null || echo 0)
    [ "$cur" = "$last" ] && [ "$cur" != "0" ] && break
    last=$cur; sleep 2
  done

  stamp="$(date +%Y%m%d-%H%M%S)"
  log="logs/${stamp}-${base%.*}.log"
  echo "=== $base -> starting $(date) ===" | tee -a "$log"

  source .venv/bin/activate
  name="$(echo "${base%.*}" | tr '[:upper:] ' '[:lower:]-' | tr -cd 'a-z0-9-' | cut -c1-40)"
  out="edited/${name}-$(date +%Y%m%d).mp4"

  if python3 tools/auto_edit.py "$f" --name "$name" --out "$ROOT/$out" >>"$log" 2>&1; then
    echo "DONE  -> $out" | tee -a "$log"
    osascript -e "display notification \"$out\" with title \"Cut ready\"" 2>/dev/null
  else
    echo "FAILED -- see $log" | tee -a "$log"
    osascript -e "display notification \"$base failed - see logs\" with title \"Edit failed\"" 2>/dev/null
  fi
  echo "=== finished $(date) ===" >> "$log"
done
