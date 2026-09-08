# Setup

**Easiest way: double-click `setup.command` in this folder.** It does everything
below on its own. You will need to type your Mac password once (Homebrew asks
for it) and sign in to Claude once in the browser. If macOS blocks it the first
time, right-click the file and choose Open instead.

The rest of this page is the same steps by hand, if you would rather do them
one at a time or something goes wrong.

One-time setup on the Mac. Everything below runs in Terminal
(Applications > Utilities > Terminal). Copy a line, press Return, wait for the
prompt to come back before the next one.

## 1. Claude Code

You have a Pro plan, which covers this.

Terminal:

    curl -fsSL https://claude.ai/install.sh | bash

Or skip the terminal entirely and use the Claude Code desktop app.

Verify:

    claude --version

## 2. VS Code extension

In VS Code press `Cmd+Shift+X`, search "Claude Code", click Install. The
extension is `anthropic.claude-code` and needs VS Code 1.94 or newer. Opening
this folder in VS Code will also offer it as a recommended extension.

Then: File > Open Folder > this folder, and press `Cmd+Esc` to start Claude.
It reads `CLAUDE.md` automatically.

## 3. ffmpeg

All the cutting runs through ffmpeg. If you don't have Homebrew:

    /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"

Then:

    brew install ffmpeg

Verify:

    ffmpeg -version

## 4. Python packages

From this folder:

    python3 -m venv .venv
    source .venv/bin/activate
    pip install -r tools/requirements.txt

This installs faster-whisper (transcription) and numpy. The first transcription
downloads the speech model, which takes a minute; after that it is cached.

Verify:

    python3 -c "import faster_whisper, numpy; print('ok')"

Whenever you open a new terminal in this folder, run `source .venv/bin/activate`
first. Claude Code will do this itself if you tell it to once.

## Check it works end to end

    python3 tools/verify_cut.py projects/medicube-egf-serum/cuts/glow-up-daddy-medicube-cut-v6.mp4

Should print PASS and no repeated phrases.

## Note on where things run

The tooling in this folder runs natively on the Mac. Earlier versions of this
project were driven from a cloud session through a bridge, which capped how long
any single command could run -- that is why the older scripts in
`projects/*/work/` batch their ffmpeg calls. Running locally, there is no such
limit; long ffmpeg and transcription passes can just run.
