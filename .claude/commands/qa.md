---
description: Full QA pass — bugs, dead surface, feature bloat
argument-hint: "[optional: a slice to focus on, e.g. 'timeline', 'python', or 'since last commit']"
allowed-tools: Task, Bash, Read, Grep, Glob, Write, Edit
---

You are running SnipAi's QA pass. Find defects; do not fix them. `/qa-fix` is
the separate, deliberately-invoked command that changes code.

Focus for this run: $ARGUMENTS  (if empty, everything)

## Step 1 — mechanical pass

Run `./scripts/qa --full` and read all of it. That is the cheap layer: types,
tests, reproduced-bug count, dead exports, orphaned routes and tools,
references into `_superseded/`, learned parameters out of range, write-only
state. Zero judgment, near-zero false positives.

Read `audits/LEDGER.md`. It is the memory of every previous run. Note which
findings are `open`, `fixed` or `wontfix` before you go further.

Do not stop here. These checks find dead imports, not wrong behaviour.

## Step 2 — three parallel reviews

Scope is the app: `app/`, `lib/`, `native/`, `scripts/`, `tests/`, root config.
`ugc-edit-system/` is context, not a target — unless I ask for it, in which case
add a fourth reviewer for the pipeline and run everything with `--with-pipeline`.

Launch three `snipai-qa` subagents **in a single message** so they run
concurrently. Give each its scope explicitly and tell it to read every file in
that scope in full, and to check the ledger before reporting anything:

1. **Server** — `app/api/**/route.ts`, `lib/*.ts`. Path traversal, data
   corruption, read-modify-write races, job/state persistence, float time
   arithmetic, child-process handling.
2. **Client** — `app/projects/[project]/review/page.tsx`,
   `app/components/*.tsx`, `app/dashboard/*`, `app/settings/*`. Stale closures,
   listener/rAF/timer cleanup, drag math, video element races, optimistic
   updates without rollback, keyboard handlers.
3. **Native and shell** — `native/*.swift`, `scripts/*`, the root `*.command`
   scripts. Swift force-unwraps and navigation failure paths, server
   lifecycle, unquoted shell variables, bundling correctness. Include how
   `lib/pipeline.ts` invokes the pipeline — argument shape, paths, units — but
   not what the Python does once it is running.
4. **Unused and bloat** — read `NOTES.md` and `prototype/snipai.html` first,
   then map every page, route, exported symbol and Python tool to its callers
   by grep, within the app. Report ORPHANED / HALF-BUILT / BLOAT.

If the focus argument names a slice, run only the relevant reviewers — but
always run the mechanical pass.

## Step 3 — verify before you report

Do not pass subagent output through unchecked. For every finding you intend to
report, open the cited file at the cited line and confirm the code says what
the finding claims. Re-run every "nothing uses this" grep yourself, across
`.md`, `.command`, `.sh` and `.py` as well as `.ts`/`.tsx`. Drop what does not
survive, and say how many you dropped.

If there are uncommitted edits in the working tree, say so — line numbers move.

## Step 4 — update the ledger, then report

Edit `audits/LEDGER.md`:

- Add new findings with the next id in their series (S/C/P for server, client,
  pipeline; U for unused; B for bloat).
- Mark as `fixed` anything whose regression test now passes or whose code you
  confirmed is corrected. Put the date in the Notes column.
- Mark as `regressed` anything previously `fixed` that has come back.
- Leave `wontfix` rows alone. They were a decision, not an oversight.

Then write `audits/<today's date>.md` — but only what changed since the last
run: new findings, newly fixed, regressed, and a one-line count of what is
still open. The full catalogue lives in the ledger; do not restate it.

Finally, tell me in chat: what is new, what got fixed, and the single thing
worth doing next. If nothing changed, say that in one sentence.
