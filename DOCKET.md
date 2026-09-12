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

**C35 jumps C27, 2026-09-11.** `review/page.tsx:1831` tells him he is watching
*"the original footage"* on the exact branch that plays the 720p proxy
(`:1860`), while the same toolbar's tooltip two rows away calls it "a small
copy". It is live every time he opens a project, and on a product whose
subject is skin texture it means **he judges focus and detail on a downscale
believing it is the original** — he can approve a soft cut or reject a sharp
one, and either way the screen has taught him to distrust his own eyes. C27 is
an annoyance he has reported twice; this is a claim about picture quality that
can put a bad video out. **The scope is small and that is part of the ruling:**
the proxy is correct on the live path — it is what makes every trim instant —
and **Rendered file** is already full resolution, so the fix is to stop
claiming otherwise and point at where quality can be judged, not to put the
original on the live path.

**C32 jumps the queue, 2026-09-11 — the third and last true jump of this
project so far.** `review/page.tsx:1192`: the Trash button toasts *"Sent back
to re-cut"* and bins the video. No job is queued, `review-state.json` records
`trashed`, the dashboard greys the card and drops it from the live count — and
**no button anywhere produces `unreviewed`**, so neither Trash nor an
accidental Approve can be undone from the UI. Destructive, mislabelled and
irreversible together, which is the worst combination available and the
strongest jump case since N1. It sits **ahead of C27 and M1**, and becomes the
next row the moment M0.8 slice 3 frees dev. Kayer is being told directly
rather than waiting on a milestone.

**M3's scope grew before it opened, 2026-09-11** — Desmond audited H1-H9 and
**none of the nine is silently finished**; the cheap win is not there. H1, H2,
H3, H4, H5 and H7 are rewritten in the ledger, H5 split (H10), H8 split (H11),
and H9 moved to Native/shell because it was never a pipeline row. **Read H2
before building anything in M3:** it is an undone decision, not an oversight —
either restore `needs_fixes` *with a destination*, or delete the dashboard
branch that renders it. Do not add a third button that goes nowhere.

**M0.8: design from another session, implementation here — unfenced
2026-09-11 on Kayer's instruction.** His words: *"Can you include the
multi-clip footage into your build. I want that. And I wanna complete
product."* Verified before taking it: the other session wrote **design only** —
every code commit in the last twenty hours is from this session, `source` is
still `string`, and no stitching implementation exists anywhere. So the row
below is their spec and the build is ours. **The attribution stays rather than
being deleted**, because it is why that row is better argued than anything
this session would have written cold, and because who wrote a spec is worth
knowing when the spec turns out to be right.

**The process reason the fence existed still stands for anything else.** Two
sessions inside one feature produced this project's worst failure to date — an
in-flight working tree read and filed as `fixed`, plus three commits landing
on a branch mid-merge. Unfencing M0.8 is safe only because the other session
never wrote code against it. Confirm that before unfencing anything else.

**Say what a milestone was proven *on*, 2026-09-11.** M0 closed on a single
file, and **Kayer never shoots a single file** — he is interrupted mid-take,
stops, and restarts, so a real TikTok reaches the app as three or four clips.
Every milestone closed after M0 was verified against footage shaped unlike his
real footage: M0.5's clip measurements, M0.6's sandbox runs, M-app's
watchability. **None of that is invalidated and all of it is narrower than it
reads.** Exit lines from here name their sample — "proven on a single-clip
project", not "proven" — which is the same discipline that kept M0.5's closure
from implying his existing library was fixed.

**2026-09-11, after Nadia's M0.8 run against six of his real 4K clips: S34 +
S35 + S36 are the next row, and this is NOT a jump.** Worth saying plainly,
because the report arrived framed as one. M0.8 is the open milestone; S34, S35
and S36 are M0.8's own blockers, so the Roadmap already answers the question —
nothing has to move for them to be next. The only thing they go ahead of is
work that was never in front of them: C27 and M1 sit in later milestones, and
C32/C35 are already committed (`3590201`, `cf6cd3c`). **Theo finishes C32/C35
before picking this up; he is not reassigned mid-row.**

**The one true ruling here is *why* they are paired and where the rebundle
sits.** S34 (`lib/stitch.ts:139-142`) refuses a join whenever
`editListTrimSec > 1/fps` — 0.0333s at 30fps — and **every clip Kayer owns
measures 0.05-0.09s**, which is AAC encoder priming, not a trim. So the
feature he asked for out loud and gave up disk space for is **0% functional on
his own footage**, and the refusal tells him to do something (duplicate it in
Photos) that **cannot work**, because the duplicate carries the same offset.
S35 ships in the **same commit** because the same priming offset is what
pushes drift past the 0.0667s tolerance the moment S34 is relaxed — fix S34
alone and the feature stays broken with a different sentence, which reads as a
new bug instead of the same one. S36 rides along because it is three lines in
the same block and otherwise the paired fix's own failure path still strands
546 MB in `raw/` and takes the project name with it.

**Where the rebundle sits: after S34/S35/S36, not before.** N15 is real — the
packaged bundle has no `/api/import` at all (`BUILD_ID` Sep 11 08:29; the
route landed in `9850739` after it), so there is no tray to click and M0.8's
exit line cannot be attempted. Rebundling first would give him a tray he can
see; rebundling after gives him one that works. **After, for four reasons.**
A tray whose only multi-clip path refuses every clip he owns, with a false
sentence and a remedy that costs him 4K disk and still fails, is worse than no
tray — he would act on it. A bundle costs ~543 MB of `.build-cache` and disk
is 4.67 GiB, so doing it twice is a gigabyte of churn for nothing. M0.8's exit
is one tester run against one packaged app; two rebundles means two runs of
something that takes Nadia most of a session. And nothing is hidden in the
meantime — `scripts/verify-bundle.mjs` already names all five missing import
routes on demand and exits 1, which is N7's fix working. **The exception is
his to take, not mine:** if he wants to *see* the tray this weekend before a
join works, a rebundle is short and reversible.

**M0.8 stays open, and the packaged app is the second reason rather than the
first.** Even on the dev server the exit line cannot be produced — "one
stitched cut with at least one beat demonstrably taken from a clip other than
the first" requires a join, and no join of any clip he owns can succeed while
S34 is live. S37 (the grouping rule proposed **five** projects for **two**
videos, with nothing flagged) is held behind S34/S35 on Nadia's judgement,
which I agree with: a grouping fix cannot be evaluated without being able to
see the joined result.

**Same evening, after Theo landed `2bb2b96`: the rebundle is now the next row,
and S35's premise did not reproduce.** Two changes to the ruling directly
above, both from observed evidence rather than from a re-think.

**S34 and S36 are fixed and green** — 225/225, `fail 0`, `guard-ledger`
agreeing across 26 ids with S34 and S36 among them. S34 was not fixed by
widening a threshold, which is the outcome the row argued for and the one
Nadia asked for: the guard now decides from the **video** track's edit list,
where a trim shows and priming does not, measured by demuxing each track to
`-f null` with and against `-ignore_editlist`. All eight of his real files hide
**0.0000s** of picture; the same clip after `ffmpeg -ss 1.1 -c copy` shows
4.83 -> 6.00. That is a mechanism rather than a magnitude, so a 0.2s Photos
trim — which any constant set clear of 0.09s would have waved through — is
still refused.

**The rebundle moves to the front, by my own stated reason rather than against
it.** I sequenced it last because a tray whose only multi-clip path refuses
every clip he owns is worse than no tray. That reason is now gone. N15 is the
next row and it is Ruth's, and the tester run that follows it does triple duty:
it is M0.8's exit line, it is where S35's failing case either appears or does
not, and it is what unblocks S37, E4 and E5 by producing a real joined cut.

**S35 stays open with its premise unreproduced, and that is the right state
for it.** Theo measured drift on `0060+0061` at **~0.04s against a 0.067s
window** — so on the pair the report cites, nothing refuses a correct join. He
hardened the window in the same commit and declined to "fix" a case he could
not reproduce, which is exactly what dev is supposed to do with a row whose
premise does not hold. **This is a disagreement between two roles, not a
mistake by either, and it does not get resolved by a third guess from me:** it
needs Nadia's actual failing case — the two file names and the two numbers —
which the rebundled run will produce or disprove. It does not block the
rebundle.

**N15 is closed, S37 stays held, and what governs the sequence now is disk
rather than code. 2026-09-11, third update of the evening.**

**Ruth rebundled and N15 is fixed.** My reversal and the dispatch crossed —
we reached the same call from the same reason, which is worth one line because
it is the first time the sequence has been arrived at twice independently.
`verify-bundle` is green (*"29 tools identical, 29 API routes compiled"*,
exit 0, re-run here), `BUILD_ID` is 13:45 against tray commits at 11:07 and
11:18, and she drove the **packaged** server on a spare port: `POST
/api/import` 201, `GET` read back, analyse/confirm/files all reaching their
handlers, and the tray's own strings found in the dashboard chunk fetched over
HTTP. **A compiled route proves the plumbing; a string in the served chunk
proves the screen** — and N16 is filed because the gate still only does the
first.

**Three new rows, all disk-free: N16, T18, T19.** N16 is the N7 class
recurring one layer up — the bundle gate asserts every API route and **zero of
the five page routes**, so a `/dashboard` that failed to compile would go green
and hand him an app with an import API and no tray. High. T18: a changed pin in
`requirements.txt` does not invalidate the Python build cache and nothing
compares what is installed, so the old transcriber can ship silently — correct
today, unguarded today, and those are different claims. T19: the suite leaks
~75 temp fixture directories **per run** (7,621 and 273 MB had accumulated
since 2026-09-08, cleared by hand), which is our own tooling eating the
resource that is currently blocking Nadia.

**S37 stays held, and the disk does not change that.** The argument for holding
it was that a grouping fix cannot be evaluated without seeing a joined result,
and that argument is untouched by how much space is free. Widening
`SEAM_WINDOW` against the preserved transcripts is genuinely free and genuinely
tempting, which is exactly why it is worth naming what it would be: **letting a
constraint push us into work we had already sequenced later**, and then having
no way to tell a real fix from one that fits six transcripts. The corpus will
still be there when a join can be watched.

**What can proceed with no disk at all:** N16, T18, T19, and the S34 refusal
wording Theo already has. **What cannot:** M0.8's exit line, S35's failing case
and the joined cut S37, E4 and E5 all need — one run, three answers, and it
needs roughly 6.4 GB against **4.7 GiB free** (measured here after the temp
sweep). That is the only thing standing between this milestone and closing, and
it is not a code problem. See Blocked.

**2026-09-11, last update of the session: two of his real clips became one cut,
and M0.8 still does not close. S42 is the next row.**

**Say what is actually true first, because it has never been true before.** Two
of Kayer's own clips joined with `blocker: null` into a 1.63 GB 9:08.80 source
and built into **one cut, one project, no manual steps** — `1:45.02`, 3150
frames against a 105.03s audio track (0.03s apart, so no A/V drift across the
seam), no black frames anywhere including the join, longest silence 1.99s.
**17 beats came from the second clip and they are the entire CTA.** Verified in
the packaged app, transcribed from the finished file rather than read off the
timeline, and his library came out 1023 files / 0 modified. S34 and S36 are
both tester-verified. That is the feature Kayer asked for, working on his
footage, for the first time.

**It does not close M0.8, and the reason is the exit line's own words.** The
line asks for **four clips of one interrupted TikTok plus one unrelated
standalone**, dropped at once, with the tray proposing **2 projects, not 5 and
not 1** — and then one stitched cut *and* one separate cut. What ran was **two
clips, one group**: the stitched half of the exit is met and the **grouping
half was never exercised**, which is precisely the half S37 records getting
wrong on six clips. **And nobody has literally watched the video** — no Screen
Recording grant for the tester's shell (proven, not assumed), so a full decode
plus a Whisper transcript of the finished cut was substituted. Strong evidence;
not eyes on a screen. **Scope of what was proven, in this milestone's own
discipline: a two-clip group, correctly proposed as one video, on one pair.**

**The last step of the exit line is one command and only Kayer can run it.**
`open cuts/img-0060-v1.mp4` in his own library. It is in front of him now; it
is not an agent's to do.

**Sequencing: S42 is next, and I am taking the tester's fix-first over the
severity ordering.** Deleting **one line** turned a 20 MB 406x720 cut into a
**505 MB 2160x3840** one and grew `work/clips/` from 19.6 MiB to **768 MiB** —
~25x the disk for the most ordinary action in the app, with **nobody pressing
Build**. The reason it goes first is not that it is the worst bug in the
abstract: it is **the one that takes his machine down, and it fires on the
action he performs most**, two or three edits from out-of-space on a startup
disk that has been at 98%, where `ENOSPC` presents as a dropped connection. It
also **unblocks the three-clip run S37's exit needs** and collapses the
37-minute build, so it is on the critical path to this milestone rather than
beside it. **Not a jump** — same as S34: it is the open milestone's blocker.
**Second is S43**, five minutes of every build plus a fabricated verdict about
his video.

**One correction to the record that I am making here rather than quietly.**
Kayer was told the disk overrun during this run was an estimating error. **It
was not.** The import was ~1.65 GiB resident plus a transient 1.5 GiB of
staging, inside estimate; **the entire overrun was S42.** He should hear the
right cause from us rather than keep the wrong one.

**S35 stops being chased.** Three independent non-reproductions — Theo, me, and
now a real two-clip join in the packaged app, all measuring ~0.04s against a
0.067s window where 0.1s was reported — and the original `clipA`/`clipB` recipe
is not recoverable, because the preserved corpus kept the outputs and not the
ffmpeg commands. The tester declined to guess at it, which is right. **The row
stays open and unworked:** three non-reproductions is grounds to stop looking,
not grounds to assert the number was never real.

**M0.9 placed 2026-09-11 — "will my app clean itself instead of littering all
over my computer?", his words. And the scope split with S42, which I own.**

**Placed behind M0.8, not instead of it, and behind S42 within it.** S42 is the
acute instance and stays fix-first — it takes his machine down on his most
common action. But S42 and retention touch the same files, so the split has to
be stated or the second pass gets re-litigated by whoever arrives later.

**Ruling: S42 absorbs the intermediates half. Verified before deciding, not
assumed.** `work/clips/` is written by `build_cut.py:360` and `:527` and
**nothing in `lib/`, `app/` or `tools/` reads it** — a grep across all three
returns no reader — and **no step's `done()` check tests it**: `lib/pipeline.ts:427`
tests `cuts/` for a finished file and `:426` tests the proxy, neither touches
`clips/`. So "the build removes its own scratch when it finishes" breaks no
skip-logic, cannot orphan a generation by shifting indices, and is a few lines
inside the file S42 is already opening. **S42 therefore = the 4K path + the
orphaning + scratch removed at build end.** Doing it in two passes over the
same function is the waste that earns a visit nobody budgeted.

**M0.9 owns the three that are genuinely policy**, because each needs a stated
lifetime rather than a bug fix: past cut versions, `work/source-proxy.mp4`, and
`work/strips/`. **The framing that makes this a milestone rather than five more
rows: the app has no concept of how long a file should live.** Four things have
a cleanup owner — snapshots (`lib/snapshots.ts:160`, `prune` to `KEEP`), the
trash (`lib/trash.ts:76`, `RETAIN_DAYS = 5`), import staging
(`lib/importBatch.ts:533`), and a failed join's output (`lib/stitch.ts:302,342`,
S36's fix) — and four were never asked the question at all. Five separate rows
would each re-answer it differently.

**One useful thing the proxy's own `done()` check gives us free:** `:426` tests
for `work/source-proxy.mp4`, so a reclaimed proxy **regenerates by itself** on
the next run. That is why regenerable files can be cleared under pressure and
cut versions cannot.

**Do not scope a standing reliability role into this milestone.** A watcher
cannot stop the app littering; only the code can. The order is **leak (S42),
then retention (M0.9), then ask whether the role has any work left** — and if
the app genuinely cleans up after itself the answer may be "almost none", which
is the good outcome, not a gap. Written here because a monitoring role is the
kind of thing that gets added later by someone reading only the symptom.

**2026-09-11, the three-clip run: I agree with Nadia's pick, with one condition
added, and I am amending M0.8's exit line rather than letting it be met
sideways. Also M0.95 placed, ahead of M0.9.**

**Three of his clips became one video, and the picker chose between clips for
the first time** — clip 2's *"It is one of the best things you can possibly do
to put inside your body."* kept at 98% over a 90% attempt. That is R5's stated
intent, *"a line said better in clip 3 wins over clip 1"*, observed rather than
argued. 1130.63s joined against 1130.59s of parts — **40ms across two seams** —
exported 190.09s / 5702 frames, both seams clean on `blackdetect` and
`blackframe`, **A/V delta measured on all 123 rendered pieces with zero over one
frame**, and she played it in the native window. Library 1023 / 1023 / 0 changed.

**THE PICK: S38 first, not S37. Nadia's call, and I am ruling for it — with a
condition, because as stated it could be met by abdicating.** Kayer asked that
the pick be checked rather than taken, so here is the check.

**Her argument holds and one of my own is stronger than the one she gave.** She
says S37 is calibration already measured twice and tuning it on three clips
risks over-fitting — which is the exact mistake the topic-overlap signal made
on one shelf, recorded in this very row. True. **But the decisive reason is
ordering, not risk: with S38 done, an S37 fix becomes *evaluable*.** The seam
scored **-0.1** where `SEPARATE_AT` is exactly **-0.1** (`lib/grouping.ts:169`)
with `confident: false` against `CONFIDENT_AT = 0.5` (`:170`) — the weakest call
the rule can make — and `needsYourEye` was **empty**. Worse, and this is the
half that makes it plumbing rather than tuning: `lib/importBatch.ts:354`
persists seams as `{from, to, reasons}` only — **no `score`, no `confident`, no
`signals`** — so even a populated `needsYourEye` would have nothing to render.
Until that is fixed, nobody can tell an S37 fix from a coincidence, because the
number that would show the difference never reaches a screen.

**My condition, and it is the reason I am not simply agreeing.** Nadia's stated
consequence is that S38 lets M0.8's exit honestly become *"proposes one project,
**or asks**"*. I accept that — it is the design's own **"propose, do not
decide"**, and the third verdict plus `needsYourEye` were built for exactly this
seam. **But as written it can be met by flagging everything**, which is not
proposing, it is abdicating, and it would turn the tray into a questionnaire —
against this row's own promise that a confirm step *"costs one click when the
guess is right."* **So the amended clause is two-sided:** the tray must flag
`0061->0062` **and ask**, and in the same run must **not** ask about
`0060->0061`, which it called confidently. One question on the seam the rule
cannot call; silence on the seam it can.

**C37 goes in the same commit, and here I do disagree with "mostly".** Rendering
a flagged seam's confidence *forces* the card past `reasons[0]`, so the two are
one change — and C37's new evidence makes it correctness, not polish: `reasons[0]`
is the **same sentence template above a join and above a split**, one identical
sentence serving two opposite verdicts, with the deciding reason at `reasons[1]`
both times and neither reaching the screen. The truncation in the same string
(`lib/grouping.ts:422-425`, `…${t.slice(-45)}` slicing by character and landing
mid-word on *"…traight up"*) rides along; it is four characters of fix in the
function the card already calls.

**M0.95 placed AHEAD of M0.9, and the reason is a dependency rather than a
priority.** Kayer answered the 720p question — *"be like a proxy where it'll
play and we'll edit at a small resolution. And then when we export, then it'll
be bigger."* That settles Part 5 #9 in favour of the proxy: **the 720p review
render is correct and stays.** What is wrong is that **nothing renders full
resolution on the way out**, and `findCutFile` returns whatever cut exists, so
on a one-click project **the preview is the file he would upload** while the
dashboard calls it *"Approved - Ready to post"*. **It goes ahead of M0.9 because
you cannot write a retention policy for exports before exports exist** — B7's
version count is a question about exports, not previews, and answering it first
would set a policy for an artefact that does not yet exist. It also happens to
be the only defect on the board that reaches the outside world: he posts a
406x720 file believing it is finished.

**Rebundle before the next tester run: yes, agreed.** One line deletion on the
13:46 bundle costs **857 MB and 32 minutes**, disk is **3.6 GiB**, and *"an edit
now costs what the first build cost"* is currently a claim rather than a
measurement. It also capped the last run at one edit and cost the
refresh-mid-edit and import-during-build cases outright.

**2026-09-11, the last ruling of the day: N18 next, then the rebundle, and the
honest state of play for Kayer at the bottom.**

**N18 goes next, and I agree with the lean for a stronger reason than the one
offered.** The offered reason was that N18 caught a Critical fail-open before
anyone ran it as a gate, which is true and earns it a place. **The decisive
reason is that the rebundle is approved by the gate N18 repairs.**
`scripts/bundle-app:23-26` reads `scripts/test`'s exit code as the release gate,
that run's typecheck has **never looked at `tests/`** (`tsconfig.json:21` names
`**/*.ts`; all 21 test files are `.mts`), and **the known hole is in the join
path specifically** — two fixtures feeding `analyseBatch` -> `joinRefusal` are
incomplete, which is how S34's fail-open was reachable from two places rather
than one. Rebundling first means shipping the join on a gate with a known blind
spot over the join. **Fix the gate, then package.** It also needs no disk, which
matters at 3.6 GiB.

**Then the rebundle, and its payload is now much stronger than it was two hours
ago — which I only know because I read the branch rather than the report.**
`qa/S38-C37` carries **`4ff5213` S42**, so *deleting one line no longer costs a
gigabyte*, plus `de9733d` (C37 and S38's plumbing) and `bb345e7` (the S34
fail-open). **That changes my earlier reasoning:** I had been arguing the
rebundle should wait for a payload that changes what Kayer can do, and it now
has one. **An edit costing 857 MB and 32 minutes is the single biggest thing
standing between him and using this app tomorrow**, and it is fixed and
unpackaged. So the rebundle is not "queued behind S37" — it is next after N18.

**Then S38's remaining half**, and the ordering is deliberate rather than
alphabetical: N18's 14 errors are in `grouping.test.mts` and
`import-batch.test.mts`, which are **S38's own fixtures**. Doing N18 first means
the rest of S38 lands on typechecked fixtures instead of adding to them.

**Where I committed this, and why it is not master.** `DOCKET.md` and
`audits/LEDGER.md` are one-writer-at-a-time shared state, and their current head
is on `qa/S38-C37`, six commits ahead of master with **strictly linear history**
(`git merge-base --is-ancestor master qa/S38-C37` passes, so the merge is a
fast-forward). Committing the ledger to master instead would **fork the one file
that must not fork**. Master fast-forwards whenever Ruth is ready; I am not
merging somebody's in-flight code branch to make my own filing tidier.

**The honest stopping point for today: after N18. Not more.** It is nearly 10pm
and the developer has been running since morning. There is no gate, test or
milestone that improves by being done tired, and the two rows after N18 — the
rebundle and S38's remaining half — are both things whose value is
*verification*, which is the worst kind of work to do on momentum.

**And the honest answer to "is the app finished today", which Kayer should hear
tonight rather than discover tomorrow: M0.8 got its join and lost its
grouping.** That is real progress and it is not done. Three of his clips became
one video tonight, correctly — every machine-checkable property passes, the take
picker chose a better line from clip 2 over clip 1, and it plays in the native
window. **But the tray proposed splitting it into two, and a human had to click
"Actually one video" to get that result.** So the thing he asked for works, and
it does not yet decide correctly on its own. **What he can do with it after the
rebundle:** drop three clips, click *Actually one video*, get one cut — and edit
lines without paying a gigabyte a time. **What is not there:** the tray getting
the grouping right unaided (S38 then S37), and a full-resolution export, so
**nothing he exports today should be treated as the finished upload** (M0.95).

**2026-09-11, and this is the one that re-orders the product queue: Kayer said
what a finished video is. M0.85 placed ahead of M0.95 and M0.9, M0.95 split,
and R6 becomes a hard gate rather than a competitor.**

His words: *"I want this app bulletproof solid and these videos to be super
tightly cut. my usual time i have a finished video is about a minute."*

**Filed as R8. It is two requirements in one sentence and both are now being
acted on** — "super tightly cut" is M0.85 below, and "bulletproof solid" is
already live as a standing instruction (Desmond is auditing the multi-clip
guards for more S34-shaped fail-opens under it). Do not let the second half be
read as mood; it is why `bb345e7` exists.

**Measured against that number, the app has never once delivered it, and the
evidence was in his library the whole time.** Six rendered versions of
`img-9817` — 1:50, 1:48, 1:52, 1:51, 1:38, 1:38 — built across 38 hours, one at
**00:15** and the next at **07:07**, each roughly a little shorter than the last,
**never below 1:38 against a target of about 1:00. Then he stopped.**
`img-9823` abandoned at 2:59. Tonight's three-clip cut came out at **3:10**,
more than three times his target, and was reported to him as a success — which
it genuinely is about *joining* and is a failure about *output*.
**Nobody asked why there were six.** That is recorded in the ledger as **the
postable question**, because it re-weights existing rows rather than adding one.

**Confirmed here rather than taken on report: the app has no notion of a target
length.** `grep` across `lib/`, `app/` and `ugc-edit-system/tools/` for any
target, maximum or budget duration returns exactly one hit — `MAX_LEN = 2000`,
a character cap on learnings text. **The drafter's objective is "keep every beat
that is not a duplicate", so output length is whatever his raw footage happens
to reduce to.** On 18:50 of source that was 3:10.

**MY RULING ON THE SEQUENCE, and the honest part first: the recency check was
the right instinct and it lands in the wrong place.** Reacting to the newest
thing he said is a real failure mode and I have corrected it before. **This is
not that**, and the test is that the evidence predates the statement by four
days: six versions and two abandoned projects were on disk before he said a
word tonight. He did not give us a new preference; **he gave us the yardstick
that makes four-day-old evidence legible.**

**Where the self-criticism is right: R6 is unmet, and re-targeting the drafter
before a human has watched one of its outputs would be absurd.** So **R6 is a
hard gate on M0.85, not a competitor to it** — and the reason that resolves
rather than adjudicates is that **R6 costs one minute.** It is one `open`
command by Kayer, already in front of him. A prerequisite that cheap does not
get to be a sequencing argument; it gets done first.

**M0.95 splits, and that dissolves the competition instead of settling it.**
Its clause 3 — *the proxy and the export are the same edit* — **is S26, and S26
is M0.85's prerequisite**: he cannot tighten toward a minute on a clock that
reads 69 seconds high. **So S26 comes out of M0.95 and goes in front of M0.85.**
What stays behind M0.85 is the full-resolution export step, because **he does
not need a 4K export to judge whether a cut is a minute long and tight** — he
needs an accurate clock and a watchable proxy, and he has the second already.

**The resulting order, and each step is a prerequisite of the next rather than
a preference over it:** S38's second half (Theo mid-flight, not switching
horses) -> **R6**, one minute, his -> **S26**, the clock -> **M0.85**, the target
-> **M0.95**, the export -> **M0.9**, retention. **Retention stays last on the
same dependency as before**, strengthened: a retention policy for files he does
not want is worse than no policy, and B7's version count is a question about
exports.

**And I am overruling my own framing from four hours ago in one respect.** I
wrote that M0.95's export was *"the only defect on the board that reaches the
outside world."* That is still true and it is no longer the most important
thing about it: **an export of a three-minute video he will not post is not
worth exporting.** The export milestone was correctly placed against a standard
of *correctness* and is wrongly placed against a standard of *postability*.

**2026-09-11, delegated ruling: no front-end engineer. And the DOM harness is
not unowned — it is M2's exit line, which is the other half of the answer.**

Kayer delegated it: *"If we do, name him Chad. If Mara deems it unnecessary then
nevermind."* **Declined, recorded as Parked P2 with the full reasoning** so it
is findable rather than re-litigated. The short version: a second implementer
cannot coexist with a WIP limit of one, the roles work by refusal rather than
throughput, and the best argument for him is actually an argument for a designer.

**The harness question had a false premise and it is worth correcting, because
it was treated all day as an obvious good with nobody owning it.** It has an
owner and a place: **`A DOM harness exists` is the first clause of M2's exit
line**, already on the roadmap, and it is a dev row — M2's first slice. Nothing
needs placing.

**It stays where it is, behind M0.85, M0.95 and M0.9.** Every row it unblocks
(C39, C40, C41, S26's display half, Desmond's finding 11) is Medium, and **none
of them loses footage or fills his disk** — which is the bar this roadmap has
used all day for jumping the line. M0.85 is what he actually asked for and its
exit needs no harness.

**With a named trigger, so it does not float again: M2 moves up the moment a
row that needs the harness becomes the sole blocker on an earlier milestone's
exit line.** That is not hypothetical — it is exactly what happened when
C22/CG1 became M-app's blocker and left M2 for it. The precedent exists and the
rule is already written into M2's row.

**The boundary is written even though the answer is no**, because it is cheaper
than discovering it: **one writer per file**, and `review/page.tsx` and
`DropZone.tsx` are the named contended files. It is in PROCESS.md under "More
than one session at a time", beside the `--amend` rule from this morning, since
it is the same rule extended from two shared documents to the code.

**What is actually waiting on Kayer tonight — two things, both small, both
his.** **R6**: watch a cut (one `open` command; it is the last step of M0.8's
exit line and no agent can do it). **B8**: confirm or change the 45-75s band.
Nothing else on the board needs him, and neither of these should be guessed at
in the morning if he has not answered.

**2026-09-11, 11pm: B7 is answered and M0.9 no longer waits on anyone. B8 still
does.**

Kayer: *"Didn't we say keep the last 3 versions and we can let go of the rest?"*
**Three, and the rest can go.** He was told plainly that three had been **our**
recommendation twice and that he had never said yes — so the row had been open
with a guess attached rather than a decision. He then decided it. **The number
is his, and that is recorded as such**, because "he confirmed our guess" and
"he chose" are indistinguishable in a changelog a month later and are not the
same thing. It is also the whole reason the row waited a day rather than being
coded on the first evening, which is worth banking as a result and not just a
delay.

**Three things were left to me and are ruled in B7.** Prune **at build time**,
not on a timer — he spoke to the *how many*, not the *when*, and a timer
deletes his work while he is not looking at it. **Three *exports*, not three
previews** — and that scoping question dissolves rather than needing a call,
because **M0.9 is built after M0.95 in the order already set**, so an export is
a distinct artefact by the time retention exists; previews are regenerable and
get no policy from him at all.

**And one thing I added that he did not ask for, which I want visible rather
than buried in a row.** The first prune on a project that already has more than
three versions **names the files and asks once**, then never again. His consent
was to a policy, not to a list of filenames — and build-time pruning would
delete **`img-9817` v1 through v4 on his very next build**, about **1.65 GB**.
That is *"the rest"* he authorised, and it is also **the only surviving record
of him fighting the tool by hand**: the ledger preserves those six durations and
timestamps but **not what was cut between versions**, which is exactly what
M0.85 may need. One click, once per project, against irreversibly deleting half
a gigabyte of his rendered output under a policy that shipped while he slept.

**B8 — the 45-75s band — is still open and nothing should guess it.** It is the
only product question outstanding, and the two things waiting on Kayer are now
R6 (watch a cut) and B8.

**2026-09-11, the reference set: eight videos he cut himself. Where they live is
ruled here, and the exit line does NOT move to them.**

**Where they go: `~/Movies/SnipAi/reference/inspiration/`, and Kayer puts them
there through Settings -> "Videos to learn the style from."** That is not a
storage decision, it is the feature this app already has and **has never once
been fed**: `reference/inspiration/` exists and is **empty**, and
`app/api/references/route.ts:144-167` runs `measure_finished.py` across it and
derives the house style as **"median of them all"**. `References.tsx:19` even
describes the slot exactly — *"These aren't your footage — they're finished
videos whose rhythm you want."* One action by him does four things at once:
gives the only artifacts that define *done* a durable home inside the library he
backs up, feeds machinery built before this session and never used, derives
**B8's number from his own work rather than anyone's guess**, and makes the 15%
outlier harmless because a median absorbs it.

**No agent moves them, and that is deliberate rather than fussy.** Writing into
`~/Movies/SnipAi` is what N1 exists for and what standing order 3 forbids; the
one-time cost of him doing it is smaller than the precedent of us doing it.

**They do NOT go into the repo.** G5 and G6 are unresolved — real-name paths in
tracked files, and whether the remote is public has never been confirmed — and
these are videos of his face and voice. **The measurements in the ledger are the
version a test can assert against**, which is the whole reason the table is in
`audits/LEDGER.md` rather than in a message. ~25 MB of his likeness does not
need to be in git for the numbers to be usable.

**Whether M0.85's exit is stated against them: no, and the eight make that
argument stronger rather than weaker.** The exit stays *a cut from his own
footage lands near the length he chose and **he** says it is tight*. The reason
is now concrete instead of principled: **`5ca5169e` is one of his own videos at
15% silence, so a metric derived from seven of his videos would reject the
eighth.** **Steer by the numbers; gate on his judgement.** The eight become
M0.85's **steering instrument and regression corpus** — eight measured examples,
one instrument, no video generation — which is a real upgrade on "he says it is
tight" without becoming a substitute for it.

**One thing to check when he uploads rather than assert now:** whether
`/api/references` behaves sensibly when `inspiration/` goes from **zero** files
to eight, since the median-of-them-all path has demonstrably never run on real
input. Not filed as a defect — nobody has measured it — but it is the first
thing that will be exercised, and S27 has taught us three times that the
default-empty case is the one nobody tried.

**B8 is still his, and my own recommendation there was wrong at both ends and
wrong in shape.** Corrected in the row: 45-75 would have excluded three of his
eight videos, and worse, a band encodes a constraint he does not hold — he runs
37s to 83s by content. I argued against a soft target on the grounds it was
hardest to verify; the evidence says it was right about the shape.

**2026-09-11, end of day. Kayer put the PM in the driver's seat; here is the
order, and tonight's answer is "two things, then stop."**

His words: *"why don't you let Mara in the driver's seat. I want this app done
right, solid, bulletproof... don't want to rush and want to utilize the team you
and I built to their fullest potential."* Recorded in PROCESS.md with what moved
and what deliberately did not. **Filed as R9.**

**"Fullest potential" is not "everyone busy", and the distinction governs
tonight.** Four roles are idle at midnight. Using them fully means not shipping
the four errors that were caught in the previous two hours — it does not mean
finding each of them something to do before morning. Kayer asked for no rushing
explicitly, so **stopping is a decision here, not a default.**

**TONIGHT — two things, neither of which builds anything.**

**1. Ruth: fast-forward `master` to `76cba1d`.** Verified safe:
`git merge-base --is-ancestor master HEAD` passes, master is 5 behind, it is a
fast-forward and not a merge. **Do not push** — his standing instruction. The
reason this does not wait for morning is **G1**, a filed row about this exact
exposure: every fix from a session existing only on one branch on one Mac. It
makes today durable without constructing anything.

**2. Claude: establish where the nightly's schedule lives. A question, not an
action.** I checked before ordering containment and **the evidence does not
support urgency, so I am not ordering it** — `crontab -l` and `launchctl list`
show **no snipai or nightly entry on this machine**, so I cannot say it will
fire again at 05:08 and will not pretend otherwise. **And the run behaved far
better than its provenance suggested**, which I had assumed it would not: it
opened `~/Movies/SnipAi/projects` **read-only**, generated a synthetic 185s
`.mov` rather than using his footage, had deletion refused by a safety
classifier and **moved its staging to `_to_delete/` instead of removing
anything**, and declared all of it in its own first twenty lines. Six findings,
nothing critical.

**Two real process defects remain and get rows in the morning, not tonight:**
the skill it was meant to invoke, `snipai-nightly-qa`, **does not exist**, so it
ran an embedded fallback copy that its own header says will drift; and it
**selected its data root by fallback**, landing on `qa-m08` — the tree holding
the preserved transcript corpus. Verified intact: library 1023 files / 8.8 GB
unchanged, `qa-transcripts` 252 KB / 11 files. **Nothing was harmed and that was
partly design and partly luck, and the fallback data-root selection is N1's
shape** — a process choosing a library at runtime with no owner.

**TOMORROW, in this order.**

1. **Claude (PM lane): file Desmond's fifteen and triage the nightly's six.**
   My own backlog is the blocker on everything else — findings living in
   messages are not findings, and nothing should be dispatched against a
   half-filed board. **Check one thing first:** the nightly's own second
   headline — *"a guard that is supposed to keep the ledger honest reports a
   parse failure as a disagreement"* — may **be T20**, and a duplicate id is
   worse than a late one.
2. **Theo: the empty-transcript scoring.** `[]` is truthy, so a silent clip
   reads as *"ends on a complete thought: \"\""* at −0.15 toward separate and
   `notTranscribed` never fires. **First because it is in the code that shipped
   tonight**, it is S39's family — a wrong answer wearing his own words — and
   `grouping.ts:76`'s own comment names the distinction the code fails to make.
3. **Theo: `qa --full` runs the regression board twice**, because
   `guard-ledger.py` re-runs it for per-id results. S42's ~90s of real ffmpeg is
   paid twice per run and **compounds with every video-touching board file**.
   Same rule as N18: repair the instrument before leaning on it.
4. **Theo: `Info.plist` into `bundle-app`** — one line, **P16**, and the
   difference between this app existing on one Mac and existing in the repo.
5. **Ruth: `_to_delete/` (9.4 MB) and `.qa-stage/`**, after confirming both are
   the nightly's staging and nothing else.

**BLOCKED ON KAYER, and this is the important line: the biggest item on the
board is gated on one action by him.** **M0.85** needs B8's number, and my own
ruling says that number should be **measured from `reference/inspiration/`**
rather than chosen — and **E7** needs the eight references somewhere a test can
reach. So both halves of *"super tightly cut"* wait on him putting eight files
into Settings → *Videos to learn the style from*. Also waiting: **R6** (watch a
cut), what **`5ca5169e`** is, and B8 itself. **Nobody should guess any of the
four.**

**2026-09-11, 23:50 — closing the night. Both items done, one new action for
tomorrow, and a routing rule.**

**`master` is at `b481e72`, fast-forwarded not merged, 7 commits unpushed per
his standing instruction.** Correct.

**Routing: mechanical local git does not need Ruth, and here is the line so it
is not asked again.** Ruth's lane is not *"runs git commands"* — it is
**whether what exists can leave this Mac**. A local fast-forward does not leave
this Mac, so it is execution and whoever types it is a detail. **A push, a tag,
or producing a bundle does leave**, and those are hers, with a checklist rather
than a command. **What Ruth genuinely should be dispatched for, and soon:** G1
(now **7** unpushed commits), G2 and G3 (stale remote and merged local
branches), and the growing pile of untracked artefacts at the repo root — her
full checklist **minus the push**, which his standing instruction forbids. That
is a real job and it has been waiting all day.

**The nightly is filed as G9, and it is filed because it cannot be closed from
here.** Four registries are empty — `crontab`, `launchctl`,
`list_scheduled_tasks`, `CronList` — and a run still fired and wrote 25 KB into
the repo, so the remaining candidate is a **server-side cloud routine on his
account**, reachable only by him. **I am not having the `snipai-nightly-qa`
skill created tonight**, and the reason is this project's own worst pattern
rather than caution: a skill whose only consumer is a process we cannot see,
cannot invoke and cannot verify picked it up is a fix whose success is
**unobservable until the next run**. That is a thing reporting success about
something nobody measured, which is M1's entire subject. It waits on the
routine's prompt, which is his.

**ONE NEW ACTION FOR TOMORROW, and the timing is measured rather than assumed.**
`05:08 UTC` is **22:08 local** (confirmed: `date` reads 23:50 PDT, UTC-0700), so
the nightly **already fired tonight** and next fires in about **22 hours** —
there is no midnight scramble and I am not inventing one. But before 22:08
tomorrow: **copy `~/Movies/SnipAi/qa-m08/qa-transcripts` (252 KB) to somewhere
outside `~/Movies/SnipAi/`.** It is still sitting in the exact tree the fallback
selected and wrote a synthetic `.mov` into. **Copy, not move** — a copy disturbs
nothing and leaves the original where every row already points. **Claude's
safety lane, not an agent's**, and outside the library root rather than into the
repo, because these are transcripts of his speech verbatim and G5/G6 are still
unresolved. 252 KB against 42 minutes of transcription that cannot be re-run
without his footage and another evening.

**The order for tomorrow is unchanged otherwise**, and the line that still
matters most: **the biggest item on the board is gated on one action by Kayer** —
eight reference videos into Settings → *Videos to learn the style from*, which
unblocks both halves of M0.85. Plus R6, and what `5ca5169e` is.

**2026-09-12, 00:xx — he retargeted M0.85, the measurement contradicted him, and
the resolution corrects one of my own statements from two hours ago.**

**His instruction:** *"Forget the rule of my videos being about a minute the
important thing is how fast the cuts are."* **And he withdrew a reference
video** — `5ca5169e`, *"deliberate pause for effect. I was gargling mouthwash
and sped it up... I should not have included that as an example."* **Seven
references now, by his instruction rather than by our statistics**, which is
worth the distinction: we kept it in deliberately and he removed it.

**On the axis he named there is no gap, and I am not softening that into
agreement either.** The app cuts at **22.6-28.1 cuts/min** against his
**17.0-28.9**, a **2.11-2.59s** average shot against his **1.97-3.28s**, all
three outputs inside his range, **tonight's cut faster than six of his seven
videos.**

**The resolution: cuts-per-minute is a PROXY for "how fast the cuts are", and
the app satisfies the proxy while failing the property.** Two reasons, both
already filed, and both feel slow to a viewer while the cut counter reads
correct: **a cut that lands and then waits** (E7 — 5.6-6.2% silence and a
shipped 1.99s internal gap against his zero) and **a cut that lands and repeats
the line it just said** (E5 — eight attempts at one line across 24 of 33.75s).
**This is the fourth time a proxy has been satisfied while the property failed,
and the first time it happened in our own analysis rather than in the product** —
`verify_edges.py` certified a clipping build, `verify_cut.py`'s FAIL reached no
surface, and now a rhythm metric built from his own videos certifies a
190-second cut he would not post.

**So M0.85's exit is resolved and it stays his judgement — with the strongest
argument available, which is a demonstrated one rather than a predicted one.**
**Had cuts/min been written into that exit line this morning, M0.85 would be
closeable right now on a cut he would not post.** The exit is now two parts: a
**floor of two measured refusals** (no unexplained internal pause, no line said
twice — their job is refusing candidates, not declaring success, so his
judgement is never spent on a cut we already know is wrong) and a **gate that is
him** (he watches a cut from his own footage and says the cuts are fast).
**Cuts/min is retired as a target and kept as a regression guard**, because a
matched metric's remaining value is stopping a fix from breaking it.

**Duration leaves the exit by his instruction, and the distinction is kept:**
*"forget the rule"* withdrew **a constraint we wrote**; it did not say 190
seconds is fine. Duration stays a reported observation and is not a goal.
**B8 is parked as P3** — withdrawn before it was ever answered, kept because the
history is instructive: it was asked rather than guessed, my own 45-75s
recommendation was then shown wrong at both ends *and* wrong in shape, and then
the question was retired by the person it was waiting on. **Nothing was ever
coded against it.**

**CORRECTION TO MY OWN ORDER FROM TWO HOURS AGO, and it is the practical
consequence: E5 is NOT gated on Kayer's upload.** I said both halves of "super
tightly cut" waited on him putting eight files into Settings. **E7 does** — it
needs the references somewhere a test can reach. **E5 does not**: it needs
`beats.json`, a joined project and the drafter, all of which are on disk. **So
E5 is the first substantive piece of work available tomorrow with nothing
blocking it, and it is now the ruled lever on every reading of his
instruction** — repetition, not length, which is why it survived him
withdrawing the minute.

**Tomorrow's order, updated.** (1) Me: file Desmond's fifteen and triage the
nightly's six, checking first whether its guard finding **is T20**. (2) **Theo:
E5** — collapse near-duplicate beats into one beat with many candidate takes;
the picker already works. (3) Theo: the empty-transcript scoring. (4) Theo:
`qa --full`'s double board run. (5) Theo: `Info.plist` (P16). (6) Ruth: G1 (8
unpushed), G2, G3 and the repo-root pile — her checklist **minus the push**.

**Waiting on Kayer, now three:** R6 (watch a cut), the seven references into
`reference/inspiration/` — **and ask him then whether `5ca5169e` is excluded**,
since "a bad example" reads as exclusion but that is an inference and the folder
is his to fill.

**2026-09-12, and this one reverses my own "nothing more tonight" for exactly
one action. He named the mechanism, and it is already three-quarters built.**

**His words:** *"there is a slight trick I do... when I cut each clip I separate
the audio from the clip... start the sound a millisecond or two early so it's
like it's mixing in sound a bit like a dj mixing in songs but way smaller."*
Then: **"That's how it sounds so tight. I want you to match my videos."** And
the magnitude, asked and answered: **"I mean a frame or two sometimes 3"** —
**1-3 frames, 33-100 ms at 30 fps**, not the 1-2 ms the first description
implied.

**That is a J-cut, and it is H4 — which has been sitting in Half-built as a
feature nobody asked for.** He has now asked for it by name as the cause of the
quality he has been describing all night. **So H4 leaves Half-built and becomes
work, and that is the section doing its job:** the product question a HALF-BUILT
row exists to put in front of him was answered by him, unprompted, before
anybody built against a guess.

**Verified line by line rather than recalled:** `lib/types.ts:10-11` already
carries `audioStart?`/`audioEnd?`; `build_cut.py:346-350` already builds a
`detached` map from them; `build_cut.py:506` writes `cuts/cut.mp4` while
`lib/pipeline.ts:220`/`:711` match only `/-v(\d+)\.(mp4|mov)$/i`. **The UI, the
API and the Python all exist; the script has never been invoked and could not
succeed if it were.**

**THE ONE ACTION TONIGHT, and it is an exception I am naming rather than a
quiet reversal.** Run the audio-onset versus scene-change correlation across his
seven references. **The reason it earns the exception: it is the only action
available that can change WHAT tomorrow's work is, rather than advance it.**
Measurement that could invalidate a plan is worth more before the plan than
after — and if a measured J-cut is how he reaches ~0.00s internal silence, then
**E5, E7 and H4 are one piece of work rather than three**, which reshapes
tomorrow entirely.

**Pre-registered prediction, so the result cannot be read charitably after the
fact — which is this project's oldest failure:** audio should precede picture by
**33-100 ms consistently** across the seven. **If it does, the fix has a
measured constant instead of a remembered one. If it does not, H4 is NOT the
mechanism, something he has not named is, and we stop before building it.**

**Who runs it: Claude, not Desmond.** Desmond reads code and never runs
anything — measuring media files is neither code review nor app operation, and
dispatching him into it would break the refusal that makes him useful. It is
evidence gathering, which is the executing seat's lane and has produced every
measurement tonight. One script, no rendering, against
`~/Documents/SnipAi-evidence/`, zero disk, nothing near his library.

**And the real difficulty of H4 is not the filename — it is three offsets.** His
33-100 ms, `--snap-lead`'s 10 ms applied to the whole segment, and E1's 40 ms
`FRAME_PAD` already inside the `afade`-out maths. **The two that exist were each
derived for a different reason, and a naive lead on top of both is three
interacting offsets tuned by whoever notices last.** In H4's row.

**The estimate: recorded, endorsed, and amended with what would falsify it.**
Two to four working sessions, most likely three, for the narrow finish line —
retakes collapsed, dead air at zero, the J-cut running, the preview clock
honest. **PROCESS.md's "no estimates" rule is amended rather than broken:** it
does not survive Kayer asking directly, because *"I don't do estimates"* is not
an answer to the founder asking whether he can post this weekend. **What I am
adding, and it is the conservative read: the estimate assumes no discovery like
H4, and tonight produced four scope changes in one session** — H4 re-weighted, a
retarget, a reversal on B7, and a withdrawn reference. At that rate three is
optimistic. **But one scheduling fact pulls the other way and is worth more than
the caution: the rate limit is verification runs, not implementation.** Each
change is two to four hours; a verification run on his footage cost **2h40m**.
So **the four changes should be batched into as few verification runs as
possible**, and if tonight's measurement shows E5/E7/H4 are one mechanism, three
sessions becomes achievable rather than hopeful. **If he wants a firmer number
he gets mine, and it will be built on that batching rather than on optimism.**

**2026-09-12: Kayer lifted the stop — *"Keep working around the clock!"* Here is
who starts on what, and why the WIP limit is untouched by dispatching four
roles at once.**

**What his instruction changes and what it does not.** It lifts the pause. It
does not lower the bar — he has said *"bulletproof"* and *"built right"* three
times tonight against *"don't want to rush"* once, and the verification standard
stays exactly where it was. **And the half of my stop that was about error rate
still stands:** it was never that the agents tire, it was that four wrong calls
shipped in two hours from the seat that was moving fastest. Continuous operation
is compatible with that as long as sequencing stays here and evidence keeps
arriving as evidence.

**THE WIP LIMIT IS NOT BEING BROKEN, and the distinction is the same one that
declined a front-end engineer this evening.** PROCESS.md says one row. **One row
means one thing being *changed*.** Of the four roles going out, **only Theo
writes code.** Desmond reads and produces nothing; I file rows; Claude measures
artifacts. That is the loop in PROCESS.md running normally around a single row,
not parallelism — and it is why the Chad ruling was about *two implementers*
rather than about five roles.

**1. Claude — the audio-lead measurement, first, and it gates Theo's
ASSIGNMENT rather than his start.** One script, no rendering, no disk, against
`~/Documents/SnipAi-evidence/`. It runs in minutes, so sequencing Theo behind it
costs nothing. **Pre-registered prediction, written before the result so it
cannot be read charitably afterwards: audio precedes picture by 33-100 ms
consistently across the seven. If it does, H4's constant is measured off his own
work rather than remembered. If it does not, H4 is not the mechanism, something
he has not named is, and we stop before building it.**

**And not Desmond, for the second time it has been proposed.** He reads code and
never runs anything; measuring media is neither code review nor app operation,
and using him as a measurement harness spends the refusal that makes him
valuable. **There is a better use of him that IS his lane — item 2.**

**2. Desmond — verify the nightly's six findings against the code**, starting
with whether its *"a guard reports a parse failure as a disagreement"* **is
T20**. That is exactly his charter: read adversarially, confirm or refute, file
nothing. A duplicate id is worse than a late one, and the report came from a
process that could not find its own skill, so its claims get read before they
get believed.

**3. Me — file Desmond's fifteen.** My own backlog is the standing blocker;
findings living in messages are not findings.

**4. Theo — assignment decided by item 1.** If audio leads consistently, then
**E5, E7 and H4 are one mechanism and he gets them as one scoped row**, which I
will write. If it does not, **E5 alone**, as already ruled — justified on
repetition, which is why it survived the minute being withdrawn.

**5. Ruth — G1 (8 unpushed), G2, G3 and the repo-root pile, her checklist minus
the push.** **One hard constraint: she does not touch `QA_BUGREPORT2026-09-12.md`
until items 2 and 3 are done.** It is the only copy of that run's findings and
it is untracked, so a hygiene sweep would delete evidence.

**6. Nadia — idle by design, and this is a decision rather than an oversight.**
Her run costs **2h40m and several gigabytes**, and there is nothing new to
verify: everything merged was already verified. **Her next run is the batched
verification of E5/E7/H4/S26 together**, which is the scheduling fact the
estimate rests on — the rate limit is verification runs, not implementation, so
four changes through one run is the difference between three sessions and six.
**Also: the nightly fires at 22:08 local, ~21 hours out, from a session none of
us can see or stop (G9), so a Nadia run should not be in flight across it.**

**The unfixed data-root fallback is accepted risk until Kayer can reach the
routine.** The corpus is duplicated outside the library and verified
byte-identical, `qa-m08` is a throwaway tree, and his real projects were opened
read-only last time. **It is not fixed, it is survivable, and it is his to fix.**

**2026-09-12: Theo is confirmed on E5. The hold is lifted, and the useful thing
is the rule that comes out of it rather than the correction itself.**

**Kayer described mid-sentence splicing, and one more question settled what it
was worth:** *"I first take the best take. If I don't have a best take I do
option two. It doesn't happen all the time but maybe keep in mind."* **So
best-take selection is his primary method and composition is an occasional
fallback.** E5's scope was **incomplete, not wrong** — and it is his primary
technique, which the app does not do today: it keeps eight attempts as **eight
beats**.

**THE RULE, and it is cheap, specific and reusable — which "don't conclude
fast" is not.** When he describes a technique, **ask whether it is primary or
occasional before re-scoping anything.** Both of his descriptions tonight were
true; the second was incomplete, and the error was treating a described
mechanism as a complete model. One question — *"is that how you usually do it,
or the exception?"* — separated a lever from a footnote and cost nothing.
**That is the same class as B7, B8 and the frames-versus-milliseconds question:
every expensive mistake available tonight was one question away from being
avoided, and every question was cheap.**

**On the correction itself: it cost a held dispatch of minutes and no code, and
the loop is what caught it.** Held, questioned, corrected, unheld, before
anything was built — that is the process functioning rather than failing, and it
should not be over-weighted. The version of the ledger that said *"E5 would have
shipped something that changes nothing"* **never entered history**; it was
corrected in the working tree, so the record carries only what turned out to be
true. **The thing worth keeping is that the correction came from him and not
from us** — twice tonight, and neither was inferable from the footage.

**What survives from the wrong turn, and it is not nothing:** **E8 is filed** —
real, his, and occasional, behind E5 and not folded into it. Its content is
unchanged and well-founded: `lib/types.ts` cannot express one line whose picture
comes from two source spans, and the type's **own comment at `:16-19`** records
why (*"two rows saying the same line"*), which is the invariant any fix must
preserve. **And `verify_edges.py` will flag his splices as defects** — a third
false-positive family after S44 and S47, now a future problem rather than a
blocker.

**Two updates to rows that the correction pointed the other way.** **H4 gets
STRONGER, not weaker:** he applies the audio lead at *every* cut — *"when I cut
each clip"* — and composition is occasional, so **the J-cut covers all his
junctions and E8 is a special case of it.** And **E7's emergent hypothesis now
runs through H4 rather than E8**: his 0.00s internal silence is more likely a
consequence of *how he joins* every cut than of *where* he occasionally splices.
**Which the measurement already running will show**, and it is why E7 should not
be started before it lands.

**Confirmed assignments, all four running:** Claude on the audio-lead
measurement with the prediction pre-registered; Desmond on the nightly's six
with T20 first; **Theo on E5 alone, as originally ruled**; Ruth on G1/G2/G3 and
the repo-root pile with `QA_BUGREPORT2026-09-12.md` untouchable until Desmond
and my filing are done. Me on Desmond's fifteen. **Nadia still idle by design**,
her next run being the batched verification.

**2026-09-12: THEO IS CONFIRMED ON E5 — go. No second J-cut measurement. Ruth's
constraint extended. And the control condition becomes a process rule.**

**1. Theo: E5, confirmed, and the null result made this decision stronger rather
than weaker.** E5 is verifiable **without Kayer** — fewer beats, correct
grouping, the picker choosing per line instead of per clip, all measurable on
disk. **H4 now is not:** the measurement cannot confirm its constant, so its
only verification is his ear. **So the row that can be proven goes first**, and
that is E5 on its own, exactly as ruled before the detour.

**2. No second attempt at measuring the J-cut, and the reason is not cost.** The
deeper finding in that report is decisive: **a J-cut's purpose is to leave no
audible seam, so the better it is done the less evidence it leaves.** Spectral
flux or MFCC discontinuity would be a better instrument aimed at a signal that
is *designed to be absent*. **And we do not need it: the constant gets validated
by the gate that was always going to be the gate** — M0.85's exit is *he says the
cuts are fast*. Spending another cycle on instrumentation to avoid asking him to
listen is backwards; listening is cheaper and it is the actual acceptance test.

**So H4 is built on his number, and the row must say so: 1-3 frames, from his
recollection, NOT from measurement.** Default **2 frames (67 ms)**, **adjustable
rather than compiled** — which is B7 and B8's lesson applied to an engineering
constant, since he is the only one who can hear whether it is right. **And it is
a net figure, not an additional one:** it has to be reconciled against
`FRAME_PAD`'s 40 ms and `--snap-lead`'s 10 ms, which is already the row's stated
difficulty. **If it sounds wrong, the first hypothesis is the constant and not
the implementation** — recorded now so that is cheap to test later.

**3. The control condition is now a PROCESS.md rule, and it is the most valuable
thing produced in the last hour.** *Any measurement of his work is run against
the app's output as a control before it is believed.* If the instrument cannot
separate them, it is not measuring the thing. **It is the same discipline as the
first assertion in S8's test** — prove the harm reproduces before asserting the
guard — moved from tests to measurements.

**On the two proxy instances that arrived within an hour of each other from
opposite directions**, now six tonight: one where an instrument certified a
property it could not see (the J-cut null), and one where two surfaces "agreed"
because **they were reading the same variable** (the nightly's row 15, appended
to S26). **The single line worth keeping: an agreement between two readings of
the same variable is not an agreement between two measurements.** Six instances
in one night stops being a series of accidents and starts being this project's
dominant failure mode — and the control condition is the first *general* defence
anyone has proposed for it. Every previous fix was per-instance.

**4. The nightly's six are triaged and filed**, on Desmond's verification rather
than on the report's word — which was the point of reading before believing.
**BUG-003 is NOT T20** and is filed as **T21** in a broader form than reported:
four separate "I could not read the board" conditions all print as *"the ledger
and the bug board disagree"*, which sends the reader to edit the ledger when the
fault is a filename. **BUG-001, BUG-004 and BUG-005 fold into C33** with one
genuinely new sub-claim (`page.tsx:2496` gates on `candidates ?` rather than
`candidatesLoading`, so a failure renders under *"Scanning source region..."*)
and one that is worse than reported (**"Cut" is the verb for four different
operations**, against the spec's own reserved meaning). **BUG-002 is S53.**
**BUG-006 is refuted and the discard is recorded** so it is not re-filed — it is
pinned by `tests/reorder.test.mts:28-29`, and **its own "needs clarification"
label was right while its defect framing was not**, which is the distinction C38
exists to honour.

**5. Ruth's constraint is extended, and she is clear to go otherwise.**
`QA_BUGREPORT2026-09-12.md` **and `qa-screenshots/2026-09-12-nightly/` (38
files)** are untouchable — the report is filed now, but those screenshots are
the only evidence behind claims we have partly refuted and partly folded, and a
hygiene sweep would delete the ability to re-check them. **Everything else on
her checklist is clear: G1 (10 unpushed), G2, G3, `_to_delete/` and
`.qa-stage/`. Minus the push.**

**2026-09-12: two clarifications retract a guess of ours and size E8 cheaply, a
third request turns out already built, and one standing assumption of mine was
false — Desmond has been blocked on something I never received.**

**HIS CLARIFICATION RETRACTS OUR SPECULATION, and the retraction is recorded
rather than the line quietly replaced.** *"If I'm saying a sentence I don't cut
in between each word. I cut out dead space so there's zero dead air."* Two
hypotheses had been floated in E7 — that his 0.00s silence was emergent from
*where* he cuts, then from *how* he joins. **Both wrong. He removes the dead
space deliberately.** The record should not carry our guess as a hypothesis
about his technique after he has answered plainly.

**And it makes E7 much smaller: possibly a constant rather than a feature.** The
app **already removes silence** — 56 interior removals in tonight's cut, living
only in `edl.json`. It removes gaps above ~3s and leaves everything below; **he
removes all of them.** Same operation, one threshold apart, and that is the
entire measured gap. **The existing warning in the row is now his stated intent
rather than our caution:** not a global 0.25s floor — a tighter *interior*
threshold with the tail and deliberate beats exempt, and `5ca5169e` proves
deliberate beats exist because he withdrew it as *"a deliberate pause for
effect."*

**E8 is sized, and it came back the cheap way.** *"I usually splice between
words. I don't think I splice inside words."* **Word boundaries, so the
transcript's existing per-word timings are sufficient and no sub-word audio
alignment is needed** — a contained build rather than a research problem. **That
was the question flagged as sizing E8, and one question decided between
scheduling it and deferring it indefinitely.**

**THE PATTERN IS NOW THREE FOR THREE TONIGHT, and it is this docket's founding
observation recurring.** `reference/inspiration/` — house style measured from his
own videos, **empty**. **H4** — the J-cut, complete and **never invoked**.
**`reference/glossary.json`** — 15 definitions, **present and unsourced**.
**This app's problem is not missing features; it is features built to ninety
percent and then never fed or never invoked.** That is the fade handle, three
times in one night, on three different features. **Anything he asks for should be
checked against the codebase before it is scoped as new work** — three for three
is no longer a coincidence.

**On his definitions request: filed as R11, ledger H12, and the one decision is
B9.** The important finding is that **the safety already holds** — I checked
rather than assumed: the glossary's `_note` claims *"the app will not burn an
unverified card in without an explicit override"*, and `plan_graphics.py:137`,
`GraphicsPanel.tsx:112-268` and `graphics/route.ts:97-99` all implement it, with
**0 of 15 terms verified.** **So nothing unsourced has reached a video**, and I
am not filing this as a live harm. **His two graphics requests are one feature**,
as you said: the app proposes a sourced definition, he sees the source, edits or
accepts, and only then does it burn in — *propose, do not decide*, the same
pattern as the import tray.

**THE CORRECTION THAT IS MINE: I have never received Desmond's fifteen
findings.** I have been naming "file Desmond's fifteen" as the only thing
gating him, in four consecutive orders, on the strength of *"you have them"* —
**and they have never been enumerated to me in any message.** I cannot file
fifteen findings I have not been shown, and **Desmond has been idle for hours
behind an item that was never actionable.** Hand them over and they are filed
immediately. **My own backlog was the blocker and my own assumption was why
nobody noticed** — which is the same failure I have corrected in others tonight,
so it belongs in the record in those terms.

**And the pattern worth acting on: asking him is the highest-yield activity
available.** Four clarifications in twenty minutes, from a man who said he was
going to sleep, each a cheap answer to an expensive assumption — B7's number,
B8's withdrawal, the frames, the word boundaries, the dead air. **Every
expensive mistake available tonight was one question away.** When a row's size
depends on how he works, **ask before scoping**, and ask one question rather
than a list.

**2026-09-12: Desmond's fifteen are filed — S54-S64, C43, U13. Desmond is
unblocked. And two of them are prerequisites of the M0.8 verification run
rather than queue-jumpers.**

**Thirteen new rows for fifteen findings.** Two were already fixed by Theo
tonight (`decidedBy`'s direction in `a0550d2`; `fakeProbe(): any` after
`5829ecc`, whose annotation then revealed **four more unchecked `.video`/`.audio`
reads the `any` had hidden**) and one is inside S38 (`confident` being
arithmetically empty — 13/13 `same`, 0/9 `unsure`, 1/5 `separate`).

**FIX-FIRST IS S54, and I am adopting Desmond's argument verbatim rather than
restating it: *you cannot tell whether the app is solid while its most expensive
operation reports the same thing either way.*** A failed *join* throws correctly
because clips stay staged; a failed *pipeline* happens after `moveInto`, so the
batch is discarded and **the tray says "done" on an import that produced
nothing.** The honest case is the one where nothing happened.

**S61 is second, and the pairing is the point.** Two clips whose names resolve
to the same staged file **silently overwrite each other while both report
`✓ copied`** — and the realistic trigger needs no sanitisation at all, because
the picker hands over basenames and he shoots on a phone where `IMG_` numbering
recycles across folders. **S54 is what would make S61 visible.** One drops a
clip; the other guarantees he is not told.

**AND THAT IS WHY NEITHER IS JUMPING THE QUEUE — they are prerequisites of the
run that closes the open milestone.** M0.8's exit is a tester run against the
packaged app. **A run cannot be believed while every failure in the import path
renders identically and a clip can be dropped without a word.** That is the same
ruling shape as N18 before the rebundle and S38 before S37: **repair the
instrument before leaning on it.** Third time tonight, same reasoning, and it is
the one pattern I have not had to revise.

**Order: Theo finishes E5 (in flight, `lib/types.ts` and `lib/retakes.ts`), then
S54, then S61 — and only then is the M0.8 verification run worth Nadia's 2h40m.**
The remaining nine (S55-S60, S62-S64, C43) are High-to-Medium and queue behind
that; **S55 sits immediately after, since it is the empty-transcript row already
handed back and it is S39's family at the limit case.**

**One relationship in the slice that changes how a row gets fixed rather than
when: S63 is S35's constant from the opposite end.** S35's reported premise was
that the drift window is too **tight**, and it never reproduced across three
attempts. S63 is a measured demonstration that the same window is too **loose**
and fails open — six clips at 30fps gives ≈0.6s, so a dropped 0.4s clip passes
and `beats.json` records six clips joined for a file containing five. **Both
cannot be fixed by moving the number. The shape has to change**, and whoever
takes either should read both. S63 also catches a comment asserting a bound the
code does not have — `:340-342` claims S34 bounds the parts, but `joinRefusal:202`
compares the per-track figure and never inspects `container`.

**U13 is filed as a sweep rather than six rows, because two of its dead fields
ARE why a High row cannot be seen.** `Batch.proposal.basis` is rendered nowhere
and **it is the one field that would have told him the batch fell back to
filename ordering** — S56's trigger. `JoinOutcome.basis`/`ordered` are returned
and never read, **which is why S56 is undetectable from any surface**: the join
reports the order it actually used and nobody listens. **A dead field and a High
defect turning out to be the same thing seen twice is the sharpest item in the
sweep.**

**On the handoff itself, and then it is closed:** the symmetry Desmond's
coordinator drew is exact and worth keeping — *a fix whose success is
unobservable* (my reason for not creating the `snipai-nightly-qa` skill) and *a
handoff whose failure is unobservable*, because the receiving seat cannot know
what it was not sent. **The general form covers both: a step whose failure
produces no signal will fail silently and for as long as nobody happens to
check.** That is S54's defect, N18's defect, and this evening's process defect,
in one sentence. **Standing correction: "you have them" is not a handoff. The
content is the handoff.**

**2026-09-12: S54 merged. Three rulings — the test change is approved with one
condition, T20 goes ahead of S61, and the filler question is closed by
measurement rather than built.**

**RULING 1 — the changed assertion is approved, and it is the right kind of
change.** `tests/import-batch.test.mts` asserted `existsSync(batchDir(id)) ===
false` after a clean import. **That assertion cannot both hold and let the
client observe an outcome**, so something had to give. He kept its stated
intent — *"staging is gone only because every clip found a home"* — by asserting
**that** instead: no clip of his remains staged. **Approved, because it replaces
a proxy with the property.** The batch record's lifetime is an implementation
detail; **where his footage is, is the invariant**, and the new assertion tests
the invariant directly. That is the seventh instance tonight of proxy-versus-
property and **the first one where the fix runs in the right direction.**

**One condition, and it is not a formality: the reclaim has to be asserted
too.** The old assertion was doing a second job nobody named — proving the
record does not accumulate. Without that, this trades a silent *"done"* for a
slow leak, **and S58 is already an open row about exactly that class** (a batch
whose status never moves is never swept). **So: a test that a terminal batch is
actually reclaimed, by the tray's `DELETE` and by `sweepAbandonedBatches`.**
With that, approved as it stands.

**And the fix being better than the scope is worth recording.** Desmond scoped
*reorder `failJob` before `discardBatch`*. Theo worked out that **reordering
would not have worked** — the gap is a few filesystem operations against a
1200 ms poll, so the client essentially always arrives after the delete and
reads a 404 it cannot distinguish from *"vanished"*. **He fixed what the client
can observe rather than what order the statements run in.** Third time tonight
that the reported cause and the real cause differed and the implementer caught
it (S34's fail-open, S35's unreproducible premise, this).

**RULING 2 — T20 goes ahead of S61, and I applied a test to myself before ruling
it.** This is the **fourth** "repair the instrument first" ruling tonight
(N18, S38, S54, now T20) and four in a row is a habit rather than a judgement
unless it survives a check. **The test: does the blindness compound, and is
there a downstream signal that would catch the thing anyway?** **T20 compounds
with every row filed and has no downstream signal — a masked row simply stays
masked.** **S61 does not compound (each import is independent) and it gained a
downstream signal tonight when S54 landed — a dropped clip now surfaces as a
failure instead of being swallowed by a "done".** So **S61 got safer tonight and
T20 got worse**, and that is why the order changes rather than because
instruments come first as a rule.

**The specific reason T20 is worse than it reads: it is blinded by how I
write.** Rows here narrate previous fixes in prose — *"fixed 2026-09-11"*,
*"FIXED by Theo tonight"* — and **the guard can be satisfied by the word `fixed`
appearing anywhere earlier in a row while the status column still says `open`.**
That is the unsafe direction, because the guard exists to catch *test green, row
open*. **Three malformed rows passed three green runs in one night, and the third
was a row about a guard.** Every row I have filed tonight sits under an
instrument that cannot check it.

**RULING 3 — the filler question is closed, not re-scoped, and it needed no
code.** Measured: **zero `um` or `uh` in his finished cuts or his raw** — he does
not say them. Discourse markers **2.9% finished against 2.7% raw**, so **his rate
is his voice and he does not reduce it**; stripping them would make him sound
less like himself. The app measures **3.9%** and **strips nothing**, so a single
point of excess with no stripping at all means **the excess is weaker takes, not
a missing filter** — his raw clips range 0.0% to 4.6% and the markers cluster in
the attempts he would discard. **`SNIPAI_QA_SPEC.md` Part 5 #3 is rewritten from
a known gap into a decision with evidence: "the app removes whole bad takes
instead" is the correct design, E5 is the fix, do not build a filler pass.**
**The control is what makes this conclusive** — the same rule that saved the
J-cut measurement from being read as a falsification.

**E8 needs nothing from me and the answer improves it.** `retakes` is the same
shape with opposite semantics — alternatives of which exactly one is live, where
E8 needs segments that all play — so overloading it would make *"what is on
screen for this line"* ambiguous, which is the `types.ts:16-19` invariant E8
exists to preserve. **A sibling field, not a reuse.** And the useful half: **E5
now preserves every attempt rather than discarding it, so E8's fragments are
already on disk in `beats.json`, and E8 inherits E5's widened picker region** —
the same span a composition would draw from.

**T22 filed from the cascade**, and it is not a footnote: an assertion placed
before its own `clean()` teardown leaked its projects into later tests, so **one
changed assertion took two unrelated tests down and looked like a
disagreement.** The whole file shares the trap. **Same lifetime-ownership class
as T19**, and the reason it gets a row is that **a cascade misattributes a
failure** — which is how a green suite and a broken one become hard to tell
apart.

**Ruth's `.gitignore` is taken, and her closing question is answered.** She
ignored the whole `qa-screenshots/` directory rather than the per-date
carve-out, on the argument that these are **frames of his real library — his
footage, his products, his project names — and a git history cannot be
un-committed without a rewrite, in a repo whose public status is unconfirmed
(G5, G6).** Correct, and she also caught that the old comment's claim
(*"the five screenshots attached to specific bugs are tracked"*) was **false —
they were neither tracked nor ignored**, which is why they sat in `git status`
for a day looking like an oversight. **Her question — where QA evidence lives
durably — is mine and the answer already exists in practice: `~/Documents/SnipAi-evidence/`,
outside the repo and outside `~/Movies/SnipAi`.** The transcript corpus is
already there. **The screenshots and the nightly's 38 frames go there too**, and
the ledger keeps citing them by filename, which is what makes ignoring them
safe. **Ignoring is not deleting** — her line, and it is the right one.

**Order: T20 → S61 → then the M0.8 verification run is worth Nadia's 2h40m.**

**2026-09-12: T20 and T21 merged. Two of the three causes I wrote into T20 were
disproved by the person fixing it, and the malformed rows were mine. S61 is
next, unchanged.**

**The correction, and I am recording it as a correction rather than editing it
away.** T20's real defect is an **extra column**: at `952d039` the S34, S36, S42
and T19 rows each read `[fixed, open]`, and the guard took `fixed` and **printed
agreement over four rows whose status column said `open`.** **Both of my stated
mechanisms are false and are now pinned as not-reproducing by tests** — the
regex is effectively case-insensitive because `ledger()` lowercases first, and
`STATUS.match` anchors so prose narrating *"fixed 2026-09-11"* never registers.
**The second one was my inference from how I write this file, and it was wrong.**

**And the malformed rows were mine, from commits including `fadeb5e` — which is
the part worth saying plainly.** I own this file's format. A row with an extra
column is my defect regardless of which keystroke added the pipe, and **I filed
a row about a guard misreading the ledger without checking whether the ledger
was malformed.** That is the same shape as the thing the row is about.

**Third time tonight the reported cause and the real cause differed and the
implementer caught it** — S34's fail-open, S35's unreproducible premise, now
this. **First of the three where the wrong cause was mine**, which makes the
count worth keeping: reading code adversarially catches defects, and
**implementing against a row is what catches the row.**

**The fix's scope was chosen by measurement and that is why it is right.** A row
declaring two statuses is read as the **most open** of its candidates, so **the
guard can only ever complain more, never less** — the property that makes a
stricter guard safe to land unattended. **12 live rows carry more than one
status cell and none disagree**, so it flags nothing currently correct; the
principled alternative, header-based column indexing, **would have flagged 44**,
mostly long-standing and harmless. *"That is a flood, not a guard"* — and those
44 rows are the argument, not taste.

**S54's condition is met, and the direction he added is better than the one I
asked for.** I asked for the reclaim to be asserted. He added the **inverse** —
**the sweeper must not reclaim a batch still importing** — with the test proving
its own fixture took, *"because otherwise it passes whenever the write silently
misses."* **That is a test that cannot go vacuous**, which is the property S8's
sweep had and the reason I trusted it. My condition would have caught a leak;
his addition catches a live import being swept out from under someone.

**T23 filed, and it is the fourth guard-shaped instance tonight** after T8, T15
and T20: run from outside the checkout, `ROOT` resolves to `/` and **every board
test reports as failing** — so a guard that cannot find the repo says *"your
tests fail."* **The harm is that the wrong answer is plausible.** That confident
misreading survived half an hour and three wrong theories. **And the method note
is in the row because it cost most of that time:** an A/B built by extracting a
script elsewhere tests the extraction as much as the script, and the extraction
regex had swallowed its own constant twice. **The A/B now reverts only the
selection inside the current file.**

**Order unchanged: S61 next, then the M0.8 verification run.** Theo confirms the
asymmetry argument reads right from the code, which is the confirmation that
matters — it was a code-reading claim and he read the code.

**`QA_BUGREPORT2026-09-12.md` stays untracked and untouched.** Its six findings
are filed and triaged, but `qa-screenshots/` is now ignored wholesale, so the
report is the last artefact of that run still sitting in the repo root. **It
moves to `~/Documents/SnipAi-evidence/` with the screenshots** — that is the
durable answer already ruled, and it is Ruth's to carry out, not a deletion.

**Six things still wait on Kayer and the count has not moved**: the relaunch, R6
(watch a cut), the seven references into `reference/inspiration/`, B8's number,
B9's boundary question, and the nightly routine only he can reach (G9).

**2026-09-12: S61 in, all three holds cleared. RUTH REBUNDLES, THEN NADIA —
and what her run must show for M0.8 to close is written below so the run is not
wasted and so I cannot close it on partial evidence.**

**The rebundle is not a thoroughness choice, it is arithmetic.** The packaged
app's `BUILD_ID` is **Sep 11 22:13** and contains **S42, C37, S38's plumbing,
S34's fail-open and T19 — and nothing since.** It is missing **E5, S54, S61, T20
and T21.** M0.8's exit is stated **against the packaged app**, so a run now
would verify five-fixes-stale code and tell us nothing about what is on master.
**Ruth first. Disk is 9.7 GiB, the nightly is nineteen hours out, nothing
collides.**

**WHAT NADIA'S RUN MUST SHOW FOR M0.8 TO CLOSE — stated before the run, because
item 7 of the Definition of Done is the one that gets skipped and I have closed
a milestone on a merge once already.** Four things, and a miss on any one leaves
it open: **(1)** the tray proposes **one** project for `{0060,0061,0062}`, **or
flags `0061→0062` and asks** — and in the same run does **not** ask about
`0060→0061`, which the rule calls confidently. **(2)** on confirm, **one**
stitched cut, with at least one beat demonstrably taken from a clip other than
the first. **(3)** the standalone clip in the same batch becomes its **own**
project — that clause has never been exercised and it is half the exit line.
**(4)** his library fingerprints identical before and after. **What does NOT
close it: a green suite, a clean `verify-bundle`, or a cut that plays.** Those
are all true today.

**CONFIRMING Theo's reading of "propose, do not decide", because it is my rule
and inheriting it would be worse than ruling it — and his reading is right.**
He read it as being about **judgements over his content** — which clip belongs to
which video — **not about where a file lands on disk.** Correct, and the
underlying test is worth writing down rather than leaving to instinct:

**Propose when being wrong costs him something he cannot recover, or when the
judgement is about his content. Decide when being wrong costs nothing and the
alternative is making him do work the app can do.** Silent grouping was the
recorded failure because both errors are expensive — a garbage cut or a
re-shoot. **A filename collision is neither: nothing is lost either way, and a
refusal sends him to Finder to rename his own footage for something the app
handles without losing a byte.**

**And the distinction that makes it safe is that there are three modes, not
two:** *propose* (ask), **decide-and-disclose** (act, and say so), and *decide
silently* (never, for anything he would want to know). **His fix is the middle
one** — the tray reads *"another clip is already called IMG_0060.MOV, so this one
is kept as 2-IMG_0060.MOV"* and `StagedFile.originalName` preserves what he
dropped. **The docket's complaint was never "the app decided", it was "the app
decided and did not say."**

**The prefix-not-suffix finding is cross-referenced into S61 and it is the most
valuable thing in that report.** `filenameNumber` reads the **trailing** number
of a name to order a roll when capture stamps are missing, so `IMG_0060-2.MOV`
would have read as **2** and **sorted ahead of `IMG_0060.MOV` — reordering his
video in order to fix a filename clash.** That is **S56's exact mechanism
arriving through a fix for something else**, and it was avoided only by checking
the ordering fallback *before* choosing a suffix. **The obvious answer would
have looked completely fine**, which is the whole point.

**`PROCESS.md` gains "assert the premise before the claim", and it belongs
beside the control condition rather than under one role's habits.** Three
fixtures caught in one night — E5's, T20's, and S61's, where `my clip!.MOV` and
`my-clip@.MOV` do not collapse to the same safe name so the test proved nothing.
**These are one rule with two applications: a measurement needs a control that
would have separated the cases; a test needs an assertion that would have failed
before the fix. In both, the thing being checked is the instrument rather than
the subject.**

**T23 takes the generalisation, and it is sharper than "instruments lie":** an
instrument's **plausible** failure is the dangerous one. Three instances share
it exactly — `ROOT` resolving to `/`, a `du -sh` misreading, and the nightly's
two surfaces agreeing because they read one variable. **An implausible wrong
answer gets a second look for free.**

**The queue after the rebundle and the run**, so nobody idles waiting for me:
**S55** (the empty transcript scored as a finished thought), then **S57** (two
unknowns matching, which can stream-copy half a 4K source sideways), then
**S60** (check-then-act on the one-at-a-time guard — *"took this Mac down"*),
then **S62/S63** together since they are the same constant from both ends, then
**S56, S58, S59, S64, C43, T22, T23.**

**The relaunch is now the one waiting item with a growing consequence: the app
on his Mac is five fixes behind, not one.** Six things still wait on him and the
count has not moved — the relaunch, R6, the seven references, B8, B9, and G9's
routine.

**2026-09-12: M0.8 IS CLOSED. M0.85 opens, and its first row is E9 rather than
E7 — which is a change to the order I set two hours ago.**

**I am closing it, and the reason I can is that the criteria were written down
before the run.** Four clauses, four passes, and **three of them measured more
strictly than I asked** — the beats-from-later-clips clause was proved by
cross-correlating source audio against the exported file (0.9995 for clip 2,
0.9447 for clip 3) rather than by reading the EDL, *"because an EDL is a claim
rather than evidence."* That sentence is the standard the rest of this roadmap
should be held to.

**What the closure does not claim, stated in the row itself: nobody has heard
either cut.** M0.8's clauses are about what the tray proposes and what the file
contains. **Whether it sounds like his work is M0.85's exit and R6's one
command.** And **every pointer-drag path is untested** — timeline reordering,
edge-handle trimming, fade grips, drag-to-highlight, and **R4's "the page must
not move while dragging"** — because the session had no drag primitive. **That is
a named coverage hole, and R4 is a thing Kayer has reported twice**, so it is
the hole that matters most.

**M0.85 OPENS, and E9 goes ahead of E7 — a correction to my own order.** I
sequenced E7 (dead air) first. **E9 displaces it: a joined project uses one
speech floor for all its clips and the third clip's words are being cut in
half** — 4 of 37 removals carrying speech, all after t=915.28s, against a
single-clip control from the same batch and the same minute reporting **`All 13
removals are below the speech floor`**. **The reason it goes first is not
severity arithmetic: M0.85's gate is his ear, and a cut that clips words cannot
be put in front of him for a tightness judgement at all.** Same prerequisite
shape as S26. **And one step before Theo: Desmond confirms the mechanism**, since
the single-project-wide floor is the tester's inference from the tool's output
rather than something read in the code — she said so unprompted and the row
carries it as a hypothesis.

**M0.85's order: E9 (after Desmond) → E10 → E7 → H4 → E8.** **E10 is E5's second
half and it is a real finding rather than a leftover:** of the 5 remaining
near-duplicate pairs, **3 have an earlier beat that is a truncated fragment of
the later full attempt** — the matcher does not recognise a partial utterance as
the same line **because it is shorter**. **And Part 5 #10 is what needed
updating, not her judgement:** she deferred to *"nothing acts on repeats"*, which
was true until E5 landed. **A written rule going stale is the rule's defect, not
the reader's.**

**Filed from the run: E9, E10, S65-S70.** The ones I could file to Definition of
Ready from what arrived: the Queue showing `0 projects` for **66 minutes** while
the API reported 75% (S65 — and the spec promises the opposite); raw transcript
lines with timecodes as the caption for **25 of the 26 analysis minutes** (S66,
S41's third and longest-lived surface); **a silent clip joined `confident: true`
on one hallucinated word from a 700 Hz sine** (S67 — S55's instrument from the
other end, and `confident: true` is the one verdict the tray does not ask about,
so it is the single state where a wrong answer reaches him silently); one job
record per batch so `img-0063`'s build was reported under `img-0060`'s name
(S68); **a correct `separate` verdict returning `confident: false`** (S69 — which
is *why* two of three seams were asked about, and the row that turns two asks
into one); and **`Approved · Ready to post` surviving the edit that invalidated
it** (S70 — C40's family from the shipping side).

**What I could not file, and I am applying the rule I enforced on Desmond's
fifteen rather than filing headlines: BUG-001, 004, 005, 006, 011, 012, 013, 015
and 017 are not Ready.** No `file:line` and no reproduction I can restate. **The
content is the handoff.** Send them and they are filed.

**And her dedupe flag is a finding about MY files, not hers.** She could not read
BUG-002/011/013 against C39/C40/C41 **because she was looking in `DOCKET.md`, and
the client rows live in `audits/LEDGER.md`.** That is a fair mistake to make:
**the docket's narrative has grown to the point where it looks like the place to
find rows.** The ledger is the row index; the docket is the sequence and the
decisions. **If a tester cannot tell which file holds what, the split has stopped
being self-evident** — worth a trim, and not tonight.

**Artifacts: relocate to `~/Documents/SnipAi-evidence/` as before.** 10 MB, and
it holds the three `batch.json` snapshots across the merge, which is the only
record of the tray changing its mind.

**`PROCESS.md` gains the shared-scratchpad rule**, because a compression step
deleted 54 PNG originals from the previous day's run on the assumption the
scratchpad was empty. Nothing lost, but **moved from where its author left it
without asking** — the same class as the nightly picking a data root by
fallback. **List before you write, and never delete what you did not create.**

| # | Milestone | Exit line | Ledger / docket ids |
|---|---|---|---|
| M0 | Prove drop-in auto-cut on a brand-new clip | A raw file dropped in the dashboard produces a finished cut in `cuts/`, no terminal touched. **Pipeline half banked 2026-09-10** by `snipai-tester` on both surfaces: all four stages ran to completion, a finished file landed in `cuts/` every time, no >1s silence, no black frames, both streams present, frame count matches duration, `state/jobs.json` `done`/`100` with no unhandled traceback. **Does not close yet** — the one unverified thing is the one the exit line is actually about: nobody has *dropped* a file in. Import-picker and drag-and-drop cannot be driven from here (see Blocked). Remaining scope: that single act. **Unblocked 2026-09-11** — Kayer granted Screen Recording and Accessibility, both verified directly (`osascript` returns real window geometry; a captured window region measures 256/256 distinct bytes rather than stripped wallpaper). **Scope of the proof, added 2026-09-11: single-clip projects only.** **MET AND CLOSED 2026-09-11.** Both routes work in the real window, no terminal touched. **Import footage** opens a genuine `AXSheet` NSOpenPanel ("Choose the video files to bring in.") — the class of bug that once made that button inert in WKWebView is gone. A real Finder→WKWebView **drag** also worked: the window dimmed, the dashed drop zone appeared, and on release the file landed in the tray. Both ran to finished cuts — `qa-drop-test-v1.mp4` (7 segs, EDL 14.999s, ffmpeg 15.45s) and `qa-drag-test-v1.mp4` (9 segs, EDL 14.010s, ffmpeg 14.52s) — both `ftyp, moov, free, mdat`, both h264 406x720 + aac, both ~0.057s per clip over the EDL. Queue card, EDL and ffmpeg all agree. S19 and E1 both confirmed again on fresh packaged builds | S3 (fixed) |
| M0.5 | Stop shipping clipped audio | **Exit line rewritten 2026-09-10 — the old one could not prove the claim.** It read "`python3 qa/verify_edges.py` reports 0 of 34"; that tool reads `work/edl.json`, `work/transcript.json` and the source audio and **never opens a rendered clip**, while E1's truncation happens downstream of the EDL in ffmpeg's per-clip re-encode. It reported clean on a build that was demonstrably still clipping. Also "0 of 34" is img-9817's denominator — a fresh import yields 2-3 measurable fragments, so a clean run on a new project is a thin result even with the right tool. **New line: for a clip built by the packaged app, every rendered clip's measured duration is ≥ its requested `dur`.** **Scope of the proof: a single-clip project, 11 clips out of one source file.** A multi-clip import has never been measured. **MET AND CLOSED 2026-09-11.** Re-run against the rebundled app: **11 of 11 clips, 0 short, +0.047s to +0.073s, mean +0.064**, measured with the bundle's own PyAV by full stream decode rather than container headers, and the stricter `min(video, audio) ≥ dur` holds for all 11 — including the two sub-0.3s fragments most at risk of losing a consonant (+0.069, +0.065). The padding survives the concat: `dur` sums to 15.234s, the finished file is 15.93s (478 frames @30), which is 11 × ~0.064 accounted for. Dev and packaged now agree (dev was +0.037 to +0.059 across 26). **Closed on the fix, not on his library** — see M0.7. Note **T5 is not fixed**: the rebundle cured this instance of a stale bundle, but `bundle-app` still has no check that what it produced matches the repo, so the next one can go stale the same way and nothing will notice | E1 (fixed), T5 (still open) |
| M0.6 | A sandboxed run cannot touch the real library | **Exit line rewritten 2026-09-11 — the old one could be satisfied by a run in which the rule never fired.** It said "verified by launching against a sandbox while a server holds 4737 and confirming `/api/projects` does not serve `~/Movies/SnipAi`", which passes just as well when the launcher spawned its own server because the port happened to be free: right answer, wrong reason, and no way to tell them apart. It also never named **which** app — and the entire failure was that the repo had the fix and the bundle did not. **New line, four clauses, every one against `SnipAi.app` and not a dev checkout:** (1) the bundled server answers `/api/health` 200 — the route the launcher polls, absent from today's bundle (N7); (2) with a foreign server already holding 4737, the app **says in its log what it found and what it decided** — the rule is observed firing, not inferred from an outcome; (3) launched with `SNIPAI_DATA=<sandbox>`, `/api/projects` serves the sandbox, and `~/Movies/SnipAi` is byte-identical before and after; (4) quitting stops only a server the app started, verified in **both** a bundled run and a dev checkout, which is P19's surviving half. Verified by `snipai-tester`, not by a merge — that is what went wrong the first time. Reconcile with P19 in the same pass — same function, opposite asks **REOPENED 2026-09-11 — I closed this on a merge and a green suite, and its exit line is a tester action.** The rule is merged and the probe passes 17/17, but the bundled server has **no `/api/health`** (N7: repo 24 routes, bundle 23), so `LaunchDecision.swift:163` polls a route its own server 404s and the ownership check is inert in the app on disk. Nothing that protects his library is actually running. **Added scope, both narrow:** a **route inventory** in `verify-bundle` (the marker-string check would not have caught this — `grep -rl faststart` hits on a stale bundle), and `scripts/qa` **honouring `scripts/test`'s exit code** instead of grepping for `fail 0` (T3), because `bundle-app:23-26` reads that exit code as the release gate that will approve this very rebundle. Closes when a rebundle carrying `/api/health` is verified **in the packaged app** by `snipai-tester` **Scope of the proof: single-clip sandboxes.** The ownership rule is not clip-shaped, so this is the least narrowed of the closures — but it was still never run against a library built from multi-clip imports. **MET AND CLOSED 2026-09-11, all four clauses, verified by `snipai-tester` against the packaged app.** (1) `/api/health` 200 from the bundled server, reporting `dataRoot`, `serverPath`, `launchToken`, `pipeline {version 3, known true}`. (2) **The rule observed firing in five branches** — which is what the rewritten line was for, and what the old one could never have shown. Verbatim on the foreign-library case: *"port 4737 is held by a SnipAi server (pid 61425, library .../qa-m06-b)"* → *"refusing to start — Port 4737 is already serving a different SnipAi library"* → *"SnipAi has not started a server and has not stopped that one. Using it would edit the wrong footage."* All four lines render **in the window**, not only the log. The occupant's `/api/health` was cold and compiled in **373ms**, inside the 8s budget — N6's case, passing. Also observed: the older-build adopt path, the won't-identify-itself refusal naming pid and command, and **orphan-restart firing in a bundle for the first time**. (3) `~/Movies/SnipAi/projects` fingerprinted **976 files before and after: 0 added, 0 removed, 0 modified**; state 3/3 identical; img-9817 34 beats, img-9823 61. (4) **3/3 bundled, 3/3 dev, plus quit-and-reopen 5/5 with 61 TIME_WAIT sockets on 4737 confirmed present at the moment of relaunch** — so the `SO_REUSEADDR` pin holds under the exact condition that caught it. **The tester discarded its own first three clause-4 attempts** because `kill -TERM` does not run `applicationWillTerminate`: the victim survived for the wrong reason. It redid them with real quit events. That is this milestone's own thesis applied by a tester to its own method, and it is the reason the result can be believed | N1, P19, N7, T3, N8, N9, N3, N4 (all fixed) |
| M0.7 | Make the E1 fix reach the footage he already has | **Opened 2026-09-11, and it is the reason M0.5 closing is not the end of the clipped-audio story.** The packaged bundle ships no `pipeline-version.json`, so packaged builds stamp `work/pipeline.json` with `"version": 0`, and the repo's own manifest still reads `"version": 2, "changed": "2026-09-09"` — never bumped for E1. Confirmed end-to-end from the running packaged server: `GET /api/projects/m05-recheck` → `cutStale: false`. **So E1 is fixed for footage imported from now on and silently not applied to anything already in his library**, and the one signal that would tell him — the "Rebuild — the cutting has improved since this was built" badge — is inert in the app he opens. His two real cuts, img-9817 and img-9823, were both built before `WORD_RESCUE` and would never be flagged. Exit: the manifest ships inside the bundle, is bumped past 2 citing E1, and `cutStale` reads **true** on a pre-fix cut in the packaged app | N2 |
| M-app | Make it watchable inside SnipAi itself | Open a cut in the native window, press play, watch all of it. **Half met 2026-09-11: it plays. He cannot watch it.** Measured from clicking Play on **Rendered file** — ~1.3-1.4s of black, first picture at +2.97s with the native transport reading `0:02 / 1:38` (which proves the `moov` was fetched and parsed), later sampled at `0:31 / 1:38` at full resolution, and the lines list followed playback through to line 34. **The `moov`-last worry does not bite over localhost, and that settles the rebuild question.** On the 513MB v6: first-1KB ttfb 0.0029s, the tail 110KB carrying the `moov` at byte 513,655,552 returns in **4ms**, the whole file streams in 1.363s at 377MB/s, and a full ffmpeg decode reports **zero errors** (1:38.39, 2160x3840, h264+aac). All six cuts are `moov`-last and all six are fine. **His existing cuts are postable as they stand — do not spend the weekend rebuilding six 513MB files.** The only standing reason to rebuild v6 is the one already on its card: it predates his latest trims. **What blocks the exit line is C22/CG1**, moved into this milestone — see the re-sequence note. Scroll the player into view and within ~4s the page drags itself back to the lines list and the player leaves the viewport (`1.0 → 0.854` at the scroll, held to +3.67s, back to `1.0` by +4.32s). It runs while **paused** (`0.655 → 1.0`) and after **F** clears selection (`0.0 → 0.541`); with a trim row open it snaps back in under a second. On a 1440x900 display a ~400pt player plus timeline plus lines cannot co-exist in an 800pt window, so playback continues with nothing visible **C22, C28 and C29 are merged and green on master** (`e761337`, `0724985`) — the follow rule now lives in `lib/follow.ts`, following asks for the least movement that brings a line into view and is bounded by the room the player has, and the live clock runs on the live edit's basis. C19 and C20 closed with them. **This milestone still does not close on that.** Its exit line is *open a cut in the native window, press play, watch all of it*, and what was false was watchability, not the diff — twice now, since C22 shipped green while C28 was live underneath it and one of C22's own tests was the reason (see C22's disclosure). So it closes when `snipai-tester` plays a cut **in a single-clip project** in the packaged app and the player stays on screen for its duration, including while paused, after a row click, and with a trim row open — C22's three triggers — and reports the measured line count at which following stops under C28's clamp. **Say single-clip when it closes:** a multi-clip cut has more beats, a longer lines list and more follow requests per minute, which is exactly the load the clamp is bounded against and has never seen  **Tester run 2026-09-11: three of four parts pass, and it stays open on the fourth.** C29 verified over 504 samples ending at the end of line 34 on the live-edit basis, both surfaces; the follow compounding is gone (page held where the hand put it for 21s at a time across three wheel events while playback continued); the player was inside the viewport 504 of 504. **It does not close because the Play/Pause button receives no mouse clicks** (C30) — `elementFromPoint` finds another element topmost at every pixel of it, five real clicks did nothing, reproduced on both surfaces. The tester graded it High and said it does not block the exit line, since Space works. The exit line is *open a cut in the native window, **press play**, watch all of it* — closing it while pressing play does nothing would be closing on a technicality that passed for the wrong reason, which is what this milestone was reopened for once already  **MET AND CLOSED 2026-09-11, proven on single-clip projects.** A real CGEvent click (`mouseMoved` → `leftMouseDown` → `leftMouseUp` at `cghidEventTap`) at the Play button's centre in the packaged app starts playback — `"Play your cut"` → `"Pause"`, clock `0:00.0` → `0:00.1` → real time to `1:58.7 / 2:06.8` — toggling both ways, repeated at a 900px window on a second project. `AXUIElementCopyElementAtPosition(728, 748)` returns the button itself, where the chain never contained it before, and a tooltip appears on hover, which a clipped element cannot produce. The ~49px twitch is **exactly 0** at eight player widths, measured by `tests/native/layout-probe.swift` against the stylesheet the app actually ships — and the pre-fix stylesheet reproduces `49` and `DIV.tl-bar`, the wrong diagnosis verbatim, which is what makes the comparison trustworthy rather than merely green. Player wholly on screen at 1180px and 900px; clock reaches the end on the live-edit basis (`qa-clip` played to `0:33.4 / 0:33.4` and reverted to `Play your cut` by itself, timeline header agreeing at `10 clips · 0:33.4`). **Not a regression, do not chase it:** at playback start the page scrolls ~130px to bring the playing line into view, everything moving together — that is C28's single permitted step. **C31 left open deliberately** — same family, but the native window's 900px minimum floors the player at 196px, so it cannot be triggered by width in `SnipAi.app` at all | S18, S19, C22/CG1, C19, C20, C28, C29, C30 (all fixed); C31 open, does not gate |
| M0.75 | Stop losing lines out of the cut | A trim that drives a hole across its own beat renormalises instead; the beat still emits pieces, and a beat that ends up empty is never silently rendered as nothing. Green regression test in `lib/`, no server needed . **MET AND CLOSED 2026-09-11** — S8 fixed with `tests/regressions/S8-a-trim-cannot-swallow-a-line.test.mts`, 9 tests, green on master. The row that could make a spoken line disappear from the finished video while `beats.json` still listed it and the timeline drew it 0px wide is closed. **It closed ahead of M0.8's later slices, as sequenced** — the reason was that multi-clip means more beats, more trimming and seams that can themselves produce holes, so shipping stitching with S8 live would have multiplied its exposure on exactly the footage he actually shoots | S8 (fixed) |
| M0.8 | **One TikTok that arrived as several clips** | **Design by another session; implementation is this one's, from 2026-09-11.** **Opened 2026-09-11, and it is why M0 closing is not the end of the drop-in story.** M0 closed on a single file, and Kayer never shoots a single file: he is interrupted mid-take — kid, door, life — stops recording, and restarts where he left off, so a real TikTok reaches the app as three or four clips. Today the uploader accepts them all and makes **each one its own project** (`DropZone.tsx:211`), because `lib/types.ts:24` is `source: string`, singular, and 68 sites agree with it (26 TS, 42 Python). So the milestone that proved drop-in works proved it for footage he does not have. **Take the cheap route (R5a): join the clips at import, before anything else runs.** Everything downstream then sees one continuous recording and needs no change at all — and the take picker spans every clip for free, which is the behaviour he actually wants (a line said better in clip 3 beating the one in clip 1). Confirmed joinable losslessly: both real sources are HEVC 3840x2160 @ 30/1, AAC 48kHz stereo, so `-c copy` with the four iPhone data tracks `-map`ped away. Do **not** make `source` a list for this; that is R5b, it touches all 68 sites, and it buys nothing extra for the way he shoots. **The seam is not a new problem** — restarting where he left off makes the join look like an abandoned take followed by a retake, which is the exact shape the take picker exists to resolve. **Two things to test rather than assume:** a splice with no silence on either side of it (does beat drafting cope), and a clip that ends mid-word (is the fragment discarded as an incomplete take, or picked). **How it tells a stitch-group from a standalone — the question Kayer asked, and the thing that makes or breaks this.** A batch can hold both: three clips that are one interrupted video, plus a fourth that is a finished video on its own. **REVISED 2026-09-11 after Kayer answered the question this depended on: he batch-films.** He often shoots several *different* TikToks in one sitting, back to back. That kills the recording-gap heuristic on its own — a three-minute gap means either "the kid came in" or "on to the next product", and time cannot tell them apart. **The discriminator is whether the clip ended mid-sentence.** An interruption cuts him off mid-word or mid-thought and the next clip restarts that same line; a finished video ends on a complete sentence, usually a CTA. That is exactly the difference, and the machinery already exists — Whisper word timings plus the beat drafter, whose whole definition of a beat is "ONE complete recitation". **Cost is ordering, not compute:** transcription is stage 1 and runs on every clip regardless, so grouping simply moves to *after* transcription instead of before it. **The rule, cheapest test first:** gap of hours → separate, stop there. Otherwise transcribe, then ask (1) does clip N end on a complete sentence, and (2) does clip N+1 open by restarting clip N's last line or continuing its script? Mid-sentence end + continuation → same video. Complete ending + a different script or product → separate. **The recording gap stays as a cheap early exit and a tiebreaker, not the decision.** ~~The signal is the recording gap, and it is free.~~ Every clip carries `creation_time` and `duration`, so `creation_time + duration` is when recording stopped; the gap to the next clip's `creation_time` is how long he was away. An interruption is minutes. A separate video is hours. Measured on his own two files: IMG_9817 stopped 10:26:51, IMG_9823 started 16:35:16 — **6h 8m apart, unambiguous.** Consecutive `IMG_` numbering is a weak tiebreaker; identical framing (compare last frame to first frame) and script continuity after transcription are stronger but far more expensive, and neither should be built until the gap alone is shown to fail. **Order within a group is not a hard problem, and drop order is never consulted for anything.** Every clip carries `creation_time` stamped by the camera at capture; it is immutable, it survives copying and renaming, and it puts seven files dropped in any order into the exact sequence they were filmed. So the first thing the importer does is sort by `creation_time` — after that, "which half came first" is already answered and a flipped pair is impossible. Filename numbering (`IMG_9817` < `IMG_9818`) is a fallback if a clip somehow arrives with no timestamp, and script continuity is a third: the clip that ends mid-sentence is by definition the earlier one. **One edge case to handle rather than discover:** interleaving — part 1 of video A, then all of video B, then part 2 of A. Chronological order alone would try to pair A-part-1 with B, so the continuity check must match a clip against every candidate in the batch, not only its immediate neighbour. Unusual, but he batch-films, so it is reachable. **Propose, do not decide.** Group by gap, then show the proposed grouping in the import tray that already exists (`DropZone.tsx` already lists each file with its own status) and let him confirm or regroup before a single stage runs. Silent grouping is wrong in both directions and both are expensive: stitching two separate videos produces a garbage cut, and splitting one interrupted video into halves means re-shooting or manual repair. A confirm step costs one click when the guess is right, which it nearly always will be, and saves the whole import when it is not. **Exit:** drop four clips of one interrupted TikTok **plus one unrelated standalone clip** into the packaged app at once; the tray proposes 2 projects, not 5 and not 1; on confirm he gets **one** stitched cut with at least one beat demonstrably taken from a clip other than the first, and **one** separate cut from the standalone | R5 **Slice 2 (the grouping rule) merged 2026-09-11 — and two of the design's own signals did not survive measurement against Kayer's real footage. Recorded because dropping them was the finding.**

**Topic overlap is inverted, and it would have been a disaster.** The design said a separate video is recognisable because it is "a different script or product". Measured content-word containment on `img-9817` and `img-9823`, read-only: his two **genuinely separate** videos score **0.66**, while two halves of **one** video score **0.20-0.26**. He sells the same product in both, so shared vocabulary means same shelf, not same video — and a hook and a CTA share almost nothing with each other. **A same-product heuristic would have joined his entire library into one video.** The design was right about what distinguishes his videos and wrong that vocabulary could see it. Signal dropped.

**Punctuation cannot carry "this video is finished."** Whisper terminates only **56% / 41%** of his segments with `.!?`, and **neither real video ends its plainly-finished CTA with one** — both end `"...in the next day or two"`. Requiring a full stop to believe a video is done scores **0 for 2** on the only real examples in existence. Replaced with a dangling function word (`"...is because"`, `"and there's"`), which fires on 25-27% of segments and on neither real ending. Signal dropped.

**Tail silence is reported and deliberately NOT scored** — his finished videos end with 1.26s and 2.25s of it, but he also has to reach over and stop recording after an interruption, so it does not discriminate, and no interrupted sample exists to calibrate against. **Recorded as a decision, not an omission**, so nobody "completes" it later by scoring a signal that was measured and rejected.

**The continuity thresholds are a measured noise floor, not a guess.** Over 5,632 cross-video boundary pairs: a 10-word shared run appears in 0.2% of pairs from *different* videos and 33% of seams *inside* one; 6 words, 1.0% against 61%. A 4-word run scores **zero**, because every one of his videos ends its hook on the same four words.

**Three verdicts, not two:** `same` / `separate` / **`unsure`**, with unsure proposed as a break and collected in `needsYourEye`. That is "propose, do not decide" implemented rather than asserted — a seam the rule genuinely cannot call has somewhere to go.

**Interleaving is handled**: every ordered pair is scored and links chosen as a one-to-one matching, best first, so `A1 → B → A2` comes out as two groups with `interleaved: true`. Drop order is never consulted, and a test asserts three different drop orders produce a byte-identical proposal.

**Decision taken rather than escalated, under Kayer's "go with best judgement" — re-transcribe the joined file.** Seams land mid-word (slice 1's own finding), and a fresh transcription of the joined file returns the two halves as **one whole word**, where assembling per-clip transcripts with offsets would leave them as two fragments and reintroduce the exact problem joining solves. The cost is Whisper running twice on a 4-core i5, and Kayer was told that plainly before the choice was made. **Recorded with its reasoning so it is not re-litigated at 3am.**

**Scope is honest:** the rule is complete, the import restructure is not started, and dev drew that line itself rather than being asked. Slice 3 in flight

**STAYS OPEN after the first real-footage run, 2026-09-11 — and the headline is that multi-clip cannot work on any clip Kayer owns.** Nadia ran slices 1-3 against six of his real 4K clips: 13 findings, filed as 14 ledger rows (S34-S41, C37, N15, T17, E4-E6). Two Critical, and they are the same sentence twice: **S34** refuses every join he could make (`editListTrimSec > 1/fps` = 0.0333s, against 0.05-0.09s of AAC priming on every clip he has), and **S37** proposed **five** projects for **two** videos with `needsYourEye` **empty**, so all three wrong splits would have been made silently. **The exit line is short on both halves at once:** there is no packaged tray to drop into (**N15** — the bundle has no `/api/import`; `BUILD_ID` Sep 11 08:29, the route landed in `9850739` after it), and even in dev no join can succeed, so "one stitched cut with a beat taken from a clip other than the first" is unreachable. Sequencing and the rebundle ruling are in the re-sequence note above.

**Slice 1's seam claim does not generalise, and this correction matters more than it reads.** "No beat lands on a seam" held on the pair Nadia could join — **for a reason that will not repeat**: 0061 has **26.89s of tail silence** and 0062 does not speak until **1.22s**, so the drafter had ~28s of dead air and never had to cross the join. **This milestone's own named untested case — "a splice with no silence on either side of it (does beat drafting cope)" — is still untested**, and `0063->0064` is exactly that case. It could not be tested because S34 refused the join. **Do not read slice 1 as verified for the general case.**

**What held, recorded so the row is not misread as a failed feature:** ordering correct across all six and order-independent; the staging restructure streamed 270 MB clips with no blow-up; `validateGroups` refused a grouping that would have orphaned a clip; the join's pre-flight disk check refuses before writing; `joinBlocker` returned `none` for every adjacent pair and was right about the streams — only the edit-list guard misfires. And **the re-transcribe-after-join decision is paying for itself**: the joined transcript came back clean across the seam where the per-clip pass invented "Thanks for watching!" on the same audio (**S39**). That decision was recorded here under "go with best judgement" so it would not be re-litigated; it is now the first one with evidence behind it.

**The corpus this run produced is the test for four of the rows, and it must not be deleted for disk:** `~/Movies/SnipAi/qa-m08/qa-transcripts/` — 252 KB, six transcripts, the proposal, `probes.json`. The only recording of his real speech this project has, and 42 minutes of transcription. S37, S38, S39 and C37 all re-run against it with no video at all

**STILL OPEN, and the reason narrowed twice in one evening.** Everything that was in the way has moved: S34 and S36 fixed, green, and now **tester-verified in the packaged app**; N15 fixed and driven against the packaged server and then by a real NSOpenPanel and a clickable tray. **Two of his clips are now one cut** — 1:45.02, no A/V drift across the seam, no black frames, **17 beats from the second clip and they are the entire CTA**. **What is left is exactly two things.** (1) **The grouping half of the exit line** — four clips of one TikTok plus one standalone, proposing 2 projects and not 5 and not 1. Never exercised; two clips in one group is not that test, and S37 records the rule getting it wrong on six clips. (2) **Somebody watching the video.** No Screen Recording grant for the tester's shell, so a full decode and a Whisper transcript of the finished file were substituted — strong, and not eyes on a screen. **That one is Kayer's: `open cuts/img-0060-v1.mp4`.** **Proven on: a two-clip group, one pair** **THREE-CLIP RUN 2026-09-11, and the exit line is AMENDED rather than met.** `{0060,0061,0062}` joined and built: **190.09s, 5702 frames, 40ms of drift across two seams**, both seams clean on `blackdetect` and `blackframe`, **A/V delta measured on all 123 pieces with zero over one frame**, played in the native window. **All three clips are in the cut** — 40 pieces / 61.06s, 55 / 77.16s, 28 / 45.05s: hook, benefits, CTA — **and the take picker chose across clips for the first time**, keeping clip 2's line at 98% over a 90% attempt, which is R5's stated intent observed. **But the tray proposed "This looks like 2 videos - 3 clips", splitting the CTA off, and a human clicked "Actually one video" to get that result.** The exit says the tray *proposes* one project. **AMENDED CLAUSE, and the amendment is two-sided so it cannot be met by flagging everything:** the tray proposes one project for these three clips, **or flags `0061->0062` and asks** — and in the same run does **not** ask about `0060->061`, which it called confidently. That is the design's own *"propose, do not decide"* with a bound on it, since a tray that asks about every seam is not proposing and breaks this row's promise that a confirm costs one click when the guess is right. **MET AND CLOSED 2026-09-12 — all four clauses, measured against criteria written down BEFORE the run, and three of them measured more strictly than I asked.**

**(1) The tray proposed and asked, and it distinguished.** Basis `creation_time`. Proposal `{0060,0061}`, `{0062}`, `{0063}`. **`0060→0061` was called `same` at 0.55 with `confident: true` and was NOT asked about** — it rendered as a decided join with a `Split here` escape and the reason *"IMG_0060.MOV stops on 'you', mid-sentence"*. **`needsYourEye` held `0061→0062` (−0.10) and `0062→0063` (−0.40).** My stated failing condition was asking about both of the first two seams; it did not. **The amended clause was written exactly to distinguish "asks where it cannot tell" from "abdicates", and that is what happened.** It asked about two of three seams, which is more than I would like — **filed as BUG-008 and it is why, not a reason to hold the milestone: the 27-minute gap was called RIGHT and still came back `confident: false`.**

**(2) One stitched cut with beats from later clips — and she proved it in the rendered file rather than in the edit list, which is stronger than the clause required.** Join **18:50.63**, 3,418,761,560 B against 3,429,712,927 B of inputs, hevc+aac, stream copy. EDL 80 segments / 122.137s — **27 / 39.09s from clip 1, 32 / 50.55s from clip 2, 21 / 32.49s from clip 3, none straddling a join.** Then, **because an EDL is a claim and not evidence**, source audio cross-correlated against the export at 8 kHz: source t=10.56 → peak **0.9997** at t=1.344; source t=334.49 (**clip 2**) → **0.9995** at t=40.660; source t=986.20 (**clip 3**) → **0.9447** at t=101.941.

**(3) The standalone became its own project, and this clause had never been exercised in any prior run.** `IMG_0063.MOV` → `img-0063`: 14 beats, own transcript, own cut at **37.29s**, and **the right video** — *"How do you know if you have actual glutathione?"*, *"you want liposomal"*, *"or rotten eggs"*. `imported: [{img-0060, clips:3}, {img-0063, clips:1}]`. **Nothing leaked in either direction.**

**(4) Library untouched.** SHA-256 of every file under `projects`: **1023 → 1023, 0 added, 0 removed, 0 modified**, manifest diff empty — better than the 26-added baseline, because she never opened a real project.

**And the milestone's own subject, re-measured: E5 worked.** Old figure, hers: eight consecutive beats were eight attempts at one line, **26.07s of 100.90s = 25.8%**. New: **that pattern is gone.** 67 candidate beats became **43**, of which **15 carry a `retakes` array holding 39 candidates — 24 attempts collapsed off the timeline** and surfaced in the Lines list as *"3 takes"*, *"6 takes"*. Residual **17.165s of 122.237s = 14.0%, no run longer than two** (was eight). **S42 visibly fixed in the same run: each edit produced a ~25 MB cut, not a gigabyte.** Disk never near the floor — 9.8 GiB start, 2.52 GiB low-water during the join, 5.47 GiB end, staging self-cleaned to 148 KB.

**WHAT THIS CLOSURE DOES NOT CLAIM, said plainly because the exit line was structural and a person's ear is not:** **nobody has heard either cut.** M0.8's clauses are about what the tray proposes and what the file contains, and all four are met. **Whether it sounds like his work is M0.85's exit and R6's one command**, and it is not evidence this milestone ever asked for. **Also not exercised this run: every pointer-drag path** — timeline reordering, edge-handle trimming, fade grips, drag-to-highlight, and R4's *"the page must not move while dragging"* — because the session had no drag primitive. **That is a named coverage hole, not a pass** | R5 **CLOSED.** S38, C37, S34, S36, S42, E5, S54, S61 all fixed and verified in the packaged app; **BUG-008, BUG-009, E9 and E10 come out of the closing run** |
| M0.85 | **A cut he would actually post — about a minute, tightly cut** | **Placed 2026-09-11 from Kayer's own words: *"I want this app bulletproof solid and these videos to be super tightly cut. my usual time i have a finished video is about a minute."*** **The app has never delivered this and has no machinery aimed at it** — confirmed by grep across `lib/`, `app/` and `tools/`: no target duration, no maximum, no length budget, and the drafter's objective is *"keep every beat that is not a duplicate"*, so length is whatever the footage reduces to. Six versions of `img-9817` (1:50 → 1:38 over 38 hours, one at 00:15 and the next at 07:07) and `img-9823` abandoned at 2:59 are him fighting this by hand and losing; tonight's three-clip cut was **3:10**. **Three parts, and they are different jobs — do not let one of them stand for the milestone.** **(1) There is no target and there needs to be one** — a budget the drafter optimises against, **not a hard truncation**, and **the number is his: do not guess a constant into the code** (that is B7's lesson from the same day). Open as **B8**. **(2) "Super tightly cut" is a second requirement, not the same one** — hitting a minute by dropping whole beats is not hitting it by tightening every beat, and he said both words. The under-used machinery is named rather than invented: `FRAME_PAD` (E1), the silence removal, the 56 interior removals the builder already makes, and `verify_edges.py`'s finding that **17 of 17 edge fragments sit below the speech floor** — which suggests there is room to cut tighter without clipping a word and **nobody has measured how much.** **(3) Repeats are the principal lever, and E5 is re-weighted to High for it** — 26.07s of near-duplicate runs is 43% of the video he wants, and the take picker choosing the better attempt is exactly the mechanism that should reclaim it. **Prerequisites, both cheap and both first: R6** (somebody watches a cut — one minute, his) and **S26** (the preview reads 69s high, so the clock he would tighten against is wrong). **RESTRUCTURED 2026-09-11 against eight of his own videos: this is TWO independent problems and his own hand work proves they separate.** **The air half (E7):** six of eight references have **zero internal gaps**, five have **0.00s** of detectable silence; the app ships 5.6-6.2% and a **1.99s** internal gap nothing objected to. His standard is an **absolute, not a budget**. **The length half (E5):** median reference ~50s against 190.09s tonight. **And the proof they are separate is `img-9817` v6** — he got air to **1.4%** by hand over six versions and it is **still 98.39s**; strip every millisecond and it is 97s. **Solve either without the other.** **One correction to my own earlier framing:** the app is **not** cutting timidly — it keeps **16.8-19.1%** of raw against the **20.3%** he kept on his own reference pair, so it already cuts harder than he does. The output is long because **he records ~19 minutes of takes for a one-minute video**, which makes **collapsing near-duplicate beats (E5) the principal lever**, not editorial selection of which lines are cut. **The eight references are the steering instrument and the regression corpus** — measurable, re-runnable, no video generation needed. **EXIT RESOLVED 2026-09-12 after he retargeted this milestone — *"Forget the rule of my videos being about a minute the important thing is how fast the cuts are"* — and the measurement then contradicted him. It stays his judgement, and the argument is now DEMONSTRATED rather than predicted.** **The app already cuts at his rhythm:** 22.6-28.1 cuts/min inside his 17.0-28.9, a 2.11-2.59s average shot inside his 1.97-3.28s, all three outputs in range, tonight's cut faster than six of his seven videos. **So a metric derived from his own work is satisfied by a 190-second cut he would not post — and had cuts/min been written into this exit line, M0.85 would be closeable right now on that cut.** That is not a hypothetical about metrics; it is a fact about this board tonight. **Cuts/min is therefore retired as a target and kept as a REGRESSION GUARD** — its remaining job is stopping an E5 or E7 fix from breaking a rhythm that is already right. **Duration leaves the exit line by his instruction**, and the distinction is kept: *"forget the rule"* withdrew a constraint we wrote, **it did not say 190 seconds is fine** — so duration stays a reported observation and is not a goal. **THE EXIT, in two parts, because a purely subjective gate is not a Definition of Ready and a purely measured one just failed in front of us:** **(1) The floor — two measured refusals.** A cut may not be put in front of him while it contains **any unexplained internal pause** (E7: five of seven of his references measure exactly 0.00s) or **says the same line twice** (E5). Both are measurable, both are already filed, and their job is refusing candidates rather than declaring success — so his judgement is never spent on a cut we already know is wrong. **(2) The gate — him.** A cut from his own footage, in the packaged app, and **he says the cuts are fast.** ~~EXIT, and it is deliberately his sentence and not a metric: a cut built from his own footage in the packaged app lands at or near the length he chose, and HE says it is tight.** **Verified by Kayer, not by a number** — because every measure this project owns asks *"is this cut correct?"*, none asks *"is this a video he would post?"*, and a metric is precisely what let six versions of a too-long video read as a working feature. A scorecard reporting 100 on a three-minute cut is the failure mode to avoid re-creating, not the proof to aim for. **And the eight references make that argument stronger rather than weaker, which is the opposite of what you would expect:** `5ca5169e` is **one of his own videos at 15% silence**, so **a metric derived from seven of his videos would reject the eighth.** Steer by the numbers; gate on his judgement | R8, B8; E5 (re-weighted High), S26 (prerequisite), R6 (gate), E1's machinery |
| M0.95 | **Export is a different artefact from the preview** | **Placed 2026-09-11 from Kayer's answer to the 720p question, in his words: *"I also want... be like a proxy where it'll play and we'll edit at a small resolution. And then when we export, then it'll be bigger."*** That is the standard NLE workflow and it **settles Part 5 #9 in favour of the proxy** — the 720p review render is **correct and stays**, and S42 fixing the automatic path back to proxy resolution is aligned with this rather than against it. **What is actually wrong is that there is no export.** Nothing renders full resolution on the way out; `findCutFile` returns whatever cut exists, so on a one-click project **the preview is the file he would upload**, while the dashboard calls it *"Approved · Ready to post"*. **The only defect on the board that reaches the outside world:** he posts a 406x720 file to a 1080x1920 platform believing it is finished. **Placed ahead of M0.9 on a dependency, not a preference** — B7's version count is a question about **exports**, and answering it first would set a retention policy for an artefact that does not exist yet. **S26 is this milestone's defining requirement, not a side row**, and its sharpened form is the reason: the review preview measured **4:14.9** against an exported **190.09s / 3:05** — **69 seconds** — and it is **structural, not arithmetic**: `beats.json` records **zero holes** while the builder cut 67 beats into **123 pieces**, so **56 interior removals exist only in `edl.json` and the edit does not know about them**. **He approved a 3:05 file after previewing 4:14.9.** Under his decision that gap becomes the whole point: **a proxy is only useful if it is the same edit at lower resolution, and right now it is a different edit.** **Exit, three clauses:** (1) an explicit export produces a full-resolution file that is a **distinct artefact** from the review proxy; (2) **no surface describes a proxy as shippable** — "Ready to post" appears only against an export, and C35's family does not reappear one screen over; (3) **the proxy and the export are the same edit** — same piece count, same total, measured, so previewing 4:14.9 and shipping 3:05 cannot happen again. Verified by `snipai-tester` on a real project, since every clause is about what a file is. **Noted 2026-09-11: this milestone has NO reference to aim at.** All eight videos he supplied are **576x1024 TikTok-served copies** — including `36c80188`, the `.mov`, which is a re-export of a served copy and not an upload master — so **no artifact in our possession carries his export settings.** They evidence **editing decisions only** and must not be cited here. Until he produces an upload master, clause 1's full-resolution target is **"matches the source"** and nothing finer. He has been asked for the file he uploaded. **FOLLOW-ON QUESTION THIS MILESTONE CREATES, recorded here so it cannot be missed: once an export is a distinct artefact from the preview, Kayer must be asked once more what "keep all versions" applies to.** He answered it while previews and exports were the same file, so the word had one referent; this milestone gives it two, and keeping every full-resolution export costs several times what keeping every 720p preview does. **Until then "keep all" is literal and total and nothing prunes `cuts/`.** Do not resolve this by inference — B7 waited a full day so that his number would not be our guess, and it was then reversed within twenty minutes, which is the argument for asking rather than deducing | S26 (defining), C35's family; **B7 gets smaller when this lands** |
| M0.9 | **The app cleans up after itself** | **Placed 2026-09-11 from Kayer's own question — *"will my app clean itself instead of littering all over my computer?"*** The honest answer is not yet, and S42 is one instance of a gap rather than the whole of it. **This is a design gap, not a bug: nothing in the app has a concept of how long a file should live.** Four things have a cleanup owner — snapshots (`lib/snapshots.ts:160`), the trash (`lib/trash.ts:76`, 5 days), import staging (`lib/importBatch.ts:533`) and a failed join's output (`lib/stitch.ts:302,342`) — and **four have none at all**: `work/clips/` build intermediates (**126 entries, 768 MiB, two complete generations** for one 100-second cut), **every past cut version** (`img-0060-v1.mp4` at 20 MB beside `-v2.mp4` at 482 MB, and on his real projects **every version of every cut he has ever built is still on disk**, which is a real part of why `~/Movies/SnipAi` is **8.8 GiB for two projects**), `work/source-proxy.mp4`, and the `work/strips/` filmstrip cache — the last being the one thing S29 already identifies as changing when he merely *views* a project. **`work/clips/` is S42's, not this milestone's** — see the scope ruling above. **Exit, four clauses, and clause 2 is the one that cannot be met by a policy that never fires** — the mistake M0.6's first exit line made: (1) every directory the app writes is named in **one** place with its owner and its lifetime, and the three left here each have one; (2) **RESTATED 2026-09-11 after Kayer answered "keep all versions", and the reversal makes this clause sharper rather than weaker: edit and rebuild ten times on a real project and **everything except `cuts/`** comes back to where it started, while **`cuts/` grows by exactly one file per build and nothing else is touched in it.** That now tests two things where it used to test one — that scratch is genuinely reclaimed, **and** that nothing is quietly deleting his output. ~~total project size comes back to where it started, give or take one cut~~ cannot be met now and should not be — measured, not asserted, because "a retention policy exists" and "disk stops growing" are different claims and this project has shipped the first while the second was false; (3) **a reclaimed regenerable file is observed to self-heal** — delete `work/source-proxy.mp4`, open the project, it returns with nothing on screen about it (the `done()` check at `lib/pipeline.ts:426` is what makes this safe); (4) **nothing of his is lost** — his real library fingerprinted before and after, 0 raw files removed, 0 `beats.json` / `review-state.json` / `edl.json` modified, and no cut version removed beyond the number **he** chose. Report the measured before/after on his library rather than promising a figure. **Verified by `snipai-tester` on a real project in the packaged app**, since every clause is about what the filesystem does over a session, not about what a function returns | S42 (fixed in `4ff5213`, and it carried the intermediates), S29; **B7 RE-ANSWERED 2026-09-11 — "keep all versions", superseding the three he gave twenty minutes earlier. This milestone waits on nobody and its scope is now smaller and clearer.**

**THE DESIGN RULE THIS MILESTONE IS ACTUALLY BUILT ON, and it is worth stating because two of his own instructions look contradictory and are not: the distinction is AUTHORSHIP, not size and not age.** He asked *"will my app clean itself instead of littering all over my computer?"* (R7) and then said *"keep all versions"* (B7). Both at once, and consistent: **littering is files the app made as a byproduct; versions are files he made.** So — **files he authored are kept, always, without limit: `cuts/`, `beats.json`, `review-state.json`, his raw footage.** **Files the app produced as a means to an end are reclaimed: `work/clips/` intermediates (S42), `work/source-proxy.mp4`, `work/strips/` (S29).** Nothing needs a threshold, a timer or a number, which is why this milestone stopped needing a decision from him the moment he gave that one. **Anybody tempted to "resolve the contradiction" between R7 and B7 should read this line instead.** ~~three, his number.~~ This milestone no longer waits on anybody.** Scope settled with it: three **exports** (not previews — those are regenerable and get no policy), pruned **at build time** rather than on a timer, and the **first prune on a project with more than three versions names the files and asks once**. See B7 for all three rulings and for why `img-9817`'s six versions are the reason the third one exists |
| M1 | Make the test/QA verdict trustworthy | **Exit line rewritten 2026-09-11 — the fourth tonight that could not prove its own milestone.** It used to include "nothing silently skipped", which can never be met as written: `scripts/test:66-68` and `scripts/qa:132-136` raise "a suite was SKIPPED" for one deliberate, permanent, harmless `skipTest` in `test_paths.py`, so the warning fires on every run and is therefore read on none. **T4 leaves M1** — verified as an environment artefact, not a defect (the venv resolves, `Ran 75 tests, OK (skipped=1)`); the residual is a reporting bug now described as such in its row. **New line, and it is about the habit rather than the symptoms:** every check reports on what it actually measured. Concretely — `./scripts/qa --regressions` prints the 12 tests on the board rather than zero (T7); `guard-ledger.py` covers all id families on both sides of its comparison and never collapses two same-titled tests into one verdict (T8); one run prints one verdict and the exit code agrees with it (T3); a deliberate skip and a suite that did not run are reported differently (T4's residual); and the Swift ownership rule has a gate at all (N4). The subject here is a pattern, not a list: `verify_edges.py` certified a clipping build, a string assertion would certify P6's dead `drawbox`, `verify_cut.py` found real repeated phrases and the card said 100, and `guard-ledger.py` reported agreement across 5 of 12 tests — **four checks that reported success about something they never measured, and one of them was relayed to Kayer as assurance** | T2, T3, T7, T8, N3, N4 (all fixed), T4 (rescoped), T11, T12, T13, T14, T15 |
| M2 | Build the net under the client | A DOM harness exists; **C2's surviving half** and **CG3** each have a test that went red → green. **CG1 left this milestone 2026-09-11** — it became M-app's blocker and was provable without a harness, so it can no longer serve as this one's proof. CG3 (C11, C12, C23: destructive state cleared with no rollback) replaces it, and is the group I flagged as the one that fails silently. **Exit line rewritten 2026-09-10** — it used to name C1, which `bb4bd5f` fixed on 2026-09-08, so half of M2's exit was already met by a commit predating the milestone and the other half (C2) is now partial. A harness whose first proof is a bug that no longer exists proves nothing. CG1 replaces it because it is the one thing Kayer has reported **twice** in his own words (R4), and a net that cannot catch "the page moves itself" is not worth stringing. Dispatch by group (CG1-CG6 in the ledger), verify by id | C2 (partial), C22 (regressed), C19 (retired into C22) |
| M3 | Finish the three-level review loop | **Split into four slices 2026-09-11, before dev reached it.** The audit turned M3 into several sittings, and a large milestone that half-lands is exactly how the fade handle happened — asked for, built partway, marked done, dead for weeks. The slices are ordered so **each one is usable on its own** and none depends on a later one to make sense. **No longer gated on Kayer** — the clamp/layout question is answered (M3a). **H10 has been removed from this milestone**: "learning has no surface" is a real row but it is not part of the three-level loop, and leaving it here would have let M3 close with it open or held M3 open for unrelated work. It follows M3 as its own row with H5's take-scoring half | H1, H2, H3; C5, C12 in the same pass |
| M3a | The player and the current line can be seen together | A compact "line being spoken" strip directly under the player. **Exit: at a 767px viewport, during playback, the picture and the current line's text are both on screen for the whole cut** — verified by `snipai-tester` in the packaged app at his 900pt display, not at a size that happens to fit. **First because everything else in M3 adds to this screen**, and today the screen cannot show itself: player flush at the top puts row 1 at viewport y 968 against a 767px viewport. Building Levels 1-3 onto a surface that cannot display them is the wrong order | C28's decision, C29b |
| M3b | Level 2 is reachable and dismissable | **Exit: open the Level 2 panel from a visible control, close it again, and see markers saved yesterday without knowing a keystroke.** `setLevel2Open(false)` has no call site today, so the panel cannot be dismissed once opened. **C5 and C12 are fixed in the same pass, not after** — C12 means a removed marker comes back, and a marker feature whose deletions return from the dead is not usable no matter how reachable it is. C5's cite is `:1162-1169`, C12's `:1566-1583` | H3, C5, C12 |
| M3c | The third verdict, or its removal | **Exit: either "Needs fixes" exists as a control and produces a re-cut job that actually runs, or the dashboard branch rendering it is gone and no status exists that the review screen cannot produce.** Explicitly **not** a third button that goes nowhere — the code's own comment says the third verdict *"was a hand-back to somebody who does not exist"*, so this is an undone decision, not a missing widget. **Sequenced after C32 and must not collide with it**: C32 lands the `unreviewed` path and honest destructive copy; this builds on that machinery rather than beside it | H2 (after C32) |
| M3d | Level 3 diagnosis, and your answer survives a reload | **Exit: diagnose a beat, reload the page, see your own answer.** `DIAGNOSIS_CHECKS` at `review/page.tsx:44` is NOTES.md's checklist in full, declared and never rendered; `beatDiagnoses` has no reader at all, which is U9's write-only half — so "it saves" is not the bar, "you can read it back" is. **Settle before rendering, not after:** P6's existing Level-3 caller is `saveGraphicNote` posting `checks: ["needs-footage"]`, so the panel will show graphics requests as diagnoses of lines nobody diagnosed — decide whether that belongs in `beatDiagnoses` at all. **H11 and H8 unblock here** (the mic in the Level-3 box needs the box; H8's ten-line rejection-dialog mic can ride along) | H1, H11; H8 optional |
| M3e | Learning has a surface | **Removed from M3 2026-09-11 — it is not part of the three-level loop**, and leaving it there would have let M3 close with it open or held M3 open for unrelated work. **Exit: the numbers that change his cuts are visible somewhere he can reach, and the toggles he can flip affect a cut.** Today those are two dead ends pointed at each other — Settings reads `learnings.json` (prose), learning writes `tuning.json` (numeric), nothing displays `tuning.json`, and nothing in `ugc-edit-system/` reads `learnings.json`. `setLearnedOpen(true)` does not exist anywhere. Take H5's surviving take-scoring clamp (`learn_from_edits.py:375`, still floor-only) in the same pass | H10, H5, P2 |
| M3.5 | Make the graphics feature he kept actually work | **Placed 2026-09-11**, now the rebundle is verified. Three rows on one feature that he explicitly kept by decision and that has never rendered correctly: **P6** (`drawbox` defaults to `eval=init`, so every card's box is `w=0` for its entire life while its text animates over nothing — and the module docstring at `:14-16` asserts the opposite, which is how it survived), **S25** (pressing "Plan graphics" twice destroys every hand-made graphic), **E3** (the scorecard still penalises cuts for carrying graphics). Sits **immediately before M4** on purpose: M4 asks him to decide which features are worth keeping, and he cannot judge graphics while graphics has never worked. Deciding on a broken version of a thing is not a decision. Not this weekend's product — closes on one short tester render of a project with a definition card, not on a string assertion | P6, S25, E3 |
| M4 | Decide what SnipAi is (his call, not QA's or dev's) | Every BLOAT row has a keep/cut answer, written down. **B3 and B4 added 2026-09-11** — the standing order named B1, B2, B5 and B6 and was silent on these two, so they read as decided and were not. The drop-folder question is framed with a recommendation (delete it) under Bloat in the ledger, waiting on him **B4 answered 2026-09-11 — delete the drop-folder ingest** (Kayer delegated it: *"let the PM decide"*; reasoning in the ledger under Bloat). That leaves **B3 only**, and smaller: two of its nine `.command` scripts go with B4, which also moots P7 and most of P4 | B3 (open), B1, B2, B4, B5, B6 (all answered) |
| M5 | ~~Ship to a human who isn't him~~ — **PARKED 2026-09-11** | Parked by Kayer's standing statement, *"this app is just for me right now."* Kept rather than deleted, the way P1 was, so the reason is findable when it changes: the milestone is not wrong, it has no audience yet. **Two things do NOT park with it.** **P16** — the bundle is not reproducible from the repo (an untracked, hand-made `Info.plist`; a copy now committed at `scripts/build/Info.plist`) — stays open at unchanged priority, because the M5 framing was too narrow: if `SnipAi.app` is ever deleted, or he clones the repo to a second machine of his own, `bundle-app` cannot produce a launchable app. That is a him-problem, not a them-problem. The same holds for **N2 and T5's whole family** — "works on this Mac, missing from the artifact" — because he is the one running the artifact. **Single-user is not single-copy**, and it is not licence to lower the bar on anything protecting his footage or his output: N1, T6, the sandbox work, S8, S25, C27 and M1's subject all stand exactly as they were | P16, N2, T5 (all still live) |

## Open

| # | What he asked for | Notes |
|---|---|---|
| R5 | Several clips that are really one video | Asked 2026-09-11. He records one TikTok across several takes/files and wants them treated as ONE project with ONE cut — and the take picker choosing across all of them, so a line said better in clip 3 wins over clip 1. **Today:** the uploader accepts multiple files but makes each its own project (`DropZone.tsx:211`), and `lib/types.ts:24` is `source: string` — singular. 68 sites assume one source (26 TS, 42 Python). **Two ways, and the cheap one is probably right.** (a) *Concatenate at import*: join the dropped clips into one `raw/` file before anything else runs; everything downstream sees one continuous recording and needs no change, and the take picker spans all clips for free. `-c copy` if codec/resolution/fps match (same phone, same mode: they will), re-encode if not. Roughly one function. (b) *True multi-source*: `source: string` becomes a list and all 68 sites learn about it. Correct, much larger, and buys little beyond (a) for his actual workflow. **Recommend (a)**, and only reach for (b) if mixed-format sources become normal. **Exit condition:** drop four clips of one TikTok at once, get one project, one cut, and a take chosen from a clip other than the first **Status 2026-09-11 after the first real-footage run: built, and not working for him.** Route (a) is implemented across three slices and the tray proposes and waits — but on **his** clips the join is refused every time (ledger **S34**) and the grouping proposed five projects for two videos (**S37**). Nothing he owns can be imported as one video today. Stays `open`, and it is M0.8's blocker, not a later milestone's | open |
| R4 | "No more scrolling when I'm not scrolling" | Said 2026-09-11, and **said before** — the `pointerDown` guard in `review/page.tsx` quotes the first report. That fix covered dragging only. Mechanism found and filed as ledger **C22**: `yield4s` hands the list over when you scroll, then four seconds later actively yanks it back (`setFollowTick`), instead of just resuming. Also runs while paused. **Updated 2026-09-10:** bigger than one fix. C22 is a **regression** — `setFollowTick` arrived in `bb4bd5f` as a deliberate feature — and C19 turned out to be a third trigger of the same rule, not a rendering bug. Now ledger group **CG1**: three call sites, one guard that is wrong for all three. It is M2's exit condition, so it gets a test, not just a patch. Third report would be the one that matters **Not done, despite C22/C28/C29 being merged.** Ledger **C27** is the same bug one axis over: `Timeline.tsx:501-507` writes `el.scrollLeft` to keep the playhead centred, guarded against five drag states but **never against the video being paused**, and with **no yield at all** — so scrolling the timeline by hand during playback is taken straight back. He would experience that as the app still scrolling when he is not scrolling, which would be the **third** report. **R4 does not close while C27 is open**, and that link is written here rather than left to memory, because a request marked done with a live half is precisely the fade-handle failure this docket exists to prevent |
| R2 | Products & links | The form writes a file only an uninvoked tool reads |
| R9 | **"Let Mara in the driver's seat... don't want to rush and want to utilize the team you and I built to their fullest potential."** | Said 2026-09-11, after he spotted the real thing first — *"I feel like you're doing Mara's job — is that a fair statement?"* — and it was. **Recorded in PROCESS.md** as an amendment with what moved (the sequence) and what deliberately did not (safety halts, and his own line of contact). **Not a preference about org chart: it is a decision about error rate.** The argument is in PROCESS.md — four corrections in two hours, all four of which would otherwise have shipped. **The standing reading of "fullest potential": it means not shipping avoidable errors, not keeping five roles occupied.** Done, and kept here because a role change nobody wrote down is a role change that lapses | done |
| R8 | **"I want this app bulletproof solid and these videos to be super tightly cut. my usual time i have a finished video is about a minute."** | Said 2026-09-11, and it is **the most consequential thing he has said about output** — it is the first time anyone has stated what *finished* means. **Two requirements in one sentence.** *"Super tightly cut"* and the minute are **M0.85**. *"Bulletproof solid"* is a standing instruction and is already live — it is why the S34 fail-open was hunted and closed (`bb345e7`), and Desmond is auditing the multi-clip guards for more of the same shape. **Do not read the second half as mood.** **Measured against the number: never once delivered.** Six versions of `img-9817` ending at 1:38, `img-9823` abandoned at 2:59, tonight's three-clip cut at 3:10. **The app has no target-length machinery at all** — one grep, one hit, and it is a character cap on learnings text. **AMENDED BY HIM 2026-09-12:** *"Forget the rule of my videos being about a minute the important thing is how fast the cuts are."* **The minute is withdrawn; cut speed is the named axis — and the measurement says cut speed already matches his own videos.** That contradiction is resolved in M0.85's exit: cuts/min is a proxy, the app satisfies the proxy, and the property fails for two filed reasons (E7's dead air, E5's repetition). He also withdrew one of the eight reference videos as a bad example. **Closes when he says the cuts are fast**, not when a metric says so | open |
| R11 | **"I want the app to look up the actual definition of the ingredient."** | Asked 2026-09-12. **And the mechanism is already built — this is the third thing tonight that turned out three-quarters done.** `~/Movies/SnipAi/reference/glossary.json` holds **15 terms, 0 verified**; `plan_graphics.py:137` reads the flag, `:195` prints `[definition UNVERIFIED]`; `GraphicsPanel.tsx:112-268` has the unverified list, the approve controls and an `allowUnverified` override; `graphics/route.ts:97-99` validates it. **The glossary's own `_note` makes the safety claim and the code honours it** — *"the app will not burn an unverified card in without an explicit override"* — so **nothing unsourced has reached a video.** **What is missing is the content, not the feature:** all 15 definitions are assistant-drafted with no source, the set is skin/beauty while tonight's products were **creatine** (absent) and glutathione, and `Hyaluronic Acid`/`Hyaluronic acid` are duplicated. **His two graphics requests are ONE feature, not two** — he asked an hour earlier for the card to show its source so he can edit or accept before it renders, which is *propose, do not decide*, the same pattern as the import tray, **and it is the mitigation for the one real risk here: these cards make factual claims about supplements, in his voice, on his channel.** Filed as ledger **H12**; the single decision that is his is **B9** | open |
| R10 | **He speeds up sections of his videos** | **Recorded 2026-09-12 as a fact, NOT as a request — his own words were *"I was gargling mouthwash and sped it up"* and *"You won't get a lot of those"*, so he explicitly damped it.** Filed anyway, for one reason: **the app's edit model cannot represent it at all.** Confirmed by grep — **no `setpts`, no `atempo`, nothing on a beat or in the EDL carrying a rate**; every `rate` in the codebase is an audio sample rate for the waveform. So a technique he demonstrably uses has no expression in the product. **Not scheduled and not scoped**, because he said not to expect many and inventing a rate field on the strength of one mouthwash clip is exactly the scope invention this process forbids. **It is here so that the answer exists the day he asks *"why can't I speed this bit up"* — the fade handle is the cautionary tale about a capability nobody was keeping score of.** Cross-filed as a false-positive note in **E7**: a future reference reading 15% silence may be this, not a defect | open — recorded, not requested |
| R7 | **"Will my app clean itself instead of littering all over my computer?"** | Asked 2026-09-11, in those words. **He was told the honest answer: not yet.** Four of the app's eight written locations have a cleanup owner and four have none, so the app's footprint grows with use and never comes back down — `~/Movies/SnipAi` is **8.8 GiB for two projects**, and one delete-and-rebuild cost **~1 GB** (S42). **Scoped as M0.9**, behind S42 which is the acute instance. One number is his and is in Blocked as **B7**; everything else is ours. **Does not close when the policy is written — it closes when disk stops growing over a session**, which is clause 2 of M0.9's exit | open |
| R6 | **Watch the joined cut, and say if it is right** | **Added 2026-09-11, and it is the last step of M0.8's exit line.** Two of his clips are one cut and every machine-checkable property of it passes — no A/V drift across the seam, no black frames, 17 beats from the second clip carrying the whole CTA, transcript clean across the join. **Nobody has watched it.** No agent can: there is no Screen Recording grant for the tester's shell, proven rather than assumed. One command in his own library — `open cuts/img-0060-v1.mp4` — and M0.8's last item is either done or has a real defect behind it. **Not blocked on code, money or a credential; blocked on one pair of eyes** | open |
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
| B6 | **Room to import his own footage** | **His decision, in front of him now.** His three creatine clips total **3.2 GB**; an import needs roughly double that; the volume has **4.7 GiB** free after a temp sweep. So Nadia's run — M0.8's exit line, S35's failing case, and the joined cut S37/E4/E5 need — **cannot start until space is found**. The largest single object on the machine is a **15 GB VM image belonging to the Claude desktop app**, bigger than his entire footage library and four times the Downloads duplicates that were the other candidate. **Nobody deletes anything of his, and nobody deletes that image on his behalf** — it is named here so the choice is his and is findable when it is made. T19 is ours and is being fixed regardless. **Updated 2026-09-11 evening: 6.4 GiB free** — about 4.6 GB came back from purgeable space plus reclaims, and the two-clip run fitted inside it. **The three-clip run still needs a decision**, and S42 changes the arithmetic: until it is fixed, budget ~2x the joined bytes for the import and **do not touch a line**, or budget another ~1 GB per edit. **The tester's 2612 MiB sandbox is being held deliberately**, with the packaged app still running against it, because `projects/img-0060/` is the evidence behind five open rows — do not sweep it yet. **Updated 2026-09-11 night: disk 3.6 GiB, the tester's sandbox 5.1 GiB, both held.** And **`~/Movies/SnipAi/qa-3clip/qa-evidence/` — 13 MB — is the evidence behind about a dozen rows**: `proposal-batch.json`, `jobs.json`, `beats.json`, `edl.json`, `review-state.json`, `joined-transcript.json`, `per-piece-av-deltas.csv` and 10 screenshots. **It is 13 MB and it is the only durable record of that run** — the tester's harness forbids writing a report file, so the findings exist as rows plus this directory. **Do not reclaim it for space; it is cheaper than re-running a 19-minute transcription and a 32-minute build** |
| B9 | **Definitions for the ingredients you sell, or lookup for anything?** | **R11/H12's one open product question, and it is a boundary question rather than a feature question — which is why it is his.** **This app has no network path by design:** no accounts, nothing leaves the machine, which is why it works offline and why his footage stays local. A lookup is either **(a) offline and curated** — limited to what ships, goes stale, no data leaves — or **(b) a live query**, which is accurate and unlimited and **sends what he says in his videos to a third party.** **(b) changes the app's character, not just its feature list**, and it is the same boundary P1 was parked on from the other direction. **Recommendation: (a), and the argument is that (b) solves a problem he does not have.** He is not looking up arbitrary words — he is looking up **the ingredients in the products he sells**, which is a small, stable, curated set: the glossary already holds 15 and `products.json` already exists (R2). **So sourcing his own ingredient list is an afternoon of citation and needs no boundary change**, and where a term is missing the card says so rather than inventing one. **The question to him is therefore narrow: is definitions-for-what-you-sell enough, or do you want to type any word and get an answer?** Only the second needs a network path, and only he can trade that against his footage staying local | waiting on Kayer |
| B7 | **How many past versions of a cut should the app keep?** | **RE-ANSWERED BY KAYER 2026-09-11, later the same night: "Keep all versions." That supersedes the "three" he gave twenty minutes earlier. Both answers are kept, in order, because the sequence is the record.** **(i) He confirmed three.** **(ii) He was then told that pruning to three would delete four files totalling ~1.65 GB on his very next build, and that those four are the only surviving record of him cutting `img-9817` down by hand.** **(iii) He said: keep all versions.** **Nobody is claiming (ii) caused (iii) — he did not say, and the row does not guess.** The two facts are adjacent in the conversation and are written in order rather than presenting "keep all" as his first and only word on it. **The cost is his and he chose it with the number in front of him:** `cuts/` is **2.6 GB for `img-9817` and 858 MB for `img-9823` — about 3.5 GB, ~40% of his 8.8 GB library** — on a machine whose free space hit **787 MB** today, and at full-resolution exports it is several times that per project. **Superseded first answer, kept verbatim:** three, and the rest can go. His words: *"Didn't we say keep the last 3 versions and we can let go of the rest?"* — and he was told plainly that three had been **our recommendation, twice, which he had never said yes to**, so the row had been sitting open with a guess attached rather than a decision. **He then decided it. The number is his.** That distinction is the entire reason this row waited a day instead of being coded on the first evening, and it is recorded because "he confirmed our guess" and "he chose" look identical in a changelog and are not the same thing. **Originally:** M0.9's one open product question, put to him with a recommendation of three. **Recommendation: three, pruned at build time rather than on a timer** — a version then disappears only as a direct consequence of him making a new one, which is the moment he is least surprised by it, and three is large enough to cover *"I posted the one before last."* **The argument, and it is the reason this is his call rather than a policy we can derive:** `cutStatus` lives on the **project** (`lib/types.ts:48`, `lib/reviewState.ts:13`), **not on a cut file** — so the app cannot know which version he actually posted, and "keep the approved one" is not implementable today. A count is the only mechanism available, which makes the number load-bearing rather than cosmetic. **Two things need no decision and are not waiting on him:** build intermediates are scratch that nothing reads after the build, so they go when the build ends (S42), and proxies and thumbnails are regenerable and rebuild on demand, so they can be cleared under pressure. **If he says "keep them all", that is a complete answer** — it just means M0.9's clause 2 is met by the other three owners and his disk keeps growing with cuts by his choice, which is different from growing by accident. **SCOPING RULING, and it is the one place I will not interpret him.** *"Keep all versions"* was answered while **a version meant one thing** — every file in `cuts/` is an artefact of his work, because previews and exports are the same file today. **M0.95 makes the word mean two things**, and keeping every full-resolution export has a very different cost from keeping every regenerable 720p preview. **So: today "keep all" is literal and total — nothing prunes `cuts/`, full stop — and when M0.95 lands he is asked once more, with the per-file cost stated.** Recorded as the follow-on in M0.95's row so it cannot be missed. **I am explicitly NOT reading "keep all versions" as licence to prune previews**, even though a preview is rebuildable from the EDL in seconds and keeping every one is storage with no product value. That is a good argument and it is still an interpretation of words he chose, and B7 waited a whole day precisely so that his number would not be our inference. **Superseded narrowing, kept:** once **M0.95** makes an export a distinct artefact from the review proxy, this stops being *"how many cuts"* and becomes *"how many exports"* — previews are regenerable and need no policy from him at all. **Smaller and clearer, still his.** He has not answered the number; do not read the narrowing as an answer. **Two scoping questions were left to me and are ruled here, since he spoke to the *how many* and not the rest.**

**ALL THREE RULINGS BELOW ARE NOW DORMANT RATHER THAN WRONG, and they are kept rather than deleted because he has reversed once tonight already.** Nothing prunes, so there is nothing to schedule, nothing to scope and nothing to ask about. **Each carries the trigger that would revive it: any pruning policy at all.** Deleting them would mean rediscovering the 1.65 GB argument from scratch the next time a number is proposed — and the docket's own habit is to keep a parked reason findable, the way P1 and M5 are.

**(1) When it prunes: at build time, not on a timer.** My original recommendation, which he did not contradict. A version then disappears only as a direct consequence of him making a new one — the moment he is least surprised by it — and a timer would delete his work while he was not looking at it, which is a different product.

**(2) Whether "three" attaches to cuts or to exports: exports, and the question dissolves rather than needing a call.** **M0.9 is built after M0.95 in the order already ruled** (M0.85 -> M0.95 -> M0.9), so by the time retention is implemented an export *is* a distinct artefact. So: **three exports**, and **previews get no product policy at all** — keep the newest, regenerate the rest on demand, because a regenerable file is not a choice anybody should have to make.

**(3) One thing I am adding that he did not ask for, because his consent was to a policy and not to a list of filenames: the first prune on a project that already has more than three versions names the files and asks once.** After that it is silent forever. **The reason is specific and not caution for its own sake:** `img-9817` has **six** versions — 29 MB, 530, 548, 545, 491, 490 — and build-time pruning would delete **v1 through v4 on his very next build**, about **1.65 GB**, which is *"the rest"* he authorised **and** the only surviving record of him fighting the tool by hand: the ledger's postable-question block preserves the durations and the timestamps, but **not what was cut between versions.** M0.85 may want exactly that. One click, once per project, is proportionate against irreversibly deleting half a gigabyte of his rendered output on a policy that shipped while he slept — and CG3 is a whole ledger family about destructive state cleared with no rollback |
**B5 cleared 2026-09-11** and removed from this table: he granted Screen
Recording and Accessibility, both verified directly. That unblocked the entire
native surface in one go — M0's last item, M-app's exit line, C20, and every
native check from here on. It sat here for one evening and cost two minutes.
Worth remembering the shape: the highest-leverage thing on the board was not
code, and no agent could do it.

## Parked

| # | What | Why |
|---|------|-----|
| P2 | **A front-end engineer ("Chad")** | **Asked and declined 2026-09-11, by Kayer's delegation — his words: *"If we do, name him Chad. If Mara deems it unnecessary then nevermind."*** Kept rather than deleted so the reasoning is findable if it changes. **Three reasons, strongest first.** (1) **A second implementer is structurally incompatible with a WIP limit of one row.** That was handed to me as a constraint rather than a question, but it is the decisive argument: with one row in flight, either he idles or the limit breaks — and the limit is not housekeeping, it is the direct counter to the failure this whole process exists to prevent, nine features at eighty percent. Adding hands to a system whose governing rule is *one thing at a time* means the rule loses. (2) **The five roles work by refusal, not throughput.** Each refuses the other four's job and that refusal is what makes the output honest. Chad refuses nothing that is not already refused. **Ines was worth adding because she covered a blind spot nobody *could* see; this covers a queue nobody has *reached*** — every row cited for him (C30, C39, C40, C41, S26, the truncated waveform words, Desmond's finding 11) is **already found and already filed**. Capacity, not vision. (3) **The strongest argument in his favour is an argument for a different role.** *"Nobody is shaped for: the review screen is exhausting to use"* is true and is a real gap — but a front-end **engineer** does not fix *exhausting* either. That is design judgement, which is Kayer's seat to hold and mine to frame, and answering it with an implementation hire is how you get a well-built screen nobody decided the shape of. **If he wants a design opinion that is a separate question and worth asking separately.** **Two counters dismantled rather than dismissed.** *"M0.85 is partly front-end"* — **S26 is not front-end work**: its mechanism is that `beats.json` records zero holes while the builder cut 67 beats into 123 pieces, so the fix is making the edit model carry what the builder did (`lib/` and the pipeline) and the display follows for free; and M0.85's exit is *he says it is tight*, verified by Kayer, which needs no new surface. *"A harness does not fix anything"* — correct, and the fixes it unblocks are **row-sized, not person-sized**: C39 is *separate select from edit*, C40 is a condition. Those are afternoons. **What to do instead is already on the roadmap — see M2** |
| P3 | **What is the target length, exactly?** | **PARKED 2026-09-12 — withdrawn by Kayer before it was ever answered:** *"Forget the rule of my videos being about a minute."* **Kept rather than deleted, because the history is the most instructive thing on this board.** It was asked instead of guessed; my own recommendation of a 45-75s band was then shown **wrong at both ends and wrong in shape** against his seven videos (37.4-83.4s, a 46-second spread — his loosest measure on any cut of the data); and then **the whole question was retired by the person it was waiting on.** **Nothing was ever coded against it.** Two days of a row sitting open cost nothing and saved a constant nobody would have been able to remove later. **Unpark it only if he names a length again** |
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
