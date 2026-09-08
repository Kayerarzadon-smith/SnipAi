#!/bin/bash
# ffmpeg without Homebrew.
# Homebrew classifies this Mac as a Tier 3 configuration, so it has no prebuilt
# openssl@3 and the ffmpeg install can't complete. This installs a self-contained
# ffmpeg binary from PyPI instead (imageio-ffmpeg) and links it into the project's
# Python environment, which is where the tools look for it.
cd "$(dirname "$0")" || exit 1
BOLD=$'\033[1m'; OK=$'\033[32m'; ERR=$'\033[31m'; OFF=$'\033[0m'

printf "%sInstalling ffmpeg (without Homebrew)%s\n\n" "$BOLD" "$OFF"

if [ ! -d .venv ]; then printf "  %s.venv missing -- run setup.command first%s\n" "$ERR" "$OFF"; exit 1; fi
source .venv/bin/activate

pip install --quiet imageio-ffmpeg || { printf "  %spip install failed%s\n" "$ERR" "$OFF"; exit 1; }

BIN=$(python3 -c "import imageio_ffmpeg; print(imageio_ffmpeg.get_ffmpeg_exe())" 2>/dev/null)
if [ -z "$BIN" ] || [ ! -x "$BIN" ]; then
  printf "  %scould not locate the ffmpeg binary%s\n" "$ERR" "$OFF"; exit 1
fi
ln -sf "$BIN" .venv/bin/ffmpeg
printf "  linked %s\n" "$BIN"

printf "\n%sChecking it works%s\n" "$BOLD" "$OFF"
if .venv/bin/ffmpeg -version >/dev/null 2>&1; then
  printf "  %s%s%s\n" "$OK" "$(.venv/bin/ffmpeg -version | head -1)" "$OFF"
  ENC=$(.venv/bin/ffmpeg -hide_banner -encoders 2>/dev/null | grep -cE " (libx264|aac) ")
  [ "$ENC" -ge 2 ] && printf "  %sh264 and aac encoders present%s\n" "$OK" "$OFF" \
                   || printf "  %sencoders missing -- tell me%s\n" "$ERR" "$OFF"
else
  printf "  %sffmpeg will not run%s\n" "$ERR" "$OFF"; exit 1
fi

printf "\n%sEverything is installed.%s\n" "$BOLD" "$OFF"
cat <<'NEXT'

Two things left, both in VS Code:
  1. Cmd+Shift+X, search "Claude Code", click Install.
  2. File > Open Folder > this folder, then press Cmd+Esc and sign in.

To confirm the whole pipeline works, run in this folder:
  source .venv/bin/activate
  python3 tools/verify_cut.py projects/medicube-egf-serum/cuts/glow-up-daddy-medicube-cut-v6.mp4

NEXT
printf "%sDone. You can close this window.%s\n" "$BOLD" "$OFF"
