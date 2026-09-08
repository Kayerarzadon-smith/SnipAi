# UGC Edit System

Framework for cutting raw talking-head footage into finished short-form video.

- **First time here?** `SETUP.md` — installing Claude Code, ffmpeg and the Python packages.
- **The method** lives in `CLAUDE.md`. Claude Code reads it automatically when
  you open this folder, so you don't have to explain the workflow each time.
- `reference/` — a raw take and the same take cut post-ready. This pair is the
  style target; everything else is measured against it.
- `tools/` — the scripts that do the work.
- `projects/` — one folder per video. `medicube-egf-serum` is the first;
  `_template/` is the starting shape for the next.

## Working on a video

In VS Code, press `Cmd+Esc` to open Claude, then use these:

    /new-video <path to footage>   set up a project, transcribe, draft the beats
    /find-takes <project> <start> <end>   find the clean take in a messy region
    /build <project>               build the cut and verify it
    /match-reference               re-measure the house style from a new reference pair

Or run the tools directly:

    python3 tools/transcribe.py <video> -o <project>/work/transcript.json
    python3 tools/silence_map.py <video> -o <project>/work/silence.txt
    python3 tools/scan_takes.py <video> <start> <end>
    python3 tools/build_cut.py --project projects/<name>
    python3 tools/verify_cut.py <cut.mp4>
    python3 tools/align_reference.py <raw> <finished>

## The one rule that matters

Each beat is one complete recitation. Trimming a pause inside a take is good and
is what makes the cut feel tight. Stitching two attempts at the same sentence is
a stutter, and it is easy to do by accident because the transcript hides the
restarts. `verify_cut.py` is what catches it — always run it before posting.

Current cut: `projects/medicube-egf-serum/cuts/glow-up-daddy-medicube-cut-v6.mp4`
(67.8s, against the reference's 67.5s).
