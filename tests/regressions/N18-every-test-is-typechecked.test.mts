import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { scratchDir } from "../scratch.mts";

/**
 * LEDGER N18 -- no test file had ever been typechecked.
 *
 * `tsconfig.json`'s include was `["next-env.d.ts", "**​/*.ts",
 * "**​/*.tsx", ".next/types/**​/*.ts"]`, and every test in this repo
 * is `.mts` -- 21 of 21 at the time, zero `.ts`. So `npx tsc --noEmit`
 * checked `lib/`, `app/` and `scripts/` and not one line of `tests/`, for as
 * long as the suite had existed. `bundle-app` runs `scripts/qa --full` as its
 * release gate, so the gate everyone quoted as green was never looking there.
 *
 * It cost two real fail-opens. The `ClipProbe` fixtures in
 * `grouping.test.mts` and `import-batch.test.mts` were each missing two
 * fields; both feed `analyseBatch -> joinRefusal`; and a probe carrying
 * `undefined` where the code tested `=== null` produced `NaN`, which fails
 * every comparison -- so the join guard answered "no blocker" for exactly the
 * clip it exists to refuse.
 *
 * WHY A GATE AND NOT JUST A FIX. `guard-ledger` and `verify-bundle` exist for
 * misses somebody eventually noticed. This one had **no symptom at all** --
 * nothing went red, nothing printed, and it surfaced only because a fixture
 * happened to be missing a field somebody was looking for. A wrong answer is
 * recoverable; an invisible absence of checking is not.
 *
 * WHAT THIS FILE ASSERTS. Not that the include set contains a particular
 * string -- that tests the instruction, and the instruction is exactly what
 * was wrong for months while looking reasonable. It drives
 * `scripts/guard-typecheck.py` against fixture trees and asserts the
 * OUTCOME: a tree whose tests are all covered passes, a tree with one file
 * outside the include set fails and names it, and the real repo passes.
 *
 * The gate asks `tsc --showConfig` rather than reimplementing tsconfig's
 * globbing, so it cannot disagree with the compiler it guards. Import
 * resolution is deliberately not used: a test reachable only because a
 * sibling imports it would appear in the program while still being outside
 * the include set, and that is the bug rather than the fix.
 */

const ROOT = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));
const GUARD = path.join(ROOT, "scripts", "guard-typecheck.py");

type Run = { code: number; out: string };

/**
 * A throwaway project with its own tsconfig and its own tests/ directory.
 * `include` is whatever the caller passes, so the gate is asked the same
 * question the real repo asked and got wrong.
 */
function runGuardOn(include: string[], testFiles: string[]): Run {
  const dir = scratchDir("n18");
  fs.writeFileSync(
    path.join(dir, "tsconfig.json"),
    JSON.stringify({ compilerOptions: { noEmit: true, allowJs: true }, include }, null, 2)
  );
  for (const rel of testFiles) {
    const p = path.join(dir, "tests", rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, "export const x = 1;\n");
  }
  const r = spawnSync(GUARD, [], {
    cwd: ROOT,
    encoding: "utf8",
    timeout: 300_000,
    env: {
      ...process.env,
      SNIPAI_TSCONFIG: path.join(dir, "tsconfig.json"),
      SNIPAI_TESTS_DIR: path.join(dir, "tests"),
    },
  });
  return { code: r.status ?? -1, out: `${r.stdout ?? ""}\n${r.stderr ?? ""}` };
}

test("N18: a test file outside the include set fails the gate, by name", () => {
  /* The headline, and the exact shape of the original defect: the include set
     names one extension and the tests use another. */
  const r = runGuardOn(["**/*.ts"], ["covered.test.ts", "invisible.test.mts"]);
  assert.equal(r.code, 1, `the gate passed a tree with an unchecked test file:\n${r.out}`);
  assert.match(r.out, /invisible\.test\.mts/, `the gate does not name the file it found:\n${r.out}`);
  assert.doesNotMatch(r.out, /covered\.test\.ts\b/, "the gate reported a file that IS checked");
});

test("N18: the next sibling extension cannot slip through either", () => {
  /* `.mts` was the one that got in. The gate has to be about the class, not
     about that extension -- a `.cts` or a stray `.mjs` helper is the same
     hole. `tests/native/fake-occupant.mjs` was exactly this, and the gate
     found it on its first run against the real repo. */
  for (const ext of ["cts", "mjs", "cjs", "tsx", "js"]) {
    const r = runGuardOn(["**/*.mts"], ["fine.test.mts", `helper.${ext}`]);
    assert.equal(r.code, 1, `a .${ext} test file outside the include set passed the gate:\n${r.out}`);
    assert.match(r.out, new RegExp(`helper\\.${ext}`), `the gate did not name the .${ext} file`);
  }
});

test("N18: a tree whose tests are all covered passes, and says how many", () => {
  const r = runGuardOn(["**/*.mts", "**/*.mjs"], ["a.test.mts", "b.test.mts", "native/fake.mjs"]);
  assert.equal(r.code, 0, `a fully covered tree was failed:\n${r.out}`);
  /* The denominator, because a guard that says "fine" without saying how much
     it looked at is how the ledger collected three "agrees" over a malformed
     table (T8, T15, T20 -- the same family three times). */
  assert.match(r.out, /3 file\(s\)/, `the gate does not state its own coverage:\n${r.out}`);
  assert.match(r.out, /1 \.mjs, 2 \.mts/, `the gate does not break its count down:\n${r.out}`);
});

test("N18: a guard that finds nothing to check does not pass", () => {
  /* The failure mode a gate like this dies of: pointed at the wrong place, it
     reports success over an empty search. T19's own sweep had to answer the
     same question. */
  const r = runGuardOn(["**/*.mts"], []);
  assert.equal(r.code, 1, `the gate passed with no test files at all:\n${r.out}`);
  assert.match(r.out, /no test sources/, r.out);
});

test("N18: the real repo passes, and every test file is in the set", () => {
  /* The live claim. Everything above is about the gate; this is about us. */
  const r = spawnSync(GUARD, [], { cwd: ROOT, encoding: "utf8", timeout: 300_000 });
  const out = `${r.stdout ?? ""}\n${r.stderr ?? ""}`;
  assert.equal(r.status, 0, `the repo has test files outside the typechecker:\n${out}`);
  assert.match(out, /every test file is typechecked/, out);
});

test("N18: scripts/test runs the gate, so the release gate covers it", () => {
  /* Staleness guard, not the proof. `bundle-app` reads `scripts/qa --full`,
     which runs `scripts/test`; if the gate is not in that path it protects
     nothing that ships. */
  const src = fs.readFileSync(path.join(ROOT, "scripts", "test"), "utf8");
  assert.match(src, /guard-typecheck\.py/, "scripts/test no longer runs the typecheck-coverage gate");
  const gate = src.indexOf("guard-typecheck.py");
  const suite = src.indexOf("--test");
  assert.ok(gate > 0 && suite > 0 && gate < suite,
    "the gate should run with the typecheck, before the suite it is about");
});
