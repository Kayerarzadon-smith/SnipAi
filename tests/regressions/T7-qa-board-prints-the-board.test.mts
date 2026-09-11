import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { scratchDir } from "../scratch.mts";

/**
 * LEDGER T7 -- `./scripts/qa --regressions` printed an empty board.
 *
 * The ledger's own header tells you to run that command to see what is open.
 * It greps node's output for `^ok` / `^not ok`, which is the tap format, and
 * node picks its reporter by whether stdout is a TTY. Piped into grep it gave
 * the SPEC reporter instead ("✔ name", "ℹ pass 1"), so nothing matched: the
 * section rendered a heading, ZERO lines, the dim "these are meant to fail"
 * footer, and the run ended "nothing mechanical to report" and exited 0 --
 * with 12 tests sitting on the board, one of them deliberately red.
 *
 * Same root cause as T2, in the second of the two places that run the board:
 * `scripts/guard-ledger.py` had it, was fixed with `--test-reporter=tap`, and
 * `scripts/qa` never got the same treatment.
 *
 * The test drives the real `scripts/qa --regressions` against a FIXTURE board
 * (SNIPAI_BOARD_DIR), for two reasons: the real board takes seconds and spawns
 * ffmpeg, and a test on the real board that ran `scripts/qa --regressions`
 * would run itself, forever. The fixture holds one passing and one failing
 * test, because the two lines a board must never lose are `ok` and `not ok`.
 *
 * execFileSync gives the child a PIPE for stdout, which is precisely the
 * condition the bug needed. Run this from a terminal by hand and the old code
 * looked fine -- that is why it survived.
 */

const ROOT = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));

function fixtureBoard(): string {
  const dir = scratchDir("t7-board");
  fs.writeFileSync(
    path.join(dir, "Z1-a-fixed-bug.test.mts"),
    `import test from "node:test";\n` +
      `import assert from "node:assert/strict";\n` +
      `test("Z1: this defect is fixed", () => { assert.equal(1, 1); });\n`
  );
  fs.writeFileSync(
    path.join(dir, "Z2-an-open-bug.test.mts"),
    `import test from "node:test";\n` +
      `import assert from "node:assert/strict";\n` +
      `test("Z2: this defect is still open", () => { assert.equal(1, 2); });\n`
  );
  return dir;
}

function qaRegressions(board: string): string {
  // NODE_TEST_CONTEXT is set by node in the children of a `node --test` run,
  // and a node that sees it reports over an internal channel instead of
  // stdout. This test IS such a child, and `scripts/qa` in real use is not:
  // dropping it here gives the script the environment it actually ships into.
  const env = { ...process.env, SNIPAI_BOARD_DIR: board };
  delete env.NODE_TEST_CONTEXT;
  return execFileSync("./scripts/qa", ["--regressions"], { cwd: ROOT, encoding: "utf8", env });
}

test("T7: the bug board prints its tests when stdout is a pipe", () => {
  const out = qaRegressions(fixtureBoard());

  const results = out
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => /^(ok|not ok) \d+ - /.test(l));

  assert.equal(
    results.length,
    2,
    `the board has two tests on it and must print a line for each; it printed:\n${out}`
  );
  assert.ok(
    results.some((l) => /^ok \d+ - Z1: this defect is fixed/.test(l)),
    "a fixed bug is reported as ok, by name"
  );
  assert.ok(
    results.some((l) => /^not ok \d+ - Z2: this defect is still open/.test(l)),
    "and a bug still open is reported as NOT ok, by name -- the whole point of the board"
  );
});

test("T7: and it prints the counts, so a reader can check the lines add up", () => {
  const out = qaRegressions(fixtureBoard());

  // ledger T2/T3: the verdict banners on this repo have lied in both
  // directions, so "# pass"/"# fail" is what a person is told to read instead.
  assert.match(out, /^\s*# pass 1$/m, "one test on this fixture board passes");
  assert.match(out, /^\s*# fail 1$/m, "and one fails");
});
