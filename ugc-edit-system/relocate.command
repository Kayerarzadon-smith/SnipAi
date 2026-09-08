#!/bin/bash
# Moves this folder out of iCloud (Desktop) to ~/Movies, and rebuilds the Python
# environment, which is not relocatable -- a venv hard-codes its own path.
cd "$(dirname "$0")" || exit 1
SRC="$(pwd)"
DEST="$HOME/Movies/UGC Edit System"
BOLD=$'\033[1m'; OK=$'\033[32m'; WARN=$'\033[33m'; ERR=$'\033[31m'; OFF=$'\033[0m'

printf "%sMoving out of iCloud%s\n" "$BOLD" "$OFF"
printf "  from: %s\n  to:   %s\n\n" "$SRC" "$DEST"

case "$SRC" in
  "$HOME/Movies/"*) printf "  %salready outside iCloud -- nothing to move%s\n" "$OK" "$OFF"; DEST="$SRC";;
  *)
    if [ -e "$DEST" ]; then printf "  %s%s already exists -- move or rename it first%s\n" "$ERR" "$DEST" "$OFF"; exit 1; fi
    mkdir -p "$HOME/Movies" || exit 1
    printf "  copying (this takes a few minutes -- iCloud has to download evicted files)...\n"
    if ! ditto "$SRC" "$DEST"; then printf "  %scopy failed%s\n" "$ERR" "$OFF"; exit 1; fi
    printf "  %scopied%s\n" "$OK" "$OFF"
    ;;
esac

cd "$DEST" || exit 1

printf "\n%sRebuilding the Python environment%s\n" "$BOLD" "$OFF"
rm -rf .venv
python3 -m venv .venv || { printf "  %svenv failed%s\n" "$ERR" "$OFF"; exit 1; }
source .venv/bin/activate
pip install --quiet --upgrade pip
pip install --quiet -r tools/requirements.txt imageio-ffmpeg || { printf "  %spip failed%s\n" "$ERR" "$OFF"; exit 1; }
BIN=$(python3 -c "import imageio_ffmpeg;print(imageio_ffmpeg.get_ffmpeg_exe())")
ln -sf "$BIN" .venv/bin/ffmpeg
printf "  %spackages installed, ffmpeg linked%s\n" "$OK" "$OFF"

printf "\n%sChecking%s\n" "$BOLD" "$OFF"
.venv/bin/ffmpeg -version >/dev/null 2>&1 && printf "  %sffmpeg OK%s\n" "$OK" "$OFF" || printf "  %sffmpeg broken%s\n" "$ERR" "$OFF"
python3 -c "import faster_whisper, numpy" 2>/dev/null && printf "  %spython OK%s\n" "$OK" "$OFF" || printf "  %spython broken%s\n" "$ERR" "$OFF"

cat <<NEXT

Done. The working copy is now:
  $DEST

The old copy is still on your Desktop. Check the new one opens and works, then
drag the Desktop one to the Trash yourself -- I'd rather you delete 2.7GB than me.

Next: open the NEW folder in VS Code, and run install-watcher.command inside it
to set up the drop-folder pipeline.

NEXT
printf "%sYou can close this window.%s\n" "$BOLD" "$OFF"
