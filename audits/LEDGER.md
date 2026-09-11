# SnipAi QA ledger

**Scope: the SnipAi app** — `app/`, `lib/`, `native/`, `scripts/`, `tests/`,
root config. The `ugc-edit-system/` pipeline is out of scope; findings already
made there are kept at the bottom for reference and are not worked on unless
asked (`./scripts/qa --with-pipeline` re-enables its checks).

Every finding QA has confirmed, and what happened to it. This file is the
memory between runs — `/qa` reads it before reporting so it tells you what is
*new* instead of repeating itself, and updates it after.

**Status:** `open` · `fixed` (with date) · `wontfix` (a decision, not an
oversight) · `regressed` (was fixed, came back).
**Test:** the regression test that reproduces it. A test here that starts
passing means the bug is fixed — that is the signal to flip the row.

Run `./scripts/qa --regressions` to see the bug board. Run `/qa-fix S1 S2` to
work through them.

---

## Fix first

These are corrupting output or losing data today.

| ID | Where | Status |
|----|-------|--------|
| S1 | `api/projects/[project]/pipeline/route.ts:136` — undo strips holes, fades, detached audio | wontfix |
| S2 | `lib/jobs.ts:184` — `failJob` never persists | fixed |
| C1 | `Timeline.tsx:266` — the in-point drag runs away and collapses the clip | open |
| C2 | `review/page.tsx:1017` — every trim after the first is unundoable | open |
| T1 | `scripts/test:26` — a skipped suite reads as "all green" | fixed |
| S18 | `media/[...path]/route.ts:73` — 416 on a range ending past EOF; **no video plays anywhere in the app** | fixed |
| S19 | the step writing `cuts/*.mp4` — `moov` at end of file, so the export can never start streaming | fixed |
| E1 | beat out-points clip the final consonant of two lines (`under-eyes-looks`, `egf-going-improve`) | fix written, needs a real render to confirm |

Out of scope but still true: `snap_tail` was **reset to 0.01 on 2026-09-10**
(`~/Movies/SnipAi/state/tuning.json`, `overrides_seen: 0`), so P2's 0.881
poisoning is no longer live. P1's missing clamp is still unfixed, so nothing
stops it recurring the next time learning runs.

---

## Server — `app/api/**`, `lib/`

| ID | Where | Defect | Status | Test |
|----|-------|--------|--------|------|
| S1 | `pipeline/route.ts:136` | Beat rebuilt from a 4-field whitelist; undo drops `holes`, `audioStart`/`audioEnd`, `fadeIn`/`fadeOut` | **wontfix 2026-09-09** — merging from disk on undo would make every cut permanent. The live loss needs GET to drop a field; it does not (6 fields pinned round-tripping in `tests/undo-round-trip.test.mts`) | `tests/regressions/S1-*.test.mts` (kept red on purpose) |
| S2 | `lib/jobs.ts:184` | `failJob` is the one mutator that doesn't `persist()`; failed builds stay "running" everywhere else and then 409 the next build | fixed — `failJob` calls `persist()`; its regression test is green | `tests/regressions/S2-*.test.mts` |
| S3 | `projects/route.ts:68` | Upload buffered whole, twice, no size cap; a 1.4GB original OOMs and the catch then deletes the new project dir. **Stale** — commit `7d31529` ("Stop the import taking the machine down") replaced the real upload path with a 64KB-chunk stream; `DropZone.tsx` sends the raw/streamed request, not multipart. The bug still exists at `references/route.ts:60`, which is a separate, lower-traffic route | fixed — confirmed 2026-09-11 for the footage-import path; `references/route.ts:60` still open | no — needs a large-file harness |
| S4 | `lib/pipeline.ts:149`, `lib/jobs.ts:164` | Unbounded stdout accumulation over a 6-hour cap, and unbounded `job.log` re-serialised every 2s | open | no |
| S5 | `peaks/route.ts:39`, `beats/[label]/candidates/route.ts:26` | CWD-relative `projects/<name>` where every other caller passes an absolute path; take picker 422s after migration | open | yes, not yet written |
| S6 | `lib/pipeline.ts:32` | `spawnSync` + `import faster_whisper` on the request path of eight GETs, 60s cache | open | no |
| S7 | `beats/route.ts:87` | Split spreads holes and detached audio onto both halves; the line renders twice | **fixed 2026-09-09** — `lib/splitBeat.ts` divides instead of copying | `tests/regressions/S7-*.test.mts` (now green) + `tests/undo-round-trip.test.mts` |
| S8 | `beats/[label]/route.ts:136` | Trim never re-runs `normaliseHoles`; a hole can end up covering the whole beat | open | yes, not yet written |
| S9 | `projects/[project]/route.ts:148` | `cutTimeline` strips any `-<digits>`; real beats `hook-1`/`hook-2` collapse into one | open | yes, not yet written |
| S10 | `candidates/route.ts:20` | `updateReviewState(p, () => {})` is a full read-modify-write, so a GET rewrites `review-state.json` and can lose a concurrent write | **fixed 2026-09-09** — the reads are reads, a no-op update does not write, and an unreadable file is kept aside instead of replaced by defaults (it was destroying every take pick) | `tests/review-state-integrity.test.mts` |
| S11 | `filmstrip/route.ts:59` | Cache key omits the cut file; scrub v2, see v1's frames | open | yes, not yet written |
| S12 | `filmstrip/route.ts:32` | `count` never NaN-checked; `NaN` reaches argv and the cache key | open | yes, not yet written |
| S13 | `references/route.ts:143` | `measured.map((_, i) => files[i])` indexes the input array by output position; wrong files credited in `house-style.json` | open | yes, not yet written |
| S14 | `graphics/route.ts:232` | `g${Date.now().slice(-6)}` collides every 16m40s; deleting one graphic deletes both | open | yes, not yet written |
| S15 | six routes | ffmpeg/Whisper spawned without `runningJob()`; twelve filmstrips render at once on page load | open | no |
| S16 | `lib/projectSummary.ts:117` | Cut length ignores holes; `lib/snapshots.ts:129` subtracts them. Same edit, two durations | open | yes, not yet written |
| S17 | `products/route.ts:14` | `read()` swallows every error and returns `{products: []}`, which PATCH writes back over the catalogue | open | yes, not yet written |
| S18 | `media/[...path]/route.ts:73` | 416 for a range past EOF instead of clamping to `size - 1`. **Fixed 2026-09-11** — `end` now clamps to `stat.size - 1` before the bounds check runs, instead of being compared unclamped. Verified with a synthetic fixture, not real footage (an over-long range with an in-bounds start now serves 206 with a correctly clamped `Content-Range`; a start genuinely past EOF still 416s) | fixed 2026-09-11 | yes — `tests/regressions/S18-media-range-clamp.test.mts` |
| S19 | the step that writes the finished file into `cuts/` | Export muxed with `moov` **after** `mdat` (`cuts/img-9817-v6.mp4`: ftyp@0, free@32, mdat@40, moov@513655552 of 513MB). Nothing can begin playing without fetching the whole file. The proxy is written correctly (moov@32), so the two writers disagreed because only the proxy writer asked for faststart. **Fixed 2026-09-11** — `lib/pipeline.ts`'s concat step now passes `-movflags +faststart` alongside `-c copy` (a remux, not a re-encode — no quality or meaningful time cost). Verified on a synthetic concatenated file: moov moves from byte 69973 of 73091 to byte 32. `img-9817-v6.mp4` itself is unchanged — this only affects builds from here forward; rebuild it if you want this specific file corrected | fixed 2026-09-11 | yes — `tests/regressions/S19-concat-faststart.test.mts` |
| S20 | `projects/route.ts` (import) | `POST /api/projects` with an **empty body** returns bare `500` with an empty response — the only one of 13 endpoints probed that does not answer with `4xx` + `{"error": …}`. A malformed-but-present body on the same route correctly returns `400 {"error":"project name must be lowercase kebab-case"}`. Same route as S3 | open | yes, not yet written |
| S21 | queue listing vs project detail | Two overall scores for one project at the same moment: review screen `scorecard.overall = 53`, queue `scorecardOverall = 76`. 76 is exactly the `Word cutoffs` metric, so the queue looks to be reporting the first metric as the overall. Not user-visible on the card today; wrong wherever it is read. Sibling of S16 | open | yes, not yet written |
| S22 | queue listing vs review header | Flagged-line count disagrees three ways for `img-9817`: review pill and lines list say **12**, queue `flaggedBeatLabels` has **6**, `beats.json` entries marked `needs_review` is **0** | open | yes, not yet written |
| S23 | `lib/projectSummary.ts` (queue summary line) | A project with no transcript is counted as needing review. With a broken third project the line reads `3 projects · 3 need your review · 1 awaiting a beat draft` — the same project counted twice, once wrongly | open | yes, not yet written |

## Client — `app/**/*.tsx`

None of these are testable yet: there is no DOM harness in the repo. Adding one
(`jsdom` + a render helper) would make C1, C2, C8 and C16 straightforward, and
is worth doing before fixing them.

| ID | Where | Defect | Status |
|----|-------|--------|--------|
| C1 | `Timeline.tsx:266` | In-point drag computes its delta against `c.at`, which doesn't move, while `c.start` already did — the trim runs away and collapses the clip to 0.15s | open |
| C2 | `review/page.tsx:1017` | `trimTimer.current` is never reset, so `pushHistory` fires once per page load; every trim after the first is unundoable | open |
| C3 | `Timeline.tsx:85,689,695` | `fading` is set and never read; `onFade` is never invoked. The documented corner-drag does nothing | open |
| C4 | `review/page.tsx:812` | `cutAt` is unconditionally null outside live mode; ⌘B always refuses while watching the rendered cut | open |
| C5 | `review/page.tsx:862` | `M` in live edit reads source time and divides by cut duration; the marker lands off-screen | open |
| C6 | `GraphicsPanel.tsx:104` | Checks `status === "failed"`; the type is `"error"`. The real ffmpeg message is discarded | open |
| C7 | `review/page.tsx:915` | Self-rescheduling poll with no handle, no unmount cancel, and `if (!res.ok) return` — one 500 disables every build button until reload | open |
| C8 | `review/page.tsx:203` | "Cut this bit out" treats a highlight before the in-point as a head cut and *lengthens* the line | open |
| C9 | `review/page.tsx:878` | Untracked toast timers; a 900ms toast clears the 9s undo toast | open |
| C10 | `review/page.tsx:2058` | Undo button renders on any toast while `undo` is set; a trim's toast offers to undo a delete | open |
| C11 | `review/page.tsx:1096,174` | Both undo paths clear state before the request succeeds, with no rollback | open |
| C12 | `review/page.tsx:1187` | `removeMarker` clears all then re-POSTs from a stale closure; a removed marker comes back | open |
| C13 | `review/page.tsx:1590`, `Timeline.tsx:312` | Inline `stripUrlFor` in an effect's deps + a 60fps rAF re-render; filmstrips never update during playback | open |
| C14 | `VoiceInput.tsx:25` | `stop()` reads a ref assigned after `await getUserMedia`; the mic can stay live for the life of the page | open |
| C15 | `review/page.tsx:279` | `nextFlagged()` reads `analysis` from its TDZ; pressing `n` while loading throws | open |
| C16 | `review/page.tsx:730` | `Math.max(0, findIndex)` maps "nothing selected" to index 0; first ↓ selects line 2 | open |
| C17 | `LiveProgress.tsx:72` | Interval depends on `job`, whose identity changes every 900ms poll; the label never rotates | open |
| C18 | `Timeline.tsx:538` | "Zoom to clip" maps `findIndex` → `-1` onto the most zoomed-*out* level | open |
| C19 | review screen re-render after a state change | For ~1s after any edit (row select, ⌘Z) the top two-thirds of the viewport render empty — no header, no player, no timeline — with the lines list starting partway down. Resolves on the next render. Reproduced from two different actions. Screenshots: `qa-screenshots/bug-010-*.jpg` | open |
| C20 | the timeline band | Plain mouse wheel over the video track or waveform is swallowed: neither the page nor the timeline moves. The spec reserves **⌘+scroll** for zoom, which implies the plain wheel should scroll the page. The timeline is a tall band mid-screen, so scrolling down from the player stops dead and reads as a freeze | open |
| C21 | Settings → Editing preferences, **Add a rule** | Clicking **Save** with the field empty does nothing and says nothing — no rule, no toast, no validation, button not disabled. Violates the cross-cutting rule that an action changing nothing says so | open |
| C22 | `review/page.tsx:408-417` | **The page scrolls itself while your hands are off the mouse.** Reported by Kayer 2026-09-11 in his own words — "no more scrolling when I'm not scrolling" — and this is the second time: the `pointerDown` guard at `:429` and `:531` exists because of the first report, quoted in its own comment ("The screen won't stay put. I cannot work this way."). That guard fixed dragging and does not cover this, because a wheel or trackpad scroll is not a pointer-down. **Mechanism:** `yield4s` correctly hands the list over when you scroll, then four seconds later does **not** merely resume following — it fires `setFollowTick`, which actively pulls the view back to the spoken line. Its own comment says so: "pull the list back now, rather than waiting for the next line". So the sequence is: you scroll to read something, you stop, you read it, and four seconds later the page moves on its own. **Second half:** the follow effect at `:427` checks `spoken` and `followRef` but never whether the video is actually **playing**, so a paused project does this too, where following a "spoken" line means nothing at all. A video player hands back the controls by ceasing to hide them, not by seizing the view. | open |

## Native and shell — part of the app

| ID | Where | Defect | Status | Test |
|----|-------|--------|--------|------|

## Tooling

| ID | Where | Defect | Status |
|----|-------|--------|--------|
| T1 | `scripts/test:26` | A skipped suite still prints "all green". Note: the venv's `bin/python` is a symlink out to a system framework — it reads as missing from some contexts and is fine on the machine itself (`lib/paths.ts:30` documents this). Fix the reporting, not the detection | fixed — reports what did not run, and counts unittest's own skips too |
| T2 | `scripts/test` verdict line | Prints **"something is broken -- do not ship"** on a run with `# fail 0` and 173/173 passing. **Root cause found 2026-09-11, not T2 itself** — `scripts/guard-ledger.py` was setting `fail=1` on every run: it parses regression-test output for `✔ name`, the spec reporter's format, but its own `subprocess.run(capture_output=True)` pipes stdout, which Node never gives the spec reporter to — only tap (`ok N - name`). Zero matches every time, read as "cannot check the ledger," exit 1. **Fixed** — forced `--test-reporter=tap` and matched that format instead of guessing from TTY-ness. The verdict line itself was working correctly the whole time; it was reporting a real (if wrongly-caused) `fail=1` | fixed 2026-09-11 |
| T3 | `scripts/qa --full` | One run, two opposite verdicts: nested section prints "something is broken -- do not ship", the run then ends "notes above, nothing blocking" and exits 0. CI reading the exit code gets a third answer | open |
| T4 | `scripts/qa` pipeline stage | `skipped -- no venv at ugc-edit-system/.venv/bin/python` in this environment, so the Python pipeline is never exercised. The script is honest about it, but a clean run says far less than it appears to. See T1's note — the venv symlink reads as missing from some contexts. Either make setup guarantee it, or make the skip a hard failure | open |

## Edit quality — found by the looks gauntlet

| ID | Where | Defect | Status | Test |
|----|-------|--------|--------|------|
| E2 | `resolveSpanDelete` / `lib/timelineLayout.ts` | A span delete can leave a **surviving sliver of a line** rather than removing it. Found 2026-09-11 by `qa/gauntlet/looks.mts` from believable input: deleting 1.67-10.48s leaves `b2` at 0.170s; deleting 10.63-15.71s leaves `b4` at 0.236s (seeds 22075, 22077, 22084, 22097 — four in ~120). Two harms, and the second is the worse one. **On screen:** 0.170s is 4.3px at the default zoom (25px/s), under the ~6px a pointer can hit — you cannot grab it to fix or remove it without knowing to zoom in first, which is not a recovery path for damage you did not mean to do. **In the cut:** 170ms of a spoken line is not a line, it is a fragment of one syllable, and it renders into the finished video as a stutter. The arithmetic gauntlet passes all of these clean — `timeline.mts` asks whether the right number of seconds came out, which they did. Decide the rule: below some floor a remnant should be dropped whole rather than kept | open | yes — `qa/gauntlet/looks.mts`, category 022, reproduces at the named seeds |

## Repo hygiene — `snipai-release`

Not app defects. Tracked here anyway because until 2026-09-11 nothing in this
project owned them, so they were invisible to every run: no agent checked
them, no gate blocked on them, and the ledger did not know they existed.
`PROCESS.md` assigns them; `snipai-release` runs the checklist.

| ID | What | Status |
|----|------|--------|
| G1 | 9 commits sat unpushed — every fix from the 2026-09-11 session existed only on this Mac | open |
| G2 | `origin/qa/issues-3-4` and `origin/qa/issues-6-7` still on the remote, both merged into master | open |
| G3 | Four local branches (`qa/issue-9`, `qa/issues-1-5-8-10`, `qa/issues-3-4`, `qa/issues-6-7`), all merged, all still here | open |
| G4 | Five overlapping QA/spec docs at the repo root (`QA_BUGREPORT.md`, `QA_BUGREPORT2026-09-10.md`, `QA_REPORT_2026-09-10.md`, plus the spec and test plan), and the nightly run adds one per night with no retention rule | open |
| G5 | `QA_BUGREPORT.md` carries `/Users/kayer.arzadon-smith/...` paths — a real name in a tracked file, in a repo whose public/private status has not been confirmed | open |
| G6 | Whether `github.com/Kayerarzadon-smith/SnipAi` is public or private is unverified. If public, `DOCKET.md` is a narrative of everything Kayer has personally asked for, in public | open — needs Kayer, one look at the repo page |
| G7 | No CI: every gate ran only on this Mac. `.github/workflows/ci.yml` added 2026-09-11; it is inert until the first push | fixed 2026-09-11 — pending its first run |

**Checked and clean 2026-09-11**, so nobody re-audits it: no `.env`, no
credentials, no `.pem`/`.key` tracked, and no literal API keys anywhere.
`lib/imagegen.ts` reads provider keys from the environment on purpose, with a
comment saying why — "a key in one is a key in someone else's".

## Edit quality — the cut itself

| ID | Where | Defect | Status | Test |
|----|-------|--------|--------|------|
| E1 | beat out-point placement | Two beats end 20-30ms before their own final word finishes: `under-eyes-looks` leaves 26ms of `'this,'` past the out-point (mean -22.5dB, peak -12.4dB) and `egf-going-improve` leaves 21ms of `'face.'` (mean -22.9dB, peak -11.6dB), both above the project's -26.2dB speech floor. Both fragments sit **inside** their line, not past an abandoned take, so this is clipping and not take selection. `img-9823`'s two flagged fragments **are** take selection working and are not filed. Note `snap_tail` is **0.01** today, so this is not P2's 0.881 residue — the boundary placement itself is tight. **Traced 2026-09-11: not the boundary placement after all.** `edl.json` shows `snap()` already placed both out-points correctly, exactly on Whisper's own word-end timestamp (96.92, 164.02). The loss happens one step later, in `build_cut.py`'s per-clip ffmpeg extraction: `-ss <x> -i <source> -t <dur> -r 30 ...` truncates the re-encode to whole output frames, which can drop up to one frame (33ms at `-r 30`) off the requested tail — invisible when that frame was silence, audible when it held the end of a word. Both measured losses (26ms, 21ms) are under one frame. **Fix written, not render-verified** — `FRAME_PAD = 0.04` added to the requested `-t` duration (and threaded through the fade-out math so a fitted fade still lands on the true tail). Confirmed the corrected `-t` value reaches `extract.sh` (2.28→2.32, 3.22→3.26). Could not render a real sample tonight: pulling even 2.3s out of the 1.5GB source through this session's connection to the Mac timed out twice, likely that connection's own I/O to a large file rather than anything about the fix. Needs a real rebuild (which runs natively on the Mac, not through this connection, so should not hit the same wall) to confirm `qa/verify_edges.py` reports 0 of 34 | open | yes — `python3 qa/verify_edges.py --project <p>` already reproduces it; the fix is green when it reports 0 of 34 |

## Unused / dead

Rows marked *(pipeline)* are out of scope — listed so the sweep is complete.

| ID | What | Evidence | Status |
|----|------|----------|--------|
| U1 | *(pipeline)* `add_sfx.py`, `render_overlays.py`, `calibrate_silence.py`, `match_product.py` invoked by nothing | `./scripts/qa` sweep | open |
| U2 | *(pipeline)* `find_overlay_cues.py`'s CLI unused (survives as an import in `plan_graphics.py`) | grep | open |
| U3 | *(pipeline)* `tools/_superseded/` — seven files, no live reference except P4's broken ones | grep | open |
| U4 | `lib/paths.ts:64 DATA_IS_LEGACY`, `lib/jobs.ts:102 isBusy()` never referenced | grep | open |
| U5 | `GET /api/learn` (the dry run) — every caller sends POST. Nothing ever previews before applying, which is how P2 went unnoticed | grep | open |
| U6 | `scripts/make_icon.py` superseded by `scripts/build/make_icon.py` | grep + its own docstring | open |
| U7 | `native/snapshot.swift` not compiled by `bundle-app` | grep | open |
| U8 | *(pipeline)* `relocate.command`, `finish-move.command` migrate to `~/Movies/UGC Edit System`; `paths.ts:47` looks in `~/Movies/SnipAi` | grep | open |
| U9 | `review-state.beatDiagnoses` (the Level 3 store), `spanCuts`, `deletedBeats`, `statusNote` written, never read | `./scripts/qa --fast`. **Chased 2026-09-10 and cleared as a data-loss risk**: a live delete + ⌘Z showed `beats.json` is authoritative and correct (34 → 33 → 34, restored byte-identical). These four are an append-only audit log that also records *undone* actions, and nothing says so — `img-9817` lists `good-thing-theres` as deleted while it is still in the cut. Anyone auditing a project from its state file will read that as a delete-persistence bug. Worth a comment or a rename either way | open |
| U10 | `app/connectors/page.tsx:13` fetches `/api/projects` into state that is never read | grep | open |

## Half-built

| ID | What | Status |
|----|------|--------|
| H1 | Level 3 diagnosis — backend complete, no UI; the one client caller is the graphics panel borrowing the endpoint | open |
| H2 | Level 1 missing "Needs fixes" — the dashboard renders a status the review screen cannot produce | open |
| H3 | Level 2 reachable only by pressing `m` — no button, no tab | open |
| H4 | Detached audio — UI, API and `build_cut.py` all complete; `work/audio.sh` is never executed, and hardcodes `cuts/cut.mp4` | open |
| H5 | Learning loop applies silently with no ceiling and no preview (see P2, U5) | open |
| H6 | Connectors — eight hardcoded `not_connected` entries, GET only, modal says so | open |
| H7 | Products & links — the form writes a file only `match_product.py` reads, and nothing invokes it | open |
| H8 | Voice input works, mounted on the mic test and the graphic dialog — not on the two places NOTES.md describes | open |
| H9 | *(pipeline)* `plan_graphics.py:136` loads `reference/glossary.json` with no fallback and none ships; `ai_overlay` promises a drop-in path that does not exist | open |

## Bloat — decisions, not defects

Do not act on these without saying so first.

| ID | What | The argument | Status |
|----|------|--------------|--------|
| B1 | The timeline NLE (~a third of the client) | NOTES.md Level 2 asks for "mark roughly where it's wrong, no detailed diagnosis". CLAUDE.md §5 argues pads should be computed off word gaps, not eyeballed. Keep span-delete and the `[`/`]` nudge; question reorder, fades, detached audio, five zoom levels | open |
| B2 | The graphics subsystem (~1,300 lines) | `CLAUDE.md:30` — "No captions, no graphic overlays, no PIP" — is the measured style target. Either the feature or that line is wrong; both are live | open |
| B3 | *(mostly pipeline)* Nine `.command` scripts, three broken | Collapse to `setup.command` + `launch-snipai.command` | open |
| B4 | *(pipeline)* The drop-folder watcher | Even repaired, it is a second ingest path that bypasses review — the workflow SnipAi exists to replace | open |
| B5 | Four independent undo mechanisms | 60 snapshots + 5-day trash + in-page history + the delete toast, for one user editing one JSON file | open |
| B6 | Five settings tabs | Products feeds nothing; Profile is a hardcoded nameplate | open |

---

# Out of scope — the `ugc-edit-system` pipeline

Kept because they are real and were verified, not because they are queued. Run
`./scripts/qa --with-pipeline` to check them, and say so explicitly if you want
them fixed.

## Pipeline

| ID | Where | Defect | Status | Test |
|----|-------|--------|--------|------|
| P1 | `build_cut.py:227` | Out-point snapping has no clamp back to the original end, so a large `snap_tail` extends beats instead of tightening them | open | not yet — `snap()` is a closure inside `main()`; extracting it is part of the fix |
| P2 | `learn_from_edits.py:282` | Learned parameters floored at 0 and never capped; three trims poisoned `snap_tail` to 0.881 | open | not yet — the clamp is inline in `main()`; extracting it is part of the fix |
| P3 | `build_cut.py:61`, `draft_beats.py:106`, `list_candidate_takes.py:34`, `find_overlay_cues.py:37` | Paths joined off `CODE_ROOT` instead of `_paths.data_root()`; works in the repo, `FileNotFoundError` in the bundle | open | yes, not yet written |
| P4 | `process_inbox.sh:32`, `build-v7.command:5`, `CLAUDE.md:60,97` | Live entry points into `tools/_superseded/` | open | covered by `./scripts/qa --fast` |
| P5 | `build_cut.py:22`, `list_candidate_takes.py:53` | Silence regex can't match a negative `silence_start`; `zip` then shifts every pair | open | `ugc-edit-system/tests/regressions/test_P5_*.py` |
| P6 | `motion_graphics.py:143,146,149,181` | `drawbox` defaults to `eval=init`, so animated geometry freezes at t=0 and cards render zero-width behind the text | open | yes, not yet written (assert the filter string carries `eval=frame`) |
| P7 | `process_inbox.sh:9,12` | The `flock` guard returns 0 on both branches; processed files never leave `inbox/` | open | no |
| P8 | `build_cut.py:287` | Detached-audio offset computed against the unsnapped beat start; audio leads picture by the snap amount | open | yes, not yet written |
| P9 | `add_sfx.py:132,134` | `amix` without `normalize=0` halves every input; the voice comes out 6dB down | open | yes, not yet written |
| P10 | `add_sfx.py:43`, `compare_to_reference.py:30` | Blind `rsplit("-", 1)`; folds a real beat label into a piece suffix | open | `ugc-edit-system/tests/regressions/test_P10_*.py` |
| P11 | `native/main.swift:414` | No `didFailProvisionalNavigation`; a server that dies after the health check leaves the spinner forever | open | no |
| P12 | `native/main.swift:301` | `weStartedServer` set unconditionally; quitting can kill a terminal-launched server | open | no |
| P13 | `learn_from_edits.py:329,241` | `tuning["scoring"]` not `.get`, and a `.tmp` write with no `makedirs`; `--apply` dies on a fresh library | open | yes, not yet written |
| P14 | `calibrate_silence.py:105` | The floor picker can select the top of its own sweep, and the guard compares that entry against 35% of itself | open | yes, not yet written |
| P15 | `audio_peaks.py:54` | `sr // rate` floored, un-floored `rate` written to the JSON; ~1% drift at `--rate 120` | open | yes, not yet written |
| P16 | `scripts/bundle-app:73` | No `Info.plist` written or present; the bundle can't launch, and mic access with no usage-description string is a hard TCC crash | open | yes, not yet written |
| P17 | `finish-move.command:48` | `[ -f .../*.MOV ]` errors on more than one match, hidden by `2>/dev/null` | open | no |
| P18 | `align_reference.py:104` | `min()` on an empty list when nothing clears the correlation gate | open | yes, not yet written |
