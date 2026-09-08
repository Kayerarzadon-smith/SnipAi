---
description: Start a new video project from a source file
---

Set up a new project for the footage at: $ARGUMENTS

Everything below runs from the repo root with the venv active:
`source .venv/bin/activate`. ffmpeg lives at `.venv/bin/ffmpeg` on this
machine, so nothing works without it (see CLAUDE.md).


1. Pick a short kebab-case project name from the product or topic and create
   `projects/<name>/{raw,cuts,work}`.
2. Move (do not copy) the source file into `projects/<name>/raw/`. Never modify it.
3. Run, from the repo root:
   - `python3 tools/transcribe.py projects/<name>/raw/<file> -o projects/<name>/work/transcript.json`
   - `python3 tools/silence_map.py projects/<name>/raw/<file> -o projects/<name>/work/silence.txt`
4. Read the transcript and draft `projects/<name>/beats.json` following
   `projects/_template/beats.json`, one beat per line of the script, in the beat
   order documented in CLAUDE.md.
5. The transcript is a draft, not ground truth. For every beat where a
   mid-sentence word runs longer than ~0.8s (transcribe.py lists these), run
   `tools/scan_takes.py` over that region and pick the LAST complete recitation.
   Report which beats you had to correct and why.

Work autonomously. Make the judgement calls yourself using CLAUDE.md -- do not
ask which take to use, what to name things, or whether to proceed. Build the
beat list, then go straight on to building and verifying the cut. Come back
with the finished cut and a short note on what you chose and what you cut.
Ask only if something is genuinely undecidable from the footage.
