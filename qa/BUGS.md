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

## BUG-009 — one pause reported as two rows is never trimmed · P1 · fixed

**Category** 021 export, 006 timeline
**Found** by verifying the freshly-built `img-9823` — 3.48s of dead air.

`silencedetect` splits a long pause wherever the level twitches above the
threshold for a frame. The map had `449.948–450.635` and `450.635–454.219`:
the same silence, in two rows that touch exactly. `walk_pieces` trimmed the
first, resumed at its end, then rejected the second by the "too near the
resume point" guard (`co <= cur + 0.18`) — and 3.5 seconds of silence the map
had found and reported correctly went into the cut.

**Fix** rows that touch or overlap (≤0.02s) are merged into one silence,
in `load_silence` and again inside `walk_pieces`, which is the function that
must not be fooled. 0.02s only: a real breath between words is wider, and
merging across one would let the trim eat a word.

**A regression I caused and caught.** Merging was applied to BOTH maps at
first, including the strict −50dB map used for edge snapping. Its small gaps
are the soft consonants the snapping comment warns about, so merging across
one moved the in-point past the first word — it cut " This" off the front of
`literally` in img-9823. The strict map is now never merged. Caught by the
word-loss check, which is the reason that check exists.

**Proved** on scratch copies of both real projects:

| | img-9817 | img-9823 |
|---|---|---|
| length | 110.31s → **97.80s** | 182.67s → **177.30s** |
| longest silent stretch | 7.06s → **0.00s** | 3.48s → **0.00s** |
| spoken words lost | **0** | **0** |

**Regression** `ugc-edit-system/tests/test_pieces.py::SplitSilenceRows`, 5 cases.

---

## Not a defect — "19 missing words", retracted after measuring

`qa/verify_words.py` reported 19 words missing from img-9817, 18 of them the
first word of a beat. That is the signature of a clipped head, so it looked
like a serious find. It is not one.

Measured in the extracted audio:

| window | mean | max |
|---|---|---|
| " Not" 350.640–350.884, the part not rendered | **−71.9 dB** | −51.8 dB |
| 350.884–351.128, from the snap point | **−19.1 dB** | −4.2 dB |
| " And" 398.920–399.336, not rendered | **−70.5 dB** | −37.1 dB |
| 399.336–399.752, from the snap point | **−17.0 dB** | −4.0 dB |

The unrendered part of each word is silence. Whisper starts words early; the
silence map is right; `snap()` is doing exactly what CLAUDE.md says it should.
Nothing is clipped.

The tool now says so, and the absolute count is labelled an upper bound. The
mode that matters is `--against`, which compares two builds on identical
footing — it is what caught the real " This" regression above, and it reads
zero for both projects after the fix.

---

## BUG-010 — the word-level highlight never renders · P2 · OPEN

**Category** 014 beat/word row
**Status** confirmed, root cause not isolated, **not fixed**

He asked for the spoken word to animate in real time under the player, and
`DOCKET.md` lists it delivered: *"The lines carousel with playback, word lit
as spoken."* The **line**-level half works. The **word**-level half does not
render at all.

**Reproduction** Open a project's review screen, click a line with transcript
words in it (`good-thing-theres` has 15), let it play.

**Expected** the line splits into `<span class="wd">` per word, one carrying
`wd on`, moving as the words are spoken.
**Actual** zero `.txt-live` and zero `.wd` elements exist at any point, in
either player mode, playing or paused.

**Verified six ways**
- `.wd` count sampled every 300ms through playback: 0, every sample
- the same in "Rendered file" mode: 0
- paused with the playhead squarely inside a 15-word beat: 0
- DOM attribute diff over 1.8s of playback: the ONLY thing that changes is the
  timeline playhead's `left`
- the line-level `.beat.playing` class tracks correctly the whole time
- React fiber walked at runtime: **no hook holds a `{label, wordIx}` object**,
  so `spoken` is null

**What is NOT the cause** (each checked): the transcript is present (723
words, 15 in that beat); `beatsRef` is populated (ArrowDown selection works
off it); `liveMode` is true; the rAF loop is running (the playhead it drives
moves 256→303px over 1.8s); the player element is the one actually playing;
the render condition and the setter both survive minification intact.

**Why it is not fixed here** the line-level highlight is driven by `liveIdx`
and works. Guessing at the `spoken` path risks breaking the half that works,
for a cosmetic feature, at the end of a pass that changed the render. It wants
its own session with a breakpoint in the rAF loop.

This is the pattern `DOCKET.md` was written for: asked for, built as far as
code that looks right, wired to nothing, and nobody keeping score.

---

## BUG-011 — delete says it cut, and cuts nothing · P1 · fixed

**Category** 013 synchronised cut & delete, 018 UI state
**Reported by Kayer twice.** I told him it was fixed once, and it was not.

The first report was a real bug and a different one: `moved` lived on a state
object that mouseup read out of a stale closure, so the highlight was thrown
away as a click. That fix was right. It was not this.

**Reproduction** Open a line that already has a stretch cut out of it.
Highlight a region that falls inside that stretch. Press Delete.

**Expected** something, anything, that tells you what happened.
**Actual** the highlight vanishes, the line stays exactly as long as it was,
and the toast says *"Cut out 1.22s — the gap closed"*.

**Root cause** Every layer behaved correctly and the result was a lie.
`normaliseHoles` merges the new range into the hole already there, so the list
comes out identical; `saveBeats` skips the write because nothing changed —
which is right, it keeps the undo history clean; the route answers 200; and
the client clears the selection and reports a cut.

Skipping a no-op write is correct. **Reporting it as a cut is not.**

**Fix** `saveBeats` and `updateBeatRange` return whether they wrote. The route
answers `changed: false` with a reason. The client keeps the highlight where
it is — so it can be moved rather than re-drawn — and says *"that stretch is
already cut out"*.

**Verified in the running app, both ways**

| what was highlighted | holes | highlight | message |
|---|---|---|---|
| inside an existing hole | unchanged | **kept** | *that stretch is already cut out* |
| real footage between two holes | **cut** | cleared | *Cut out 0.49s — the gap closed* |

**Also covered** the head/tail trim path, which had the same shape: trimming
an edge to where it already is looked exactly like a trim that worked.

**Regression** `tests/silent-noop-edit.test.mts`, 7 cases, using the real
numbers from img-9817 beat 8.

**What I should have done the first time.** I reproduced the original bug with
a synthetic keydown on a beat with no holes, saw it work, and called it fixed.
The condition that makes it fail is the state his project was actually in.
A repro that does not match the reported conditions is not a repro.

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
3. **`-ss` before `-i` is a keyframe seek.** (Made twice.) Measured silence in the wrong
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
| BUG-010 | the word-level highlight never renders | P2 | Confirmed, root cause not isolated. Wants a breakpoint in the rAF loop; guessing risks the line-level highlight that works. |
| — | proxy is 0.10s shorter than its source (40.07 vs 40.17) | P3 | Last partial frame. Seeks near the very end clamp. Not chased. |
| — | the auto pipeline's review render is 720p and nothing on screen says so | P3 | Deliberate (minutes, not tens of minutes). But pressing Build gives full 4K and the two are not distinguished in the UI — worth a label. |
| S10..S15 | six items on `audits/LEDGER.md` | P2-P3 | Pre-existing board, untouched by this pass except S1 and S7. |

---

# Feature gauntlet — the `changed` / `unchanged` signal

Run against the feature added in `9b63ac8`. Three defects in the feature
itself, all fixed.

## BUG-F1 — a no-op trim taught the tuner · P2 · fixed

The trim path recorded `{startDelta: 0, endDelta: 0}` into `trimEdits`
whether or not an edge moved. That is the signal `learn_from_edits.py` reads,
so every trim-to-where-it-already-is dragged `snap_lead` and `snap_tail`
toward zero — invisibly, because the file does not change, so there is no
edit to look at and wonder about. **This learner has already run away once in
the other direction** (`snap_tail` reached 1.359 and left ten seconds of dead
air), which is what makes feeding it noise worth refusing.

Fixed: the learning entry is written only when something actually moved.

## BUG-F2 — the signal covered two write paths out of eight · P2 · fixed

The feature was applied where the bug was reported and nowhere else. The other
paths answered a no-op exactly as before:

| path | was | now |
|---|---|---|
| detached audio | no `changed` at all | reports, *"the audio is already there"* |
| relink audio to picture | no `changed` at all | reports |
| fades | no `changed` at all | reports, *"that fade is already set"* |
| reorder a line | no `changed` at all | reports, *"that line is already there"* |
| **cut a span out of the timeline** | no `changed` at all | reports, *"that stretch is already cut out"* |
| **undo** | no `changed` at all | reports, *"there was nothing to undo"* |

The span delete is the one that matters: it is the **same user action** as the
snippet delete, on the timeline instead, and it had the identical fault. Undo
is the quiet one — the history moved and the edit did not, and it said
*"Undid that trim"* either way.

## BUG-F3 — a no-op left a dead step on the undo stack · P3 · fixed

`pushHistory` runs before the write, so a no-op left an entry that undoes to
the state you are already in: press ⌘Z, nothing moves, and the edit you
actually wanted back is one press further away than it looks.

The entry is taken back when the write turns out to change nothing. And
because `pushHistory` declines on an empty beat list, it now returns whether
it pushed — a drop that assumed otherwise would eat somebody else's step. That
was a fault in my own fix, caught before it shipped.

## Verified in the running app

| sequence | result |
|---|---|
| drag inside an existing hole → Delete | holes unchanged, **highlight kept**, *"already cut out"* |
| then ⌘Z | **"Nothing to undo"** — no dead step was left |
| drag over real footage → Delete | hole added, highlight cleared, *"Cut out 0.59s"* |
| then ⌘Z | *"Undid cutting that bit out"*, holes **exactly restored** |
| **4 Deletes in one tick on one selection** | **one** hole, **one** snapshot, then *"already cut out"* |

Before the feature, that last row was four *"Cut out 0.55s"* toasts for one cut.

## Not tested

- **Visual QA of the toast** — the browser pane renders hidden in this
  session, so the message was read out of the DOM, not looked at.
- **The WKWebView itself** — every UI check ran in the in-app Chromium pane
  against the same server, not through the native wrapper.
