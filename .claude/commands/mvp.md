---
description: Run the PROCESS.md loop until a raw clip goes in and a postable TikTok comes out
argument-hint: "[optional: a specific raw clip to use, e.g. ~/Movies/IMG_1234.MOV]"
allowed-tools: Task, Bash, Read, Grep, Glob, Write, Edit
---

You are running SnipAi's MVP loop. One target, and it is not "finish the app":

> **Kayer drops in raw footage and gets back a TikTok he can post.**

Everything below serves that sentence. Anything that does not is out of scope
for this run no matter how broken it is — file it, do not fix it.

Clip to use for this run: $ARGUMENTS  (if empty, pick the smallest raw file
under `~/Movies/SnipAi/projects/*/raw/`, or ask Kayer for one.)

---

## The team

Five agents in `.claude/agents/`. Each refuses the other four's job on
purpose — a reviewer who also writes code stops reviewing, and an implementer
who also picks priorities starts rewriting whatever he already wanted to
rewrite. Dispatch them with the Task tool. Do not do their work yourself.

| Agent | Responsibility | Must never |
|---|---|---|
| `snipai-pm` | Sequence. Picks the next row, closes milestones, forces decisions to Kayer | Write code; judge whether a defect is real |
| `snipai-qa` | Read code adversarially. Line-anchored findings with a failure scenario | Run the app; edit anything |
| `snipai-tester` | Run the real app — dev server AND packaged `SnipAi.app`, both — as a user | Edit app code |
| `snipai-dev` | Fix one ledger row: failing test first, then cause, then proof, then commit | Invent scope; touch BLOAT/HALF-BUILT unasked |
| `snipai-release` | Clean tree, pushed work, reproducible build, the checklist verdict | Decide what to build; fix defects |

`PROCESS.md` is the authority for the loop, the Definition of Ready, the
Definition of Done, and the gate table. Read it before you dispatch anyone.

---

## Phase 0 — stop the bleeding (do this first, it is fast)

Dispatch `snipai-release`:

1. Push everything. Work that exists only on this Mac is one spilled drink
   from gone, and there are unpushed commits right now.
2. Prune every merged branch, local and remote. **Check first** that each is
   truly merged (`git branch --no-merged master`) — the point is to remove
   things that contain nothing unique, not to lose work.
3. Report whether `github.com/Kayerarzadon-smith/SnipAi` is public or
   private. If public, say so loudly: `DOCKET.md` is a narrative of
   everything Kayer has personally asked for, and `QA_BUGREPORT.md` carries
   his real name in a filesystem path (ledger G5, G6).
4. Commit or ignore every stray untracked file. Nothing stays in limbo.

**Why this is first:** Kayer said he does not know which version of the code
to begin from. Answer that with evidence, in one line: how many branches
contain work not already in `master`, and how many commits are unpushed.
If the answer is "none" and "zero", say so plainly — the feeling of many
versions and the fact of one are different things, and he deserves the fact.

---

## Phase 1 — the MVP loop (this is the run)

Target: `M0` and `M0.5` in `DOCKET.md`. Loop until both exit lines are met.

```
PM       picks the next ready row from M0/M0.5. One row. WIP limit is one.
 |
DEV      reproduces it as a failing test, fixes the cause, proves it, commits.
 |
QA       reads the diff. New defect -> new ledger row -> back to DEV.
 |       Same bug shape elsewhere -> also a row.
 |
TESTER   runs the real app against the exit condition. If the suite and the
 |       tester disagree, THE TESTER WINS — say so loudly and file it.
 |
RELEASE  checklist. Clean, green, ledger agrees, pushed, nothing private.
 |
PM       exit line met? Close it, open the next. Not met? Next row. Loop.
```

The run that matters is `snipai-tester` doing this end to end:

1. Drop the raw clip into the dashboard — the real upload path, not a curl.
2. Let the auto pipeline run to completion with no terminal intervention.
3. Confirm a finished file lands in `cuts/`.
4. `python3 qa/verify_edges.py --project <that project>` → expect **0 of N**.
   Non-zero means E1's fix did not hold; hand it to `snipai-dev`.
5. Play it. In `SnipAi.app`, not just the dev server — they are different
   builds and the gap between them is where the worst bugs have lived.
6. Say whether Kayer could post the result to TikTok as-is.

**Known and already fixed, so do not re-diagnose from scratch** — verify
instead: S18 (range clamp, player was black), S19 (faststart, forward-only
so cuts already on disk still carry `moov` last), E1 (frame-rounding clipped
word tails). If one of these reappears, that is a regression and it is news.

---

## Safe cleanup only

Kayer asked for the cleanest code possible. Most of that is **not** this run.
The split is by risk, not by appetite:

**Do now** — cannot change app behaviour:
- merged branches, the stray untracked files
- the QA report sprawl at the repo root: `QA_BUGREPORT.md`,
  `QA_BUGREPORT2026-09-10.md`, `.previous-run.md`, `QA_REPORT_2026-09-10.md`
  overlap and the nightly run adds one a night with no retention rule
  (ledger G4). Propose a rule — keep the newest, archive the rest under
  `audits/` — and ask before deleting anything.

**Do not touch this run** — every one of these is real, catalogued, and
competes directly with a posted TikTok: the 10 dead-code rows (U1-U10), the
6 bloat rows (B1-B6), the 21 open client bugs, the DOM harness, the review
flow. They are `M2` and later. Deleting dead code tomorrow morning *feels*
productive and ships nothing.

---

## Stop conditions

Stop and report at the first of these:

1. **Both exit lines met.** Say it plainly: a clip went in, a postable cut
   came out, and here is where the file is.
2. **A product decision is needed.** Ask Kayer, with your recommendation and
   a one-sentence argument. Do not guess and do not skip ahead. E2 is already
   waiting for one: below what length should a leftover sliver of a line be
   dropped whole instead of kept?
3. **The same row fails twice.** Two failed attempts means the diagnosis is
   wrong, not that the fix needs a third try. Back to QA or TESTER for a real
   cause.
4. **Anything would touch Kayer's irreplaceable footage destructively.** There
   is no staging library. Back up `beats.json` before destructive testing and
   verify it byte-identical afterward, exactly as the last tester run did.

Do not start `M2`, `M3`, or any cleanup beyond the safe list without Kayer
saying so. Finishing one thing beats starting three.

---

## When you report

Lead with whether he can post a video. Then what changed, then what is still
open, then the one decision you need from him. Match the ledger's voice:
plain, specific, no padding. "Made progress on the pipeline" is worse than
useless — name the id, name the exit line it is short of.
