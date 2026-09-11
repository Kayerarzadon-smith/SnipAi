import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { scratchDir } from "../scratch.mts";

/**
 * LEDGER T19 -- the test suite leaked fixture directories onto his disk.
 *
 * 7,621 `snipai-*` directories, 273 MB, accumulating since 2026-09-08, at
 * about 75 per run. Not a historical pile to sweep once: a rate. Measured
 * again mid-session, 157 came back inside one working session.
 *
 * WHY IT EXISTED, since the row asks. `tests/regressions/_fixture.mts` --
 * the shared helper, older than most of the files that leak -- minted two
 * directories and removed neither. So a fixture that wanted cleanup could not
 * get it from the helper and had to hand-roll `mkdtempSync` plus `rmSync`.
 * One of those is a line, the other is a lifetime problem, so what got
 * written was the line. Audited over all 27 sites: eight files removed
 * nothing at all, and most of the rest called `rmSync` as the last statement
 * of a test body -- skipped the moment an assertion throws, which is exactly
 * when a run leaves the most behind. **The helper's own gap is why the helper
 * was not reached for**, so the fix is the helper, not 27 `try/finally`s.
 *
 * WHAT THIS FILE ASSERTS. Not that anything calls `rm` -- that is the trap
 * this session has hit twice (C22's arithmetic, and S34's own copy assertion
 * pinning words instead of the property). A suite that leaks would pass a
 * "the helper calls rmSync" test all day. What is pinned here is the outcome
 * the row's exit condition names:
 *
 *     after a run, the temp dir holds none of the directories that run made
 *
 * measured by counting them, for a passing run, a failing run, and a run that
 * throws before its first test -- because a fixture that tidies up only on
 * success is the bug with extra steps.
 *
 * And separately, the sweep's SCOPE, which is the part that could do harm
 * rather than merely fail to help. A symlink is how a `touch` once became a
 * write to his footage, and `[ -d ]` follows symlinks, so the target of a
 * link named `snipai-*` surviving is asserted here explicitly.
 */

const ROOT = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));
const SCRATCH = path.join(ROOT, "tests", "scratch.mts");
const REGISTER = path.join(ROOT, "tests", "register.mts");
const SWEEP = path.join(ROOT, "scripts", "sweep-fixtures");
const TMP = os.tmpdir();

/**
 * Every `snipai-*` DIRECTORY in the OS temp dir right now.
 *
 * Directories only, and that is not a convenience: `register.mts` leaves a
 * zero-byte `snipai-testrun-said-<ppid>` marker behind on purpose -- its
 * comment explains that removing it lets the next wave of test files announce
 * the banner a second time -- and one appears per child process. Counting
 * files here made the sandbox assertion read 53 against 52 and blame a leak
 * for documented behaviour. The row's exit condition is `ls -d` for the same
 * reason. `tmpFiles` below pins that the markers survive, so this narrowing
 * cannot become a blind spot.
 */
function tmpEntries(prefix = "snipai-"): string[] {
  return fs.readdirSync(TMP)
    .filter((n) => n.startsWith(prefix))
    .filter((n) => {
      try { return fs.statSync(path.join(TMP, n)).isDirectory(); } catch { return false; }
    })
    .sort();
}

function tmpFiles(prefix = "snipai-"): string[] {
  return fs.readdirSync(TMP)
    .filter((n) => n.startsWith(prefix))
    .filter((n) => {
      try { return fs.statSync(path.join(TMP, n)).isFile(); } catch { return false; }
    })
    .sort();
}

/* --------------------------------------------------------------- the leak
 *
 * A child run, driven exactly as `scripts/test` drives one, whose fixtures
 * are tagged so this process can tell them from its own.
 */
/* One host directory for every probe, not one each: `tmpEntries()` counts
   what is in the temp dir, and a host per call would show up in the count
   assertion as this file's own litter. */
const HOST = scratchDir("t19-host");
let probeSeq = 0;

function runChild(body: string, tag: string): { code: number; left: string[]; ran: string } {
  const file = path.join(HOST, `probe-${probeSeq++}.test.mts`);
  const before = tmpEntries(`snipai-${tag}`);
  fs.writeFileSync(
    file,
    `import test from "node:test";\n` +
    `import assert from "node:assert/strict";\n` +
    `import { scratchDir } from ${JSON.stringify(SCRATCH)};\n` +
    body
  );
  /* NODE_TEST_CONTEXT has to be stripped, and this cost an hour: when this
     file is itself run under `node --test`, the environment carries
     NODE_TEST_CONTEXT=child-v8, a grandchild inherits it, and a grandchild
     that thinks it is reporting to a parent runner **exits 0 however many
     tests failed**. Measured side by side: inherited env -> status 0, the
     same run with the variable removed -> status 1.
     
     The first draft of this file did not strip it, and the consequence is
     worth writing down because it is the trap in miniature: the passing-run
     test went GREEN while the child had not failed as intended, and the two
     failure-path tests -- the ones the row is actually about -- reported that
     the probe "was supposed to fail". A green test over a child whose exit
     code is a lie. Hence `ran` below: every probe now proves it executed. */
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  /* And SNIPAI_DATA, so the child's register.mts actually mints its own
     sandbox instead of inheriting this process's. Inherited, the sandbox test
     below passed with the teardown deliberately removed -- vacuous, because
     there was no sandbox to leak. Unset is also what a real run looks like,
     and register.mts sandboxes rather than reaching for his library (T6). */
  delete env.SNIPAI_DATA;
  const r = spawnSync(
    process.execPath,
    ["--import", REGISTER, "--test", file],
    { encoding: "utf8", timeout: 120_000, cwd: ROOT, env }
  );
  const out = `${r.stdout ?? ""}\n${r.stderr ?? ""}`;
  /* What the CHILD created, not what happens to be in the temp dir: diffed
     against a snapshot taken before it started. The first version compared
     against [] and went red on litter left by an unrelated experiment
     earlier in the same session -- which is the leak measuring itself, and a
     good reminder that a test of a shared directory has to name its own
     contribution. */
  const after = tmpEntries(`snipai-${tag}`);
  return { code: r.status ?? -1, left: after.filter((n) => !before.includes(n)), ran: out };
}

/** Proof the probe actually executed, so no assertion below can pass vacuously. */
function assertRan(ran: string, tests: number): void {
  assert.match(
    ran, new RegExp(`tests ${tests}\\b`),
    `the probe did not run ${tests} test(s), so nothing it left behind means anything:\n${ran.slice(0, 400)}`
  );
}

test("T19: a passing run leaves none of its fixture directories behind", () => {
  const { code, left, ran } = runChild(
    `scratchDir("t19pass-module");\n` +
    `test("takes two more", () => { scratchDir("t19pass-a"); scratchDir("t19pass-b"); });\n`,
    "t19pass"
  );
  assertRan(ran, 1);
  assert.equal(code, 0, "the probe run was supposed to pass");
  assert.deepEqual(left, [], `a green run left ${left.length} directories: ${JSON.stringify(left)}`);
});

test("T19: a run with a FAILING test still leaves none behind", () => {
  /* The half that matters. Every leaking site called rmSync as the last
     statement of the test body, so this is the case that leaked most. */
  const { code, left, ran } = runChild(
    `scratchDir("t19fail-module");\n` +
    `test("takes one and then fails", () => {\n` +
    `  scratchDir("t19fail-inside");\n` +
    `  assert.equal(1, 2, "deliberate");\n` +
    `});\n`,
    "t19fail"
  );
  assertRan(ran, 1);
  assert.notEqual(code, 0, "the probe run was supposed to fail, so it is not proving anything");
  assert.deepEqual(left, [], `a red run left ${left.length} directories: ${JSON.stringify(left)}`);
});

test("T19: a run that throws before its first test leaves none behind", () => {
  const { code, left, ran } = runChild(
    `scratchDir("t19throw-module");\n` +
    `throw new Error("deliberate: no tests will run");\n`,
    "t19throw"
  );
  assert.match(ran, /deliberate: no tests will run/, "the probe did not reach its throw");
  assert.notEqual(code, 0, "the probe run was supposed to die");
  assert.deepEqual(left, [], `a run that threw left ${left.length} directories: ${JSON.stringify(left)}`);
});

test("T19: the run's own SNIPAI_DATA sandbox goes with it", () => {
  /* register.mts mints one per child process to keep the suite off his
     library (T6). It used to remove it with a handler of its own; it now goes
     through the same door as everything else, so this pins that the move did
     not drop it. */
  const { ran } = runChild(
    `test("reads its own data root", () => {\n` +
    `  if (!process.env.SNIPAI_DATA) throw new Error("no sandbox was made");\n` +
    `  console.log("SANDBOX=" + process.env.SNIPAI_DATA);\n` +
    `});\n`,
    "t19none"
  );
  const made = /SANDBOX=(\S+)/.exec(ran);
  assert.ok(made, `the child never minted a sandbox, so this proves nothing:\n${ran.slice(0, 300)}`);
  assert.match(made![1], /snipai-testrun-/, "the sandbox is not where register.mts puts it");
  /* The path it actually used, not a count of how many exist. A global count
     races: under `./scripts/test` every board file's child mints one of these
     too, in parallel with this one. Asking after the specific directory is
     both stronger and immune to the neighbours. */
  assert.equal(
    fs.existsSync(made![1]), false,
    `the child left its SNIPAI_DATA sandbox at ${made![1]}`
  );
});

test("T19: the run-announced-itself marker is still left on purpose", () => {
  /* Not a leak, and this is here so the narrowing above cannot hide one.
     register.mts explains why it stays: deleted on the speaker's way out, the
     next wave of files claims it and prints the banner again (observed three
     times in a seventeen-file run). Zero bytes, and the OS reaps it. */
  const before = tmpFiles("snipai-testrun-said-").length;
  const { ran } = runChild(`test("nothing", () => {});\n`, "t19marker");
  assertRan(ran, 1);
  assert.ok(
    tmpFiles("snipai-testrun-said-").length > before,
    "the marker file is no longer being left -- if that was deliberate, register.mts's " +
    "comment about the triple banner needs revisiting first"
  );
});

test("T19: a run that both passes and fails leaves none of its own behind", () => {
  /* The row's exit condition is a GLOBAL count -- `ls -d "$TMPDIR"/snipai-*`
     the same before and after `./scripts/test`. That cannot honestly be
     asserted from inside a run: `node --test` executes board files in
     PARALLEL, so while this test holds its breath, sibling files are taking
     and releasing their own directories. The first version of this assertion
     compared a global snapshot and passed alone, then failed under
     `scripts/qa --regressions` for exactly that reason -- a race, not a leak.
     
     So the global number is measured from OUTSIDE the suite and recorded in
     the row (0 before, 0 after, against ~75 per run before the fix), and what
     is asserted here is the same claim scoped to this test's own tag, over a
     child that both passes and fails in one run. */
  const { left, ran } = runChild(
    `scratchDir("t19count-a");\n` +
    `test("ok", () => { scratchDir("t19count-b"); });\n` +
    `test("bad", () => { scratchDir("t19count-c"); assert.ok(false, "deliberate"); });\n`,
    "t19count"
  );
  assertRan(ran, 2);
  assert.deepEqual(
    left, [],
    `a run with one pass and one failure left ${left.length}: ${JSON.stringify(left)}`
  );
});

/* ------------------------------------------------------- the safety net
 *
 * `scripts/sweep-fixtures` against a temp dir we own entirely, so its scope
 * is measured rather than argued. Every decoy here is something it must NOT
 * touch.
 */
function sweepAgainst(build: (dir: string) => void): { swept: number; left: string[] } {
  const fake = scratchDir("t19-fake");
  const tmp = path.join(fake, "T");
  fs.mkdirSync(tmp);
  build(tmp);
  const r = spawnSync(SWEEP, [], { encoding: "utf8", env: { ...process.env, TMPDIR: tmp }, timeout: 60_000 });
  assert.equal(r.status, 0, `sweep-fixtures exited ${r.status}: ${r.stderr}`);
  return { swept: Number(r.stdout.trim()), left: fs.readdirSync(tmp).sort() };
}

test("T19: the sweep takes our leftover directories", () => {
  const { swept, left } = sweepAgainst((tmp) => {
    for (const n of ["snipai-qa-aaa", "snipai-c30-bbb", "snipai-elst-ccc"]) {
      fs.mkdirSync(path.join(tmp, n));
      fs.writeFileSync(path.join(tmp, n, "junk"), "x");
    }
  });
  assert.equal(swept, 3, `swept ${swept} of 3`);
  assert.deepEqual(left, [], `left ${JSON.stringify(left)}`);
});

test("T19: and touches nothing else in the temp dir", () => {
  const { swept, left } = sweepAgainst((tmp) => {
    fs.mkdirSync(path.join(tmp, "snipai-taken"));            // ours: goes
    fs.mkdirSync(path.join(tmp, "notsnipai-keep"));          // not ours
    fs.mkdirSync(path.join(tmp, "important"));               // not ours
    fs.writeFileSync(path.join(tmp, "snipai-testrun-said-9"), "");  // ours, but a FILE
    fs.writeFileSync(path.join(tmp, "some-other.sock"), "");
  });
  assert.equal(swept, 1, "the sweep reached past its own prefix");
  assert.deepEqual(
    left,
    ["important", "notsnipai-keep", "snipai-testrun-said-9", "some-other.sock"],
    "the sweep removed something that was not a fixture directory of ours"
  );
});

test("T19: a symlink named like ours cannot aim the sweep at anything", () => {
  /* `[ -d ]` follows symlinks, so without the `-L` test first a link called
     `snipai-anything` pointed at a real directory would pass the guard. The
     claim asserted is about the TARGET's contents, not the link. */
  const outside = scratchDir("t19-outside");
  const sentinel = path.join(outside, "do-not-delete.txt");
  fs.writeFileSync(sentinel, "his footage, as far as this test is concerned");

  const { swept, left } = sweepAgainst((tmp) => {
    fs.symlinkSync(outside, path.join(tmp, "snipai-evil"));
  });

  assert.ok(
    fs.existsSync(sentinel),
    "the sweep followed a symlink out of the temp dir and deleted what it pointed at"
  );
  assert.equal(fs.readFileSync(sentinel, "utf8").length > 0, true, "the target was emptied");
  assert.equal(swept, 0, "a symlink was counted as a fixture directory");
  assert.deepEqual(left, ["snipai-evil"], "the link itself was removed; only the -L skip was asserted");
});

test("T19: the sweep is a no-op on an empty temp dir, and says so", () => {
  const { swept, left } = sweepAgainst(() => {});
  assert.equal(swept, 0, "the unmatched glob was treated as a file");
  assert.deepEqual(left, []);
});

test("T19: scripts/test runs the sweep before the suite, not after", () => {
  /* Staleness guard, not the proof. After the run would delete the fixtures
     of the run that just finished -- harmless today, and exactly the kind of
     reordering that makes the failure-path tests above meaningless. */
  const src = fs.readFileSync(path.join(ROOT, "scripts", "test"), "utf8");
  const sweepAt = src.indexOf("sweep-fixtures");
  const firstSuite = src.indexOf("--test");
  assert.ok(sweepAt > 0, "scripts/test no longer runs the sweep at all");
  assert.ok(
    sweepAt < firstSuite,
    "the sweep now runs after the suite, so it would collect the run's own fixtures"
  );
});
