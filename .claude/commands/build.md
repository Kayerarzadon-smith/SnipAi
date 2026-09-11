---
description: Build the whole app — run the full roadmap, milestone by milestone, until every feature works
argument-hint: "[optional: a milestone to start from, e.g. 'M2', or 'continue']"
allowed-tools: Task, Bash, Read, Grep, Glob, Write, Edit
---

You are building SnipAi to done. Not an MVP — Kayer asked for the full app
with all of his features, and this command runs until there is nothing left
that can be finished without another company's approval or his credit card.

Start from: $ARGUMENTS  (if empty, or "continue", read `DOCKET.md` and start
at the first milestone whose exit line is not met.)

---

## What "done" means here

`NOTES.md` has the product intent. In his own words, the thing the app is for:

> **Drop in raw footage and it edits my TikToks.**

Everything else — the review levels, the take picker, the learning loop,
products, connectors — exists to serve that or to correct it when it gets it
wrong. When a decision is ambiguous, that sentence is the tiebreaker.

---

## The team

Five agents in `.claude/agents/`. Dispatch them with the Task tool; do not do
their work yourself. Each refuses the other four's job on purpose.

| Agent | Responsibility | Must never |
|---|---|---|
| `snipai-pm` | Sequence. Picks the next row, closes milestones, escalates decisions | Write code; judge whether a defect is real |
| `snipai-qa` | Read code adversarially. Line-anchored findings with a failure scenario | Run the app; edit anything |
| `snipai-tester` | Run the real app — dev server AND packaged `SnipAi.app` — as a user | Edit app code |
| `snipai-dev` | Fix one ledger row: failing test first, then cause, then proof, then commit | Invent scope; touch bloat unasked |
| `snipai-release` | Clean tree, pushed work, reproducible build, the shippable verdict | Decide what to build; fix defects |

`PROCESS.md` is the authority for the loop, Definition of Ready, Definition of
Done, and the gates. Read it before dispatching anyone.

---

## Standing orders from Kayer (2026-09-11)

These are decided. Do not re-litigate them, do not ask again.

1. **He wants all of it.** The timeline NLE stays. The graphics subsystem
   stays. All four undo mechanisms stay. All five settings tabs stay. Ledger
   rows B1, B2, B5 and B6 are **wontfix — kept by decision**, not oversights.
   `M4` collapses to deleting only what is *provably* dead (U1-U10), and even
   then only what QA has confirmed has no caller.
2. **Graphics won; the rule was wrong.** `ugc-edit-system/CLAUDE.md:30` — "No
   captions, no graphic overlays, no PIP" — is to be rewritten so overlays are
   allowed, because the scorecard currently penalises cuts for a feature he
   deliberately built and wants. Fix the rule, not the feature. Check what
   else reads that line before changing it: the Pacing/house-style scoring
   path reads the same doc.
3. **Work freely; never touch the footage.** Fix, test, commit and push on
   your own without stopping to ask. But his raw footage is irreplaceable and
   there is no staging library: any operation that writes into `raw/` or
   `cuts/`, or that runs a destructive test against a real project, backs the
   project up first and verifies it byte-identical afterward — exactly as the
   2026-09-10 tester run did with `img-9817/beats.json`. If you cannot
   guarantee that for a given step, skip the step and file it.

---

## The order

**`DOCKET.md`'s Roadmap table is the sequence. Read it; do not keep a copy.**

This command used to carry its own milestone list and it went stale within a
day — it still called M5 "the remaining half-built features" after the docket
had parked M5 entirely, and it named an M6 that no longer exists. Two lists of
the same thing drift apart; that is the bug class behind the ledger
disagreeing with the bug board (T2) and the zoom table being mirrored in the
looks gauntlet. One authority. It is the docket.

Work the table top to bottom. A milestone closes only on its own exit line,
verified by the role that can verify it. What follows is context the table
cannot carry, not a second ordering:

- **The decimal milestones are not optional.** M0.5 through M0.8 exist because
  M0 closed and the thing still did not work for him — the fix had not reached
  his existing footage, a sandboxed run could still reach his real library,
  and his own footage arrives as several clips rather than one. They are the
  difference between a milestone passing and the app working.
- **M0.8 is the newest and it is his, in his words.** He is interrupted
  mid-take, restarts where he left off, and batch-films several different
  TikToks in one sitting — so a real TikTok reaches the app as three or four
  clips, mixed in a batch with unrelated ones. Its row carries the whole
  design: join at import rather than making `source` a list, group on whether
  a clip ended mid-sentence rather than on the recording gap, order by
  `creation_time` so drop order never matters, and propose the grouping for
  confirmation before a single stage runs. Build what the row says; the
  reasoning for each choice is in it, including the roads not taken.
- **M2 is the highest-leverage row in the project.** 22 client bugs open, 0
  ever fixed — not because they are hard but because nothing can test a React
  drag, so no fix can be proven and therefore none get made. The harness is
  worth more than any single bug behind it.
- **A milestone can be wrong.** Three exit lines were rewritten on 2026-09-11
  because they could not prove their own milestone, and M0's was wrong about
  how he shoots. If a line can be satisfied by a run in which the thing never
  actually happened, say so and rewrite it before working to it.

## Blocked, and honestly so

Say so in every report. Do not quietly skip them.

- **B1 connectors** — needs a developer app and credentials from eight
  separate companies. TikTok Shop requires business verification. Weeks of
  *their* process. Only Kayer can start it.
- **B2 signing** — $99/yr Apple Developer account. Only Kayer can buy it.
- **B3 auto-update** — needs B2 first.
- **B4 Apple Silicon** — a universal build; works under Rosetta today.

---

## When the app is finished

Kayer asked for every bug fixed. That needs a finish line a machine can
recognise, or "done" is just a feeling. All six, at once:

1. **Zero `open` defect rows** in `audits/LEDGER.md` — the server, client,
   tooling, pipeline and edit-quality sections. As of 2026-09-11 that is
   **60**. Rows marked `wontfix` are decided, not outstanding, and do not
   count; neither do the half-built, dead-code or hygiene sections, which are
   their own milestones.
2. **Zero half-built rows** (H1-H9). A feature that exists but cannot be
   reached is not a fixed bug, it is an unfinished promise, and he asked for
   all of his features.
3. **`./scripts/test` green**, with its verdict line agreeing with its counts
   and nothing silently skipped — which means the pipeline venv problem (T4)
   is actually solved, not skipped past.
4. **`./scripts/qa --full` clean**, and `node --import ./tests/register.mts
   qa/run.mts` reporting zero distinct failures across all 2,000+ scenarios,
   including the `022 looks` and `023 gates` suites.
5. **A fresh `/qa` judgment pass finds nothing new.** Not "nothing serious" —
   nothing. This is the real gate, and it is the one that will hold longest.
6. **`snipai-tester` completes the whole journey on the packaged app**:
   raw footage in, a cut out, reviewed at all three levels, and a file Kayer
   can post — with no step requiring a terminal.

## Expect the number to rise before it falls

This will happen and it is not failure. A QA function that is working finds
bugs faster than one implementer fixes them, especially early: `snipai-qa`
reads code that has never been read adversarially, and `snipai-tester` is
about to run surfaces that have never been driven end to end. The count
going from 60 to 80 after a good run means the team is doing its job and the
ledger is getting honest, not that the app got worse — the bugs were already
there, uncounted.

Report the number every run, both directions, and say which way it moved and
why. Never quietly close a row to make the count look better; `guard-ledger.py`
will catch it, and it is the one dishonesty that would make the whole ledger
worthless.

## The loop

```
PM       picks the next ready row from the open milestone. One row. WIP = 1.
 |
DEV      failing test, then the cause, then proof, then commit it alone.
 |
QA       reads the diff. New defect -> new row -> back to DEV.
 |       Same bug shape elsewhere -> also a row.
 |
TESTER   runs the real app against the exit condition. If the suite and the
 |       tester disagree, THE TESTER WINS — say so loudly and file it.
 |
RELEASE  clean, green, ledger agrees, pushed, nothing private tracked.
 |
PM       exit line met? Close it, open the next milestone. Else next row.
 '-----> loop
```

Keep looping across milestone boundaries. Do not stop because a milestone
closed — that is the signal to open the next one.

## Stop and ask only for

1. A product decision the standing orders above do not already answer.
2. The same row failing twice — two failures means the diagnosis is wrong,
   not that the fix needs a third try. Back to QA or TESTER for a real cause.
3. Anything that would risk the footage and cannot be made safe.
4. Nothing left but the blocked items.

## Report

Lead with what now works that did not before, in his words, not ids. Then the
milestone state, then what is blocked and on whom. Match the ledger's voice:
plain, specific, no padding. Name the id and the exit line it is short of.
