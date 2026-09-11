# The docket

What Kayer has asked for, and what happened to it.

`audits/LEDGER.md` holds defects **I** found in the code. This holds requests
**he** made out loud — which is the list that was actually going missing. The
fade handle is the example worth remembering: asked for, built as far as a
draggable corner, wired to nothing, and it sat dead for weeks because nothing
was keeping score.

**Status:** `open` · `done` · `partial` (some of it works, the rest is named)
· `blocked` (waiting on something outside the code — money, a credential, a
decision) · `parked` (he called it off; kept so it is not re-litigated).

Read this at the start of a session. Update it in the same commit as the work,
not afterwards. `./scripts/docket` prints what is still open.

---

## Roadmap — the sequence

One milestone open at a time. Nothing below gets touched until the one above
it meets its exit line. New ideas go in **Open**, not into whichever milestone
is live — they get pulled in when this list is re-sequenced, not on the spot.

**Re-sequenced 2026-09-11, updated same night.** He needs TikToks posted this
weekend. Drop-in auto-cut is the product.

**Re-sequence 2026-09-10 (PM), one row: S8 jumps the line as M0.75.** Ledger
S8 was in no milestone at all. A trim whose hole ends up covering its own beat
makes the line **disappear from the finished video** with nothing said, while
`beats.json` still shows it and the timeline draws it 0px wide so it cannot be
clicked. That is output the user did not ask for and cannot see the cause of —
the same failure class as M0.5 (the cut does not contain what the edit said it
should), which is why it sits directly after it. It does **not** interrupt
M0/M0.5: S8 needs a manual trim over a hole, so a fresh drop-in auto-cut never
fires it, and it cannot block the exit line the tester is running right now.
Jumping the line is the exception; this is the only row that got to.

**Re-sequence 2026-09-10 (PM), second and last one: N1 jumps to M0.6, ahead
of S8.** The app adopts whatever server already holds port 4737 and then
**silently ignores `SNIPAI_DATA`**, so a run that believed it was sandboxed
wrote into `~/Movies/SnipAi` on 2026-09-10 — `state/jobs.json` at 22:27, the
`projects/` mtime moving in the same minute. His footage was checked and is
intact, both projects whole, both raw files byte-identical. Nothing was lost.
It jumps anyway, on three counts. It is the footage-loss criterion in the
charter, and the only row in the ledger that can reach the raw files, which
are the one thing with no undo — S8 damages an output that can be rebuilt, so
N1 goes ahead of it. It is the **second** time a sandbox boundary has leaked
into his real library by a different route; one is an incident, two is a
pattern. And it is the only defect here that blocks the *process* rather than
a feature: standing order 3 is "never touch the footage", and until this is
fixed no agent can actually honour it, so every QA and tester run from here
carries a risk it is not supposed to carry.

**Re-sequence 2026-09-11 (PM), and the last of the session: C22/CG1 moves out
of M2 into M-app, and M-app moves ahead of M0.75.**

C22 is not jumping the line — it was **mis-filed**. M-app's exit line is "open
a cut in the native window, press play, watch all of it", and the 2026-09-11
run proved the cut plays and he still cannot watch it, because the page drags
the player out of the viewport within four seconds. A row that is the sole
blocker on an earlier milestone's exit line belongs in that milestone. It sat
in M2 behind a DOM harness it does not need: the tester proved the behaviour
with AX scrollbar values, so a proof path exists today. That is the fourth
mis-filing this session — a wrong line, a wrong exit line, a wrong section,
now a wrong milestone — and all four had the same effect of making something
real unfindable.

**M-app then moves ahead of M0.75 (S8).** M-app is one row from done and that
row is taxing everything else in flight: it stole three of the tester's clicks
in one session, one of which opened a Trim editor on his real project that had
to be backed out of. S8 is the more severe defect, but it needs a manual trim
across a hole, which nobody is currently performing. Cheap-and-unblocking goes
ahead of severe-but-dormant when the cheap one is also a tax on every session
that follows. Reversible the moment Kayer trims a beat with a hole.

It is also **R4**, which he has now reported twice in his own words. A third
report would be the one that matters, and it would be deserved.

**This is the last re-sequence of the session.** Counting honestly: two true
jumps (S8, N1), three placements of rows that were in no milestone at all
(N2/M0.7, P6/M3.5, C22), one correction. The table now stands until Kayer says
otherwise or a finding arrives that meets the charter's bar.

**2026-09-11, after M0.7 merged: M0.6 REOPENS. This is not a re-sequence —
it is a milestone I closed that was not done.**

I closed M0.6 on a merge and a green suite. Its exit line is a tester action
("launch against a sandbox while a server holds 4737 and confirm
`/api/projects` does not serve `~/Movies/SnipAi`"), and no tester ran it
against the packaged app. QA then counted routes: the repo has 24, the bundle
has 23, and the missing one is `/api/health` — the route the M0.6 launcher
polls. So the ownership check I ruled jumped the queue on footage-safety
grounds has never run in the app Kayer opens.

That is the seventh item of the Definition of Done — verified by the role that
can verify it — and this time the one who skipped it was me. It is the same
error I have corrected in four exit lines tonight, made by the person
correcting them. Worth writing down in those terms rather than as a status
change.

Two narrow things join M0.6 rather than waiting for M1, and only these two: a
**route inventory** in `verify-bundle`, and `scripts/qa` **honouring
`scripts/test`'s exit code**. The first is the assertion that catches N7 — and
the marker-string check I proposed earlier would *not* have, since
`grep -rl faststart` hits on a stale bundle. The second is in scope because
`bundle-app:23-26` reads that exit code as the release gate that will approve
this very rebundle; fixing the artifact through a gate that cannot fail is how
the bundle went three days stale in the first place.

**T14 (the board cannot fail a run) stays in M1.** It is the general rule and
a design change — which board tests gate, and when — and bolting it onto a
rebundle is how it gets done badly. M1 is now unmistakably the milestone where
checks stop reporting on things they did not measure.

**Overnight session 2026-09-11:** S18 and S19 fixed and test-verified (not
against real footage — synthetic fixtures; see their commits). E1's fix is
written and its mechanism confirmed against real measured data, but not yet
proven against a real render — this session's connection to the Mac could not
finish extracting even 2.3s from a real 1.5GB source without timing out twice.
**What's still needed before M0 and M0.5 can close: someone actually drops a
raw clip into the dashboard and lets it run.** That exercises the real upload
path, the real pipeline, and the real E1 fix, natively on the Mac rather than
through this session's connection to it — which is exactly what this
connection could not do reliably tonight. Also fixed in passing: T2's real
cause (`guard-ledger.py` was silently forcing `fail=1` on every run) — `M1` is
mostly done as a result, `scripts/test` now prints an honest verdict.

**Checkpoint 2026-09-10, before the tester run.** Re-ran the suite: 173/173,
`# fail 0`, one honest skip (1 pipeline test, no venv — T4). Regression board
5 of 6, the one red being S1, kept red on purpose. S18 and S19 both green.
M-app does **not** close on that alone — see its row.

| # | Milestone | Exit line | Ledger / docket ids |
|---|---|---|---|
| M0 | Prove drop-in auto-cut on a brand-new clip | A raw file dropped in the dashboard produces a finished cut in `cuts/`, no terminal touched. **Pipeline half banked 2026-09-10** by `snipai-tester` on both surfaces: all four stages ran to completion, a finished file landed in `cuts/` every time, no >1s silence, no black frames, both streams present, frame count matches duration, `state/jobs.json` `done`/`100` with no unhandled traceback. **Does not close yet** — the one unverified thing is the one the exit line is actually about: nobody has *dropped* a file in. Import-picker and drag-and-drop cannot be driven from here (see Blocked). Remaining scope: that single act. **Unblocked 2026-09-11** — Kayer granted Screen Recording and Accessibility, both verified directly (`osascript` returns real window geometry; a captured window region measures 256/256 distinct bytes rather than stripped wallpaper). **MET AND CLOSED 2026-09-11.** Both routes work in the real window, no terminal touched. **Import footage** opens a genuine `AXSheet` NSOpenPanel ("Choose the video files to bring in.") — the class of bug that once made that button inert in WKWebView is gone. A real Finder→WKWebView **drag** also worked: the window dimmed, the dashed drop zone appeared, and on release the file landed in the tray. Both ran to finished cuts — `qa-drop-test-v1.mp4` (7 segs, EDL 14.999s, ffmpeg 15.45s) and `qa-drag-test-v1.mp4` (9 segs, EDL 14.010s, ffmpeg 14.52s) — both `ftyp, moov, free, mdat`, both h264 406x720 + aac, both ~0.057s per clip over the EDL. Queue card, EDL and ffmpeg all agree. S19 and E1 both confirmed again on fresh packaged builds | S3 (fixed) |
| M0.5 | Stop shipping clipped audio | **Exit line rewritten 2026-09-10 — the old one could not prove the claim.** It read "`python3 qa/verify_edges.py` reports 0 of 34"; that tool reads `work/edl.json`, `work/transcript.json` and the source audio and **never opens a rendered clip**, while E1's truncation happens downstream of the EDL in ffmpeg's per-clip re-encode. It reported clean on a build that was demonstrably still clipping. Also "0 of 34" is img-9817's denominator — a fresh import yields 2-3 measurable fragments, so a clean run on a new project is a thin result even with the right tool. **New line: for a clip built by the packaged app, every rendered clip's measured duration is ≥ its requested `dur`.** **MET AND CLOSED 2026-09-11.** Re-run against the rebundled app: **11 of 11 clips, 0 short, +0.047s to +0.073s, mean +0.064**, measured with the bundle's own PyAV by full stream decode rather than container headers, and the stricter `min(video, audio) ≥ dur` holds for all 11 — including the two sub-0.3s fragments most at risk of losing a consonant (+0.069, +0.065). The padding survives the concat: `dur` sums to 15.234s, the finished file is 15.93s (478 frames @30), which is 11 × ~0.064 accounted for. Dev and packaged now agree (dev was +0.037 to +0.059 across 26). **Closed on the fix, not on his library** — see M0.7. Note **T5 is not fixed**: the rebundle cured this instance of a stale bundle, but `bundle-app` still has no check that what it produced matches the repo, so the next one can go stale the same way and nothing will notice | E1 (fixed), T5 (still open) |
| M0.6 | A sandboxed run cannot touch the real library | **Exit line rewritten 2026-09-11 — the old one could be satisfied by a run in which the rule never fired.** It said "verified by launching against a sandbox while a server holds 4737 and confirming `/api/projects` does not serve `~/Movies/SnipAi`", which passes just as well when the launcher spawned its own server because the port happened to be free: right answer, wrong reason, and no way to tell them apart. It also never named **which** app — and the entire failure was that the repo had the fix and the bundle did not. **New line, four clauses, every one against `SnipAi.app` and not a dev checkout:** (1) the bundled server answers `/api/health` 200 — the route the launcher polls, absent from today's bundle (N7); (2) with a foreign server already holding 4737, the app **says in its log what it found and what it decided** — the rule is observed firing, not inferred from an outcome; (3) launched with `SNIPAI_DATA=<sandbox>`, `/api/projects` serves the sandbox, and `~/Movies/SnipAi` is byte-identical before and after; (4) quitting stops only a server the app started, verified in **both** a bundled run and a dev checkout, which is P19's surviving half. Verified by `snipai-tester`, not by a merge — that is what went wrong the first time. Reconcile with P19 in the same pass — same function, opposite asks **REOPENED 2026-09-11 — I closed this on a merge and a green suite, and its exit line is a tester action.** The rule is merged and the probe passes 17/17, but the bundled server has **no `/api/health`** (N7: repo 24 routes, bundle 23), so `LaunchDecision.swift:163` polls a route its own server 404s and the ownership check is inert in the app on disk. Nothing that protects his library is actually running. **Added scope, both narrow:** a **route inventory** in `verify-bundle` (the marker-string check would not have caught this — `grep -rl faststart` hits on a stale bundle), and `scripts/qa` **honouring `scripts/test`'s exit code** instead of grepping for `fail 0` (T3), because `bundle-app:23-26` reads that exit code as the release gate that will approve this very rebundle. Closes when a rebundle carrying `/api/health` is verified **in the packaged app** by `snipai-tester` **MET AND CLOSED 2026-09-11, all four clauses, verified by `snipai-tester` against the packaged app.** (1) `/api/health` 200 from the bundled server, reporting `dataRoot`, `serverPath`, `launchToken`, `pipeline {version 3, known true}`. (2) **The rule observed firing in five branches** — which is what the rewritten line was for, and what the old one could never have shown. Verbatim on the foreign-library case: *"port 4737 is held by a SnipAi server (pid 61425, library .../qa-m06-b)"* → *"refusing to start — Port 4737 is already serving a different SnipAi library"* → *"SnipAi has not started a server and has not stopped that one. Using it would edit the wrong footage."* All four lines render **in the window**, not only the log. The occupant's `/api/health` was cold and compiled in **373ms**, inside the 8s budget — N6's case, passing. Also observed: the older-build adopt path, the won't-identify-itself refusal naming pid and command, and **orphan-restart firing in a bundle for the first time**. (3) `~/Movies/SnipAi/projects` fingerprinted **976 files before and after: 0 added, 0 removed, 0 modified**; state 3/3 identical; img-9817 34 beats, img-9823 61. (4) **3/3 bundled, 3/3 dev, plus quit-and-reopen 5/5 with 61 TIME_WAIT sockets on 4737 confirmed present at the moment of relaunch** — so the `SO_REUSEADDR` pin holds under the exact condition that caught it. **The tester discarded its own first three clause-4 attempts** because `kill -TERM` does not run `applicationWillTerminate`: the victim survived for the wrong reason. It redid them with real quit events. That is this milestone's own thesis applied by a tester to its own method, and it is the reason the result can be believed | N1, P19, N7, T3, N8, N9, N3, N4 (all fixed) |
| M0.7 | Make the E1 fix reach the footage he already has | **Opened 2026-09-11, and it is the reason M0.5 closing is not the end of the clipped-audio story.** The packaged bundle ships no `pipeline-version.json`, so packaged builds stamp `work/pipeline.json` with `"version": 0`, and the repo's own manifest still reads `"version": 2, "changed": "2026-09-09"` — never bumped for E1. Confirmed end-to-end from the running packaged server: `GET /api/projects/m05-recheck` → `cutStale: false`. **So E1 is fixed for footage imported from now on and silently not applied to anything already in his library**, and the one signal that would tell him — the "Rebuild — the cutting has improved since this was built" badge — is inert in the app he opens. His two real cuts, img-9817 and img-9823, were both built before `WORD_RESCUE` and would never be flagged. Exit: the manifest ships inside the bundle, is bumped past 2 citing E1, and `cutStale` reads **true** on a pre-fix cut in the packaged app | N2 |
| M-app | Make it watchable inside SnipAi itself | Open a cut in the native window, press play, watch all of it. **Half met 2026-09-11: it plays. He cannot watch it.** Measured from clicking Play on **Rendered file** — ~1.3-1.4s of black, first picture at +2.97s with the native transport reading `0:02 / 1:38` (which proves the `moov` was fetched and parsed), later sampled at `0:31 / 1:38` at full resolution, and the lines list followed playback through to line 34. **The `moov`-last worry does not bite over localhost, and that settles the rebuild question.** On the 513MB v6: first-1KB ttfb 0.0029s, the tail 110KB carrying the `moov` at byte 513,655,552 returns in **4ms**, the whole file streams in 1.363s at 377MB/s, and a full ffmpeg decode reports **zero errors** (1:38.39, 2160x3840, h264+aac). All six cuts are `moov`-last and all six are fine. **His existing cuts are postable as they stand — do not spend the weekend rebuilding six 513MB files.** The only standing reason to rebuild v6 is the one already on its card: it predates his latest trims. **What blocks the exit line is C22/CG1**, moved into this milestone — see the re-sequence note. Scroll the player into view and within ~4s the page drags itself back to the lines list and the player leaves the viewport (`1.0 → 0.854` at the scroll, held to +3.67s, back to `1.0` by +4.32s). It runs while **paused** (`0.655 → 1.0`) and after **F** clears selection (`0.0 → 0.541`); with a trim row open it snaps back in under a second. On a 1440x900 display a ~400pt player plus timeline plus lines cannot co-exist in an 800pt window, so playback continues with nothing visible **Blocked on C22, which is in flight on `qa/c22-cg1` and not merged.** A fix exists as an uncommitted working tree; this docket briefly recorded it as done, which it was not. The exit line is *open a cut in the native window, press play, watch all of it*, and what is false is watchability, not the diff — so this closes when `snipai-tester` plays a cut in the packaged app and the player stays on screen for its duration, including while paused, after a row click, and with a trim row open, which were C22's three triggers | S18, S19 (fixed), C22/CG1, C19, C20 (open, in flight) |
| M0.75 | Stop losing lines out of the cut | A trim that drives a hole across its own beat renormalises instead; the beat still emits pieces, and a beat that ends up empty is never silently rendered as nothing. Green regression test in `lib/`, no server needed | S8 |
| M0.8 | **One TikTok that arrived as several clips** | **Opened 2026-09-11, and it is why M0 closing is not the end of the drop-in story.** M0 closed on a single file, and Kayer never shoots a single file: he is interrupted mid-take — kid, door, life — stops recording, and restarts where he left off, so a real TikTok reaches the app as three or four clips. Today the uploader accepts them all and makes **each one its own project** (`DropZone.tsx:211`), because `lib/types.ts:24` is `source: string`, singular, and 68 sites agree with it (26 TS, 42 Python). So the milestone that proved drop-in works proved it for footage he does not have. **Take the cheap route (R5a): join the clips at import, before anything else runs.** Everything downstream then sees one continuous recording and needs no change at all — and the take picker spans every clip for free, which is the behaviour he actually wants (a line said better in clip 3 beating the one in clip 1). Confirmed joinable losslessly: both real sources are HEVC 3840x2160 @ 30/1, AAC 48kHz stereo, so `-c copy` with the four iPhone data tracks `-map`ped away. Do **not** make `source` a list for this; that is R5b, it touches all 68 sites, and it buys nothing extra for the way he shoots. **The seam is not a new problem** — restarting where he left off makes the join look like an abandoned take followed by a retake, which is the exact shape the take picker exists to resolve. **Two things to test rather than assume:** a splice with no silence on either side of it (does beat drafting cope), and a clip that ends mid-word (is the fragment discarded as an incomplete take, or picked). **How it tells a stitch-group from a standalone — the question Kayer asked, and the thing that makes or breaks this.** A batch can hold both: three clips that are one interrupted video, plus a fourth that is a finished video on its own. **REVISED 2026-09-11 after Kayer answered the question this depended on: he batch-films.** He often shoots several *different* TikToks in one sitting, back to back. That kills the recording-gap heuristic on its own — a three-minute gap means either "the kid came in" or "on to the next product", and time cannot tell them apart. **The discriminator is whether the clip ended mid-sentence.** An interruption cuts him off mid-word or mid-thought and the next clip restarts that same line; a finished video ends on a complete sentence, usually a CTA. That is exactly the difference, and the machinery already exists — Whisper word timings plus the beat drafter, whose whole definition of a beat is "ONE complete recitation". **Cost is ordering, not compute:** transcription is stage 1 and runs on every clip regardless, so grouping simply moves to *after* transcription instead of before it. **The rule, cheapest test first:** gap of hours → separate, stop there. Otherwise transcribe, then ask (1) does clip N end on a complete sentence, and (2) does clip N+1 open by restarting clip N's last line or continuing its script? Mid-sentence end + continuation → same video. Complete ending + a different script or product → separate. **The recording gap stays as a cheap early exit and a tiebreaker, not the decision.** ~~The signal is the recording gap, and it is free.~~ Every clip carries `creation_time` and `duration`, so `creation_time + duration` is when recording stopped; the gap to the next clip's `creation_time` is how long he was away. An interruption is minutes. A separate video is hours. Measured on his own two files: IMG_9817 stopped 10:26:51, IMG_9823 started 16:35:16 — **6h 8m apart, unambiguous.** Consecutive `IMG_` numbering is a weak tiebreaker; identical framing (compare last frame to first frame) and script continuity after transcription are stronger but far more expensive, and neither should be built until the gap alone is shown to fail. **Order within a group is not a hard problem, and drop order is never consulted for anything.** Every clip carries `creation_time` stamped by the camera at capture; it is immutable, it survives copying and renaming, and it puts seven files dropped in any order into the exact sequence they were filmed. So the first thing the importer does is sort by `creation_time` — after that, "which half came first" is already answered and a flipped pair is impossible. Filename numbering (`IMG_9817` < `IMG_9818`) is a fallback if a clip somehow arrives with no timestamp, and script continuity is a third: the clip that ends mid-sentence is by definition the earlier one. **One edge case to handle rather than discover:** interleaving — part 1 of video A, then all of video B, then part 2 of A. Chronological order alone would try to pair A-part-1 with B, so the continuity check must match a clip against every candidate in the batch, not only its immediate neighbour. Unusual, but he batch-films, so it is reachable. **Propose, do not decide.** Group by gap, then show the proposed grouping in the import tray that already exists (`DropZone.tsx` already lists each file with its own status) and let him confirm or regroup before a single stage runs. Silent grouping is wrong in both directions and both are expensive: stitching two separate videos produces a garbage cut, and splitting one interrupted video into halves means re-shooting or manual repair. A confirm step costs one click when the guess is right, which it nearly always will be, and saves the whole import when it is not. **Exit:** drop four clips of one interrupted TikTok **plus one unrelated standalone clip** into the packaged app at once; the tray proposes 2 projects, not 5 and not 1; on confirm he gets **one** stitched cut with at least one beat demonstrably taken from a clip other than the first, and **one** separate cut from the standalone | R5 |
| M1 | Make the test/QA verdict trustworthy | **Exit line rewritten 2026-09-11 — the fourth tonight that could not prove its own milestone.** It used to include "nothing silently skipped", which can never be met as written: `scripts/test:66-68` and `scripts/qa:132-136` raise "a suite was SKIPPED" for one deliberate, permanent, harmless `skipTest` in `test_paths.py`, so the warning fires on every run and is therefore read on none. **T4 leaves M1** — verified as an environment artefact, not a defect (the venv resolves, `Ran 75 tests, OK (skipped=1)`); the residual is a reporting bug now described as such in its row. **New line, and it is about the habit rather than the symptoms:** every check reports on what it actually measured. Concretely — `./scripts/qa --regressions` prints the 12 tests on the board rather than zero (T7); `guard-ledger.py` covers all id families on both sides of its comparison and never collapses two same-titled tests into one verdict (T8); one run prints one verdict and the exit code agrees with it (T3); a deliberate skip and a suite that did not run are reported differently (T4's residual); and the Swift ownership rule has a gate at all (N4). The subject here is a pattern, not a list: `verify_edges.py` certified a clipping build, a string assertion would certify P6's dead `drawbox`, `verify_cut.py` found real repeated phrases and the card said 100, and `guard-ledger.py` reported agreement across 5 of 12 tests — **four checks that reported success about something they never measured, and one of them was relayed to Kayer as assurance** | T2, T3, T7, T8, N3, N4 (all fixed), T4 (rescoped), T11, T12, T13, T14, T15 |
| M2 | Build the net under the client | A DOM harness exists; **C2's surviving half** and **CG3** each have a test that went red → green. **CG1 left this milestone 2026-09-11** — it became M-app's blocker and was provable without a harness, so it can no longer serve as this one's proof. CG3 (C11, C12, C23: destructive state cleared with no rollback) replaces it, and is the group I flagged as the one that fails silently. **Exit line rewritten 2026-09-10** — it used to name C1, which `bb4bd5f` fixed on 2026-09-08, so half of M2's exit was already met by a commit predating the milestone and the other half (C2) is now partial. A harness whose first proof is a bug that no longer exists proves nothing. CG1 replaces it because it is the one thing Kayer has reported **twice** in his own words (R4), and a net that cannot catch "the page moves itself" is not worth stringing. Dispatch by group (CG1-CG6 in the ledger), verify by id | C2 (partial), C22 (regressed), C19 (retired into C22) |
| M3 | Finish the three-level review loop | Level 1 → 2 → 3 usable without knowing `m` is a shortcut | H1, H2, H3 |
| M3.5 | Make the graphics feature he kept actually work | **Placed 2026-09-11**, now the rebundle is verified. Three rows on one feature that he explicitly kept by decision and that has never rendered correctly: **P6** (`drawbox` defaults to `eval=init`, so every card's box is `w=0` for its entire life while its text animates over nothing — and the module docstring at `:14-16` asserts the opposite, which is how it survived), **S25** (pressing "Plan graphics" twice destroys every hand-made graphic), **E3** (the scorecard still penalises cuts for carrying graphics). Sits **immediately before M4** on purpose: M4 asks him to decide which features are worth keeping, and he cannot judge graphics while graphics has never worked. Deciding on a broken version of a thing is not a decision. Not this weekend's product — closes on one short tester render of a project with a definition card, not on a string assertion | P6, S25, E3 |
| M4 | Decide what SnipAi is (his call, not QA's or dev's) | Every BLOAT row has a keep/cut answer, written down. **B3 and B4 added 2026-09-11** — the standing order named B1, B2, B5 and B6 and was silent on these two, so they read as decided and were not. The drop-folder question is framed with a recommendation (delete it) under Bloat in the ledger, waiting on him **B4 answered 2026-09-11 — delete the drop-folder ingest** (Kayer delegated it: *"let the PM decide"*; reasoning in the ledger under Bloat). That leaves **B3 only**, and smaller: two of its nine `.command` scripts go with B4, which also moots P7 and most of P4 | B3 (open), B1, B2, B4, B5, B6 (all answered) |
| M5 | ~~Ship to a human who isn't him~~ — **PARKED 2026-09-11** | Parked by Kayer's standing statement, *"this app is just for me right now."* Kept rather than deleted, the way P1 was, so the reason is findable when it changes: the milestone is not wrong, it has no audience yet. **Two things do NOT park with it.** **P16** — the bundle is not reproducible from the repo (an untracked, hand-made `Info.plist`; a copy now committed at `scripts/build/Info.plist`) — stays open at unchanged priority, because the M5 framing was too narrow: if `SnipAi.app` is ever deleted, or he clones the repo to a second machine of his own, `bundle-app` cannot produce a launchable app. That is a him-problem, not a them-problem. The same holds for **N2 and T5's whole family** — "works on this Mac, missing from the artifact" — because he is the one running the artifact. **Single-user is not single-copy**, and it is not licence to lower the bar on anything protecting his footage or his output: N1, T6, the sandbox work, S8, S25, C27 and M1's subject all stand exactly as they were | P16, N2, T5 (all still live) |

## Open

| # | What he asked for | Notes |
|---|---|---|
| R5 | Several clips that are really one video | Asked 2026-09-11. He records one TikTok across several takes/files and wants them treated as ONE project with ONE cut — and the take picker choosing across all of them, so a line said better in clip 3 wins over clip 1. **Today:** the uploader accepts multiple files but makes each its own project (`DropZone.tsx:211`), and `lib/types.ts:24` is `source: string` — singular. 68 sites assume one source (26 TS, 42 Python). **Two ways, and the cheap one is probably right.** (a) *Concatenate at import*: join the dropped clips into one `raw/` file before anything else runs; everything downstream sees one continuous recording and needs no change, and the take picker spans all clips for free. `-c copy` if codec/resolution/fps match (same phone, same mode: they will), re-encode if not. Roughly one function. (b) *True multi-source*: `source: string` becomes a list and all 68 sites learn about it. Correct, much larger, and buys little beyond (a) for his actual workflow. **Recommend (a)**, and only reach for (b) if mixed-format sources become normal. **Exit condition:** drop four clips of one TikTok at once, get one project, one cut, and a take chosen from a clip other than the first | open |
| R4 | "No more scrolling when I'm not scrolling" | Said 2026-09-11, and **said before** — the `pointerDown` guard in `review/page.tsx` quotes the first report. That fix covered dragging only. Mechanism found and filed as ledger **C22**: `yield4s` hands the list over when you scroll, then four seconds later actively yanks it back (`setFollowTick`), instead of just resuming. Also runs while paused. **Updated 2026-09-10:** bigger than one fix. C22 is a **regression** — `setFollowTick` arrived in `bb4bd5f` as a deliberate feature — and C19 turned out to be a third trigger of the same rule, not a rendering bug. Now ledger group **CG1**: three call sites, one guard that is wrong for all three. It is M2's exit condition, so it gets a test, not just a patch. Third report would be the one that matters |
| R2 | Products & links | The form writes a file only an uninvoked tool reads |
| R3 | Teach the take picker what "best" means to him | The machinery is connected and waiting: `takePicks` is still empty, so nothing has taught it. Needs him to override a few picks in **Takes** |

## Blocked — not on code

**Heads-up on ids: this table's `B1-B4` are NOT the ledger's Bloat `B1-B6`.**
Two different namespaces, both called B, and on 2026-09-11 a single message
referred to both. Docket `B2` is the Apple Developer account; ledger `B2` is
the graphics subsystem. Say which file you mean.

**Re-sequenced 2026-09-11 by Kayer's standing statement — *"this app is just
for me right now."*** Three rows below lose their reason and are parked rather
than deleted, so the reason is findable when it changes.

| # | What he asked for | Waiting on |
|---|---|---|
| B1 | Post to TikTok Shop, X, Snapchat, Facebook, Instagram, **Pinterest**, **Trybe**, Amazon Storefront | A developer app and credentials per platform. Eight tiles, all `not_connected` |
| B2 | Hand the app to a few people | **Parked 2026-09-11 — *"this app is just for me right now."*** The $99/yr is not needed for anything he currently wants. Unpark it the day he wants someone else to open it |
| B3 | It updates itself | **Parked 2026-09-11**, follows B2 — Sparkle needs signing, signing needs an account he does not need. He restarts the app himself every session (see Done) |
| B4 | Runs properly on Apple Silicon | **Dropped from blocked to whenever, 2026-09-11.** It works under Rosetta and he is the only user, so a universal build is a nicety with no date. Not parked — it is still wanted, just not waiting on anything |
**B5 cleared 2026-09-11** and removed from this table: he granted Screen
Recording and Accessibility, both verified directly. That unblocked the entire
native surface in one go — M0's last item, M-app's exit line, C20, and every
native check from here on. It sat here for one evening and cost two minutes.
Worth remembering the shape: the highest-leverage thing on the board was not
code, and no agent could do it.

## Parked

| # | What | Why |
|---|------|-----|
| P1 | AI overlay — the aged-neck shot, click, freeze, revert | He called it off after seeing the per-image cost. Everything but the generation call is built and committed: `ai_shot.py`, `lib/imagegen.ts`, `scripts/connect-image-provider`. One key away |

## Done

Kept because "did you do X?" is a question worth being able to answer, and
because several of these were reported twice.

| What | Where it landed |
|------|-----------------|
| Reference videos build a house-style template that is actually used | the scorecard's Pacing score reads off it — 38 on the current cut |
| Drop footage in and it cuts itself, no second step | auto pipeline, live verb and percentage |
| A real percentage while footage imports | `copying 41%`, and the row fills as a bar |
| A 1.8GB import stops taking the Mac down with it | streamed to disk: 2169MB → 149MB on a 700MB file |
| Re-score a cut without re-rendering it | the `check` step, seconds instead of minutes |
| A real timeline: two tracks, zoom, CRUD, premium UX | `Timeline.tsx` |
| Zoom with ⌘+scroll, and a toggle | timeline and snippet editor both |
| Detach audio for J/L cuts | UI, API and builder — the render script is still unrun (see ledger H4) |
| Extremely high resolution waveforms, cyan | one spike per device pixel |
| Frame-by-frame filmstrip, not a stretched smear | visible window only, ~1 frame / 44px |
| Playhead unsnapped from the grid, skinnier, exact | 1px, free-moving |
| Playhead draggable, and synced to playback | 47 position updates a second |
| Highlight a region and delete it | snippet editor, and the timeline |
| Ripple delete across synced audio and video | one drag, resolved and applied as one write |
| ⌘B to splice | plus `S` |
| Fade in / out with a draggable handle | **was dead for weeks**; the corner now ramps the clip |
| Learn rules from what I do repeatedly | and the loop was reconnected after the library moved |
| Real-time playback in the snippet monitor | canvas mirror, one decoder |
| Half-size playback window | then made resizable, then made it take the footage's shape |
| Delete projects properly, five days to change your mind | ⋯ → Delete → Recently deleted |
| Animated status bar, live percentage, estimated finish, changing verbs | transcribing, snipping, editing, shrinking, rendering |
| Thumbnail on the queue card | beside the title |
| Motion graphics and definition cards | six kinds, folded under the timeline |
| Generate a graphic for one line | about a second, off the existing transcript |
| A box that takes my voice | in the graphic dialog |
| Microphone granted without asking mid-sentence | asked for at launch |
| Sleeker trim row — just cut, slice, save | and 1px handles |
| Snippet editor as wide as its line, looking like it belongs to it | seamless with the row above |
| Space plays the snippet | and pressing it again stops |
| Save trim in the bottom right corner | |
| Nothing drawn over the picture | filename and LIVE badge removed |
| 1px between the tracks | |
| Edits applied instantly, no re-render step | 67ms — you watch the edit, not the last render |
| Stay on the cut, stop reverting to original footage | renamed **Your cut** / **Rendered file** |
| The lines carousel with playback, word lit as spoken | yields for 4s if you scroll, then comes back |
| Select a video track and have the beat row follow | selection linked both ways |
| Audio while scrubbing | 0.5× to 3×, at the speed of your hand |
| Restart the app on every change so I can see it land | every session ends bundled and relaunched |
| A 1,000-scenario QA gauntlet, run against the real app | `qa/` — 4,008 scenarios, 9 defects found, 8 fixed |
| Ten seconds of dead air gone from the cut | img-9817 111.02s → 98.5s, img-9823 184.3s → 178.9s, zero silent stretches |
| Make the app more efficient | standalone server: 250MB → 22MB |
| Darker theme, no emoji on buttons | |
| An inventory of everything built | the two published guides |
