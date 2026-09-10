#!/bin/bash
# QA (2026-09-10): rebuild SnipAi.app from HEAD, then launch it against the
# throwaway library so the pass can be destructive. Delete when QA is done.
cd "$(dirname "$0")" || exit 1
LOG="$PWD/qa-rebuild.log"
: > "$LOG"
exec > >(tee -a "$LOG") 2>&1

echo "=== stopping anything on 4737 ==="
./stop-snipai.command || true

echo "=== bundling from $(git rev-parse --short HEAD) ==="
QA_SKIP=1 ./scripts/bundle-app
echo "bundle exit=$?"

export SNIPAI_DATA="$HOME/Movies/SnipAi/qa-sandbox"
mkdir -p "$SNIPAI_DATA/projects"
echo "=== launching against SNIPAI_DATA=$SNIPAI_DATA ==="
echo "READY-TO-LAUNCH"
exec "$PWD/SnipAi.app/Contents/MacOS/SnipAi"
