---
description: Scan a source region to find the clean take
---

Find the clean recitation in this region: $ARGUMENTS

Everything below runs from the repo root with the venv active:
`source .venv/bin/activate`. ffmpeg lives at `.venv/bin/ffmpeg` on this
machine, so nothing works without it (see CLAUDE.md).

(expects: a project name and a start/end time in seconds)

Run `python3 tools/scan_takes.py <project raw file> <start> <end>` and, if the
result is still ambiguous, again with `--width 1.6 --hop 0.7` to narrow it down.

Read the output bottom-up. The speaker restarts lines repeatedly; the usable
take is the last complete one. Tell me the exact in-point and out-point, and
quote what is actually said between them.
