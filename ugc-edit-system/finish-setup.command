#!/bin/bash
# UGC Edit System -- finishes setup: ffmpeg (with full output), Claude Code, VS Code extension.
cd "$(dirname "$0")" || exit 1
BOLD=$'\033[1m'; OK=$'\033[32m'; WARN=$'\033[33m'; ERR=$'\033[31m'; OFF=$'\033[0m'
step() { printf "\n%s==> %s%s\n" "$BOLD" "$1" "$OFF"; }
good() { printf "  %s%s%s\n" "$OK" "$1" "$OFF"; }
warn() { printf "  %s%s%s\n" "$WARN" "$1" "$OFF"; }
bad()  { printf "  %s%s%s\n" "$ERR" "$1" "$OFF"; }

for p in /opt/homebrew/bin/brew /usr/local/bin/brew; do
  [ -x "$p" ] && eval "$("$p" shellenv)" && break
done
export PATH="$HOME/.local/bin:$PATH"

step "ffmpeg"
if command -v ffmpeg >/dev/null 2>&1; then
  good "already installed ($(ffmpeg -version | head -1 | awk '{print $3}'))"
else
  warn "retrying -- if it asks 'proceed with the installation? [y/n]' type y and press Return"
  brew install ffmpeg
  if command -v ffmpeg >/dev/null 2>&1; then
    good "installed"
  else
    bad "still failing. The error is printed above -- send me the last 15 lines."
  fi
fi

step "Claude Code"
if command -v claude >/dev/null 2>&1; then
  good "already installed ($(claude --version 2>/dev/null))"
else
  curl -fsSL https://claude.ai/install.sh | bash
  export PATH="$HOME/.local/bin:$PATH"
  command -v claude >/dev/null 2>&1 && good "installed ($(claude --version 2>/dev/null))" \
    || bad "install failed"
fi

step "VS Code extension"
if command -v code >/dev/null 2>&1; then
  code --install-extension anthropic.claude-code --force >/dev/null 2>&1 \
    && good "Claude Code extension installed" || warn "add it from the Extensions panel instead"
else
  warn "the 'code' command isn't set up -- in VS Code press Cmd+Shift+X, search"
  warn "\"Claude Code\", and click Install. That works just as well."
fi

step "Summary"
command -v ffmpeg >/dev/null 2>&1 && good "ffmpeg ready" || bad "ffmpeg MISSING"
[ -d .venv ] && good "python env ready" || bad "python env MISSING"
command -v claude >/dev/null 2>&1 && good "claude ready" || bad "claude MISSING"

cat <<'NEXT'

Next: open this folder in VS Code (File > Open Folder) and press Cmd+Esc.
Sign in with your Pro account when the browser opens.

NEXT
printf "%sDone. You can close this window.%s\n" "$BOLD" "$OFF"
