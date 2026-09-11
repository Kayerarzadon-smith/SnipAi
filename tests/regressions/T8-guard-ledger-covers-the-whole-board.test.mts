import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * LEDGER T8 -- the guard that checks the ledger against the bug board was
 * checking five twelfths of it and reporting agreement as if it were all.
 *
 * "the ledger agrees with all 5 regression tests" was printed on a board of 12
 * tests across 7 files, and that sentence was relayed to Kayer as assurance.
 * Four distinct defects produced it, and this file has one test per defect.
 *
 *  1. The BOARD side matched only `(S\d+):` in the test title, so every C, N,
 *     P, T and E test was invisible.
 *  2. The LEDGER side matched only `S\d+` in the id column. Widening (1) alone
 *     makes the guard WORSE, not better: `rows.get("N1")` returns None and a
 *     correct tree fails with "N1 has a test but no row in the ledger".
 *  3. Results were keyed by id with the last write winning, so the two tests
 *     in `S19-concat-faststart.test.mts` -- both titled `S19: ...` -- collapsed
 *     into one. A failing first and a passing second recorded S19 as passing.
 *  4. Even with 1 and 2 fixed, the six tests added for N1 and T6 stayed
 *     invisible, because their titles carry no id prefix at all ("the server
 *     reports the data root it is actually serving"). N1 could have been
 *     flipped back to `open`, or its tests gone red, with this guard printing
 *     green. The id now comes from the FILE NAME, which is already the
 *     convention on every file of the board and is one declaration per file
 *     instead of one per sentence.
 *
 * The guard is pure enough to feed a fixture ledger and a fixture board
 * (SNIPAI_LEDGER, SNIPAI_BOARD_DIR), which is what every test below does -- no
 * test here depends on what the real ledger happens to say today.
 */

const ROOT = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));

type Row = [string, string];

function fixture(files: Record<string, string>, rows: Row[]) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "snipai-t8-"));
  const board = path.join(dir, "board");
  fs.mkdirSync(board);
  for (const [name, body] of Object.entries(files)) fs.writeFileSync(path.join(board, name), body);

  const ledger = path.join(dir, "LEDGER.md");
  fs.writeFileSync(
    ledger,
    "# fixture ledger\n\n| ID | Where | Defect | Status | Test |\n|----|-------|--------|--------|------|\n" +
      rows.map(([id, status]) => `| ${id} | \`lib/x.ts:1\` | something | ${status} | yes |`).join("\n") +
      "\n"
  );
  return { board, ledger };
}

/** A test file with one test per [title, passes] pair, in the order given. */
function boardFile(tests: [string, boolean][]): string {
  return (
    `import test from "node:test";\n` +
    `import assert from "node:assert/strict";\n` +
    tests
      .map(([title, ok]) => `test(${JSON.stringify(title)}, () => { assert.equal(1, ${ok ? 1 : 2}); });\n`)
      .join("")
  );
}

function guard(files: Record<string, string>, rows: Row[]) {
  const { board, ledger } = fixture(files, rows);
  const r = spawnSync("python3", ["scripts/guard-ledger.py"], {
    cwd: ROOT,
    encoding: "utf8",
    env: { ...process.env, SNIPAI_BOARD_DIR: board, SNIPAI_LEDGER: ledger },
  });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
}

test("T8: a bug outside the S family is checked at all", () => {
  // N9 is green on the board and open in the ledger: the exact situation this
  // guard exists for (its own docstring tells the S2 version of the story),
  // and for every non-S id it could not see it.
  const { code, out } = guard(
    { "N9-native-thing.test.mts": boardFile([["N9: the native thing holds", true]]) },
    [["N9", "open"]]
  );
  assert.match(out, /N9 passes, but the ledger still calls it open/, out);
  assert.equal(code, 1, "and that is a failure, not a note");
});

test("T8: widening the board alone would fail a correct tree -- the ledger side is widened too", () => {
  // Read the board for N9 but not the ledger and rows.get("N9") is None, which
  // this guard reports as "has a test but no row in the ledger" -- on a tree
  // where the row is right there and says fixed.
  const { code, out } = guard(
    { "N9-native-thing.test.mts": boardFile([["N9: the native thing holds", true]]) },
    [["N9", "fixed 2026-09-11"]]
  );
  assert.doesNotMatch(out, /no row in the ledger/, out);
  assert.match(out, /the ledger agrees with the bug board/, out);
  assert.equal(code, 0, "a green test and a fixed row agree; nothing to report");
});

test("T8: a failing test and a passing test under one id is a FAILING id", () => {
  // S19-concat-faststart.test.mts is this shape: two tests, both titled
  // "S19: ...". Keyed by id with last-write-wins, the passing second one
  // erased the failing first, and the guard called S19 fixed.
  const { code, out } = guard(
    {
      "S9-two-halves.test.mts": boardFile([
        ["S9: the half that is still broken", false],
        ["S9: the half that works", true],
      ]),
    },
    [["S9", "fixed 2026-09-11"]]
  );
  assert.match(out, /S9 FAILS, but the ledger calls it fixed/, out);
  assert.equal(code, 1);
});

test("T8: a test whose title carries no id is still covered -- the id is the file name", () => {
  // Every test the M0.6 fix added reads like this one. Nothing is wrong with
  // the title; coverage must not depend on it.
  const { code, out } = guard(
    { "T9-no-prefix.test.mts": boardFile([["the server reports the data root it is serving", false]]) },
    [["T9", "**fixed 2026-09-11**"]]
  );
  assert.match(out, /T9 FAILS, but the ledger calls it fixed/, out);
  assert.equal(code, 1);
});

test("T8: a board file that names no id is a failure, not a silent gap", () => {
  // The cost of taking the id from the file name is that the file name has to
  // carry one. That has to be enforced, or it is just another convention that
  // rots quietly -- which is the whole finding.
  const { code, out } = guard(
    { "stray-reproduction.test.mts": boardFile([["something or other", true]]) },
    [["S9", "open"]]
  );
  assert.match(out, /stray-reproduction\.test\.mts names no ledger id/, out);
  assert.equal(code, 1);
});

test("T8: the guard states its own coverage, so under-coverage is visible", () => {
  // "the ledger agrees with all 5 regression tests" was TRUE and useless: it
  // named a denominator of its own choosing and said nothing about the seven
  // tests it had not looked at. Whatever it prints has to be checkable.
  const { code, out } = guard(
    {
      "N9-native-thing.test.mts": boardFile([["N9: holds", true]]),
      "S9-server-thing.test.mts": boardFile([["S9: holds", true], ["S9: also holds", true]]),
    },
    [
      ["N9", "fixed 2026-09-11"],
      ["S9", "fixed 2026-09-11"],
      ["C9", "open"],
      ["C10", "regressed"],
    ]
  );
  assert.equal(code, 0, out);
  assert.match(out, /checked 2 ids across 2 board file\(s\) and 3 test\(s\): N9 S9/, out);
  assert.match(out, /2 row\(s\) marked open or regressed have no test on the board/, out);
});
