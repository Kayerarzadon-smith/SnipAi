# Gauntlet bug log

Defects found by the 1,000-scenario gauntlet (`qa/`), separate from
`audits/LEDGER.md`, which is the standing QA ledger, and from `DOCKET.md`,
which is what Kayer asked for.

Severity: **P0** data loss / unusable · **P1** major workflow broken ·
**P2** significant · **P3** minor · **P4** cosmetic.

---

## BUG-001 — a working transcode is killed for being quiet · P1 · fixed

**Category** 019 failure/chaos, 004 media import
**Found** by running the real import Kayer had stuck at 43%.

`make_source_proxy.py` runs ffmpeg with `-loglevel error -nostats`, which
prints **nothing at all** for the whole transcode. The runner judges a job by
whether it is still talking rather than by how long it has taken — deliberately,
because a wall-clock ceiling once killed a real 4K build at 601 seconds. But
silence is only evidence of a hang if the process would otherwise speak.

**Reproduction** Import a 1.8GB 4K clip. The pipeline reaches "Shrinking for
smooth playback…", sits there, and fails at five minutes with
`stopped responding — nothing written for 5 minutes, so it was killed`.

**Expected** The transcode finishes.
**Actual** Killed mid-write, leaving a 24MB truncated proxy; the whole auto
pipeline fails at 56%.

**Root cause** `ugc-edit-system/tools/make_source_proxy.py` — no output while
working. The idle timeout in `lib/pipeline.ts` is correct; its premise
("each of these tools writes continuously") was not true of this one.

**Fix** `-progress pipe:1`, parsed into a percentage. Heartbeat AND the
progress the queue can show. Measured on a 40s 4K slice: 92 heartbeats,
longest gap **2.19s** against a 300s killer.

**Also fixed here** the same file resolved ffmpeg as `.venv/bin/ffmpeg` or a
bare `ffmpeg`. There is no venv inside the .app and no system ffmpeg on this
Mac, so `SNIPAI_FFMPEG` is now honoured first, then imageio.

**Bounded, not guessed** the other whole-file tools (`transcribe.py`,
`verify_cut.py`, `measure_finished.py`) extract audio with `-vn`. Measured on
the same 1.8GB source: **2 seconds**. No heartbeat needed.

---

## BUG-002 — one bad `beats.json` empties the whole queue · P1 · fixed

**Category** 001 launch/initialization, 011 data integrity

`loadBeats` was `JSON.parse(readFileSync(...)) as BeatsFile`. beats.json is
the edit, and CLAUDE.md documents Kayer editing it by hand. A stray comma
threw out of `summarizeAllProjects`, 500'd `GET /api/projects`, and took
**every other project** off the dashboard with it.

The cast was the second half: `{"beats":null}` parsed happily and returned a
document whose `beats` is not a list, so the TypeError surfaced at a `.map()`
several calls away.

**Fix** `readBeats()` returns missing / broken / ok, `loadBeats` never throws,
`summarizeAllProjects` guards each project, and a project that is on disk but
unreadable now stays on the queue **saying what is wrong** instead of silently
vanishing.

**Regression** `tests/corrupt-project.test.mts` — 7 corruption shapes × 3
assertions.

---

## BUG-003 — a negative EDL duration runs the timeline backwards · P2 · fixed

**Category** 006 timeline core, 007 frame accuracy

`layout()` trusted `edl[].dur`. Positions are a running sum, so one piece with
a negative or non-finite duration produced a negative total, and every playhead
position, clip offset and filmstrip position inherited it.

**Fix** `edlStillFits` rejects a piece that cannot describe real footage
(negative/non-finite duration, inverted or non-finite source range) and the
beat falls back to its own extent — which is what already happened for every
other kind of stale EDL.

**Regression** `tests/corrupt-project.test.mts`, 5 cases.
**Found by** the adversarial suite, 12 failing scenarios.

---

## BUG-004 — splitting a beat says the line twice · P1 · fixed

**Category** 006 timeline core, 021 export
**Was** LEDGER S7, open, with a failing board test.

The split built both halves with `{ ...b }`. The route's local `Beat` type
declared four fields, so the spread looked safe and the type checker had
nothing to say. Everything else on the beat was copied onto **both** halves:

- `audioStart`/`audioEnd` — both halves claim the same range of speech, so
  `build_cut` lays it down twice and **the line is spoken twice in the
  export**. Nothing on screen shows this until you watch the render.
- `holes` — a stretch removed from the head was also removed from the tail,
  where it does not exist; holes outside a half's range are ignored by
  `build_cut`, so half the cuts quietly came back.
- `fadeIn`/`fadeOut` — a fade in the middle of what had been one line.

**Fix** `lib/splitBeat.ts` divides rather than copies: head keeps the fade-in,
tail the fade-out, each hole goes to the half containing it (a straddling hole
is cut in two), and detached audio is divided at the same offset as the
picture.

**Regression** `tests/undo-round-trip.test.mts`, 5 cases. Board test S7 now
passes.

---

## BUG-005 — every JSON route 500s on a body of `null` · P2 · fixed

**Category** 019 failure/chaos

`JSON.parse("null")` succeeds — so do `7`, `"hello"`, `[]` and `true`. Ten
handlers caught the parse error and then read `body.something`, throwing a
TypeError that nothing caught: a 500 with a stack where a sentence belongs.

Affected: `pipeline` POST+PATCH, `beats` POST, `beats/[label]` PATCH,
`snapshots` POST, `graphics` POST+PATCH, `products` PATCH, `references` POST,
`trash` POST. `references` PUT threw on any non-multipart body.

**Fix** `lib/requestBody.ts` — `readJsonObject()`, applied to all of them;
`references` PUT catches a non-form body.

**Found by** the body-fuzz suite: 11 routes × 7 bodies.

---

## BUG-006 — `./scripts/test` said "all green" without running the bug board · P2 · fixed

**Category** test infrastructure

`scripts/test` globbed `tests/*.test.mts` only. `tests/regressions/` — the
board of reproduced, still-open defects — ran only under `./scripts/qa`. So
the command anyone reaches for first printed **all green** while two known
defects sat red beside it.

**Fix** the board is counted and reported separately, because a board test is
written to fail until its bug is fixed and so must not gate the suite. The
runner now says `2 still open (1 fixed)` under a green suite.

---

## LEDGER S1 — will not be implemented as written · resolved-as-wontfix

S1 asks the PATCH handler to merge a beat's extra fields back in from disk
when the client omits them. **It must not.** Undo's job is to restore a beat
to a state it held BEFORE an edit, and the commonest such edit is cutting a
hole; `pushHistory` runs before the cut, so the saved entry has no holes and
undo sends exactly that. A server merging holes back in from disk would make
**every cut permanent** — a worse bug, and much harder to see.

The loss S1 was written for is only reachable if `GET` drops a field, because
then the client never holds it. Verified it does not: 6 optional fields
round-trip GET → undo PATCH → disk. Pinned in
`tests/undo-round-trip.test.mts`, including that undo can *remove* a hole.

---

## BUG-007 — ten seconds of dead air in the middle of the cut · P1 · fixed

**Category** 021 export, 006 timeline
**Found** by opening `img-9817-v4.mp4` and measuring it. Nothing on any screen
showed this; the render "succeeded".

Measured 10.1 seconds of silence at 71.8s–82.0s of a 111-second TikTok, the
longest single stretch 7.06s.

**Root cause** `walk_pieces` in `build_cut.py` filtered detected pauses with
`x > s + 0.12 and y < e - 0.12` — the silence had to end **inside** the beat.
The beat `swear-by-glowing` ran 428.30–441.46, speech stopped at 430.2, and
the silence map had 430.246–**444.266**. It ran past the out-point, so the one
condition that mattered was the one that failed, and the pause was skipped
entirely.

A line ending in a long pause is the commonest shape there is — Whisper folds
the pause into the duration of the preceding word (the word ` of` was
timestamped **11.48 seconds**, exactly what CLAUDE.md warns about), so the
out-point routinely sits deep inside silence. It was the one shape that could
not be trimmed. A second guard, `ci >= tail - 0.18`, rejected it again in the
loop.

**Fix** the pause is CLIPPED to the line instead of required to fit inside it,
and a pause reaching the end moves the out-point — which is what the
hand-drawn-hole branch already did. The head keeps its guard: a silence
touching the in-point belongs to `snap()`, and trimming it here would cut into
the first word rather than in front of it.

**Proved, not asserted** — rebuilt on a scratch copy and rendered:

| | before | after |
|---|---|---|
| cut length | 111.02s | **99.39s** |
| longest silent stretch | **7.06s** | **0.00s** |
| total silence | 10.1s | **0.0s** |
| spoken words lost | — | **0** |

`swear-by-glowing` 12.45s → 1.98s. Three other beats tightened. Every word in
every beat still present, checked against the transcript.

**Regression** `ugc-edit-system/tests/test_pieces.py::TrailingPause`, 6 cases.

---

## BUG-008 — reading the review state destroyed it · P1 · fixed

**Category** 011 data integrity, 010 races
**Was** LEDGER S10, open.

`review-state.json` holds everything decided outside beats.json: take picks,
trim edits, cut regions, deleted lines, beat diagnoses, the cached scorecard.

`readJson()` returns the fallback for an unparseable file, so `loadReviewState`
handed back bare defaults — and `updateReviewState` wrote them straight back.
Two routes called `updateReviewState(p, () => {})` purely to **read** the
candidate cache, so opening the Takes panel on a project whose state file had
been truncated erased every decision in it *and overwrote the only copy*.

**Fix** `readJsonChecked` tells missing from broken; a broken file is renamed
to `review-state.json.corrupt-<timestamp>` and **kept**, the state carries a
`stateProblem` saying where it went, the two reads are reads, and an update
that changes nothing no longer writes.

**Regression** `tests/review-state-integrity.test.mts`, 17 cases.

---

## Instrument errors I made, and caught

Recorded because a QA pass that manufactures defects is worse than one that
misses them, and all three of these looked like findings.

1. **`astats=reset=N` counts audio frames, not seconds.** Reported "5239
   seconds" of a 111-second file and a "328s" silent run. Replaced with
   `silencedetect`, which reports real time ranges.
2. **Treated the transcript's top-level list as words.** It is a list of
   segments with nested `words`. Produced "34 of 34 beats are entirely
   silent", which was nonsense — corrected, every beat is 74%+ speech.
3. **`-ss` before `-i` is a keyframe seek.** Measured silence in the wrong
   part of a 4K source and drew the wrong conclusion from it.

## Not a defect, after measuring

**Rendered length exceeds the EDL by ~0.7s.** The EDL is written to 3dp;
video comes in whole frames, and each piece is quantised up to the next one.
Predicted half a frame per piece: 46 pieces → 0.77s, 47 → 0.78s. Observed
0.715s and 0.698s. That is frame quantisation, not drift. The check now allows
one frame per piece and fails beyond it.

---

## Open / not fixed

| # | What | Severity | Why not |
|---|------|----------|---------|
| — | proxy is 0.10s shorter than its source (40.07 vs 40.17) | P3 | Last partial frame. Seeks near the very end clamp. Not chased. |
