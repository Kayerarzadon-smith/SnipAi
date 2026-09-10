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

Out of scope but still true, and still costing you output quality: the pipeline's
`snap_tail` is poisoned to 0.881 (P1/P2 below). One line of JSON to reset;
the clamp that stops it recurring is a pipeline change.

---

## Server — `app/api/**`, `lib/`

| ID | Where | Defect | Status | Test |
|----|-------|--------|--------|------|
| S1 | `pipeline/route.ts:136` | Beat rebuilt from a 4-field whitelist; undo drops `holes`, `audioStart`/`audioEnd`, `fadeIn`/`fadeOut` | **wontfix 2026-09-09** — merging from disk on undo would make every cut permanent. The live loss needs GET to drop a field; it does not (6 fields pinned round-tripping in `tests/undo-round-trip.test.mts`) | `tests/regressions/S1-*.test.mts` (kept red on purpose) |
| S2 | `lib/jobs.ts:184` | `failJob` is the one mutator that doesn't `persist()`; failed builds stay "running" everywhere else and then 409 the next build | fixed — `failJob` calls `persist()`; its regression test is green | `tests/regressions/S2-*.test.mts` |
| S3 | `projects/route.ts:68` | Upload buffered whole, twice, no size cap; a 1.4GB original OOMs and the catch then deletes the new project dir. Same at `references/route.ts:60` | open | no — needs a large-file harness |
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
| S18 | `media/[...path]/route.ts:73` | 416 for a range past EOF instead of clamping to `size - 1` | open | yes, not yet written |

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

## Native and shell — part of the app

| ID | Where | Defect | Status | Test |
|----|-------|--------|--------|------|

## Tooling

| ID | Where | Defect | Status |
|----|-------|--------|--------|
| T1 | `scripts/test:26` | A skipped suite still prints "all green". Note: the venv's `bin/python` is a symlink out to a system framework — it reads as missing from some contexts and is fine on the machine itself (`lib/paths.ts:30` documents this). Fix the reporting, not the detection | fixed — reports what did not run, and counts unittest's own skips too |

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
| U9 | `review-state.beatDiagnoses` (the Level 3 store), `spanCuts`, `deletedBeats`, `statusNote` written, never read | `./scripts/qa --fast` | open |
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
