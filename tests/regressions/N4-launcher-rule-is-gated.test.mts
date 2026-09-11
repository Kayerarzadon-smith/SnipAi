import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { scratchDir } from "../scratch.mts";

/**
 * LEDGER N4 -- nothing automated compiled or ran the Swift ownership rule.
 *
 * `native/LaunchDecision.swift` decides whether the app adopts, refuses or
 * restarts whatever is already holding port 4737. When it decides wrongly a
 * sandboxed run writes into ~/Movies/SnipAi, which is what happened on
 * 2026-09-10 (ledger N1). `tests/native/launch-decision-probe.swift` checks
 * that decision 44 ways -- and was run BY HAND, with its output pasted into a
 * commit message. No gate invoked `swiftc`. `decideLaunch` could have been
 * changed to return `.adopt` in every case and `./scripts/test`,
 * `./scripts/qa --full` and the commit hook would all have stayed green until
 * somebody happened to rebundle, which is the same hole as T5 sitting under
 * the code that protects the footage.
 *
 * The fix is `scripts/check-launcher`, called from `scripts/test`. This test
 * is about the GATE, not about the rule: the rule already has 44 checks and
 * they are now run on every push. What had no coverage at all was the
 * plumbing -- that something compiles it, that something runs it, and that a
 * red result actually reddens the run instead of being printed and dropped.
 * `scripts/qa` has shipped `|| true` on a guard before (its own comment at
 * :189 says so), and a guard that cannot fail the run is a comment.
 *
 * It drives `scripts/check-launcher` against SUBSTITUTE Swift sources, the
 * way T7 drives `scripts/qa --regressions` against a fixture board. The real
 * probe takes ~14s and binds ports; these compile in under a second, and the
 * question being asked here is only whether an exit code survives the trip.
 *
 * The last case is the reason the toolchain policy is not a skip: a source
 * that will not compile -- which is also what a missing or broken swiftc
 * looks like, since /usr/bin/swiftc is a stub that errors when no toolchain
 * is installed -- must be RED. A skip there could be silently permanent, and
 * a silently permanent skip is how the pipeline suite went unexercised.
 */

const ROOT = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));
const CHECKER = path.join(ROOT, "scripts", "check-launcher");

/** A two-file Swift program shaped like the real pair: a rule, and a probe
 *  that exits on what the rule decided. `verdict` is the rule's answer. */
function substitutePair(verdict: number | "uncompilable"): { rule: string; probe: string; dir: string } {
  const dir = scratchDir("n4");
  const rule = path.join(dir, "Rule.swift");
  const probe = path.join(dir, "Probe.swift");
  fs.writeFileSync(
    rule,
    verdict === "uncompilable"
      ? `this is not Swift and never was\n`
      : `func ruleDecidesCorrectly() -> Int32 { ${verdict} }\n`
  );
  fs.writeFileSync(
    probe,
    `import Foundation\n` +
      `@main struct Probe {\n` +
      `  static func main() {\n` +
      `    print("1/1 checks passed")\n` +
      `    exit(ruleDecidesCorrectly())\n` +
      `  }\n` +
      `}\n`
  );
  return { rule, probe, dir };
}

function runChecker(rule: string, probe: string) {
  const r = spawnSync(CHECKER, [rule, probe], { cwd: ROOT, encoding: "utf8" });
  return { status: r.status, out: (r.stdout ?? "") + (r.stderr ?? "") };
}

test("N4: the gate exists and is executable", () => {
  assert.ok(fs.existsSync(CHECKER), "scripts/check-launcher is missing");
  fs.accessSync(CHECKER, fs.constants.X_OK);
});

test("N4: a rule that decides wrongly turns the gate red", () => {
  const { rule, probe, dir } = substitutePair(1);
  try {
    const { status, out } = runChecker(rule, probe);
    assert.notEqual(status, 0, `check-launcher exited ${status} on a failing probe:\n${out}`);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("N4: a rule that decides correctly leaves the gate green", () => {
  const { rule, probe, dir } = substitutePair(0);
  try {
    const { status, out } = runChecker(rule, probe);
    assert.equal(status, 0, `check-launcher exited ${status} on a passing probe:\n${out}`);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("N4: a rule that will not compile is a failure, never a skip", () => {
  const { rule, probe, dir } = substitutePair("uncompilable");
  try {
    const { status, out } = runChecker(rule, probe);
    assert.notEqual(status, 0, `check-launcher exited ${status} on a source swiftc rejects:\n${out}`);
    assert.doesNotMatch(out, /skip/i, "a missing or broken toolchain must not be reported as a skip");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("N4: a missing source file is a failure, not silence", () => {
  const { status, out } = runChecker("native/NoSuchRule.swift", "tests/native/NoSuchProbe.swift");
  assert.notEqual(status, 0, `check-launcher exited ${status} with no sources to check:\n${out}`);
});

test("N4: with no arguments the gate checks the REAL rule and probe", () => {
  // The defaults are the whole point -- a gate pointed at substitutes would
  // pass this file and protect nothing. Read them rather than run them: the
  // real probe takes ~14s and scripts/test already pays that once.
  const src = fs.readFileSync(CHECKER, "utf8");
  assert.match(src, /\$\{1:-native\/LaunchDecision\.swift\}/);
  assert.match(src, /\$\{2:-tests\/native\/launch-decision-probe\.swift\}/);
});

test("N4: scripts/test runs the gate and cannot ignore what it says", () => {
  // The one static link in this file, and it is unavoidable: a test that ran
  // ./scripts/test to observe the stage would be ./scripts/test running the
  // board running ./scripts/test. So assert the invocation and, on the same
  // line, that its exit code reaches `fail` -- N4's sibling defect (T3) was a
  // gate whose exit code was thrown away, and scripts/qa:189 records the same
  // fault as `|| true` on a guard.
  const src = fs.readFileSync(path.join(ROOT, "scripts", "test"), "utf8");
  const call = src.split("\n").find((l) => l.includes("scripts/check-launcher") && !l.trimStart().startsWith("#"));
  assert.ok(call, "scripts/test does not invoke scripts/check-launcher at all");
  assert.match(call!, /fail=1/, `scripts/test runs the launcher gate but drops its result: ${call}`);
  assert.doesNotMatch(call!, /\|\|\s*true/, `scripts/test swallows the launcher gate: ${call}`);
});
