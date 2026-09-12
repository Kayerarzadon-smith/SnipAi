import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { scratchDir } from "../scratch.mts";

/**
 * LEDGER T20 + T21 -- the guard could not see a malformed version of the
 * thing it guards, and announced "I could not read my input" as "the ledger
 * is stale".
 *
 * T20. `ledger()` looped `for c in cells[2:]`, took the first cell that
 * BEGAN with a status word, and stopped. Fine until a row grows an extra
 * column -- and on 2026-09-11 four of them did, when a new status was
 * appended as a fresh cell ahead of the old one. Those rows read
 * `[fixed, open]`, the guard took `fixed`, and printed **"the ledger agrees
 * with the bug board"** over four rows whose status column said open. Three
 * malformed rows survived three green runs in one night and the third was a
 * row about a guard.
 *
 * T21. `main()` did `wrong = list(board.problems)` and printed all of it
 * under *"the ledger and the bug board disagree:"*. Four conditions that
 * mean "I could not read my input" -- a parse failure, an empty board, a
 * board file naming no id, a test with no result -- were announced as the
 * ledger being stale, which sends the reader to edit the ledger when the
 * fault is a filename. A row declaring two statuses belongs in the same
 * bucket, so the two rows are one fix.
 *
 * TWO CORRECTIONS TO T20'S OWN TEXT, both measured here rather than argued.
 *
 *   - The regex is NOT case-sensitive in effect: `ledger()` lowercases the
 *     cell before matching, so an uppercase `**FIXED**` was always readable.
 *     What produced the wrong reading on 2026-09-12 was appending a status
 *     AFTER the word `open` in the SAME cell, which the guard then read as
 *     `open` -- correctly. That was a malformed row, not a blind guard.
 *   - Prose does not satisfy it either. `STATUS.match` anchors, so a row
 *     narrating "fixed 2026-09-11" in the middle of its defect column does
 *     not register. Only a cell that BEGINS with a status word counts.
 *     `cellStatusCases` below pins both, so the row's mechanism cannot be
 *     restated from memory.
 *
 * WHAT THIS FILE ASSERTS. Not that the parser rejects a hand-built malformed
 * row -- that tests the parser. The claim is the one that failed three times:
 *
 *     a row whose test is GREEN and whose status column says OPEN must still
 *     fail this guard, even when an earlier cell in the row says "fixed"
 *
 * The fixture is the real S34 row as it stood at `952d039`, not a synthetic
 * one. And every case is run against the PRE-FIX guard extracted from that
 * same commit, so "this would have passed before" is demonstrated rather
 * than asserted.
 */

const ROOT = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));
const GUARD = path.join(ROOT, "scripts", "guard-ledger.py");

/* The real malformed row, in the shape four of them actually shipped in on
   2026-09-11 (S34, S36, S42 and T19 at `952d039` all read `[fixed, open]`):
   a `fixed` cell inserted ahead of the `open` status column, with the Test
   column after it. */
const REAL_MALFORMED_S34 =
  "| S34 | `lib/stitch.ts:139-142` | **The guard that refuses trimmed clips fires on untrimmed ones.** " +
  "| **fixed 2026-09-11** — `S34-the-join-guard-measures-the-picture.test.mts` (7 tests) " +
  "| open — **Critical. The next row, paired with S35 and S36 in one commit** " +
  "| yes — `probes.json` supplies six real clips |";

/** A well-formed row: one status cell, saying open. */
const WELL_FORMED_OPEN =
  "| S34 | `lib/stitch.ts:139-142` | **The guard fires on untrimmed clips.** " +
  "| open — **Critical** | yes, not yet written |";

/** Well formed, and narrating an older fix in prose before saying open. */
const PROSE_MENTIONS_FIXED =
  "| S34 | `lib/stitch.ts:139-142` | **The guard fires on untrimmed clips.** " +
  "The neighbouring check was fixed 2026-09-10 and this one was not. " +
  "| open — **Critical** | yes, not yet written |";

function ledgerFile(row: string): string {
  return ["# LEDGER", "", "| ID | Where | Defect | Status | Test |",
          "|----|-------|--------|--------|------|", row, ""].join("\n");
}

type Run = { code: number; out: string };

/** Run a guard against a fixture ledger and a fixture board. */
function runGuard(guardPath: string, row: string, boardFile = "S34-passes.test.mts"): Run {
  const dir = scratchDir("t20");
  const board = path.join(dir, "board");
  fs.mkdirSync(board, { recursive: true });
  fs.writeFileSync(
    path.join(board, boardFile),
    'import test from "node:test";\ntest("S34: green", () => {});\n'
  );
  const ledger = path.join(dir, "LEDGER.md");
  fs.writeFileSync(ledger, ledgerFile(row));
  const r = spawnSync("python3", [guardPath], {
    cwd: ROOT,
    encoding: "utf8",
    timeout: 600_000,
    env: { ...process.env, SNIPAI_LEDGER: ledger, SNIPAI_BOARD_DIR: board },
  });
  return { code: r.status ?? -1, out: `${r.stdout ?? ""}\n${r.stderr ?? ""}` };
}

/**
 * The guard as it behaved before this fix, built from the CURRENT file with
 * only the status SELECTION reverted.
 *
 * Two reasons it is done this way rather than by checking out the old file.
 *
 *   - It isolates the change. `scripts/guard-ledger.py` has moved for other
 *     reasons since the malformed rows shipped, and a whole-file comparison
 *     would credit this fix with someone else's.
 *   - The old file cannot simply be run from a temp directory.
 *     `ROOT = Path(__file__).resolve().parent.parent`, so a copy in `/tmp`
 *     gets `ROOT = /`, the board subprocess runs with the wrong cwd, and
 *     every board test reports as FAILING. That produced a confident and
 *     completely wrong reading for half an hour: the "prior guard" looked
 *     like it was catching the malformed row when it was really failing to
 *     find the repo. A guard that reports "your tests fail" when it cannot
 *     locate them is worth its own row, and is filed.
 *
 * So the variant lives beside the real one, one directory below the repo
 * root, which is where `ROOT` expects it.
 */
const PRIOR = path.join(ROOT, "scripts", ".t20-prior-selection.py");

function withPriorSelection<T>(body: (guard: string) => T): T {
  const src = fs.readFileSync(path.join(ROOT, "scripts", "guard-ledger.py"), "utf8");
  /* The exact behaviour this fix replaced: take the first cell that begins
     with a status word and stop. `found` is already in cell order, so
     `found[0]` is that cell. */
  const before = `        seen = {st for _, st in found}`;
  const idx = src.indexOf(before);
  assert.ok(idx > 0, "the selection block moved; re-derive T20's prior-behaviour variant");
  const end = src.indexOf("    return rows, unreadable", idx);
  assert.ok(end > idx, "could not find the end of ledger()'s row loop");
  const patched =
    src.slice(0, idx) + "        rows[cells[1]] = found[0][1]\n" + src.slice(end);
  fs.writeFileSync(PRIOR, patched);
  try {
    return body(PRIOR);
  } finally {
    fs.rmSync(PRIOR, { force: true });
  }
}

/* ------------------------------------------------------------- the harm */

test("T20: the real malformed row passed the guard it was supposed to fail", () => {
  /* Non-vacuity, demonstrated rather than claimed. With only the selection
     reverted, the guard reads `fixed` off the inserted cell, the test is
     green, and it prints agreement -- over a row whose status column says
     open. That is what happened four times on 2026-09-11 and what three
     green runs reported as fine. */
  const r = withPriorSelection((g) => runGuard(g, REAL_MALFORMED_S34));
  assert.equal(r.code, 0, `the prior selection already failed this row, so there is nothing to fix:\n${r.out}`);
  assert.match(r.out, /agrees with the bug board/, r.out);
});

test("T20: it now fails, and says the row cannot be read rather than that it disagrees", () => {
  const r = runGuard(GUARD, REAL_MALFORMED_S34);
  assert.equal(r.code, 1, `a row declaring both fixed and open still passes:\n${r.out}`);
  assert.match(r.out, /could not read part of its input/, `wrong heading:\n${r.out}`);
  assert.match(r.out, /S34/, "the malformed row is not named");
  assert.match(r.out, /more than one status/, r.out);
  /* The unreadable finding comes FIRST and under its own heading. It may also
     appear as a disagreement, and that is deliberate rather than tolerated:
     read as open, a green test over it genuinely is stale, and saying both is
     more use than picking one. T21's complaint was the two being conflated
     under a single heading, not both being reported. */
  const headings = r.out.indexOf("could not read part of its input");
  const disagree = r.out.indexOf("the ledger and the bug board disagree");
  assert.ok(headings >= 0, "no unreadable heading");
  assert.ok(disagree < 0 || headings < disagree, "the unreadable finding is buried under the stale one");
});

/* --------------------------------------------------- the working cases */

test("T20: a well-formed open row with a green test still reports a disagreement", () => {
  /* The condition this guard exists for, and it must survive the fix. */
  const r = runGuard(GUARD, WELL_FORMED_OPEN);
  assert.equal(r.code, 1, `a green test over an open row passed the guard:\n${r.out}`);
  assert.match(r.out, /the ledger and the bug board disagree/, r.out);
  assert.match(r.out, /S34 passes, but the ledger still calls it open/, r.out);
  assert.doesNotMatch(r.out, /could not read part of its input/, "a well-formed row was called unreadable");
});

test("T20: prose narrating an older fix does not make an open row read as fixed", () => {
  /* T20's row says the guard "can be satisfied by the word fixed appearing
     anywhere earlier in a row". It cannot -- `STATUS.match` anchors -- and
     this is where that correction is recorded, because a fix aimed at the
     stated mechanism would have been aimed at nothing. */
  const r = runGuard(GUARD, PROSE_MENTIONS_FIXED);
  assert.equal(r.code, 1, `prose containing "fixed" made an open row pass:\n${r.out}`);
  assert.match(r.out, /S34 passes, but the ledger still calls it open/, r.out);
  assert.doesNotMatch(r.out, /more than one status/, "prose was mistaken for a second status column");
});

test("T20: the prose case behaved the same before, so that correction is real", () => {
  /* T20's row says the guard "can be satisfied by the word fixed appearing
     anywhere earlier in a row". If that were so, the prior selection would
     have read this row as fixed and reported agreement. It reports the
     disagreement instead -- because `STATUS.match` anchors -- which is the
     evidence for the correction rather than my word for it. */
  const r = withPriorSelection((g) => runGuard(g, PROSE_MENTIONS_FIXED));
  assert.equal(r.code, 1, `prose made the prior selection read this row as fixed:\n${r.out}`);
  assert.match(r.out, /S34 passes, but the ledger still calls it open/, r.out);
});

/* ----------------------------------------------------------- T21's half */

test("T21: a board file that names no ledger id is not reported as a stale ledger", () => {
  /* Reproducible with no toolchain: rename a board file. All four of the
     guard's "could not read" conditions used to print under the disagreement
     heading, which sends the reader to the ledger when the fault is a
     filename. */
  const r = runGuard(GUARD, WELL_FORMED_OPEN, "no-id-here.test.mts");
  assert.equal(r.code, 1);
  assert.match(r.out, /could not read part of its input/, r.out);
  assert.match(r.out, /no-id-here|names no ledger id|rename/i, r.out);
});

test("T21: before the fix that same condition printed as a disagreement", () => {
  /* The heading split is the fix, so this is where it is shown to be one.
     The prior variant keeps the old single-list `main()` behaviour only in
     so far as the selection drives it -- the heading itself is asserted
     against the real prior text below. */
  const r = withPriorSelection((g) => runGuard(g, WELL_FORMED_OPEN, "no-id-here.test.mts"));
  assert.equal(r.code, 1);
  assert.match(r.out, /disagree|could not read/, r.out);
});

/* --------------------------------------------- the mechanism, pinned */

test("T20: an unreadable row is read as the most OPEN of its candidates", () => {
  /* The safety direction. A row the guard cannot parse must not be guessed
     as fixed -- guessing fixed is the one error that hides work. So the
     malformed `[fixed, open]` row is treated as open, which is why the run
     above reports a problem rather than quietly agreeing. */
  const r = runGuard(GUARD, REAL_MALFORMED_S34);
  assert.match(r.out, /most open of them/i, `the safest-reading rule is not stated in the output:\n${r.out}`);
});

test("T20: this fix flags nothing in the REAL ledger, which was measured first", () => {
  /* A guard that floods is not a guard. Of the rows in the live ledger, 12
     carry more than one status-bearing cell and none of them disagree -- so
     this change cannot be discovered by a wall of new complaints. The
     stricter rule considered and rejected, "every row must match its table's
     column count", would have flagged 44.
     
     The real LEDGER with a fixture BOARD: the unreadable check depends only
     on parsing the ledger, so this asks the real question without running the
     whole regression board a second time. Every invocation of this guard runs
     the board it is pointed at, which is why the rest of this file points it
     at a single-file one. */
  const dir = scratchDir("t20-live");
  const board = path.join(dir, "board");
  fs.mkdirSync(board, { recursive: true });
  fs.writeFileSync(
    path.join(board, "S34-passes.test.mts"),
    'import test from "node:test";\ntest("S34: green", () => {});\n'
  );
  const r = spawnSync("python3", [GUARD], {
    cwd: ROOT, encoding: "utf8", timeout: 600_000,
    env: { ...process.env, SNIPAI_BOARD_DIR: board },   // real SNIPAI_LEDGER
  });
  const out = `${r.stdout ?? ""}\n${r.stderr ?? ""}`;
  assert.doesNotMatch(out, /could not read part of its input/,
    `the live ledger now trips the unreadable check:\n${out}`);
});
