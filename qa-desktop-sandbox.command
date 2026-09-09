#!/bin/bash
# QA: launch the SnipAi desktop app against the throwaway library instead of
# the real one, so destructive testing never touches ~/Movies/SnipAi/projects.
# Delete this file when QA is done.
export SNIPAI_DATA="$HOME/Movies/SnipAi/qa-sandbox"
mkdir -p "$SNIPAI_DATA/projects"
echo "SNIPAI_DATA=$SNIPAI_DATA"
exec "$HOME/Projects/SnipAi/SnipAi.app/Contents/MacOS/SnipAi"
