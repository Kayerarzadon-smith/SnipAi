---
description: Measure a new reference edit and update the house style
---

Analyse the reference pair (or the files named in: $ARGUMENTS)

Everything below runs from the repo root with the venv active:
`source .venv/bin/activate`. ffmpeg lives at `.venv/bin/ffmpeg` on this
machine, so nothing works without it (see CLAUDE.md).


1. `python3 tools/align_reference.py reference/1-raw/<raw> reference/2-finished/<finished>`
2. Check for captions or graphic overlays by pulling frames with ffmpeg and
   looking at them.
3. Check for a music bed: measure `volumedetect` in a gap between spoken lines.
   Raw room tone sits near -49 dB; anything above about -30 dB means music.
4. Compare words/sec between the reference and our raw footage -- a runtime gap
   is often the read, not the edit.

Then update the "House style" section of CLAUDE.md with what changed, and tell
me which numbers moved.
