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
| M0 | Prove drop-in auto-cut on a brand-new clip | A raw file dropped in the dashboard produces a finished cut in `cuts/`, no terminal touched. **Pipeline half banked 2026-09-10** by `snipai-tester` on both surfaces: all four stages ran to completion, a finished file landed in `cuts/` every time, no >1s silence, no black frames, both streams present, frame count matches duration, `state/jobs.json` `done`/`100` with no unhandled traceback. **Does not close yet** — the one unverified thing is the one the exit line is actually about: nobody has *dropped* a file in. Import-picker and drag-and-drop cannot be driven from here (see Blocked). Remaining scope: that single act. **Unblocked 2026-09-11** — Kayer granted Screen Recording and Accessibility, both verified directly (`osascript` returns real window geometry; a captured window region measures 256/256 distinct bytes rather than stripped wallpaper). A `snipai-tester` run covering the picker/drag item is in flight | S3 (fixed) |
| M0.5 | Stop shipping clipped audio | **Exit line rewritten 2026-09-10 — the old one could not prove the claim.** It read "`python3 qa/verify_edges.py` reports 0 of 34"; that tool reads `work/edl.json`, `work/transcript.json` and the source audio and **never opens a rendered clip**, while E1's truncation happens downstream of the EDL in ffmpeg's per-clip re-encode. It reported clean on a build that was demonstrably still clipping. Also "0 of 34" is img-9817's denominator — a fresh import yields 2-3 measurable fragments, so a clean run on a new project is a thin result even with the right tool. **New line: for a clip built by the packaged app, every rendered clip's measured duration is ≥ its requested `dur`.** **MET AND CLOSED 2026-09-11.** Re-run against the rebundled app: **11 of 11 clips, 0 short, +0.047s to +0.073s, mean +0.064**, measured with the bundle's own PyAV by full stream decode rather than container headers, and the stricter `min(video, audio) ≥ dur` holds for all 11 — including the two sub-0.3s fragments most at risk of losing a consonant (+0.069, +0.065). The padding survives the concat: `dur` sums to 15.234s, the finished file is 15.93s (478 frames @30), which is 11 × ~0.064 accounted for. Dev and packaged now agree (dev was +0.037 to +0.059 across 26). **Closed on the fix, not on his library** — see M0.7. Note **T5 is not fixed**: the rebundle cured this instance of a stale bundle, but `bundle-app` still has no check that what it produced matches the repo, so the next one can go stale the same way and nothing will notice | E1 (fixed), T5 (still open) |
| M0.6 | A sandboxed run cannot touch the real library | `SNIPAI_DATA` either takes effect or the launch refuses; an adopted server is announced, never silent; quitting the app stops the server it started. Verified by launching against a sandbox while a server holds 4737 and confirming `/api/projects` does not serve `~/Movies/SnipAi`. Reconcile with P19 in the same pass — same function, opposite asks | N1, P19 |
| M0.7 | Make the E1 fix reach the footage he already has | **Opened 2026-09-11, and it is the reason M0.5 closing is not the end of the clipped-audio story.** The packaged bundle ships no `pipeline-version.json`, so packaged builds stamp `work/pipeline.json` with `"version": 0`, and the repo's own manifest still reads `"version": 2, "changed": "2026-09-09"` — never bumped for E1. Confirmed end-to-end from the running packaged server: `GET /api/projects/m05-recheck` → `cutStale: false`. **So E1 is fixed for footage imported from now on and silently not applied to anything already in his library**, and the one signal that would tell him — the "Rebuild — the cutting has improved since this was built" badge — is inert in the app he opens. His two real cuts, img-9817 and img-9823, were both built before `WORD_RESCUE` and would never be flagged. Exit: the manifest ships inside the bundle, is bumped past 2 citing E1, and `cutStale` reads **true** on a pre-fix cut in the packaged app | N2 |
| M0.75 | Stop losing lines out of the cut | A trim that drives a hole across its own beat renormalises instead; the beat still emits pieces, and a beat that ends up empty is never silently rendered as nothing. Green regression test in `lib/`, no server needed | S8 |
| M-app | Make it watchable inside SnipAi itself | Open a cut in the native window, press play, watch all of it. **Both fixes in and green** (`tests/regressions/S18-*`, `S19-*`) — but S19 is forward-only, and all six `img-9817` cuts on disk still carry `moov` last (v6: moov@513655552 of 513MB). The named file cannot pass until it is rebuilt. Closes on the cut the tester's run produces, or on a rebuilt `img-9817` — not on the ledger alone | S18 (fixed), S19 (fixed) |
| M1 | Make the test/QA verdict trustworthy | A clean run prints one verdict; a deliberately broken run goes red. **Root cause (guard-ledger.py) fixed** — T3/T4 (the two-verdicts-in-one-run problem, and the silent pipeline skip) still open | T2 (fixed), T3, T4 |
| M2 | Build the net under the client | A DOM harness exists; **C2's surviving half** and **CG1** each have a test that went red → green. **Exit line rewritten 2026-09-10** — it used to name C1, which `bb4bd5f` fixed on 2026-09-08, so half of M2's exit was already met by a commit predating the milestone and the other half (C2) is now partial. A harness whose first proof is a bug that no longer exists proves nothing. CG1 replaces it because it is the one thing Kayer has reported **twice** in his own words (R4), and a net that cannot catch "the page moves itself" is not worth stringing. Dispatch by group (CG1-CG6 in the ledger), verify by id | C2 (partial), C22 (regressed), C19 (retired into C22) |
| M3 | Finish the three-level review loop | Level 1 → 2 → 3 usable without knowing `m` is a shortcut | H1, H2, H3 |
| M3.5 | Make the graphics feature he kept actually work | **Placed 2026-09-11**, now the rebundle is verified. Three rows on one feature that he explicitly kept by decision and that has never rendered correctly: **P6** (`drawbox` defaults to `eval=init`, so every card's box is `w=0` for its entire life while its text animates over nothing — and the module docstring at `:14-16` asserts the opposite, which is how it survived), **S25** (pressing "Plan graphics" twice destroys every hand-made graphic), **E3** (the scorecard still penalises cuts for carrying graphics). Sits **immediately before M4** on purpose: M4 asks him to decide which features are worth keeping, and he cannot judge graphics while graphics has never worked. Deciding on a broken version of a thing is not a decision. Not this weekend's product — closes on one short tester render of a project with a definition card, not on a string assertion | P6, S25, E3 |
| M4 | Decide what SnipAi is (his call, not QA's or dev's) | Every BLOAT row has a keep/cut answer, written down. **B3 and B4 added 2026-09-11** — the standing order named B1, B2, B5 and B6 and was silent on these two, so they read as decided and were not. The drop-folder question is framed with a recommendation (delete it) under Bloat in the ledger, waiting on him | B1, B2, B3, B4, B5, B6 |
| M5 | Ship to a human who isn’t him | Apple Developer account bought; a build launches on Apple Silicon without Rosetta | B2, B3, B4 (docket) |

## Open

| # | What he asked for | Notes |
|---|---|---|
| R4 | "No more scrolling when I'm not scrolling" | Said 2026-09-11, and **said before** — the `pointerDown` guard in `review/page.tsx` quotes the first report. That fix covered dragging only. Mechanism found and filed as ledger **C22**: `yield4s` hands the list over when you scroll, then four seconds later actively yanks it back (`setFollowTick`), instead of just resuming. Also runs while paused. **Updated 2026-09-10:** bigger than one fix. C22 is a **regression** — `setFollowTick` arrived in `bb4bd5f` as a deliberate feature — and C19 turned out to be a third trigger of the same rule, not a rendering bug. Now ledger group **CG1**: three call sites, one guard that is wrong for all three. It is M2's exit condition, so it gets a test, not just a patch. Third report would be the one that matters |
| R2 | Products & links | The form writes a file only an uninvoked tool reads |
| R3 | Teach the take picker what "best" means to him | The machinery is connected and waiting: `takePicks` is still empty, so nothing has taught it. Needs him to override a few picks in **Takes** |

## Blocked — not on code

| # | What he asked for | Waiting on |
|---|---|---|
| B1 | Post to TikTok Shop, X, Snapchat, Facebook, Instagram, **Pinterest**, **Trybe**, Amazon Storefront | A developer app and credentials per platform. Eight tiles, all `not_connected` |
| B2 | Hand the app to a few people | Apple Developer account, $99/yr, for signing and notarisation |
| B3 | It updates itself | Sparkle, which needs B2 first |
| B4 | Runs properly on Apple Silicon | A universal build. Works today under Rosetta |
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
