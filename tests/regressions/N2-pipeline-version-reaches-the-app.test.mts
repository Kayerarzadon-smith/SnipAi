import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { tempLibrary, bundleSkeleton } from "./_fixture.mts";

/**
 * LEDGER N2 — the "Rebuild — the cutting has improved" badge is inert.
 *
 * E1 (clipped consonants) and S19 (streamable export) are forward-only: they
 * change how footage is cut from now on and do nothing to a file already on
 * disk. The one thing that would tell Kayer his two real cuts are behind is
 * the dashboard badge, and in the packaged app it could never fire, for two
 * independent reasons -- fix one and nothing changes.
 *
 *   (a) `scripts/bundle-app` copies `ugc-edit-system/tools` and never the
 *       manifest, which is that directory's SIBLING. So inside the .app,
 *       currentPipelineVersion() reads nothing, returns 0, and
 *       isPipelineBehind short-circuits on `if (current <= 0) return false`.
 *       `find SnipAi.app -name pipeline-version.json` returned nothing.
 *
 *   (b) The manifest was never bumped for E1. It still said version 2, the
 *       WORD_RESCUE value, so even a bundle carrying the file would compare
 *       every pre-E1 cut equal to current and flag nothing.
 *
 * The part that matters in a year is not here but in
 * tests/pipeline-version.test.mts, deliberately: a manifest nobody remembers
 * to bump is a signal that silently stops working, and the guard against that
 * has to live in the suite that GATES, not on the bug board, which scripts/qa
 * and scripts/test both count without failing on.
 *
 * Expected to FAIL until N2 is fixed.
 */

const ROOT = path.dirname(path.dirname(path.dirname(new URL(import.meta.url).pathname)));

test("N2: a cut built by the pre-E1 pipeline reads as behind", async () => {
  const lib = tempLibrary("n2");
  const work = path.join(lib, "projects", "n2", "work");
  const cuts = path.join(lib, "projects", "n2", "cuts");
  fs.mkdirSync(work, { recursive: true });
  fs.mkdirSync(cuts, { recursive: true });
  fs.writeFileSync(path.join(cuts, "cut.mp4"), "not really a video");
  // version 2 is what build_cut.py stamped for every render between
  // WORD_RESCUE and E1 -- exactly the state of img-9817 and img-9823.
  fs.writeFileSync(path.join(work, "pipeline.json"),
    JSON.stringify({ version: 2, built: "2026-09-10T00:00:00" }));

  const { isPipelineBehind } = await import("../../lib/cutFreshness.ts");
  assert.equal(isPipelineBehind("n2", "cut.mp4"), true,
    "a cut stamped with the pre-E1 pipeline must ask to be rebuilt");
});

test("N2: the bundle is rejected when the pipeline manifest is missing", () => {
  const verify = path.join(ROOT, "scripts", "verify-bundle.mjs");
  assert.ok(fs.existsSync(verify),
    "scripts/verify-bundle.mjs must exist -- nothing else checks what the bundler produced");

  // A bundle skeleton: everything a real one has except the manifest.
  // The skeleton is shared (tests/regressions/_fixture.mts) so that an
  // assertion added to verify-bundle for some other row cannot quietly turn
  // this fixture into an invalid bundle and redden a test about the manifest.
  const app = bundleSkeleton("n2");
  const res = path.join(app, "Contents", "Resources");
  fs.rmSync(path.join(res, "pipeline", "pipeline-version.json"));

  const run = () => {
    try {
      execFileSync(verify, [app], { cwd: ROOT, encoding: "utf8", stdio: "pipe" });
      return { code: 0, out: "" };
    } catch (e: any) {
      return { code: e.status ?? 1, out: `${e.stdout ?? ""}${e.stderr ?? ""}` };
    }
  };

  const missing = run();
  assert.notEqual(missing.code, 0,
    "a bundle with no pipeline-version.json must not pass verification");
  assert.match(missing.out, /pipeline-version\.json/,
    "and it must say which file is missing");

  fs.copyFileSync(path.join(ROOT, "ugc-edit-system", "pipeline-version.json"),
    path.join(res, "pipeline", "pipeline-version.json"));
  assert.equal(run().code, 0,
    "with the manifest in place and the tools matching the repo, it must pass");

  fs.rmSync(app, { recursive: true, force: true });
});

test("N2: the bundler verifies what it produced", () => {
  const src = fs.readFileSync(path.join(ROOT, "scripts", "bundle-app"), "utf8");
  assert.match(src, /pipeline-version\.json/,
    "bundle-app must copy the manifest -- it is tools/'s sibling, not inside it");
  assert.match(src, /verify-bundle\.mjs/,
    "bundle-app must end by verifying the bundle it just wrote");
});
