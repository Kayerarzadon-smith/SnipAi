/* CATEGORY 023 — the gates themselves.
 *
 * Every other suite tests the app. This one tests the machinery that is
 * supposed to stop a bad app from getting out, because that machinery has
 * failed silently twice already and both times it failed OPEN:
 *
 *   T1  a skipped suite still printed "all green"
 *   T2  guard-ledger.py parsed for a reporter node never gave it, found
 *       nothing, and forced fail=1 on every single run -- so the verdict
 *       line cried wolf for long enough to stop meaning anything
 *
 * A gate that is wrong in the safe direction wastes your time. A gate that
 * is wrong in the other direction is worse than no gate, because you stopped
 * checking by hand once you had it. PROCESS.md lists the gates; this asserts
 * they are all still real, still wired up, and still say what they mean.
 */
import fs from "node:fs";
import { execFileSync } from "node:child_process";
import type { Report } from "../report.mts";

const exists = (p: string) => fs.existsSync(p);
const executable = (p: string) => {
  try { fs.accessSync(p, fs.constants.X_OK); return true; } catch { return false; }
};
const read = (p: string) => fs.readFileSync(p, "utf8");

export function run(rep: Report) {
  /* ---- the gates PROCESS.md promises actually exist ------------------ */
  rep.check("023 gates", "every gate PROCESS.md names is a real file", () => {
    if (!exists("PROCESS.md")) throw new Error("PROCESS.md is missing -- the process is only in someone's head");
    const named = [
      ".githooks/pre-commit",
      "scripts/test",
      "scripts/qa",
      "scripts/guard-ledger.py",
      "scripts/bundle-app",
      ".github/workflows/ci.yml",
    ];
    const missing = named.filter((f) => !exists(f));
    if (missing.length) throw new Error(`named in the gate table, absent on disk: ${missing.join(", ")}`);
  });

  rep.check("023 gates", "the gates that must run are executable", () => {
    const needed = [".githooks/pre-commit", "scripts/test", "scripts/qa"];
    const dead = needed.filter((f) => !executable(f));
    if (dead.length) throw new Error(`present but not executable, so they silently never run: ${dead.join(", ")}`);
  });

  /* ---- the commit gate is actually wired to git ----------------------- */
  rep.check("023 gates", "git is pointed at .githooks, not the default hooks dir", () => {
    const path = execFileSync("git", ["config", "--get", "core.hookspath"], { encoding: "utf8" }).trim();
    if (path !== ".githooks") {
      throw new Error(`core.hookspath is "${path || "(unset)"}" -- the pre-commit gate is not armed on this clone`);
    }
  });

  rep.check("023 gates", "the pre-commit hook still runs the fast QA pass", () => {
    const src = read(".githooks/pre-commit");
    if (!/scripts\/qa\b/.test(src)) throw new Error("pre-commit no longer invokes scripts/qa");
    if (!/--fast/.test(src)) throw new Error("pre-commit no longer asks for --fast; a slow gate gets bypassed");
  });

  /* ---- postbuild -------------------------------------------------------- */
  rep.check("023 gates", "npm run build still gates on QA", () => {
    const pkg = JSON.parse(read("package.json"));
    const post = pkg.scripts?.postbuild ?? "";
    if (!/scripts\/qa/.test(post)) throw new Error(`postbuild is "${post}" -- the build path no longer runs a gate`);
  });

  /* ---- CI ------------------------------------------------------------- */
  rep.check("023 gates", "CI runs the same suite the Mac does", () => {
    const ci = read(".github/workflows/ci.yml");
    if (!/\.\/scripts\/test/.test(ci)) throw new Error("the CI workflow does not run ./scripts/test");
    if (!/ffmpeg/.test(ci)) throw new Error("CI has no ffmpeg; the S19 atom-order test cannot run there");
    if (!/node-version/.test(ci)) throw new Error("CI does not pin a node version -- the harness relies on node's own type stripping");
  });

  /* ---- the ledger gate ------------------------------------------------ */
  rep.check("023 gates", "the ledger and the bug board agree", () => {
    try {
      execFileSync("python3", ["scripts/guard-ledger.py"], { encoding: "utf8" });
    } catch (e) {
      const out = (e as { stdout?: string }).stdout ?? "";
      throw new Error(`guard-ledger.py is failing:\n${out.trim()}`);
    }
  });

  /* T2, encoded so it cannot come back: the guard must be reading a format
     node will actually emit down a pipe. */
  rep.check("023 gates", "guard-ledger reads a reporter it will actually be given", () => {
    const src = read("scripts/guard-ledger.py");
    if (/[✔✖]/.test(src) && !/test-reporter=tap/.test(src)) {
      throw new Error("guard-ledger matches the spec reporter's ✔/✖ but does not force --test-reporter=tap; " +
                      "capture_output pipes stdout and node never gives a pipe the spec reporter (this was T2)");
    }
  });

  /* ---- every regression test is accounted for ------------------------- */
  rep.check("023 gates", "every regression test maps to a ledger row", () => {
    const ledger = read("audits/LEDGER.md");
    const orphans: string[] = [];
    for (const f of fs.readdirSync("tests/regressions")) {
      const m = /^([SCPTEU]\d+)-/.exec(f);
      if (!m) continue;
      if (!new RegExp(`\\|\\s*${m[1]}\\s*\\|`).test(ledger)) orphans.push(`${m[1]} (${f})`);
    }
    if (orphans.length) throw new Error(`a test exists with no row explaining it: ${orphans.join(", ")}`);
  });

  /* ---- nothing private can be committed -------------------------------- */
  rep.check("023 gates", "key material cannot reach the history", () => {
    const tracked = execFileSync("git", ["ls-files"], { encoding: "utf8" }).split("\n");
    const bad = tracked.filter((f) => /(^|\/)\.env|\.pem$|\.p12$|(^|\/)credentials?\.json$|_rsa$/.test(f));
    if (bad.length) throw new Error(`tracked and should not be: ${bad.join(", ")}`);
  });

  rep.check("023 gates", "no literal API key is tracked", () => {
    // git grep exits 1 when it finds NOTHING, which is the outcome we want.
    // Letting that throw would turn a clean repo into a red gate -- exactly
    // the fail-open/fail-closed confusion this suite exists to catch, so it
    // would be a poor place to make the same mistake.
    let out = "";
    try {
      out = execFileSync("git", ["grep", "-InE", "(sk-[A-Za-z0-9]{20,}|AIza[A-Za-z0-9_-]{30,})", "--", "."],
        { encoding: "utf8" }).trim();
    } catch (e) {
      const err = e as { status?: number; stdout?: string; stderr?: string };
      if (err.status === 1) return;                 // no matches: clean
      throw new Error(`git grep failed (status ${err.status}): ${(err.stderr ?? "").trim()}`);
    }
    if (out) throw new Error(`literal key material in tracked files:\n${out.slice(0, 400)}`);
  });
}
