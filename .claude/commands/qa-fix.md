---
description: Fix findings from the QA ledger — reproduce, fix, prove, record
argument-hint: "[ledger ids like S1 S2 P1, or 'fix first', or 'all open data-loss']"
allowed-tools: Bash, Read, Grep, Glob, Edit, Write, Task
---

Fix SnipAi defects that QA has already found and verified. Findings live in
`audits/LEDGER.md`; the reasoning behind each is in the dated report beside it.

What to fix this run: $ARGUMENTS
(empty, or "fix first" → the rows in the ledger's **Fix first** block, in order)

## Before you touch anything

1. Read `audits/LEDGER.md` and the most recent `audits/*.md`.
2. `git status --short`. If the working tree is dirty, stop and tell me — I may
   be mid-edit, and your fix and my edit will fight. Do not stash my work.
3. `./scripts/qa --fast`. If it is already failing for a reason unrelated to
   what you are about to fix, say so before proceeding.
4. Work on a branch: `git checkout -b qa/<ids>`. Never commit to my working
   branch directly.

## The loop, per finding — in this order, no shortcuts

**a. Reproduce it as a failing test.** Before changing a line of source, write
a test in `tests/regressions/<id>-<slug>.test.mts` (or
`ugc-edit-system/tests/regressions/test_<id>_<slug>.py`) that fails *because of
this bug*. Run `./scripts/qa --regressions` and watch it fail. Read the failure
message: if it is failing for a different reason than the ledger describes,
your understanding is wrong — go back and read the code again.

`tests/register.mts` imports app modules unmodified, route handlers included:
`import { PATCH } from "@/app/api/projects/[project]/pipeline/route"` and call
it with `new Request(url, {method, body})`. Point `SNIPAI_DATA` at a temp dir so
tests never touch the real library.

If a finding genuinely cannot be tested — a drag interaction, a Swift
navigation path, anything needing a DOM or a display — say so, mark it
`Testable: no` in the ledger, and fix it with extra care instead of extra
speed. Do not fake a test that passes either way.

**b. Fix the cause, not the symptom.** Read enough surrounding code to know why
the line is the way it is. Several of these bugs are a correct intention
implemented wrongly — the comment above the code usually tells you what was
meant. Restore the intention; do not paper over the effect.

**c. Prove it.** The new test goes green, `./scripts/qa --full` still passes,
`npx tsc --noEmit` is clean. If the fix breaks an existing test, stop — that
test encodes a behaviour someone wanted. Work out which of the two is right and
tell me, rather than editing the old test to agree with you.

**d. Look for the siblings.** These defects come in families. When you fix one,
grep for the same shape everywhere else before moving on, and report what you
find as new ledger rows even if you do not fix them:
- a mutator that does not `persist()` → check every mutator in that module
- a field whitelist that drops the rest of an object → check every other
  handler that rebuilds a `Beat`
- a `Date.now()`-derived id → check every other id generator
- a delta computed against an optimistically-updated value → check every drag
  handler in that component
- a tool joining paths off `CODE_ROOT` → check every tool

**e. Commit it alone.** One finding per commit. Message: the ledger id, what
was wrong, what the fix does, and the test that now covers it. Then set that
row to `fixed` in the ledger with today's date.

## Fixes that are decisions, not defects

Anything in the ledger's **BLOAT** or **HALF-BUILT** sections is a product
call, not a bug. Do not delete a feature, do not finish a half-built one, and
do not "clean up" an orphaned file on your own initiative. Bring me the choice
with the cost on both sides and wait.

The one exception: an entry point that points at a file which no longer exists
is a defect, not a decision. Fix the reference or delete the caller, and say
which you did.

## Scope

The app: `app/`, `lib/`, `native/`, `scripts/`, `tests/`, root config. Do not
change anything under `ugc-edit-system/` — those findings are recorded in the
ledger's out-of-scope section and are not yours to fix unless I say so.

## The current Fix-first block, with what "correct" means for each

If you are fixing these, this is the intent — check it against the code rather
than trusting it.

**S1 — `app/api/projects/[project]/pipeline/route.ts:136`.** The handler
validates four fields and rebuilds the beat from only those, so undo drops
`holes`, `audioStart`, `audioEnd`, `fadeIn`, `fadeOut`. The intent in the
comment is right: validate before writing. The fix is to validate the four
fields and then merge onto the existing beat, preserving everything else —
match on label, keep the stored beat's other fields. Test: PATCH a beat list
whose entries carry holes and fades, read `beats.json` back, assert they
survived.

**S2 — `lib/jobs.ts:184`.** `failJob` is the only mutator that does not call
`persist()`. Add it. Then check `finishJob`, `appendLog`, `createJob` and every
mutator in `lib/snapshots.ts` and `lib/trash.ts` for the same gap. Test: create
a job, fail it, re-read `jobs.json` from disk, assert status is `error` and the
message is there.

**C1 — `app/components/Timeline.tsx:266`.** The in-point drag computes
`delta = t - c.at`, but `c.at` (the clip's left edge in cut time) does not move
when you trim the in-point, while `c.start` has already been moved by the
previous mousemove. So each frame re-applies the whole pointer offset and the
trim runs away to the 0.15s floor. The out-point is correct because `c.at +
c.dur` follows the edit. Fix by anchoring the drag to where it started —
capture the pointer time and the beat's original start on mousedown and apply
the difference — not by patching the symptom at the clamp. Test: this needs a
DOM harness the repo does not have; adding `jsdom` and a small render helper is
part of this fix, and it unlocks C2, C8 and C16 too.

**C2 — `app/projects/[project]/review/page.tsx:1017`.** `trimTimer.current` is
never set back to `null` inside the debounce callback, so
`if (!trimTimer.current) pushHistory(...)` — meant to fire once per drag —
fires once per page load. Every trim after the first is unundoable and ⌘Z jumps
back past all of them. Null the ref where the timer fires. Then check every
other ref used as a once-per-gesture latch in that file for the same gap.

**C3 — `app/components/Timeline.tsx:85,689,695`.** `setFading()` is called on
both fade grips, `fading` is never read, and `onFade` is never invoked — while
the shortcut sheet at :585 documents "drag corner — fade a clip". Two honest
outcomes: wire the drag up, or remove the grips and the shortcut line. Ask me
which; a documented control that does nothing is worse than no control.

**T1 — test runner honesty, `scripts/test:26`.** A skipped suite currently reads as
"all green". Make a skip visible in the summary line and non-zero on demand
(`--strict`). Note before you touch it: the venv's `bin/python` is a symlink
out to a system framework, which looks missing from some contexts but is fine
on the machine itself — do not "fix" the venv detection into something that
reports a working install as broken.

## When you are done

`./scripts/qa --full`, then tell me in chat: what you fixed, what tests now
cover it, what siblings you found, and what you deliberately left alone and
why. Leave the branch for me to review — do not merge it.
