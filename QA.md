# QA

SnipAi has a QA engineer. It reads the code, it does not write it.

**Scope is the app** — `app/`, `lib/`, `native/`, `scripts/`, `tests/` and the
root config. `ugc-edit-system/` is the pipeline SnipAi drives, not SnipAi: QA
reads it for context (a path or units mismatch across that boundary is an app
bug) but does not audit it. Add `--with-pipeline` to any `./scripts/qa` command,
or ask `/qa` for it, to include it. Findings already made there are parked at
the bottom of `audits/LEDGER.md`.

## The two layers

**Mechanical** — `./scripts/qa`. Things a machine can prove: types, tests, the
reproduced-bug board, dead exports, orphaned routes and tools, entry points into
files that no longer exist, learned parameters out of range, state written and
never read. No judgment, near-zero false positives.

**Judgment** — `/qa` in Claude Code. Runs the mechanical pass, then three
reviewers in parallel over the server, the client, and native/shell, plus an
unused-and-bloat sweep, verifies every finding against the actual line before
reporting, and updates the ledger. The reviewer's brief lives in
`.claude/agents/snipai-qa.md` — it carries the failure patterns this codebase
actually has, so each run starts where the last one finished.

## When it runs

| Trigger | What runs | Cost |
|---|---|---|
| `git commit` | `qa --fast` via `.githooks/pre-commit` | ~2s |
| `npm run build` | `qa --fast` as `postbuild` | ~2s |
| `./scripts/bundle-app` | `qa --full` — a bundle is the artifact that leaves this machine | ~25s |
| Claude Code edits a file | `qa --fast`, via the PostToolUse hook in `.claude/settings.json` | ~2s |
| `npm run qa:watch` | `qa --fast` on every save, in a terminal beside `npm run dev` | continuous |
| You ask | `/qa`, or `./scripts/qa --deep` for knip as well | minutes |

The commit gate blocks on something **new** — a guard that this commit
introduced, or a known problem that got worse. The existing backlog is recorded
in `audits/.qa-baseline` and stays out of your way. After you fix something, or
decide to live with something, run `./scripts/qa --accept` to re-baseline.
`git commit --no-verify` gets past it once.

## The bug board

`audits/LEDGER.md` is the live state of every confirmed finding: `open`,
`fixed`, `wontfix`, `regressed`. It is what makes the next run useful — QA reads
it first, so it reports what changed instead of repeating itself.

Findings that can be reproduced have a failing test in `tests/regressions/` or
`ugc-edit-system/tests/regressions/`. `./scripts/qa --regressions` runs them.
**They are meant to fail.** A test there going green is the signal that its bug
is fixed — flip the ledger row and move on. They are kept out of
`./scripts/test` on purpose, so the real suite stays a true green.

## Fixing

`/qa-fix S1 S2` — or `/qa-fix fix first` for the top block. That command works
on a branch, reproduces each bug as a failing test before changing a line,
fixes the cause rather than the symptom, greps for the same shape elsewhere, and
commits one finding at a time. It will not touch anything in the BLOAT or
HALF-BUILT sections without asking: those are product decisions, not defects.
