#!/bin/bash
# QA launcher — starts SnipAi against an isolated throwaway library so testing
# never touches ~/Movies/SnipAi/projects. Delete this file when QA is done.
cd "$(dirname "$0")" || exit 1
export SNIPAI_DATA="$HOME/Movies/SnipAi/qa-sandbox"
mkdir -p "$SNIPAI_DATA/projects"
echo "SNIPAI_DATA=$SNIPAI_DATA"
exec ./launch-snipai.command
