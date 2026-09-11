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

**How rows are counted — one definition, settled 2026-09-10.** Two different
totals were circulating, which is how a ledger stops being trusted. The number
anyone quotes is the **finish-line count**: live rows (`open` + `regressed`,
excluding `fixed`, `wontfix` and `retired`) in **Server, Client, Native and
shell, Tooling, and the two Edit-quality sections** — the sections that stand
between the app and shipping. **Unused (U), Half-built (H), Bloat (B) and Repo
hygiene (G) are excluded**: each is its own milestone (M3, M4, M5) or its own
role's checklist, and folding them in inflates the number that is supposed to
mean "defects left". Pipeline (P) is quoted separately, never folded in. The
earlier "69" was every live row in the file; it was not wrong arithmetic, it
was the wrong denominator, and the finish-line count is the one that governs.

---

## Fix first

These are corrupting output or losing data today.

| ID | Where | Status |
|----|-------|--------|
| S1 | `api/projects/[project]/pipeline/route.ts:136` — undo strips holes, fades, detached audio | wontfix |
| S2 | `lib/jobs.ts:184` — `failJob` never persists | fixed |
| N1 | the app adopts any server already on port 4737 and **silently ignores `SNIPAI_DATA`** — a sandboxed run wrote into `~/Movies/SnipAi` on 2026-09-10 (footage verified intact) | fixed 2026-09-11 (`3725b35`) — **M0.6**, with P19 and T6 |
| T6 | `./scripts/qa --full` resolved `DATA_ROOT` to the real library and evicted his whole job history into `_test_*` fixtures | fixed 2026-09-11 (`02d1225`) — **M0.6** |
| S8 | `lib/beats.ts:88-90` — a trim can push a hole across the whole beat; the line then **silently disappears from the finished video** and is 0px wide on the timeline, so you cannot click it to find out why | open — **M0.75**, promoted 2026-09-10 |
| S25 | `lib/pipeline.ts:296` — "Plan graphics" a second time overwrites `work/graphics.json` whole: every hand-added graphic, every edited definition, every `verified` flag gone | open |
| C1 | `Timeline.tsx:298` — the in-point drag runs away and collapses the clip | fixed 2026-09-08 (`bb4bd5f`) |
| C2 | `review/page.tsx:1276` — a second trim started before the first PATCH returns gets no history entry | open — partial, the once-per-page-load half is fixed |
| T1 | `scripts/test:26` — a skipped suite reads as "all green" | fixed |
| S18 | `media/[...path]/route.ts:73` — 416 on a range ending past EOF; **no video plays anywhere in the app** | fixed |
| S19 | the step writing `cuts/*.mp4` — `moov` at end of file, so the export can never start streaming | fixed |
| E1 | beat out-points clip the final consonant of two lines (`under-eyes-looks`, `egf-going-improve`) | fixed 2026-09-10 on dev (26 clips, 0 short); packaged pending the rebundle — see T5 |

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
| S4 | `lib/pipeline.ts:183-184`, `lib/jobs.ts:197` and `:201-204` | Unbounded stdout accumulation over a 6-hour cap, and unbounded `job.log` re-serialised every 2s. Defect unchanged; line numbers corrected 2026-09-10 (`:149`/`:164` were stale) | open | no |
| S5 | `peaks/route.ts:56`, `beats/[label]/candidates/route.ts:40` | CWD-relative `projects/<name>` where every other caller passes an absolute path; take picker 422s after migration. **Already fixed and the row was stale for a day** — commit `8289149` ("Four tools were being handed a path that has not existed since the migration") fixed all four routes at once; both halves now pass `projectDir(project)` | fixed 2026-09-09 (`8289149`) | no — covered by the commit's own change |
| S6 | `lib/pipeline.ts:32` | `spawnSync` + `import faster_whisper` on the request path of eight GETs, 60s cache | open | no |
| S7 | `beats/route.ts:87` | Split spreads holes and detached audio onto both halves; the line renders twice | **fixed 2026-09-09** — `lib/splitBeat.ts` divides instead of copying | `tests/regressions/S7-*.test.mts` (now green) + `tests/undo-round-trip.test.mts` |
| S8 | `beats/[label]/route.ts:166` → `lib/beats.ts:88-90` | **A trimmed line can vanish from the finished video without saying so.** `updateBeatRange` sets `beat.start`/`beat.end` directly and never re-runs `normaliseHoles`, and the PATCH path validates only `end - start >= 0.15`. Beat 10.0-20.0 with hole `[12.0,18.0]`, trimmed to `{start:12.5, end:15.0}`, now has a hole covering the whole beat: `walk_pieces` emits nothing, so the line is absent from the cut while still sitting in `beats.json` looking fine, and `layout()` draws it 0px wide so it cannot be clicked to find out why. Cited `:136` was stale — that line is now a `catch`. **Promoted to Fix first 2026-09-10 and scheduled as M0.75** (see DOCKET); measured against NOTES.md's "drop in raw footage and it edits my TikToks", a line disappearing from the cut silently is close to the worst thing the app can do | open | yes, not yet written — reproducible in `lib/` with no server and no spawn |
| S9 | `projects/[project]/route.ts:148` | `cutTimeline` strips any `-<digits>`; real beats `hook-1`/`hook-2` collapse into one | open | yes, not yet written |
| S10 | `candidates/route.ts:20` | `updateReviewState(p, () => {})` is a full read-modify-write, so a GET rewrites `review-state.json` and can lose a concurrent write | **fixed 2026-09-09** — the reads are reads, a no-op update does not write, and an unreadable file is kept aside instead of replaced by defaults (it was destroying every take pick) | `tests/review-state-integrity.test.mts` |
| S11 | `filmstrip/route.ts:59` | Cache key omits the cut file; scrub v2, see v1's frames | open | yes, not yet written |
| S12 | `filmstrip/route.ts:32` | `count` never NaN-checked; `NaN` reaches argv and the cache key | open | yes, not yet written |
| S13 | `references/route.ts:166` | `measured.map((_, i) => files[i])` indexes the input array by output position; wrong files credited in `house-style.json`. Line corrected 2026-09-10 (`:143` was stale); the defect is exactly as written | open | yes, not yet written |
| S14 | `graphics/route.ts:236` | `` g${String(Date.now()).slice(-6)} `` collides when two adds land exactly 1,000,000ms apart; deleting one graphic deletes both. **Reclassified low 2026-09-10 (PM call), not scheduled** — it needs two `Date.now()` congruent mod 10⁶ms, ~0.02% over twenty adds in a session. It reads like data loss and is not one. Real, keep the row, fix it for free the next time anyone edits this file (a counter or `randomUUID().slice(0,8)`); do not spend a slot on it. The 100%-probability graphics data loss is S25, not this | open — low | no, and not worth one |
| S15 | six routes | ffmpeg/Whisper spawned without `runningJob()`; twelve filmstrips render at once on page load | open | no |
| S16 | `lib/snapshots.ts:120-131` | **Half fixed; rewritten 2026-09-10 to the surviving half.** The `projectSummary` half is gone — commit `a52aa3d` ("The Queue reports the length of the file, not the sum of the beat spans") made it `layout(...).total`, hole- and EDL-aware, and the old cited line `:117` is a comment now. What survives is `summarise()` in `lib/snapshots.ts`, which sums beat spans minus holes and **ignores the EDL entirely**: `img-9817` reads **126.3s** in the snapshot list against **98.0s** everywhere else in the app. One edit, two durations, still | open — partial | yes, not yet written |
| S17 | `products/route.ts:22-27` (read at `:50`, written at `:82`) | `read()` swallows every error and returns `{products: []}`, which PATCH then writes back over the catalogue. Lines corrected 2026-09-10 (`:14` is a type declaration); the defect is exactly as written | open | yes, not yet written |
| S18 | `media/[...path]/route.ts:73` | 416 for a range past EOF instead of clamping to `size - 1`. **Fixed 2026-09-11** — `end` now clamps to `stat.size - 1` before the bounds check runs, instead of being compared unclamped. Verified with a synthetic fixture, not real footage (an over-long range with an in-bounds start now serves 206 with a correctly clamped `Content-Range`; a start genuinely past EOF still 416s) | fixed 2026-09-11 | yes — `tests/regressions/S18-media-range-clamp.test.mts` |
| S19 | the step that writes the finished file into `cuts/` | Export muxed with `moov` **after** `mdat` (`cuts/img-9817-v6.mp4`: ftyp@0, free@32, mdat@40, moov@513655552 of 513MB). Nothing can begin playing without fetching the whole file. The proxy is written correctly (moov@32), so the two writers disagreed because only the proxy writer asked for faststart. **Fixed 2026-09-11** — `lib/pipeline.ts`'s concat step now passes `-movflags +faststart` alongside `-c copy` (a remux, not a re-encode — no quality or meaningful time cost). Verified on a synthetic concatenated file: moov moves from byte 69973 of 73091 to byte 32. `img-9817-v6.mp4` itself is unchanged — this only affects builds from here forward; rebuild it if you want this specific file corrected. **Confirmed on a real packaged artifact 2026-09-11**, no longer synthetic-only: a cut built by the rebundled app reads `ftyp@0 moov@32 free@15377 mdat@15385` — `moov` at byte **32**, where the pre-rebundle packaged build had it at byte 4,924,283 — with ffmpeg's own `Starting second pass: moving the moov atom to the beginning of the file` in the log | fixed 2026-09-11 — verified packaged | yes — `tests/regressions/S19-concat-faststart.test.mts` |
| S20 | `projects/route.ts` (import) | `POST /api/projects` with an **empty body** returns bare `500` with an empty response — the only one of 13 endpoints probed that does not answer with `4xx` + `{"error": …}`. A malformed-but-present body on the same route correctly returns `400 {"error":"project name must be lowercase kebab-case"}`. Same route as S3 | open | yes, not yet written |
| S21 | `lib/projectSummary.ts:145-146` | **Two overall scores for one project at the same moment.** Reproduced 2026-09-10 against the real library: `img-9817` queue **76** vs review **53**; `img-9823` queue **100** vs review **42**. **Mechanism rewritten — the old row sent you to the wrong line.** `:188` (`scorecardOverall: scorecard.overall`) is correct code and is not the bug. The queue builds its scorecard from **one** metric — `const metrics = [computeWordCutoffMetric(...)]` — and `buildScorecard` averages the non-null values, so the mean of a one-element list is that element. The review route builds four. The queue is not "reporting the first metric as the overall"; it never computes the other three. Not user-visible on the card today; wrong wherever it is read. Sibling of S16 | open | yes, not yet written — testable in `lib/` with no server and no spawn |
| S22 | `lib/projectSummary.ts:140-142` vs the review route | **Flagged-line count disagrees between the queue and the review screen.** Reproduced 2026-09-10: `img-9817` queue `flaggedBeatLabels` **6** vs review pill **12**; `img-9823` queue **0** vs review **20 of 61**. **The old row's third number was wrong and is dropped** — `needs_review` has never lived in `beats.json`. It lives in `work/beat-analysis.json`, which `projectSummary` never opens. The real disagreement is two-way: the queue counts word-boundary flags only (`computeWordBoundaryFlags`), the review pill is the union of those and the drafter's own flags | open | yes, not yet written |
| S23 | `app/dashboard/page.tsx:39-41` | **A broken project is counted twice in the queue summary line.** `3 projects · 3 need your review · 1 awaiting a beat draft` — the third project is in both numbers. **Re-pointed 2026-09-10: `lib/projectSummary.ts` does no counting**, the dashboard does. `brokenProject()` returns `cutStatus: "unreviewed"` and `beatCount: 0`, so it satisfies both `needsApproval` (`:39`) and `draftBeats` (`:41`). Decide which bucket a broken project belongs in — it is arguably neither | open | yes, not yet written |
| S24 | `app/api/projects/[project]/filmstrip/route.ts:51` | **A live, unlisted instance of the original S16 flaw.** When `end` is absent the cut's length falls back to `beats.reduce((s,b) => s + (b.end - b.start), 0)` — sum of beat spans, holes ignored, EDL ignored: **126.3** for a 98s file. And `end` is absent on the request that matters: `review/page.tsx:2106` omits it until `<video>` reports its duration, so **first paint** builds and caches a filmstrip sampled across 126.3s of a 98s file. Every frame is at the wrong time, and the cache key does not know it. Same wrong arithmetic as S16, third copy of it | open | yes, not yet written |
| S28 | `verify_cut.py`'s result vs the queue card | **A cut that FAILED verification scores 100 on its card.** Measured 2026-09-11 on the M0.5 re-run: `verify_cut.py` reported `FAIL -- 3 repeated phrase(s)` — `"and you can"` at 2.20s/3.14s, `"i swear this"` at 6.58s/7.78s, `"this stuff is i"` at 8.20s/12.94s — and the pipeline logged `VERIFY FAILED — a phrase repeats in this cut. It was still rendered`. The queue card for that same project reports `scorecardOverall: 100` and `flaggedBeatLabels: []`. The verifier ran, found real damage, said so in the log, and **nothing carried it to any surface the user looks at**. Same shape as the old "Word cutoffs 100% while splits landed inside words", and the third instance tonight of a check that reports success about something it did not measure. **Filed on its own, deliberately not merged into S21** — S21 is the queue averaging a one-element metric list, whereas this is a `verify_cut` result that reaches no scorecard at all. They may share a cause; let whoever takes them establish that rather than assume it | open | yes, not yet written |
| S26 | the card/timeline duration vs the rendered file | **The card's cut length is now systematically short of the file, and we caused it.** Card and timeline compute from the EDL; the render adds `FRAME_PAD` (0.04s) per clip. Measured 2026-09-10: long project card **43.2s**, EDL sum 43.206s, file **44.37s**; short project card **17.3s**, file **17.62s**. Drift is `0.04 × clip count`, so it grows with the edit — a 60-clip cut is 2.4s out. **Filed as a direct consequence of E1's fix, not a regression of `a52aa3d`**, so nobody re-opens S16 chasing it. Either the EDL sum accounts for the pad, or the pad moves into the EDL; the two must not disagree by construction | open | yes, not yet written |
| S27 | the `check`/scorecard path → `compare_to_reference.py` | **A caught traceback still reaches the job log and `stage`, and the recovery sentence blames the wrong thing.** With no `reference/house-style.json`, `compare_to_reference.py` prints a full `FileNotFoundError` traceback into `log` and then recovers with a sentence. Not fatal, and `done`/`100` is honest. But the scorecard's pacing note then reads **"needs a built cut to compare"** when a built cut exists — the real reason is the missing reference file. Two defects in one row: a handled error that looks unhandled in the log, and a user-facing message naming a cause that is not the cause | open | yes, not yet written |
| S25 | `lib/pipeline.ts:296`, dispatched from `graphics/route.ts:149-156` | **Pressing "Plan graphics" a second time destroys every hand-made graphic.** `runPlanGraphicsJob` runs `plan_graphics.py -o work/graphics.json` — the live plan file — and `plan_graphics.py:201` does `json.dump({...}, open(a.out,"w"))`: a fresh write, no merge, no read of what is there. Everything the user put in that file goes: every `action:"add"` graphic (`route.ts:255`), every edited `definition`, every `verified: true` (`:117`). No confirmation, no undo, no trash copy. Out-of-scope pipeline code writes the file, but **the decision to aim `-o` at the live plan with no merge is the app's**, so this row is in scope. Fix is app-side: plan to a scratch path and merge, keeping anything the user touched | open | yes, not yet written |

## Client — `app/**/*.tsx`

None of these are testable yet: there is no DOM harness in the repo. Adding one
(`jsdom` + a render helper) would make C2, C8 and C16 straightforward, and is
worth doing before fixing them. **One row the harness cannot retire: C20** —
see its own note.

**Line numbers audited 2026-09-10.** 17 of the 19 rows citing one had drifted;
only C14 and C22 were still accurate. All corrected below. If you are reading
a client row written before this date somewhere else, distrust its line.

### Root causes — the dispatch unit

The 22 rows are **six jobs**. The ids stay (each has its own exit condition,
and they are referenced from commits, branches and every prior QA run), but
nobody should be handed one row of a group in isolation — that is how you get
six half-fixes of one rule. Dispatch by group; verify by id.

| # | The one rule | Rows | Where it is broken |
|---|--------------|------|--------------------|
| CG1 | **The page does not move itself while you are reading.** | C22, C19 (retired into it), the row-click path | Three call sites — `page.tsx:437` `scrollBy`, `:536` `scrollIntoView`, `Timeline.tsx:364` `scrollIntoView` — one `pointerDown` guard that is wrong for all three (a wheel is not a pointer-down; a `click` fires after `mouseup`, so the guard is already false). The follow effect at `:427` also never checks whether the video is **playing** |
| CG2 | **A toast belongs to the action that raised it.** | C9, C10 | One global slot, untracked timers (`:1159-1161`), Undo button (`:2490`) gated on `undo` being set rather than on which toast is showing. Compound: delete a line (9s toast), press `L` — a 900ms toast replaces it and takes Undo with it 8.1s early; save a trim inside that window and its toast offers an Undo that resurrects the deleted line. Wants `{id, kind, message, expiresAt}` and one tracked timer |
| CG3 | **Write first, clear on success, roll back on failure.** | C11, C12, C23 | Destructive local state is cleared before the request is known to have worked, with no rollback, and one path re-POSTs from a stale closure |
| CG4 | **Live time and cut time are different clocks; convert, never assume.** | C4, C5 | Both converters already exist (`cutPlayhead` at `:1224`, `cutToSource` at `:443`). The keyboard handlers do not use them |
| CG5 | **One poll shape, with an unmount flag.** | C7, C6 | `pollBuild` and `GraphicsPanel.watch` are the same broken shape. `LiveProgress.poll` is the only one with an `alive` flag and is the one to copy |
| CG6 | **`Math.max(0, findIndex)` is not an index.** | C16, C18 | Same reflex twice: `page.tsx:1009` and `Timeline.tsx:609`. `-1` means "nothing", not "the first one" |

| ID | Where | Defect | Status |
|----|-------|--------|--------|
| C1 | `Timeline.tsx:298` | In-point drag computes its delta against `c.at`, which doesn't move, while `c.start` already did — the trim runs away and collapses the clip to 0.15s. **Already fixed and the row was stale for three days** — commit `bb4bd5f` ("Fix the five, and stop the app throwing you back to the raw footage") names it; the trim path is now absolute maths off a mousedown anchor (`drag.fromSrc + (t - drag.fromCut)`, anchors set at `:796`/`:801`), no reference to `c.at` survives in it, and `:93-101` carries the post-mortem comment | **fixed 2026-09-08** (`bb4bd5f`) |
| C2 | `review/page.tsx:1276` vs the comment at `:1284-1286` | **Downgraded to partial 2026-09-10.** The headline — "fires once per page load, every trim after the first unundoable" — is genuinely fixed: `:1287` clears the handle. What survives is that the comment is **wrong about its own code**. It says "Cleared before anything awaits", but the assignment at `:1287` is *after* `await fetch(...)` at `:1276`. So for the length of the PATCH round trip the already-fired handle is still truthy and `:1264`'s `if (!trimTimer.current) pushHistory(...)` skips. Repro: finish a handle drag, wait out the 420ms debounce, start a second drag before the PATCH returns — the second trim gets no history entry and ⌘Z steps straight past it | open — partial |
| C3 | `Timeline.tsx:314-331` | `fading` is set and never read; `onFade` is never invoked. The documented corner-drag does nothing. **Already fixed** — commit `bb4bd5f`. All three halves are connected: a live effect reads `fading` and calls `onFade` capped at `c.dur/2`, the grips set it at `:784`/`:790`, and the review page wires `onFade={setFade}` at `page.tsx:2048` → `:1313`. This is the fade handle from the docket's own cautionary tale; it is wired now | **fixed 2026-09-08** (`bb4bd5f`) |
| C4 | `review/page.tsx:1093`, `:1097` | **CG4.** `cutAt` is unconditionally null outside live mode; ⌘B always refuses while watching the rendered cut | open |
| C5 | `review/page.tsx:1143-1148` | **CG4.** `M` in live edit reads source time and divides by cut duration; the marker lands off-screen | open |
| C6 | `GraphicsPanel.tsx:106` | **CG5.** Checks `status === "failed"`; the type is `JobStatus = "running" \| "done" \| "error"` (`lib/jobs.ts:5`). The real ffmpeg message is discarded | open |
| C7 | `review/page.tsx:1196-1220`, and `:483` | **CG5. Blast radius widened 2026-09-10 — this is not only the build buttons.** Self-rescheduling poll with no handle, no unmount cancel, and `if (!res.ok) return`, so one 500 leaves `buildJobRef.current.status` stuck at `"running"` forever. `applyEditsSoon` at `:483` gates on exactly that (`if (buildJobRef.current?.status === "running") { applyEditsSoon(); return; }`) and re-arms every 6s — so **auto-apply dies too**, and keeps politely rescheduling itself for the life of the page. One dropped poll response and the app quietly stops applying your edits. Filed as one row rather than a sibling: same poll, same 500, same fix | open |
| C8 | `review/page.tsx:258`, `:266` | "Cut this bit out" treats a highlight before the in-point as a head cut and *lengthens* the line | open |
| C9 | `review/page.tsx:1159-1161` | **CG2.** Untracked toast timers; a 900ms toast clears the 9s undo toast | open |
| C10 | `review/page.tsx:2490` | **CG2.** Undo button renders on any toast while `undo` is set; a trim's toast offers to undo a delete | open |
| C11 | `review/page.tsx:203`, `:1412` | **CG3.** Both undo paths clear state before the request succeeds, with no rollback | open |
| C12 | `review/page.tsx:1525-1540` | **CG3.** `removeMarker` clears all then re-POSTs from a stale closure; a removed marker comes back | open |
| C13 | `review/page.tsx:2022-2028`, `Timeline.tsx:367-380` | Inline `stripUrlFor` in an effect's deps + a 60fps rAF re-render; filmstrips never update during playback | open |
| C14 | `VoiceInput.tsx:25` | `stop()` reads a ref assigned after `await getUserMedia`; the mic can stay live for the life of the page | open |
| C15 | `review/page.tsx:354` | `nextFlagged()` reads `analysis` from its TDZ; pressing `n` while loading throws | open |
| C16 | `review/page.tsx:1009` | **CG6.** `Math.max(0, findIndex)` maps "nothing selected" to index 0; first ↓ selects line 2 | open |
| C24 | `LiveProgress.tsx` phase table vs `job.stage` | **The progress caption reads "Working…" for most of every job.** `stage` carries the raw tool line, and during transcription that line is a timecoded transcript fragment matching no row in the phase table — e.g. `stage = "  14.92-  19.64: I've been using this stuff for like five months now…"`. Replayed 2026-09-10: **40 of 52 polls on dev, 50 of 64 packaged**, render "Working…". Percentage and ETA do move, so it is not dead, just mute. Same on both surfaces, so not a bundle problem. This covers the **longest phase of the product** — the docket lists "animated status bar, changing verbs — transcribing, snipping, editing, shrinking, rendering" as delivered, and for most of the wait it says none of them | open |
| C17 | `LiveProgress.tsx:72` | Interval depends on `job`, whose identity changes every 900ms poll; the label never rotates | open |
| C18 | `Timeline.tsx:609` (range `:604-613`) | **CG6.** "Zoom to clip" maps `findIndex` → `-1` onto the most zoomed-*out* level | open |
| C19 | — | Filed as "the top two-thirds of the viewport render empty for ~1s after any edit". **Misdescribed; retired into C22 2026-09-10 as CG1's third trigger.** QA opened both screenshots: `bug-010-blank-viewport-after-row-click.jpg` is not blank — it is beat rows 3-29 with row 3 clipped at the top, and the nav rail's "Kayer / Arzacorp" footer is visible in the undo shot. That is **a page scrolled down**, not an empty render. The suspected `!data` branch at `:1629` cannot be the cause either: `data` never goes null after first load, because `load()` at `:852` only assigns on `res.ok`. Real mechanism: `:529-538` calls `row.scrollIntoView({block:"center"})` and its `pointerDown.current` guard at `:531` is **already false by `click` time**, because `click` dispatches after `mouseup` and the guard is a capture handler on `mouseup` (`:504`). Click line 14 of 34, it centres itself, and the player and timeline go off the top of the screen. Nothing re-rendered empty; the page moved | retired → C22 |
| C20 | the timeline band | Plain mouse wheel over the video track or waveform is swallowed: neither the page nor the timeline moves. The spec reserves **⌘+scroll** for zoom, which implies the plain wheel should scroll the page. The timeline is a tall band mid-screen, so scrolling down from the player stops dead and reads as a freeze | open — **needs `snipai-tester`, not the harness** |

**C20 is the one client row a DOM harness cannot settle**, so it should not be
counted as M2 coverage. There is no plain-wheel swallow in `Timeline.tsx` —
`:340-342` returns before `preventDefault` unless `ctrlKey`/`metaKey`. The only
deliberate swallow in the client is `TrimWave.tsx:322-328`, which is the trim
wave **inside an open line**, not the timeline band. So either the report
misattributed which element ate the wheel, or something outside the React tree
did. Two runs in the real wrapper settle it: **(a)** no trim row open, wheel
over `.tl-video`; **(b)** the same with a trim row open, wheel over
`.trimwave`. If only (b) freezes, C20 is intended behaviour and the row gets
reworded or closed — not fixed.
| C21 | Settings → Editing preferences, **Add a rule** | Clicking **Save** with the field empty does nothing and says nothing — no rule, no toast, no validation, button not disabled. Violates the cross-cutting rule that an action changing nothing says so | open |
| C22 | `review/page.tsx:408-417` | **The page scrolls itself while your hands are off the mouse.** Reported by Kayer 2026-09-11 in his own words — "no more scrolling when I'm not scrolling" — and this is the second time: the `pointerDown` guard at `:429` and `:531` exists because of the first report, quoted in its own comment ("The screen won't stay put. I cannot work this way."). That guard fixed dragging and does not cover this, because a wheel or trackpad scroll is not a pointer-down. **Mechanism:** `yield4s` correctly hands the list over when you scroll, then four seconds later does **not** merely resume following — it fires `setFollowTick`, which actively pulls the view back to the spoken line. Its own comment says so: "pull the list back now, rather than waiting for the next line". So the sequence is: you scroll to read something, you stop, you read it, and four seconds later the page moves on its own. **Second half:** the follow effect at `:427` checks `spoken` and `followRef` but never whether the video is actually **playing**, so a paused project does this too, where following a "spoken" line means nothing at all. A video player hands back the controls by ceasing to hide them, not by seizing the view. **Marked `regressed` 2026-09-10, not `open`** — `yield4s`/`setFollowTick` was introduced by commit `bb4bd5f`, which describes it in its own message as a *feature*. This is not an old defect nobody got to; it is behaviour that was deliberately added and that Kayer then reported, for the second time. Read it that way when scheduling it. **Now CG1, and it absorbs C19 as its third trigger**: (1) wheel/trackpad scroll, then `setFollowTick` yanks the list back four seconds later; (2) the same while **paused**, where "the spoken line" means nothing; (3) clicking a beat row, where `:529-538`'s `scrollIntoView({block:"center"})` centres the row and pushes the player and timeline off screen, because the `pointerDown` guard is already false by `click` time. One rule, three call sites (`:437`, `:536`, `Timeline.tsx:364`), one guard that is wrong for all three. | **regressed** |
| C23 | `review/page.tsx:1405` | **CG3. Undo a delete in a reordered project and the line comes back in the wrong place.** `undoDelete` re-inserts at `beats.findIndex((x) => x.start > undo.beat.start)` — **source** order — but after a reorder the beat list is in **edit** order, and the two stopped agreeing. So the restore lands wherever source time says, which is not where the line was taken from. Undo that silently reorders the cut is worse than undo that fails, because nothing says it happened | open |

## Native and shell — part of the app

| ID | Where | Defect | Status | Test |
|----|-------|--------|--------|------|
| N1 | `native/main.swift` (server adopt/health-check path) + the bundled `next-server` lifetime | **A sandboxed run can write into the real library, and did.** The app adopts whatever server already holds port 4737 instead of starting its own, and when it adopts one it **silently ignores `SNIPAI_DATA`** — the log says nothing about not having started a server. Killing the wrapper does not stop the bundled `next-server`; it keeps running and keeps the port, so the next launch adopts it. Reproduced: kill the wrapper, relaunch with `SNIPAI_DATA=<sandbox>`, and `/api/projects` serves the **other** library's projects. **Not theoretical — it bit on 2026-09-10:** `~/Movies/SnipAi/state/jobs.json` was written at **22:27** during a run that was supposed to be sandboxed, and `~/Movies/SnipAi/projects/`'s own directory mtime moved in the same minute. **Footage verified intact** — img-9817 (34 beats) and img-9823 (61 beats) both whole, both raw files byte-identical and dated before that night, all six cuts present; nothing was damaged. The mechanism that could damage it is live. This is the **second** time a sandbox boundary has leaked into his real footage by a different route (the first turned a `touch` into a write through a symlink), which is what makes it a pattern rather than an incident. Standing order 3 is "never touch the footage"; this row is the one hole in it, and **every future QA and tester run's isolation guarantee rests on it**. **Jumped the queue 2026-09-10 as M0.6** — see DOCKET. **Fixed 2026-09-11 (`3725b35`), with P19 in the same commit** — the port identifies nobody, so the server now says who it is (`app/api/health/route.ts`: data root, code root, pid, `force-dynamic`) and `native/LaunchDecision.swift` decides on that rather than on the port. A server serving a different library is neither adopted nor killed: the launch refuses and shows both roots. Every outcome is logged — no silent adoption. `startServer()` also passes `SNIPAI_DATA` explicitly instead of letting the server re-derive it. Reproduced live on port 4999 (not 4737): before, `serverIsUp() && serverMatchesDiskBuild()` were both true against a foreign-library server, so the old code adopted it; after, refused and the server still alive | fixed 2026-09-11 | yes — `tests/regressions/N1-server-states-its-data-root.test.mts` (node) + `tests/native/launch-decision-probe.swift` (Swift, 21 checks, run by hand — `scripts/qa` does not compile Swift) |
| P11 | `native/main.swift:526-537` | **No `didFailProvisionalNavigation` in the delegate block** — only `didFail navigation:`, which fires for a navigation that has already *committed*. So a server that passes `serverIsUp()` and then dies before the load commits leaves the spinner forever, with no message. Lines corrected (`:414` was stale). **Cannot be automated at all** — it needs a server killed mid-load in the real window | open | no — and not automatable |
| P12 | `native/main.swift:374`, `:198` | `weStartedServer` set unconditionally; quitting can kill a terminal-launched server. **Already fixed as written** — `bootServerThenLoad` returns at `:364` on the adopt path, before reaching `:374`; `git blame` puts that early return in `77e2ae5` (2026-09-07). The quoted consequence cannot happen | **fixed 2026-09-07** (`77e2ae5`) | no |
| P19 | `native/main.swift:371` | **The app kills your dev server at launch.** In the same five lines P12 was cleared from, `:371` runs `shell("lsof -ti:\(kPort) -sTCP:LISTEN \| xargs kill 2>/dev/null")` **at launch**, against whatever holds the port, whoever started it. Failure: run `npm run dev`, edit anything, double-click `SnipAi.app` — the running dev server's BUILD_ID differs from `.next/BUILD_ID`, so the app kills it out from under you mid-session. **Dispatch with N1 (M0.6): same function, same region — but note they want opposite fixes.** N1 wants the app to stop *adopting* a stranger's server; P19 wants it to stop *killing* one. The reconciling rule is that the app may only start and stop a server it owns, and must say out loud what it found on the port | **fixed 2026-09-11** (`3725b35`, with N1) — that rule is now `native/LaunchDecision.swift`. Ownership is decided by finding our own bundled server path in the listener's command line, so `next dev` never matches; the launch-time kill is gone, and the only remaining signal is a SIGTERM to pids re-confirmed as ours immediately before sending it. `applicationWillTerminate` stops the `Process` handle we hold rather than whoever holds the port by then | yes — `tests/native/launch-decision-probe.swift` ("dev server, right library, older build -> adopt, never kill", plus six combinations asserting `restartOrphan` is unreachable without ownership) |
| P16 | `scripts/bundle-app:103` | **Rewritten 2026-09-11 — the row was misdescribed and the truth is worse.** Both stated consequences are false today: `SnipAi.app/Contents/Info.plist` exists (Sep 7, 1068 bytes) and does carry `NSMicrophoneUsageDescription`, so "the bundle can't launch" and "mic access is a hard TCC crash" are wrong. What is true: **nothing in the repo produces that file.** It is untracked (`.gitignore:17`), and `bundle-app:103` only removes `Resources/{server,pipeline,node}`, so it has survived seventeen rebundles by never being touched. **The bundle is not reproducible from a fresh clone** — which is `snipai-release`'s entire charter — and the artifact existed in exactly one place in the world while a rebundle was running. QA committed a copy to `scripts/build/Info.plist` (`cb9e463`) as a stopgap; `bundle-app` still neither writes nor verifies it. **The failure is invisible to every check that runs on this Mac**, because this Mac already has the file: without the plist, Finder refuses with `-10810`, but `exec Contents/MacOS/SnipAi` still works — and that is exactly how `qa-desktop-sandbox.command:8` launches it. So a check would report the bundle launching happily while a human double-clicking it cannot open it. This is the M5 case | open | yes, not yet written — assert `bundle-app` emits the plist and that the built `.app` contains it |
| P20 | `native/main.swift:454` | **The one error message the packaged app can show points at a file that does not exist.** `showFailure()` says *"Check ~/Projects/SnipAi/.snipai.log"* unconditionally, while `startServer()` at `:394-397` writes a bundled server's log to `~/Library/Logs/SnipAi/server.log`. On the machine of anyone who does not have the repo — which is every machine M5 is for — the app fails, names a path, and the path is not there | open | yes, not yet written |
| N2 | `scripts/bundle-app` → `Contents/Resources/pipeline-version.json` | The packaged bundle has **no `pipeline-version.json`**, so packaged builds stamp `work/pipeline.json` with `"version": 0` where dev stamps `2`, and `currentPipelineVersion()` returns 0 inside the app. `pipelineStale` is therefore **always false** in the shipped app: it can never say "this cut was built by an older version of the cutting" — at the exact moment that was true all night, while the bundle was three days behind the repo. The one warning designed for this situation is the one the bundle disables. **Confirmed end-to-end on the rebundled app 2026-09-11, and it is worse than filed — there are two halves, not one.** (a) `find SnipAi.app -name 'pipeline-version.json'` still returns nothing, and `work/pipeline.json` is stamped `{"version": 0}`. (b) The repo's own manifest reads `"version": 2, "changed": "2026-09-09"` — **it was never bumped for E1 either**, so even a bundle carrying the file would not flag anything. `GET /api/projects/m05-recheck` on the running packaged server → `cutStale: false`. **Consequence in plain terms: E1 is fixed for footage imported from now on and silently not applied to anything already in his library.** img-9817 and img-9823 were both built before `WORD_RESCUE`; neither will ever be flagged, and the "Rebuild — the cutting has improved since this was built" badge is the signal that would have told him. **Scheduled as M0.7** — both halves, or neither works | open | yes, not yet written — assert the bundle contains the manifest and that `cutStale` reads **true** on a pre-fix cut |

## Tooling

| ID | Where | Defect | Status |
|----|-------|--------|--------|
| T1 | `scripts/test:26` | A skipped suite still prints "all green". Note: the venv's `bin/python` is a symlink out to a system framework — it reads as missing from some contexts and is fine on the machine itself (`lib/paths.ts:30` documents this). Fix the reporting, not the detection | fixed — reports what did not run, and counts unittest's own skips too |
| T2 | `scripts/test` verdict line | Prints **"something is broken -- do not ship"** on a run with `# fail 0` and 173/173 passing. **Root cause found 2026-09-11, not T2 itself** — `scripts/guard-ledger.py` was setting `fail=1` on every run: it parses regression-test output for `✔ name`, the spec reporter's format, but its own `subprocess.run(capture_output=True)` pipes stdout, which Node never gives the spec reporter to — only tap (`ok N - name`). Zero matches every time, read as "cannot check the ledger," exit 1. **Fixed** — forced `--test-reporter=tap` and matched that format instead of guessing from TTY-ness. The verdict line itself was working correctly the whole time; it was reporting a real (if wrongly-caused) `fail=1` | fixed 2026-09-11 |
| T3 | `scripts/qa --full` | One run, two opposite verdicts: nested section prints "something is broken -- do not ship", the run then ends "notes above, nothing blocking" and exits 0. CI reading the exit code gets a third answer | open |
| T4 | `scripts/qa` pipeline stage | `skipped -- no venv at ugc-edit-system/.venv/bin/python` in this environment, so the Python pipeline is never exercised. The script is honest about it, but a clean run says far less than it appears to. See T1's note — the venv symlink reads as missing from some contexts. Either make setup guarantee it, or make the skip a hard failure | open |
| T5 | `scripts/bundle-app` | **The bundle can ship without the fixes and nothing checks.** `bundle-app` has no verification that what it produced contains what the repo has. On 2026-09-10 `SnipAi.app` was **three days stale** and no gate noticed: `Contents/Resources/pipeline/tools/build_cut.py` had no `FRAME_PAD` (mtime Sep 9 23:10), `grep -rl faststart Contents/Resources/server/` returned nothing, and the packaged media route still 416'd a range past EOF (`bytes=0-99999999` → **416** packaged, **206** dev). So E1, S18 and S19 were all fixed in the repo and all **absent from the app Kayer opens** — a cut the packaged app built that night came out `moov`-last (`ftyp@0 free@32 mdat@40 moov@4924283`) with three of seven clips short. One cause, three findings. Filed as a row rather than a docket item because it is a **missing gate**, and PROCESS.md assigns gates; it belongs on `snipai-release`'s checklist. The guard is cheap: assert the bundled `build_cut.py` and server carry a couple of marker strings the repo has. Answering PROCESS.md's retro question — yes, worth building, and it would have caught all three | open |
| T6 | `lib/paths.ts:55-60` via `tests/register.mts` | **`./scripts/qa --full` wrote the real library, and it destroyed his build history.** `resolveDataRoot()` falls back to `~/Movies/SnipAi` whenever `SNIPAI_DATA` is unset and `projects/` exists — right for the app, lethal for a test run, which is the same import. `tests/job-stage.test.mts` persists five jobs through `lib/jobs.ts` into a store capped at 40, so every `--full` run evicted the five oldest **real** records. After eight runs all 40 entries were `_test_*` fixtures (5 project names × 8 each, confirmed). This is the mechanism behind the 22:27 write in N1. **Fixed 2026-09-11** (`02d1225`) at the seam rather than in the gate: `tests/register.mts` is loaded by every route into the suite (`scripts/test`, `scripts/qa`, `scripts/guard-ledger.py`) and by nothing the app ships, and a run that skips it cannot resolve `@/` at all — so there is no third door. Setting `SNIPAI_DATA` in `scripts/qa` was rejected: besides being forgettable, it would have **blinded the "learned parameters in range" guard**, which reads that variable to find the *real* `tuning.json` on purpose. Proof: `env -u SNIPAI_DATA ./scripts/qa --full` now leaves `state/*.json` and all three `beats.json` byte-identical by sha256, with `projects/` mtimes unmoved. Test: `tests/regressions/T6-test-run-never-resolves-real-library.test.mts` | fixed 2026-09-11 |
| T7 | `scripts/qa:regressions()` | **The bug board prints nothing.** `./scripts/qa --regressions` — the command the ledger header tells you to run — greps node's output for `^ok` / `^not ok`, but **Node 24 uses the spec reporter (`✔ name`) even when stdout is piped**, so nothing ever matches and the section renders as an empty list under its own heading. Verified 2026-09-11: the board has 12 tests, the section shows 0. **This is T2's root cause in a second location** — `guard-ledger.py` had exactly this bug and was fixed by forcing `--test-reporter=tap`; `scripts/qa` was never given the same treatment. One-line fix, same as T2's | open — **proposed 2026-09-11**, found while fixing T6 |
| T8 | `scripts/guard-ledger.py:48` | **The ledger/board agreement guard only sees `S` rows.** Its regex is `^(not ok\|ok)\s+\d+\s+-\s+(S\d+):`, so every `C`, `N`, `P`, `T` and `E` regression test is invisible to it. It reported "the ledger agrees with all 5 regression tests" on a run where the board held 12 across three id families. The guard exists precisely because nobody remembers to flip a row (its own docstring tells the S2 story) — and it cannot check two thirds of the board. Widen to `[A-Z]+\d+` | open — **proposed 2026-09-11**, found while fixing N1/T6 |
| T9 | `qa-launch.command:5`, `qa-desktop-sandbox.command:5`, `qa-rebuild-and-launch.command:16` | **The QA sandbox lives inside the library it is sandboxing from.** All three export `SNIPAI_DATA="$HOME/Movies/SnipAi/qa-sandbox"`. `PROJECTS_ROOT` then lands at `~/Movies/SnipAi/qa-sandbox/projects`, so his own `projects/` is not written *directly* — but the isolation boundary is a subdirectory of the thing it is meant to exclude, which means every tool, backup sweep and `rm -rf` that takes `~/Movies/SnipAi` wholesale spans both, and `~/Movies/SnipAi/` shows `qa-sandbox` and `qa-sandbox-m05` sitting beside `projects/` today. Given that the **first** boundary leak on this project turned a `touch` into a write to his footage through a symlink, a sandbox nested in the real library is the wrong shape even where the path arithmetic happens to work. Move it under the OS temp dir or `~/Movies/SnipAi-qa`, outside the library root | open — **proposed 2026-09-11**, found while fixing N1/T6 |
| T10 | `stop-snipai.command:28-34` | **Same "the port is our server" fallacy N1/P19 was just fixed for.** It runs `lsof -ti:4737 -sTCP:LISTEN \| xargs kill`, then escalates to `kill -9`, against whoever holds the port — a dev server, or any unrelated program that happened to bind 4737. Lower stakes than P19 because a person ran it deliberately, but the mechanism to do it correctly now exists: `/api/health` reports the server's pid and data root, so this can stop a SnipAi server and only a SnipAi server | open — **proposed 2026-09-11**, sibling of P19 |

## Edit quality — found by the looks gauntlet

| ID | Where | Defect | Status | Test |
|----|-------|--------|--------|------|
| E2 | `resolveSpanDelete` / `lib/timelineLayout.ts` | A span delete can leave a **surviving sliver of a line** rather than removing it. Found 2026-09-11 by `qa/gauntlet/looks.mts` from believable input: deleting 1.67-10.48s leaves `b2` at 0.170s; deleting 10.63-15.71s leaves `b4` at 0.236s (seeds 22075, 22077, 22084, 22097 — four in ~120). Two harms, and the second is the worse one. **On screen:** 0.170s is 4.3px at the default zoom (25px/s), under the ~6px a pointer can hit — you cannot grab it to fix or remove it without knowing to zoom in first, which is not a recovery path for damage you did not mean to do. **In the cut:** 170ms of a spoken line is not a line, it is a fragment of one syllable, and it renders into the finished video as a stutter. The arithmetic gauntlet passes all of these clean — `timeline.mts` asks whether the right number of seconds came out, which they did. Decide the rule: below some floor a remnant should be dropped whole rather than kept | open | yes — `qa/gauntlet/looks.mts`, category 022, reproduces at the named seeds |
| E3 | `ugc-edit-system/CLAUDE.md:30` | **The app scores his cuts against a rule the app itself breaks.** That line says "No captions, no graphic overlays, no PIP", and it is not a comment — it is the measured house-style target the scorecard's Pacing/style scoring reads. Meanwhile the graphics subsystem (~1,300 lines, six card kinds) is live and he uses it. Filed as bloat B2 on the theory one of them had to go. **Kayer decided 2026-09-11: the graphics stay, the rule was wrong.** So this is now a defect, not a decision — rewrite `CLAUDE.md:30` to allow overlays so cuts stop being penalised for a feature he deliberately built and wants. Before changing it, grep for every reader of that doc: the scoring path is the known one, and a house-style template built from reference videos also measures against it | open | yes, not yet written — assert a cut carrying graphics is not marked down for carrying them |

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
| E1 | beat out-point placement | Two beats end 20-30ms before their own final word finishes: `under-eyes-looks` leaves 26ms of `'this,'` past the out-point (mean -22.5dB, peak -12.4dB) and `egf-going-improve` leaves 21ms of `'face.'` (mean -22.9dB, peak -11.6dB), both above the project's -26.2dB speech floor. Both fragments sit **inside** their line, not past an abandoned take, so this is clipping and not take selection. `img-9823`'s two flagged fragments **are** take selection working and are not filed. Note `snap_tail` is **0.01** today, so this is not P2's 0.881 residue — the boundary placement itself is tight. **Traced 2026-09-11: not the boundary placement after all.** `edl.json` shows `snap()` already placed both out-points correctly, exactly on Whisper's own word-end timestamp (96.92, 164.02). The loss happens one step later, in `build_cut.py`'s per-clip ffmpeg extraction: `-ss <x> -i <source> -t <dur> -r 30 ...` truncates the re-encode to whole output frames, which can drop up to one frame (33ms at `-r 30`) off the requested tail — invisible when that frame was silence, audible when it held the end of a word. Both measured losses (26ms, 21ms) are under one frame. **Fix written, not render-verified** — `FRAME_PAD = 0.04` added to the requested `-t` duration (and threaded through the fade-out math so a fitted fade still lands on the true tail). Confirmed the corrected `-t` value reaches `extract.sh` (2.28→2.32, 3.22→3.26). Could not render a real sample tonight: pulling even 2.3s out of the 1.5GB source through this session's connection to the Mac timed out twice, likely that connection's own I/O to a large file rather than anything about the fix. Needs a real rebuild (which runs natively on the Mac, not through this connection, so should not hit the same wall) to confirm `qa/verify_edges.py` reports 0 of 34. **Confirmed by a real render 2026-09-10 — and the stated test was the wrong test.** `qa/verify_edges.py` reads `work/edl.json`, `work/transcript.json` and the source audio; **it never opens a rendered clip.** E1's truncation happens *downstream* of the EDL, in ffmpeg's per-clip re-encode, so the tool reports clean with or without `FRAME_PAD` — and did report clean on a packaged build that was demonstrably still clipping. It could never have proven this fix. What actually proves it is measuring each rendered clip's real duration against its requested `dur`: **dev, +0.037s to +0.059s across all 26 clips, 0 short.** The packaged app measured 3 of 7 clips short only because the bundle was three days stale and had no `FRAME_PAD` at all (see T5) — a packaging failure, not this one | fixed 2026-09-10 (dev-verified by real render; packaged pending the rebundle) | **replaced** — not `verify_edges.py`. Measure each rendered clip's duration against its requested `dur`; green when none is short |

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
| B1 | The timeline NLE (~a third of the client) | NOTES.md Level 2 asks for "mark roughly where it's wrong, no detailed diagnosis". CLAUDE.md §5 argues pads should be computed off word gaps, not eyeballed. Keep span-delete and the `[`/`]` nudge; question reorder, fades, detached audio, five zoom levels | **wontfix 2026-09-11 — kept by decision.** Kayer asked for the full app with all of his features; the timeline stays. Not an oversight — a decision, and not to be re-litigated. |
| B2 | The graphics subsystem (~1,300 lines) | `CLAUDE.md:30` — "No captions, no graphic overlays, no PIP" — is the measured style target. Either the feature or that line is wrong; both are live | **wontfix 2026-09-11 — kept by decision.** Superseded by his call on `CLAUDE.md:30`: the graphics subsystem stays and the house-style rule was the thing that was wrong. See the E3 row — the rule must be rewritten so the scorecard stops penalising a feature he deliberately built and wants. |
| B3 | *(mostly pipeline)* Nine `.command` scripts, three broken | Collapse to `setup.command` + `launch-snipai.command` | open |
| B4 | *(pipeline)* The drop-folder watcher | Even repaired, it is a second ingest path that bypasses review — the workflow SnipAi exists to replace | open |

**Open question for Kayer — B3 + B4, the drop-folder ingest. Delete it, or
repair it?** Raised 2026-09-11; **not covered by the standing order**, which
names B1, B2, B5 and B6 as kept-by-decision and is silent on these two, so
this is genuinely undecided rather than re-litigation.

What is true today: the drop-folder path is broken end to end, not
degraded. `process_inbox.sh:32` calls `tools/auto_edit.py`, `build-v7.command:5`
calls `tools/tune_and_build.py`, and `CLAUDE.md:60`/`:97` name two more — **all
four exist only in `tools/_superseded/`** (P4). On top of that, P7's `flock`
guard returns 0 down both branches because macOS has no `flock`, and the loop
never `mv`s or `rm`s anything out of `inbox/`, so every tick reprocesses every
file forever. Nothing here has worked for some time and nothing noticed.

**Recommendation: delete it.** Repairing P7's lock inside a script whose only
tool call is a dead path is work spent on a second way into the app that
skips the review flow — and the review flow is what SnipAi *is*. He already
has drop-in ingest through the dashboard, which is M0 and which he uses; this
is the pre-SnipAi workflow surviving underneath it. Deleting it also closes
most of B3's nine `.command` scripts for free.

**The counter-argument, so he is choosing and not just agreeing:** a watched
folder is genuinely less friction than opening the app, and if what he wants
is "footage appears, cut appears, I review later", that is a real workflow and
not a bug. If he says that, the answer is not to repair `process_inbox.sh` but
to point a watcher at the dashboard's own import path, so there is still one
ingest and one review flow.
| B5 | Four independent undo mechanisms | 60 snapshots + 5-day trash + in-page history + the delete toast, for one user editing one JSON file | **wontfix 2026-09-11 — kept by decision.** All four undo mechanisms stay. He asked for everything. |
| B6 | Five settings tabs | Products feeds nothing; Profile is a hardcoded nameplate | **wontfix 2026-09-11 — kept by decision.** All five settings tabs stay. He asked for everything. |

---

# Out of scope — the `ugc-edit-system` pipeline

Kept because they are real and were verified, not because they are queued. Run
`./scripts/qa --with-pipeline` to check them, and say so explicitly if you want
them fixed.

## Pipeline

**Audited 2026-09-11. Only P6 is on a shipped, wanted feature.** QA grepped
`lib/` and `app/` for every tool name in this section; `motion_graphics.py` is
the only one that comes back (`lib/pipeline.ts:315`, the live "Render graphics"
job). P9 (`add_sfx`), P14 (`calibrate_silence`), P18 (`align_reference`) and
P3's survivor (`find_overlay_cues`) are all in tools the app never invokes —
they are U1/U2's territory, and fixing them buys nothing a user can see.
**P6 is scheduled; the rest wait for M4**, when the keep/cut answers land.

**Dispatch groups** (named `PG` so they do not collide with repo hygiene's
`G1-G7`):

| # | The one rule | Rows |
|---|--------------|------|
| PG1 | **Clamped at write *and* at read.** P2 now clamps on the way in; P1's read side has no bound at all, so at P2's own 0.35 ceiling the out-point still walks outward into the next take, ×34 beats. Fix one and you have fixed neither. Pull `snap()` out of `main()` while in there — it is the stated blocker on both tests | P1, P2 |
| PG2 | **A fresh install resolves every path.** All three are `snipai-release`'s, not the pipeline's, and all three are invisible on this Mac because this Mac already has the artifacts | P13's survivor, N2, P16 |
| PG3 | **One parser, three copies.** Both have red tests already, and the corrected implementation exists in one of the files | P5, P10 |
| PG4 | **The drop-folder ingest.** Not a fix — a question for Kayer. See the note under Bloat | P4, P7, B3, B4 |
| PG5 | **ffmpeg defaults that silently do nothing.** Do P6 only; P9's tool is uninvoked | P6, P9 |

**Test-provability, because it changes who proves them.** Automatable today:
P1, P2, P3, P4, P8, P13, P14, P15, P17, P18. Already automated and red: P5,
P10. **Needs a real render and would pass a string assertion while still
broken: P6 and P9** — that is the `verify_edges.py` trap a second time, so
treat a green string test on either as no evidence. Not automatable at all:
P11.

**Leave this alone:** P5 and P10's regression tests are invisible to
`scripts/test` because `unittest discover` cannot import `tests/regressions`
(no `__init__.py`), and `scripts/qa --regressions` runs them file-by-file with
a comment saying exactly why. That is deliberate and correct — the bug board
is not the suite.

| ID | Where | Defect | Status | Test |
|----|-------|--------|--------|------|
| P1 | `build_cut.py:386`, `:389` | Out-point snapping has no clamp back to the original end, so a large `snap_tail` extends beats instead of tightening them. Lines corrected (`:227` was stale). **Read this with P2** — P2 now clamps on the way *in*, but the read side here has no bound at all, so even at P2's own 0.35 ceiling the out-point still moves outward into the next take, ×34 beats. Fix one and you have fixed neither | open | not yet — `snap()` is a closure inside `main()`; extracting it is part of the fix |
| P2 | `learn_from_edits.py:364`, `:375` | **Partial.** Learned parameters floored at 0 and never capped. Commit `9752e80` added the `LIMITS` ceiling, with the 1.359s incident quoted in its comment — `snap_tail` can no longer be poisoned, which was the original failure. Still uncapped at `:375`: `tuning["scoring"][...] = round(max(0.0, cur + delta), 3)`, no `LIMITS` entry. The surviving failure is slower and quieter than the original: repeatedly pick a take carrying an `internal_repeat` flag, `penalty_internal_repeat` climbs past 1.0 after ~10 runs, nothing clears `min_confidence: 0.7`, and **the take picker silently stops recommending anything** for any beat with a repeat flag. Nothing says it has stopped | open — partial | not yet — the clamp is inline in `main()`; extracting it is part of the fix |
| P3 | `find_overlay_cues.py:37` | Paths joined off `CODE_ROOT` instead of `_paths.data_root()`. **3 of 4 fixed** by `9752e80` — the Python counterpart of `8289149`, one commit, all at once. The survivor is line-accurate but **dead code**: `plan_graphics.py:28` sets its own `DEFAULT_GLOSSARY` via `data_path`, and the stale constant is reachable only through a CLI that is already U2 "unused". Fix it for free if you are in the file, or delete the file; do not spend a slot | open — dead code | no, and not worth one |
| P4 | `process_inbox.sh:32`, `build-v7.command:5`, `CLAUDE.md:60,97` | Live entry points into `tools/_superseded/` | open | covered by `./scripts/qa --fast` |
| P5 | `build_cut.py:83`, `:85`, `list_candidate_takes.py:59`, `:62` | Silence regex can't match a negative `silence_start`; `zip` then shifts every pair. Lines corrected | open | `ugc-edit-system/tests/regressions/test_P5_*.py` — **already automated and red** |
| P6 | `motion_graphics.py:143,146,149,181` | `drawbox` defaults to `eval=init`, so animated geometry freezes at t=0 and cards render zero-width behind the text. `grep -n "eval=" motion_graphics.py` returns **nothing**, and every animated `w`/`h`/`x` is an expression in `t` — so at init the expression evaluates to 0 and a card's box is **w=0 for its entire life** while its `drawtext` animates correctly over nothing. The module docstring at `:14-16` asserts the opposite, which is how it survived this long. **The one pipeline row on a shipped, wanted feature** — `lib/pipeline.ts:315` invokes `motion_graphics.py` as the live "Render graphics" job, and the graphics subsystem is kept by Kayer's standing order. **Scheduled — see DOCKET M4-adjacent note; the rest of the pipeline waits** | open | **not a string assertion.** Asserting `eval=frame` is in the filter proves the flag is present, not that the geometry moves — the `verify_edges.py` trap again. Closes on one short `snipai-tester` render of a project with a definition card |
| P7 | `process_inbox.sh:9,12` | The `flock` guard returns 0 on both branches; processed files never leave `inbox/` | open | no |
| P8 | `build_cut.py:490-491` | Detached-audio offset computed against the unsnapped beat start; audio leads picture by the snap amount. Lines corrected (`:287` was stale) | open | yes, not yet written |
| P9 | `add_sfx.py:132,134` | `amix` without `normalize=0` halves every input; the voice comes out 6dB down. **In a tool the app never invokes** (U1) — do not schedule ahead of P6 | open | yes, but it is the P6 trap: a string assertion proves the flag, not the level |
| P10 | `add_sfx.py:43`, `compare_to_reference.py:40` | Blind `rsplit("-", 1)`; folds a real beat label into a piece suffix. **Partial** — `build_cut.py:104-110` now has the correct `base_label` and its first regression test passes; the second still fails (`'serum-glow' != 'serum-glow-2'`). The corrected implementation is twelve files away and **neither surviving copy imports it**. Line corrected (`:30` was stale) | open — partial | `ugc-edit-system/tests/regressions/test_P10_*.py` — **automated, half red** |
| P11, P12, P16 | — | **Moved to "Native and shell" 2026-09-11. They were never pipeline rows** — `native/main.swift` and `scripts/bundle-app` are both named in this file's own scope line as *in* scope. Filing them here meant three in-scope rows sat under a heading that says "not worked on unless asked", and were excluded from the finish-line count. Ids kept; see the Native section |
| P13 | `learn_from_edits.py:373`, `:375` | **Partial.** The `.tmp`-write-with-no-`makedirs` half is fixed by `813de9f`. The `KeyError` half survives: `tuning["scoring"]` by subscript at `:373`/`:375`. Nastier than it reads, because `:362` in the **print** pass correctly uses `.get` — so the dry run succeeds and tells you it will work, and only `--apply` dies. Failure: fresh library, three take overrides, `--apply` → `KeyError: 'scoring'`, after the preview said fine. Lines corrected (`:329,241` were stale) | open — partial | yes, not yet written |
| P14 | `calibrate_silence.py:105` | The floor picker can select the top of its own sweep, and the guard compares that entry against 35% of itself | open | yes, not yet written |
| P15 | `audio_peaks.py:54` | `sr // rate` floored, un-floored `rate` written to the JSON; ~1% drift at `--rate 120` | open | yes, not yet written |
| P17 | `finish-move.command:48` | `[ -f .../*.MOV ]` errors on more than one match, hidden by `2>/dev/null` | open | no |
| P18 | `align_reference.py:104` | `min()` on an empty list when nothing clears the correlation gate | open | yes, not yet written |
