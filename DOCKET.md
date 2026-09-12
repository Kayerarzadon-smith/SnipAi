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

**STILL OPEN, and the reason narrowed twice in one evening.** Everything that was in the way has moved: S34 and S36 fixed, green, and now **tester-verified in the packaged app**; N15 fixed and driven against the packaged server and then by a real NSOpenPanel and a clickable tray. **Two of his clips are now one cut** — 1:45.02, no A/V drift across the seam, no black frames, **17 beats from the second clip and they are the entire CTA**. **What is left is exactly two things.** (1) **The grouping half of the exit line** — four clips of one TikTok plus one standalone, proposing 2 projects and not 5 and not 1. Never exercised; two clips in one group is not that test, and S37 records the rule getting it wrong on six clips. (2) **Somebody watching the video.** No Screen Recording grant for the tester's shell, so a full decode and a Whisper transcript of the finished file were substituted — strong, and not eyes on a screen. **That one is Kayer's: `open cuts/img-0060-v1.mp4`.** **Proven on: a two-clip group, one pair** **THREE-CLIP RUN 2026-09-11, and the exit line is AMENDED rather than met.** `{0060,0061,0062}` joined and built: **190.09s, 5702 frames, 40ms of drift across two seams**, both seams clean on `blackdetect` and `blackframe`, **A/V delta measured on all 123 pieces with zero over one frame**, played in the native window. **All three clips are in the cut** — 40 pieces / 61.06s, 55 / 77.16s, 28 / 45.05s: hook, benefits, CTA — **and the take picker chose across clips for the first time**, keeping clip 2's line at 98% over a 90% attempt, which is R5's stated intent observed. **But the tray proposed "This looks like 2 videos - 3 clips", splitting the CTA off, and a human clicked "Actually one video" to get that result.** The exit says the tray *proposes* one project. **AMENDED CLAUSE, and the amendment is two-sided so it cannot be met by flagging everything:** the tray proposes one project for these three clips, **or flags `0061->0062` and asks** — and in the same run does **not** ask about `0060->061`, which it called confidently. That is the design's own *"propose, do not decide"* with a bound on it, since a tray that asks about every seam is not proposing and breaks this row's promise that a confirm costs one click when the guess is right. **Blocked on S38 + C37, which is the ruled next row; S37 follows and becomes evaluable once a score reaches a screen** |
| M0.85 | **A cut he would actually post — about a minute, tightly cut** | **Placed 2026-09-11 from Kayer's own words: *"I want this app bulletproof solid and these videos to be super tightly cut. my usual time i have a finished video is about a minute."*** **The app has never delivered this and has no machinery aimed at it** — confirmed by grep across `lib/`, `app/` and `tools/`: no target duration, no maximum, no length budget, and the drafter's objective is *"keep every beat that is not a duplicate"*, so length is whatever the footage reduces to. Six versions of `img-9817` (1:50 → 1:38 over 38 hours, one at 00:15 and the next at 07:07) and `img-9823` abandoned at 2:59 are him fighting this by hand and losing; tonight's three-clip cut was **3:10**. **Three parts, and they are different jobs — do not let one of them stand for the milestone.** **(1) There is no target and there needs to be one** — a budget the drafter optimises against, **not a hard truncation**, and **the number is his: do not guess a constant into the code** (that is B7's lesson from the same day). Open as **B8**. **(2) "Super tightly cut" is a second requirement, not the same one** — hitting a minute by dropping whole beats is not hitting it by tightening every beat, and he said both words. The under-used machinery is named rather than invented: `FRAME_PAD` (E1), the silence removal, the 56 interior removals the builder already makes, and `verify_edges.py`'s finding that **17 of 17 edge fragments sit below the speech floor** — which suggests there is room to cut tighter without clipping a word and **nobody has measured how much.** **(3) Repeats are the principal lever, and E5 is re-weighted to High for it** — 26.07s of near-duplicate runs is 43% of the video he wants, and the take picker choosing the better attempt is exactly the mechanism that should reclaim it. **Prerequisites, both cheap and both first: R6** (somebody watches a cut — one minute, his) and **S26** (the preview reads 69s high, so the clock he would tighten against is wrong). **EXIT, and it is deliberately his sentence and not a metric: a cut built from his own footage in the packaged app lands at or near the length he chose, and HE says it is tight.** **Verified by Kayer, not by a number** — because every measure this project owns asks *"is this cut correct?"*, none asks *"is this a video he would post?"*, and a metric is precisely what let six versions of a too-long video read as a working feature. A scorecard reporting 100 on a three-minute cut is the failure mode to avoid re-creating, not the proof to aim for | R8, B8; E5 (re-weighted High), S26 (prerequisite), R6 (gate), E1's machinery |
| M0.95 | **Export is a different artefact from the preview** | **Placed 2026-09-11 from Kayer's answer to the 720p question, in his words: *"I also want... be like a proxy where it'll play and we'll edit at a small resolution. And then when we export, then it'll be bigger."*** That is the standard NLE workflow and it **settles Part 5 #9 in favour of the proxy** — the 720p review render is **correct and stays**, and S42 fixing the automatic path back to proxy resolution is aligned with this rather than against it. **What is actually wrong is that there is no export.** Nothing renders full resolution on the way out; `findCutFile` returns whatever cut exists, so on a one-click project **the preview is the file he would upload**, while the dashboard calls it *"Approved · Ready to post"*. **The only defect on the board that reaches the outside world:** he posts a 406x720 file to a 1080x1920 platform believing it is finished. **Placed ahead of M0.9 on a dependency, not a preference** — B7's version count is a question about **exports**, and answering it first would set a retention policy for an artefact that does not exist yet. **S26 is this milestone's defining requirement, not a side row**, and its sharpened form is the reason: the review preview measured **4:14.9** against an exported **190.09s / 3:05** — **69 seconds** — and it is **structural, not arithmetic**: `beats.json` records **zero holes** while the builder cut 67 beats into **123 pieces**, so **56 interior removals exist only in `edl.json` and the edit does not know about them**. **He approved a 3:05 file after previewing 4:14.9.** Under his decision that gap becomes the whole point: **a proxy is only useful if it is the same edit at lower resolution, and right now it is a different edit.** **Exit, three clauses:** (1) an explicit export produces a full-resolution file that is a **distinct artefact** from the review proxy; (2) **no surface describes a proxy as shippable** — "Ready to post" appears only against an export, and C35's family does not reappear one screen over; (3) **the proxy and the export are the same edit** — same piece count, same total, measured, so previewing 4:14.9 and shipping 3:05 cannot happen again. Verified by `snipai-tester` on a real project, since every clause is about what a file is | S26 (defining), C35's family; **B7 gets smaller when this lands** |
| M0.9 | **The app cleans up after itself** | **Placed 2026-09-11 from Kayer's own question — *"will my app clean itself instead of littering all over my computer?"*** The honest answer is not yet, and S42 is one instance of a gap rather than the whole of it. **This is a design gap, not a bug: nothing in the app has a concept of how long a file should live.** Four things have a cleanup owner — snapshots (`lib/snapshots.ts:160`), the trash (`lib/trash.ts:76`, 5 days), import staging (`lib/importBatch.ts:533`) and a failed join's output (`lib/stitch.ts:302,342`) — and **four have none at all**: `work/clips/` build intermediates (**126 entries, 768 MiB, two complete generations** for one 100-second cut), **every past cut version** (`img-0060-v1.mp4` at 20 MB beside `-v2.mp4` at 482 MB, and on his real projects **every version of every cut he has ever built is still on disk**, which is a real part of why `~/Movies/SnipAi` is **8.8 GiB for two projects**), `work/source-proxy.mp4`, and the `work/strips/` filmstrip cache — the last being the one thing S29 already identifies as changing when he merely *views* a project. **`work/clips/` is S42's, not this milestone's** — see the scope ruling above. **Exit, four clauses, and clause 2 is the one that cannot be met by a policy that never fires** — the mistake M0.6's first exit line made: (1) every directory the app writes is named in **one** place with its owner and its lifetime, and the three left here each have one; (2) **edit and rebuild ten times on a real project and total project size comes back to where it started, give or take one cut** — measured, not asserted, because "a retention policy exists" and "disk stops growing" are different claims and this project has shipped the first while the second was false; (3) **a reclaimed regenerable file is observed to self-heal** — delete `work/source-proxy.mp4`, open the project, it returns with nothing on screen about it (the `done()` check at `lib/pipeline.ts:426` is what makes this safe); (4) **nothing of his is lost** — his real library fingerprinted before and after, 0 raw files removed, 0 `beats.json` / `review-state.json` / `edl.json` modified, and no cut version removed beyond the number **he** chose. Report the measured before/after on his library rather than promising a figure. **Verified by `snipai-tester` on a real project in the packaged app**, since every clause is about what the filesystem does over a session, not about what a function returns | S42 (S42 first, and it carries the intermediates), S29; **B7 is the one decision this milestone waits on** |
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
| R8 | **"I want this app bulletproof solid and these videos to be super tightly cut. my usual time i have a finished video is about a minute."** | Said 2026-09-11, and it is **the most consequential thing he has said about output** — it is the first time anyone has stated what *finished* means. **Two requirements in one sentence.** *"Super tightly cut"* and the minute are **M0.85**. *"Bulletproof solid"* is a standing instruction and is already live — it is why the S34 fail-open was hunted and closed (`bb345e7`), and Desmond is auditing the multi-clip guards for more of the same shape. **Do not read the second half as mood.** **Measured against the number: never once delivered.** Six versions of `img-9817` ending at 1:38, `img-9823` abandoned at 2:59, tonight's three-clip cut at 3:10. **The app has no target-length machinery at all** — one grep, one hit, and it is a character cap on learnings text. **Closes when he says a cut is tight**, not when a metric says so | open |
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
| B7 | **How many past versions of a cut should the app keep?** | **M0.9's one open product question, already put to him 2026-09-11 with a guess of three. It waits; nobody guesses a number into the code.** **Recommendation: three, pruned at build time rather than on a timer** — a version then disappears only as a direct consequence of him making a new one, which is the moment he is least surprised by it, and three is large enough to cover *"I posted the one before last."* **The argument, and it is the reason this is his call rather than a policy we can derive:** `cutStatus` lives on the **project** (`lib/types.ts:48`, `lib/reviewState.ts:13`), **not on a cut file** — so the app cannot know which version he actually posted, and "keep the approved one" is not implementable today. A count is the only mechanism available, which makes the number load-bearing rather than cosmetic. **Two things need no decision and are not waiting on him:** build intermediates are scratch that nothing reads after the build, so they go when the build ends (S42), and proxies and thumbnails are regenerable and rebuild on demand, so they can be cleared under pressure. **If he says "keep them all", that is a complete answer** — it just means M0.9's clause 2 is met by the other three owners and his disk keeps growing with cuts by his choice, which is different from growing by accident. **Narrowed 2026-09-11 by his own proxy decision, and left open:** once **M0.95** makes an export a distinct artefact from the review proxy, this stops being *"how many cuts"* and becomes *"how many exports"* — previews are regenerable and need no policy from him at all. **Smaller and clearer, still his.** He has not answered the number; do not read the narrowing as an answer |
| B8 | **What is the target length, exactly?** | **M0.85's one open product question, and the second number in two days that must not be guessed into the code.** He said *"about a minute"*, which is a target and not a specification. The three candidate shapes, and they produce different drafters: **(a) 60s as a budget** the drafter optimises toward and may miss; **(b) a band, 45-75s**, which lets a good cut at 68s stop rather than be squeezed; or **(c) "as short as it can be without losing the point"** — no number, and the drafter drops whole beats until meaning breaks, which is the most ambitious and the hardest to verify. **Recommendation: (b), a band of 45-75s, and make it settable in Settings rather than compiled in.** The one-sentence argument: a hard 60 would force the drafter to cut into a good 68-second video, and a band is the only one of the three that can say *"this is finished"* rather than *"this is as close as I got"* — which is the difference between the six versions of `img-9817` and one. **B7's lesson applies directly and is four hours old: a number we choose becomes a number he has to fight.** Waiting on him |
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
