---
description: Build and verify the cut from beats.json
---

Build the cut for: $ARGUMENTS

Everything below runs from the repo root with the venv active:
`source .venv/bin/activate`. ffmpeg lives at `.venv/bin/ffmpeg` on this
machine, so nothing works without it (see CLAUDE.md).


1. `python3 tools/build_cut.py --project projects/<name>`
2. `bash projects/<name>/work/extract.sh`
3. `ffmpeg -y -f concat -safe 0 -i projects/<name>/work/concat.txt -c copy projects/<name>/cuts/<name>-v<N>.mp4`
4. `python3 tools/verify_cut.py projects/<name>/cuts/<name>-v<N>.mp4`
5. `python3 tools/compare_to_reference.py --project projects/<name>`

If verify fails, it names the timestamps of the repeated phrase. Map that back
through `work/edl.json` to the beat, re-scan that region with
`tools/scan_takes.py`, fix the in-point in `beats.json`, and rebuild. Do not
hand me a cut that has not passed verify. Fix and rebuild on your own -- do not
ask permission between attempts.

Report what compare_to_reference.py says, not just the duration. If the median
beat is well above the reference's, the cut is structurally looser than the
reference even when the total length matches -- the reference cuts *within*
lines more than we do. Name the longest beats and ask whether to tighten them.
Also say which beats you changed and why.
