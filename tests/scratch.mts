import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * Every scratch directory the suite makes, and the one place that removes
 * them. (ledger T19)
 *
 * WHY THIS DID NOT ALREADY EXIST, because the row asks and the answer is the
 * fix. `tests/regressions/_fixture.mts` -- the shared helper, written before
 * most of the files that leak -- mints two directories and removes neither.
 * So a test that wanted cleanup could not get it from the helper; it had to
 * write its own `mkdtempSync` plus its own `rmSync`. One of those is a line
 * and the other is a lifetime problem, so what got written was the line.
 * Audited across the 27 sites: eight files removed nothing at all, and most
 * of the rest called `rmSync` as the last statement of a test body -- which
 * is skipped the moment an assertion throws, i.e. exactly when a run leaves
 * the most behind. A fixture that tidies up only when the test passes is the
 * bug with extra steps.
 *
 * So the teardown is not something a caller can forget to ask for. Taking a
 * directory registers it, and the registration is what removes it.
 *
 * WHY `process.on("exit")` IS ENOUGH, and it took checking. `node --test`
 * runs each FILE in its own child process, so this module's list is per-file
 * and the handler fires once per file rather than once per run. It fires on
 * every ending that matters:
 *
 *   - a passing file                        exit 0, handler runs
 *   - a failing assertion inside a test     the runner catches it, the file
 *                                           still exits normally, handler runs
 *   - a throw at module top level           exit 1, handler runs
 *   - an unhandled rejection                same
 *
 * What it does not survive is SIGKILL, and that is what `scripts/test`'s
 * pre-run sweep is for. Belt and braces: this stops the leak, the sweep
 * collects anything a killed run stranded and anything already on the disk.
 */

/** Every scratch path this process has taken, in the order it took them. */
const taken: string[] = [];
let armed = false;

/**
 * A throwaway directory under the OS temp dir, removed when this process
 * ends however it ends.
 *
 * `tag` only has to be recognisable in a `ps`-shaped listing; the suffix
 * `mkdtemp` adds is what makes it unique. Keep the `snipai-` prefix: it is
 * the entire safety scope of the sweep in `scripts/test`.
 */
export function scratchDir(tag: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `snipai-${tag}-`));
  taken.push(dir);
  if (!armed) {
    armed = true;
    process.on("exit", removeScratchDirs);
  }
  return dir;
}

/**
 * Remove everything this process took. Idempotent, and never throws: a
 * leftover temp directory is not worth turning a green run red over, and a
 * handler that throws on the way out would mask the exit code the runner is
 * trying to report.
 */
export function removeScratchDirs(): void {
  while (taken.length) {
    const dir = taken.pop()!;
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      /* the sweep will get it next run */
    }
  }
}

/** What this process is currently holding. For T19's own test. */
export function scratchDirsHeld(): readonly string[] {
  return taken;
}
