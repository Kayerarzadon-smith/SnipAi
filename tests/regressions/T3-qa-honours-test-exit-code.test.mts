import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { scratchDir } from "../scratch.mts";

/**
 * LEDGER T3 — one run, two opposite verdicts, and the exit code agrees with
 * the wrong one.
 *
 * `scripts/qa:124-133` ran the suite as `out=$(./scripts/test 2>&1)`, threw
 * the status away, and decided with `grep -q "fail 0"`. That grep only ever
 * sees node's summary line for the app suite. A `tsc --noEmit` failure, a red
 * guard, or a failing Python unittest case produces no such line and
 * suppresses none -- so every one of them sailed through.
 *
 * Observed live on 2026-09-11: a run printed three ledger disagreements AND a
 * nested "something is broken -- do not ship", then ended "notes above,
 * nothing blocking" and exited 0.
 *
 * Why it is worth a row rather than a shrug: `scripts/bundle-app:23-26` reads
 * that exit code as the release gate. `if ./scripts/qa --full; then good
 * "clean"` -- so the gate that is supposed to stop a broken artifact leaving
 * this machine was reading a grep for a string that is present on a broken
 * run. The M0.6 rebundle would have gone through a gate that cannot fail.
 *
 * The same shape, one function down: `sweeps()` re-ran all three guards with
 * `|| true`, so a guard could report its defect and pass the run anyway --
 * which the comment in `scripts/test:44` already calls out as a known fault.
 *
 * HOW THIS IS TESTED, and why not against the real tree: `scripts/qa --full`
 * runs `scripts/test`, which runs this very board. A board test that shelled
 * out to the real `./scripts/qa --full` would recurse into itself forever.
 * So it runs against a stub tree -- `scripts/qa` copied verbatim beside a
 * fake `scripts/test` and fake guards whose exit codes the test dictates.
 * `scripts/qa` cd's to `$(dirname $0)/..`, so the copy reads the stubs. That
 * isolates precisely the mechanism under test: given a non-zero status from
 * the things it runs, does qa report failure?
 *
 * Expected to FAIL until T3 is fixed.
 */

const ROOT = path.dirname(path.dirname(path.dirname(new URL(import.meta.url).pathname)));

/** A tree `scripts/qa` can run in, with the exit codes of its parts dictated. */
function stubTree(opts: { testExit: number; guardExit?: number }): string {
  const root = scratchDir("t3");
  for (const d of ["scripts", "audits", "app/api", "lib", "native", "tests/regressions"]) {
    fs.mkdirSync(path.join(root, d), { recursive: true });
  }
  fs.copyFileSync(path.join(ROOT, "scripts", "qa"), path.join(root, "scripts", "qa"));
  fs.chmodSync(path.join(root, "scripts", "qa"), 0o755);

  // The stub suite prints exactly the line the old grep keyed on, so a broken
  // run is indistinguishable from a green one by that measure -- and then
  // exits non-zero, the way tsc/guard/unittest failures actually do.
  fs.writeFileSync(path.join(root, "scripts", "test"),
    `#!/bin/bash\necho "# tests 1"\necho "# pass 1"\necho "# fail 0"\n` +
    `echo "something is broken -- do not ship"\nexit ${opts.testExit}\n`);
  fs.chmodSync(path.join(root, "scripts", "test"), 0o755);

  for (const g of ["guard-rebuild.py", "guard-open-panel.py", "guard-ledger.py"]) {
    fs.writeFileSync(path.join(root, "scripts", g),
      `import sys\nprint("  ${g} stub")\nsys.exit(${opts.guardExit ?? 0})\n`);
  }
  return root;
}

function runQa(root: string): { code: number; out: string } {
  try {
    const out = execFileSync(path.join(root, "scripts", "qa"), ["--full"],
      { cwd: root, encoding: "utf8", stdio: "pipe",
        env: { ...process.env, SNIPAI_DATA: path.join(root, "data") } });
    return { code: 0, out };
  } catch (e: any) {
    return { code: e.status ?? 1, out: `${e.stdout ?? ""}${e.stderr ?? ""}` };
  }
}

test("T3: a green suite still exits 0", () => {
  // The control. Without it, a qa that always failed would pass the tests below.
  const root = stubTree({ testExit: 0 });
  const r = runQa(root);
  assert.equal(r.code, 0, `a tree where everything passes must exit 0:\n${r.out}`);
  fs.rmSync(root, { recursive: true, force: true });
});

test("T3: a suite that exits non-zero fails the run, even when it printed 'fail 0'", () => {
  const root = stubTree({ testExit: 1 });
  const r = runQa(root);

  assert.match(r.out, /fail 0/,
    "the fixture must still print the string the old grep keyed on, " +
    "otherwise this proves nothing about the defect");
  assert.notEqual(r.code, 0,
    "scripts/test exited 1 -- a tsc error, a red guard or a failing unittest case. " +
    "qa must not exit 0 on that: bundle-app reads this as the release gate");
  assert.doesNotMatch(r.out, /nothing blocking/,
    "and the verdict line must not say 'nothing blocking' over a broken suite");
  fs.rmSync(root, { recursive: true, force: true });
});

test("T3: a guard that fails in sweeps() fails the run", () => {
  // Same shape one function down: `python3 scripts/guard-*.py || true`.
  const root = stubTree({ testExit: 0, guardExit: 1 });
  const r = runQa(root);
  assert.notEqual(r.code, 0,
    "a guard reporting its defect must not be able to pass the run -- " +
    "`|| true` is how a guard gets to be advisory about the thing it guards");
  fs.rmSync(root, { recursive: true, force: true });
});

test("T3: bundle-app's release gate reads that exit code", () => {
  // The reason the row matters. If this stops being true, T3's stakes change.
  const src = fs.readFileSync(path.join(ROOT, "scripts", "bundle-app"), "utf8");
  assert.match(src, /if \.\/scripts\/qa --full; then/,
    "bundle-app must gate on qa's exit status -- that is what makes it a gate");
});
