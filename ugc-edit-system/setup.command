#!/bin/bash
# UGC Edit System -- one-time setup. Double-click this file to run it.
cd "$(dirname "$0")" || exit 1

BOLD=$'\033[1m'; DIM=$'\033[2m'; OK=$'\033[32m'; WARN=$'\033[33m'; ERR=$'\033[31m'; OFF=$'\033[0m'
step() { printf "\n%s==> %s%s\n" "$BOLD" "$1" "$OFF"; }
good() { printf "  %s%s%s\n" "$OK" "$1" "$OFF"; }
warn() { printf "  %s%s%s\n" "$WARN" "$1" "$OFF"; }
bad()  { printf "  %s%s%s\n" "$ERR" "$1" "$OFF"; }

printf "%sUGC Edit System -- setup%s\n" "$BOLD" "$OFF"
printf "%sThis installs ffmpeg, the Python packages, and Claude Code.%s\n" "$DIM" "$OFF"
printf "%sYou will be asked for your Mac password once, and to sign in to Claude once.%s\n" "$DIM" "$OFF"

# ---------------------------------------------------------------- Homebrew
step "Homebrew"
if command -v brew >/dev/null 2>&1; then
  good "already installed"
else
  warn "not found -- installing (it will ask for your Mac password)"
  /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)" || bad "Homebrew install failed"
fi
for p in /opt/homebrew/bin/brew /usr/local/bin/brew; do
  [ -x "$p" ] && eval "$("$p" shellenv)" && break
done
command -v brew >/dev/null 2>&1 && good "brew $(brew --version | head -1 | awk '{print $2}')" || bad "brew still not on PATH"

# ---------------------------------------------------------------- ffmpeg
step "ffmpeg"
if command -v ffmpeg >/dev/null 2>&1; then
  good "already installed ($(ffmpeg -version | head -1 | awk '{print $3}'))"
else
  brew install ffmpeg && good "installed" || bad "ffmpeg install failed"
fi

# ---------------------------------------------------------------- Python
step "Python packages"
if [ ! -d .venv ]; then
  python3 -m venv .venv || bad "could not create .venv"
fi
if [ -d .venv ]; then
  # shellcheck disable=SC1091
  source .venv/bin/activate
  pip install --quiet --upgrade pip
  pip install --quiet -r tools/requirements.txt && good "faster-whisper and numpy installed" \
    || bad "pip install failed"
  python3 -c "import faster_whisper, numpy" 2>/dev/null && good "imports OK" || bad "imports failed"
fi

# ---------------------------------------------------------------- Claude Code
step "Claude Code"
export PATH="$HOME/.local/bin:$PATH"
if command -v claude >/dev/null 2>&1; then
  good "already installed ($(claude --version 2>/dev/null))"
else
  curl -fsSL https://claude.ai/install.sh | bash
  export PATH="$HOME/.local/bin:$PATH"
  command -v claude >/dev/null 2>&1 && good "installed ($(claude --version 2>/dev/null))" \
    || bad "install failed -- see https://code.claude.com/docs/en/setup"
fi

# ---------------------------------------------------------------- VS Code extension
step "VS Code extension"
if command -v code >/dev/null 2>&1; then
  code --install-extension anthropic.claude-code --force >/dev/null 2>&1 \
    && good "Claude Code extension installed" || warn "could not install -- add it from the Extensions panel"
else
  warn "the 'code' command isn't set up."
  warn "In VS Code press Cmd+Shift+P, run \"Shell Command: Install 'code' command in PATH\","
  warn "then run this script again -- or just search \"Claude Code\" in the Extensions panel."
fi

# ---------------------------------------------------------------- Summary
step "Summary"
command -v ffmpeg >/dev/null 2>&1 && good "ffmpeg ready" || bad "ffmpeg MISSING"
[ -d .venv ] && good "python env ready (.venv)" || bad "python env MISSING"
command -v claude >/dev/null 2>&1 && good "claude ready" || bad "claude MISSING"

cat <<'NEXT'

Next:
  1. Open this folder in VS Code (File > Open Folder), press Cmd+Esc to start Claude.
     The first time, it will open a browser to sign in with your Pro account.
  2. To check everything works, run in this folder:
       source .venv/bin/activate
       python3 tools/verify_cut.py projects/medicube-egf-serum/cuts/glow-up-daddy-medicube-cut-v6.mp4
     The first run downloads the speech model, so give it a minute. It should print PASS.

NEXT
printf "%sDone. You can close this window.%s\n" "$BOLD" "$OFF"
