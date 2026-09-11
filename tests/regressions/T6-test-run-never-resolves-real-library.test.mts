import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * T6 -- a test run must never resolve DATA_ROOT to the real library.
 *
 * `lib/paths.ts:resolveDataRoot()` falls back to ~/Movies/SnipAi whenever
 * SNIPAI_DATA is unset and `projects/` exists there. That fallback is correct
 * for the app -- it is how a person's library is found -- and catastrophic for
 * a test run, which is the same process with the same import.
 *
 * It has already destroyed data. `tests/job-stage.test.mts` calls createJob()
 * five times; `lib/jobs.ts` persists to STATE_ROOT/jobs.json and caps the
 * store at 40. `./scripts/qa --full` therefore evicted the five oldest real
 * build records on every run, and after eight runs all 40 entries in
 * ~/Movies/SnipAi/state/jobs.json were `_test_*` fixtures. The real build
 * history is gone.
 *
 * The rule this asserts is not "the suite happens to be pointed somewhere
 * safe today". It is that **a test process cannot reach the default library
 * at all**, whatever any individual test file remembers to do. The seam is
 * `tests/register.mts`: it is loaded with --import by every way the suite is
 * run (`scripts/test`, `scripts/qa`, `scripts/guard-ledger.py`), and nothing
 * in the shipping app loads it. A test run that skips it cannot resolve `@/`
 * and so cannot import an app module in the first place -- there is no
 * bypass to forget about.
 *
 * The probe runs in a child process with SNIPAI_DATA explicitly removed,
 * because this parent already has it set (by the very guard under test), and
 * because `lib/paths.ts` reads the environment once at import.
 */

const ROOT = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));
const DEFAULT_LIBRARY = path.join(os.homedir(), "Movies", "SnipAi");

type Probe = {
  DATA_ROOT: string;
  STATE_ROOT: string;
  /** Answered inside the child, while the sandbox still exists: the guard
   *  removes it on exit, so the parent cannot stat it afterwards. */
  stateExists: boolean;
  stateWritable: boolean;
};

function resolveInChildWithoutSnipaiData(): Probe {
  const env = { ...process.env };
  delete env.SNIPAI_DATA;
  const out = execFileSync(
    process.execPath,
    [
      "--import",
      "./tests/register.mts",
      "-e",
      `Promise.all([import("node:fs"), import("node:os"), import(${JSON.stringify(path.join(ROOT, "lib", "paths.ts"))})])
         .then(([fs, os, m]) => {
           let stateWritable = false;
           // Never write until the destination has been PROVEN to be a
           // throwaway. On the unfixed code this probe resolves to
           // ~/Movies/SnipAi and an unguarded write here is the very bug.
           const tmp = fs.realpathSync(os.tmpdir()) + "/";
           if (fs.existsSync(m.DATA_ROOT) && fs.realpathSync(m.DATA_ROOT).startsWith(tmp)) {
             try {
               fs.writeFileSync(m.STATE_ROOT + "/t6-probe", "ok");
               stateWritable = true;
             } catch {}
           }
           console.log("\\u0001" + JSON.stringify({
             DATA_ROOT: m.DATA_ROOT,
             STATE_ROOT: m.STATE_ROOT,
             stateExists: fs.existsSync(m.STATE_ROOT),
             stateWritable,
           }));
         })`,
    ],
    { cwd: ROOT, env, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }
  );
  const line = out.split("\n").find((l) => l.startsWith(""));
  assert.ok(line, `probe printed no result:\n${out}`);
  return JSON.parse(line.slice(1));
}

test("a test process cannot resolve DATA_ROOT to the real library", () => {
  const { DATA_ROOT } = resolveInChildWithoutSnipaiData();

  assert.notEqual(
    DATA_ROOT,
    DEFAULT_LIBRARY,
    `a test run with SNIPAI_DATA unset resolved DATA_ROOT to the real library ` +
      `(${DATA_ROOT}). Anything the suite persists lands in Kayer's footage.`
  );
});

test("the redirected data root is a real, writable, throwaway directory", () => {
  const { DATA_ROOT, stateExists, stateWritable } = resolveInChildWithoutSnipaiData();

  // Prove the location is a throwaway BEFORE writing a byte into it. The
  // first draft of this test asserted writability first and, on the unfixed
  // code, created ~/Movies/SnipAi/state/t6-probe -- the test for the bug
  // committing the bug. Both this assertion and the probe's own guard exist
  // because of that.
  const tmp = fs.realpathSync(os.tmpdir()) + path.sep;
  assert.ok(
    DATA_ROOT.startsWith(tmp) || DATA_ROOT.startsWith(os.tmpdir() + path.sep),
    `redirected DATA_ROOT is not under the temp dir: ${DATA_ROOT}`
  );

  // Not enough to point away from the library: lib/jobs.ts and friends mkdir
  // and write under STATE_ROOT, so a root that does not exist or is not
  // writable turns a data-loss bug into a crash-on-every-test bug. Both
  // answers come from inside the probe, which is the only place the sandbox
  // is still alive -- the guard removes it when that process exits.
  assert.ok(stateExists, `redirected STATE_ROOT does not exist`);
  assert.ok(stateWritable, `redirected STATE_ROOT is not writable`);
});

test("an explicit SNIPAI_DATA still wins -- the guard only fills a gap", () => {
  // The guard must not override a data root the caller chose; every
  // regression fixture in tests/regressions/_fixture.mts depends on that.
  const chosen = fs.mkdtempSync(path.join(os.tmpdir(), "snipai-t6-"));
  const out = execFileSync(
    process.execPath,
    [
      "--import",
      "./tests/register.mts",
      "-e",
      `import(${JSON.stringify(path.join(ROOT, "lib", "paths.ts"))}).then(m =>
         console.log("\\u0001" + m.DATA_ROOT))`,
    ],
    { cwd: ROOT, env: { ...process.env, SNIPAI_DATA: chosen }, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }
  );
  const line = out.split("\n").find((l) => l.startsWith(""));
  assert.equal(line?.slice(1), path.resolve(chosen));
  fs.rmSync(chosen, { recursive: true, force: true });
});
