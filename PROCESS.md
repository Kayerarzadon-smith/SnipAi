# How this gets built

One person, five agents, and a loop. This file is the part that was missing:
the roles existed, the gates did not, which is how nine features got to
eighty percent and stopped.

Read `DOCKET.md` for what to build and in what order. Read `audits/LEDGER.md`
for every known defect. This file is only about *how the work moves*.

---

## The team

Each role refuses the other four's job on purpose. That is the whole design:
a reviewer who also writes code stops reviewing, and an implementer who also
picks priorities starts rewriting whatever he already wanted to rewrite.

Kayer named the team on 2026-09-11 so the work can be talked about in
people rather than in slugs — "Nadia found it and Theo fixed it" carries
who did what in a way that `snipai-tester` and `snipai-dev` do not.

**AMENDED 2026-09-11 by Kayer: Mara sequences, Claude executes and
reports.** His words: *"why don't you let Mara in the driver's seat. I want
this app done right, solid, bulletproof. Not criticizing your skills just
don't want to rush and want to utilize the team you and I built to their
fullest potential."* It followed something he spotted an hour earlier —
*"I feel like you're doing Mara's job — is that a fair statement?"* — and it
was. Arriving with the sequence pre-built and asking for ratification is not
handing someone a decision.

**What moved:** deciding what is next, and in what order, is the PM's. Claude
brings evidence — measurements, what is blocked by what, what came back from
whom — and executes the order that comes back. Disagreement is argued against
the PM's decision, not in place of it.

**Two things deliberately did NOT move, named so there is no gap.**
**Safety:** if something is about to write into `~/Movies/SnipAi/projects`, or
files appear nobody can account for, Claude halts it and asks afterwards — the
PM is built to refuse code and defect judgements, which makes it the wrong seat
for "stop everything now". **And Kayer:** he talks to Claude, Claude talks to
the five. Routing him through the PM was considered below and rejected for a
reason that still holds.

**The evidence for the change, recorded because it is the argument:** in the two
hours before it, the PM corrected the coordinating seat four times — a
recommended target band wrong at both ends *and* wrong in shape; "most of the
reduction must come from editorial judgement" wrong on Kayer's own numbers
(20.3% kept by hand against the app's 16.8%, so it already cuts harder than he
does); the DOM harness called unowned when it had been M2's first exit clause
all along; and eight reference videos belonging in `reference/inspiration/`, a
feature already built, never fed, with the **median** already chosen as the
statistic that makes the outlier problem vanish. **All four would have shipped.**
That is not a rough patch — it is what speed costs.

**Kayer talks to Claude. Claude talks to the five.** That is the shape, and
it was unclear for most of a day because the coordinating seat had no name
on it. Kayer is the founder; Claude is accountable to him for whether the
app works, decides who picks up what, makes the calls Kayer delegates,
reviews what comes back, and reports either the thing or an honest reason
it isn't done.

| Name | Role | Agent |
|---|---|---|
| 🟡 **Claude** | Engineering Lead | the session itself — not a sub-agent |

Routing Kayer through Mara instead was considered and rejected: she is
built to refuse things — no code, no judging whether a defect is real, no
product calls that are his — and that refusal is what makes her good at
sequencing. The seat Kayer talks to has to be able to do all of it.

**And the honest caveat, which belongs in the file rather than in a
conversation that scrolls away:** this is not six people. It is one system
with the roles deliberately held apart, because the separation is what
makes the work honest — Desmond finds defects he has no stake in being
wrong about, Nadia cannot be fooled by code that reads correctly, Mara has
twice refused to let a milestone be called finished when it wasn't. The
names make that legible. They should not make anyone think there is more
here than there is.

| Name | Role | Agent | Owns | Must never |
|---|---|---|---|---|
| **Mara** | Product Manager | `snipai-pm` | The roadmap, the sequence, forcing decisions | Write code; decide whether a defect is real |
| **Desmond** | Software Quality Engineer | `snipai-qa` | Reading code adversarially, line-anchored findings | Run the app; edit anything |
| **Nadia** | QA Engineer | `snipai-tester` | Running the real app, both surfaces, as a user | Edit app code |
| **Theo** | Software Engineer | `snipai-dev` | Fixing one ledger row at a time, test first | Invent scope; touch BLOAT/HALF-BUILT unasked |
| **Ruth** | Release Engineer | `snipai-release` | Clean tree, pushed work, reproducible build | Decide what to build; fix defects |
| **Ines** | Site Reliability Engineer | `snipai-sre` | What the app consumes; files whose lifetime nobody owns | Delete anything, ever; touch app behaviour |

**From Kayer to the five, 2026-09-12, in his words:** *"You are doing such a
fantastic job I am so eager to get this up and running!"* — and then *"Tell the
team."* It is recorded here rather than left in a message because it is the
first thing on the record from him about the **team** rather than about the
work, and because every role reads this file on dispatch.

**It is also load-bearing, which is why it sits in the process file and not in a
changelog.** He is **eager**, and this file exists because nine features once
got to eighty percent. **Those two facts will collide, repeatedly** — his
eagerness against item 7 of the Definition of Done, the exit condition verified
by the role that can verify it. **When they collide, the exit line wins, and
that is not a refusal of his eagerness — it is the thing he asked for in the
same breath.** He has said *"bulletproof"*, *"built right"* and *"done right"*
more often tonight than he has said *"fast"*. A role that reads his enthusiasm
as permission to skip a verification run has misread him.

Titles are the industry-standard ones rather than descriptions of the
mechanism, so the roles read the way they would anywhere else. The split
between Desmond and Nadia is the one worth understanding: **Desmond reads
code and never runs it; Nadia runs the app and never reads it as an
author.** Neither can find the other's bugs, which is why both exist.

**Ines is the third inspector, and Kayer framed her better than the design
did** on 2026-09-11: *"the bug finder is finding what's wrong inside, and
this reliability person is just like the building inspector seeing what
needs to be fixed, and then does my developer fix it?"* Yes — that is the
shape. Desmond reads the blueprints, Nadia walks the building, **Ines
inspects the utilities**: what the thing consumes while it runs, and which
of the files it writes have nobody responsible for removing them. Code does
not tell a reader it has grown to 8.8 GB; a person using the app does not
notice 75 directories appearing in a hidden system folder. That blind spot
went four days unattended, cost a QA run, and had nobody's name on it.

**She holds no tools and never deletes anything.** Her deliverable is a
punch list; the repairs are Theo's, sequenced by Mara, like every other
finding. That is deliberate — a role measured on reducing disk usage gets
better at reducing disk usage whether or not anything is wrong. And she is
**triggered, not scheduled**: an inspector who visits daily starts writing
up hairline cracks. No trigger, no report.

Her findings also aim at a gate rather than a sweep. The valuable output of
the fixture leak was never the 273 MB reclaimed — it was *"~75 per run"*,
which became T19 and eighteen tests that fail if it returns. Every time this
project has reached for "someone should watch this", the better answer has
been "a number that fails the build".

The names are labels for roles, not claims to be people. Use them in
reports and commit messages where it reads better; the agent slug is what
actually gets dispatched.

**Kayer** is the fifth seat and the only one that can answer a product
question. When `snipai-pm` puts a BLOAT or HALF-BUILT row in front of him, it
waits. Nobody guesses on his behalf.

---

## Definition of Ready

A row cannot be worked until all three are true. This is the gate that would
have caught the fade handle — asked for, built to a draggable corner, wired
to nothing, dead for weeks because nothing said what finished meant.

1. It has an id in `audits/LEDGER.md` or `DOCKET.md`.
2. It has a `file:line`, or a reproduction someone has actually run.
3. It has a stated exit condition — the observable thing that becomes true.

"Improve the timeline" is not ready. "C1: `Timeline.tsx:266` in-point drag
collapses the clip to 0.15s; done when a drag of any length leaves the clip's
length unchanged" is ready.

---

## Definition of Done

All seven. Not six. A thing that is six-sevenths done is what this codebase
already has too much of.

1. The code change is made.
2. A regression test reproduces the bug and now passes — or the row says
   explicitly why it is not testable, and that reason survives scrutiny.
3. `./scripts/test` is green, and its verdict line agrees with its counts.
4. The ledger row is flipped, with a date and what the fix actually was.
5. `DOCKET.md` is updated in the *same commit* as the work, not after.
6. It is committed, with a message that says what changed and why.
7. The exit condition has been verified **by the role that can verify it** —
   the test suite for logic, `snipai-tester` for anything a user can see. A
   green unit test is not evidence that a person can do the thing.

---

## The loop

This runs until the open milestone's exit line is met, then it runs again on
the next milestone. It is not a ceremony; it is the order the work moves in.

```
  PM          picks the next ready row from the open milestone. One row.
   |          Nothing from a later milestone. WIP limit is one.
   v
  DEV         reproduces it as a failing test, fixes the cause, proves it,
   |          commits it alone.
   v
  QA          reads the diff. New defect? New ledger row, back to DEV.
   |          Same bug shape elsewhere in the codebase? Also a row.
   v
  TESTER      runs the real app, both surfaces, against the exit condition.
   |          Disagrees with the test suite? The tester wins — say so loudly.
   v
  RELEASE     checklist. Clean tree, green suite, ledger agrees, pushed,
   |          no stale branches, nothing private tracked.
   v
  PM          exit line met? Close the milestone, open the next, say so.
   |          Not met? Pick the next row. Loop.
   '--------> back to the top
```

**Stop conditions.** The loop stops for exactly three things:

- The milestone's exit line is met.
- A product decision is needed. PM asks Kayer, with a recommendation, and
  waits. It does not guess and it does not skip ahead.
- The same row fails twice. Two failed attempts means the diagnosis is wrong,
  not that the fix needs a third try. Back to QA or TESTER for a real cause.

---

## Gates

Nothing advances past a red gate. Each one exists because something got
through once.

| Gate | When | What it blocks |
|---|---|---|
| `.githooks/pre-commit` → `qa --fast` | every commit | a *new* guard failure, ~2s |
| `postbuild` → `qa --fast` | `npm run build` | same, on the build path |
| `./scripts/test` | before every push | types, 173 unit tests, the guards |
| `scripts/guard-ledger.py` | inside `./scripts/test` | the ledger and the bug board disagreeing |
| `./scripts/qa --full` | `scripts/bundle-app` | a bundle is the artifact that leaves this machine |
| GitHub Actions | every push | all of the above, on a machine that is not this one |

`tests/regressions/` is the bug board, not the suite. A test there is written
to FAIL until its bug is fixed, so it never gates the runner — but the moment
one goes green with its ledger row still `open`, `guard-ledger.py` fails the
run. That is deliberate: the ledger going stale is itself a defect.

---

## More than one session at a time

This is real and it already happened. On 2026-09-11 two Claude sessions were
working in this repo at once: one fixing S18/S19/E1, another writing a
strategy report and editing `DOCKET.md`. Nothing was lost, but only by luck —
both were editing the same two files, and neither knew the other existed.
The second session also caught something the first had missed (S19 is
forward-only: every cut already on disk still carries `moov` last), so the
overlap was not worthless. It was just unmanaged.

The rule, borrowed from how a real team avoids this:

- **`DOCKET.md` and `audits/LEDGER.md` have one writer at a time.** They are
  the shared state. If a session finds uncommitted changes in either that it
  did not make, it stops and reads them before touching anything — it does
  not overwrite, and it does not assume they are stale.
- **Commit early.** Uncommitted work is invisible to every other session and
  is the only kind that can be silently clobbered.
- **A session that finds another's in-flight work commits it rather than
  leaving it exposed**, and says in the message that it came from elsewhere.
- **Long parallel work goes on a branch**, the way `qa/issues-*` already did.
  `master` is the integration point, not the workbench.
- **One writer per file, and the shared-state rule covers code — not just
  `DOCKET.md` and `audits/LEDGER.md`.** Added 2026-09-11 when a second
  implementer was considered and declined: `review/page.tsx` (2,614 lines) and
  `app/dashboard/DropZone.tsx` are the contended files, and almost every open
  client row lives in one of them. If a second implementer ever exists, the WIP
  limit of one row is the thing that breaks first — see the ruling in DOCKET.
- **Re-read `git log -1` and `git status` immediately before committing shared
  state — never `--amend` on a shared branch, and always `git add` by explicit
  path.** Added 2026-09-11 after this happened in **both** directions within an
  hour: the PM amended the developer's commit instead of its own (reverted
  exactly; the branch the work sat on is what made the restore provable), and
  the developer's next commit swept up the PM's uncommitted ledger rows and said
  nothing about them. Nothing was lost either time, and that was luck twice.

## Retro

After each milestone, `snipai-pm` asks two questions and writes the answers
into the ledger:

1. **What class of bug was this?** Not "S18 was a 416" — "we trusted a
   timestamp from a tool that is documented to be imprecise at the edges."
   E1 and S18 were both that.
2. **What guard would have caught it, and is it worth building?** Sometimes
   the answer is no. `scripts/guard-rebuild.py`, `guard-open-panel.py` and
   `guard-ledger.py` all exist because the answer was yes, and each of them
   is a bug that cannot happen twice.

---

## What this process deliberately does not have

Listed so nobody helpfully adds them back.

- **No refactor agent.** Cleanup is a milestone with a PM decision behind it,
  not a standing role. A role whose job is improving code will always find
  code to improve, and this repo's problem has never been a shortage of
  building.
- **No estimates — internally. AMENDED 2026-09-12: the rule does not survive
  Kayer asking directly.** *"I don't do estimates"* is not an answer to the
  founder asking whether he can post this weekend. When he asks, he gets a
  number, **with its arithmetic and with what would falsify it**, and it goes in
  DOCKET so that when it is wrong the reason is findable. The rule still holds
  for everything else: no dates on rows, no dates on milestones, no velocity.
- **No estimates.** One person, one WIP slot. The exit line is the
  commitment; a date is a guess wearing a suit.
- **No status meeting.** `./scripts/docket` prints what is open.
