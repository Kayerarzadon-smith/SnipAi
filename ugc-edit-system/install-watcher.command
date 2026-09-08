#!/bin/bash
# Installs the drop-folder watcher: anything you put in inbox/ gets edited
# automatically and the finished cut appears in edited/.
cd "$(dirname "$0")" || exit 1
ROOT="$(pwd)"
BOLD=$'\033[1m'; OK=$'\033[32m'; ERR=$'\033[31m'; OFF=$'\033[0m'
PLIST="$HOME/Library/LaunchAgents/com.ugc.editsystem.watcher.plist"

case "$ROOT" in
  "$HOME/Desktop"/*|"$HOME/Documents"/*)
    printf "%sThis folder is still inside iCloud (%s).%s\n" "$ERR" "$ROOT" "$OFF"
    printf "Run relocate.command first, then run this from the new location.\n"; exit 1;;
esac

mkdir -p inbox edited logs "$HOME/Library/LaunchAgents"

cat > "$PLIST" <<PLISTEOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.ugc.editsystem.watcher</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>$ROOT/tools/process_inbox.sh</string>
  </array>
  <key>WatchPaths</key>
  <array><string>$ROOT/inbox</string></array>
  <key>StandardOutPath</key><string>$ROOT/logs/watcher.out</string>
  <key>StandardErrorPath</key><string>$ROOT/logs/watcher.err</string>
</dict>
</plist>
PLISTEOF

launchctl unload "$PLIST" 2>/dev/null
if launchctl load "$PLIST" 2>/dev/null; then
  printf "\n%sWatcher installed.%s\n\n" "$OK" "$OFF"
  cat <<NEXT
Drop a raw video into:
  $ROOT/inbox

The finished cut appears in:
  $ROOT/edited

You get a notification when it's done. Logs are in logs/ if anything goes wrong.
Nothing is deleted -- the raw file moves into projects/<name>/raw/ and stays.

To turn it off:  launchctl unload "$PLIST"
To run it by hand instead: bash tools/process_inbox.sh

NEXT
else
  printf "%sCould not load the watcher. Run by hand: bash tools/process_inbox.sh%s\n" "$ERR" "$OFF"
fi
printf "%sYou can close this window.%s\n" "$BOLD" "$OFF"
