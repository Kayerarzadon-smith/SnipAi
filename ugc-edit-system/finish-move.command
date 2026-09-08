#!/bin/bash
# Completes the move out of iCloud. Safe to run repeatedly -- it resumes.
# Unlike the first attempt this skips regenerable scratch (clip caches, the venv)
# and tolerates files iCloud cannot materialise, which is what broke ditto.
cd "$(dirname "$0")" || exit 1
SRC="$(pwd)"
DEST="$HOME/Movies/UGC Edit System"
BOLD=$'\033[1m'; OK=$'\033[32m'; WARN=$'\033[33m'; ERR=$'\033[31m'; OFF=$'\033[0m'

case "$SRC" in "$HOME/Movies/"*) printf "%sAlready in place.%s\n" "$OK" "$OFF"; DEST="$SRC";; esac

if [ "$SRC" != "$DEST" ]; then
  if pgrep -x ditto >/dev/null 2>&1; then
    printf "%sThe earlier copy is still running. Let it finish, then run this again.%s\n" "$WARN" "$OFF"
    exit 1
  fi
  printf "%sCopying to %s%s\n" "$BOLD" "$DEST" "$OFF"
  printf "Skipping clip caches and the venv -- both are rebuilt, not carried over.\n\n"
  mkdir -p "$DEST"
  rsync -a --no-perms --no-owner --no-group \
    --exclude '.venv/' --exclude '.DS_Store' \
    --exclude 'work/clips/' --exclude 'work/previews/' \
    --exclude '.clips_v*/' --exclude '.preview*/' --exclude '.transcode-cache/' \
    --exclude 'node_modules/' --exclude 'logs/' \
    "$SRC/" "$DEST/"
  rc=$?
  case $rc in
    0)  printf "  %scopied%s\n" "$OK" "$OFF";;
    23|24) printf "  %scopied, some files were skipped (iCloud could not produce them)%s\n" "$WARN" "$OFF";;
    *)  printf "  %srsync failed (%s)%s\n" "$ERR" "$rc" "$OFF"; exit 1;;
  esac
fi

cd "$DEST" || exit 1
mkdir -p inbox edited logs

printf "\n%sRebuilding the Python environment%s\n" "$BOLD" "$OFF"
rm -rf .venv
python3 -m venv .venv && source .venv/bin/activate && \
  pip install --quiet --upgrade pip && \
  pip install --quiet -r tools/requirements.txt imageio-ffmpeg || {
    printf "  %sfailed%s\n" "$ERR" "$OFF"; exit 1; }
ln -sf "$(python3 -c 'import imageio_ffmpeg;print(imageio_ffmpeg.get_ffmpeg_exe())')" .venv/bin/ffmpeg

printf "\n%sChecking%s\n" "$BOLD" "$OFF"
.venv/bin/ffmpeg -version >/dev/null 2>&1 && printf "  %sffmpeg OK%s\n" "$OK" "$OFF" || printf "  %sffmpeg broken%s\n" "$ERR" "$OFF"
python3 -c "import faster_whisper, numpy" 2>/dev/null && printf "  %spython OK%s\n" "$OK" "$OFF" || printf "  %spython broken%s\n" "$ERR" "$OFF"
[ -f projects/medicube-egf-serum/raw/*.MOV ] 2>/dev/null && printf "  %sraw footage present%s\n" "$OK" "$OFF"
ls projects/medicube-egf-serum/cuts/*.mp4 >/dev/null 2>&1 && printf "  %scuts present (%s)%s\n" "$OK" "$(ls projects/medicube-egf-serum/cuts/*.mp4 | wc -l | tr -d ' ')" "$OFF"

cat <<NEXT

The working copy is now:
  $DEST

Next: double-click install-watcher.command IN THAT FOLDER (not the Desktop one).
Then drop a video into its inbox/ folder.

The Desktop copy is untouched. Once you've confirmed the new one works, drag the
Desktop one to the Trash yourself.

NEXT
printf "%sYou can close this window.%s\n" "$BOLD" "$OFF"
