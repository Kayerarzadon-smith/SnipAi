# UGC Edit System

Framework for cutting raw talking-head footage into finished short-form video
(TikTok Shop / UGC review format). Read this before editing anything here.

## Layout

    CLAUDE.md                     this file — the method
    SETUP.md                      one-time setup on the Mac
    .claude/commands/             /new-video, /find-takes, /build, /match-reference
    reference/
      1-raw/                      an unedited take
      2-finished/                 the same take, cut to post-ready (the target)
      3-walkthrough/              screen recordings of the process
      resources/                  before/after photos, definitions, music, screenshots
    tools/                        reusable scripts (see bottom)
    projects/<product>/
      beats.json                  the edit: one entry per line of the script
      raw/                        source footage — NEVER modified
      cuts/                       finished renders
      work/                       transcripts, silence maps, EDLs, scratch clips
    projects/_template/           starting shape for the next video

## House style

Measured by aligning `reference/2-finished` against `reference/1-raw`:

- 67s finished out of ~333s raw.
- 34 cuts — roughly one every 2 seconds.
- No captions, no graphic overlays, no PIP. Hard cuts only, real background.
- A music bed runs under the whole thing: gaps between lines sit at -16 to -26 dB
  where raw room tone is -49 dB.
- Pauses are trimmed INSIDE a line, not only between lines (removals of 0.07-0.43s).
- One clean recitation per line. Never two attempts at the same sentence.
- Beat order: three hooks, product intro, application, one beat per ingredient,
  how long they've used it, people noticing, before, after, commitment,
  scarcity, sale, CTA.

## Working style

Work autonomously. This is a creative production folder, not a codebase review --
the user wants finished cuts, not a decision queue. Choose takes, names and
trims yourself from the rules here, and report what you chose afterwards. Ask
only when the footage genuinely cannot settle it. A wrong call that is stated
clearly is cheaper than a question.

## Method

### 1. Never modify the raw file
Everything is non-destructive. Cuts are timecode ranges into an untouched source.

### 2. Transcribe, then distrust the transcript
This is the critical failure mode. Whisper assigns pause and restart audio to the
duration of the *preceding word*. A word timestamped at 5.4s is not a long word —
it is a word, a hesitation, and often two or three restarts of the sentence. A
coarse transcript of footage full of retakes reads perfectly clean when the audio
is not.

Rule: any mid-sentence word span over ~0.8s is a suspected restart. Confirm with
`tools/scan_source_takes.py`, which re-transcribes the region in 2-3.5s windows —
short windows force fine decoding and expose the repeats.

On the MediCube footage this flagged 10 of 22 beats. In every case the correct
in-point was *later* than the coarse transcript implied, because the beat was
starting inside the tail of a previous attempt. That is exactly what a "stutter"
sounds like in the finished cut.

### 3. Pick the last complete recitation
The speaker runs each line 2-5 times. Take the final complete one. If no clean
complete take exists, split the line into two beats and take the clean half of
each, or drop the beat — do not stitch two attempts of the same sentence together.

### 4. Trim pauses inside the beat
`silencedetect=noise=-28dB:d=0.10` over the whole source. Internal silences of
0.22s or more get shortened to 0.07s. Every cut lands inside detected silence,
never on speech. This is not the same as splicing two takes — it is what makes
the cut feel tight.

### 5. Pad boundaries off the word gaps
Head pad up to 0.07s, tail pad up to 0.20s, each capped at (gap to the neighbouring
word minus 0.04s). Where the next word starts immediately, the pad is zero:
padding into a zero gap clips the next word, which is the same defect as cutting
a word short.

### 6. Render
Per-clip fast seek, then stream-copy concat. Never run one `filter_complex` pass
over the whole source — decoding several minutes of HEVC in a single pass exceeds
the shell's time limit and leaves a corrupt file with no moov atom.

    ffmpeg -y -ss <start> -i SRC -t <dur> -c:v libx264 -preset veryfast -crf 18 \
      -pix_fmt yuv420p -r 30 -c:a aac -b:a 192k -movflags +faststart out.mp4
    ffmpeg -y -f concat -safe 0 -i list.txt -c copy final.mp4

Batch 6-10 extractions per shell call.

### 7. Verify the output, not the plan
`tools/scan_output.py` transcribes the finished cut in overlapping 5s windows.
Any phrase appearing twice is a defect. This is the only check that reflects what
a viewer actually hears — an edit plan can look correct and still contain a repeat.

## Matching a new reference

`tools/align_reference.py` cross-correlates a finished edit against its own raw
take and prints the segment map: which source range every finished segment came
from, and how much was removed at each join. From that, measure cut count, per-beat
duration, and whether removals fall between lines or inside them.

Watch delivery speed. The reference take runs 4.5 words/sec against 3.2 in the
MediCube raw. Same script, but 67s there and 85s here before any trimming — so
a runtime gap is often the read, not the edit.

## Tools

Run from the repo root, with the venv active (`source .venv/bin/activate`).
See SETUP.md for first-time setup.

**Important on this machine:** ffmpeg is NOT installed system-wide. Homebrew
classifies this Mac as a Tier 3 configuration and has no prebuilt openssl@3, so
`brew install ffmpeg` cannot complete. ffmpeg comes from the `imageio-ffmpeg`
PyPI package instead and is linked at `.venv/bin/ffmpeg` (v7.1, with libx264 and
aac). So the venv must be active for any ffmpeg call to resolve, or invoke it by
path. There is no `ffprobe`; `verify_cut.py` falls back to reading the duration
off ffmpeg. Don't try to fix this with brew -- it will fail the same way.

    transcribe.py <video> -o <proj>/work/transcript.json
        word-level transcript; also lists the long word spans that hide restarts

    silence_map.py <video> -o <proj>/work/silence.txt
        silence map used to trim pauses inside a beat

    scan_takes.py <video> <start> <end> [--width 1.6 --hop 0.7]
        fine-window scan of a region, to find the last clean recitation

    build_cut.py --project projects/<name> [--pad]
        beats.json -> work/edl.json, work/extract.sh, work/concat.txt.
        In/out points in beats.json are final; --pad only if they were picked
        tight on the word boundary without handles.

    verify_cut.py <cut.mp4>
        transcribes the finished cut and fails if any phrase repeats.
        Always run this before posting.

    compare_to_reference.py --project projects/<name>
        checks a built cut against reference/house-style.json -- length, cut
        count, beat length -- and names the longest beats. A check, not a fixer.

    align_reference.py <raw> <finished>
        reverse-engineer a finished edit: which source range each segment came
        from, cut count, segment lengths, and whether removals are pause trims
        inside a take or jumps to another take.

In Claude Code, the same workflow is available as `/new-video`, `/find-takes`,
`/build`, and `/match-reference`.

## Open items

- No music bed on the current cut. Drop a track in `reference/resources`.
- `reference/3-walkthrough` is empty.
