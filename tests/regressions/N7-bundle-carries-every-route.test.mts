import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

/**
 * LEDGER N7 — the bundled server is missing a route and verify-bundle says it matches.
 *
 * Counted 2026-09-11: the repo has 24 `app/api/**\/route.ts`, `SnipAi.app` has
 * 23 compiled `route.js`, and the one that is not there is `api/health` --
 * which is the ENTIRE N1/P19 ownership mechanism. `LaunchDecision.swift:163`
 * polls a route its own bundled server 404s, so the check that stops a
 * sandboxed run from writing into ~/Movies/SnipAi is inert in the artifact
 * Kayer actually opens. M0.6's exit line could never have been met.
 *
 * `verify-bundle.mjs` reported that half as matching, because its server
 * assertion was presence-only: `server/server.js` exists, therefore fine.
 *
 * Note what does NOT work here. The marker-string idea -- `grep -rl faststart
 * Contents/Resources/server` -- was proposed for T5 and would have PASSED the
 * broken bundle sitting on disk on 2026-09-11: that string does hit, in
 * `.next/server/chunks/194.js`. A marker proves some code made it in. Only an
 * inventory proves that a SPECIFIC route did.
 *
 * Digesting the server output is still off the table -- Next's build is not
 * byte-reproducible and that check would cry wolf every run. Counting routes
 * is the cheap assertion in between.
 *
 * Also unasserted before this row, and therefore shippable-empty: the bundled
 * CPython, ffmpeg, and `.next/static`. A bundle with no interpreter, no
 * ffmpeg and no stylesheets passed verification.
 *
 * Expected to FAIL until N7 is fixed.
 */

const ROOT = path.dirname(path.dirname(path.dirname(new URL(import.meta.url).pathname)));
const VERIFY = path.join(ROOT, "scripts", "verify-bundle.mjs");

/** Every `app/api/**\/route.ts` in the repo, as a route path like `api/health`. */
function repoRoutes(): string[] {
  const out: string[] = [];
  const walk = (dir: string, rel: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.isDirectory()) walk(path.join(dir, e.name), path.posix.join(rel, e.name));
      else if (e.name === "route.ts") out.push(rel);
    }
  };
  walk(path.join(ROOT, "app", "api"), "api");
  return out.sort();
}

/**
 * A bundle skeleton that passes every check verify-bundle had BEFORE this row:
 * the launcher pieces, the manifest, byte-identical tools. Everything the
 * new assertions are about is added by the caller, so each one can be
 * removed in isolation and blamed by name.
 */
function skeleton(): string {
  const app = fs.mkdtempSync(path.join(os.tmpdir(), "snipai-bundle-n7-"));
  const res = path.join(app, "Contents", "Resources");
  fs.mkdirSync(path.join(res, "server"), { recursive: true });
  fs.mkdirSync(path.join(app, "Contents", "MacOS"), { recursive: true });
  for (const f of ["Contents/Info.plist", "Contents/MacOS/SnipAi",
                   "Contents/Resources/node", "Contents/Resources/server/server.js"]) {
    fs.writeFileSync(path.join(app, f), "");
  }
  fs.cpSync(path.join(ROOT, "ugc-edit-system", "tools"),
    path.join(res, "pipeline", "tools"), { recursive: true });
  fs.copyFileSync(path.join(ROOT, "ugc-edit-system", "pipeline-version.json"),
    path.join(res, "pipeline", "pipeline-version.json"));

  // the three pieces nothing asserted: interpreter, ffmpeg, stylesheets
  fs.mkdirSync(path.join(res, "pipeline", "python", "bin"), { recursive: true });
  fs.writeFileSync(path.join(res, "pipeline", "python", "bin", "python3"), "");
  fs.mkdirSync(path.join(res, "pipeline", "bin"), { recursive: true });
  fs.writeFileSync(path.join(res, "pipeline", "bin", "ffmpeg"), "");
  fs.mkdirSync(path.join(res, "server", ".next", "static", "chunks"), { recursive: true });
  fs.writeFileSync(path.join(res, "server", ".next", "static", "chunks", "main.js"), "");

  // and the compiled routes, one per repo route
  for (const r of repoRoutes()) {
    const d = path.join(res, "server", ".next", "server", "app", r);
    fs.mkdirSync(d, { recursive: true });
    fs.writeFileSync(path.join(d, "route.js"), "");
  }
  return app;
}

function run(app: string): { code: number; out: string } {
  try {
    execFileSync(VERIFY, [app], { cwd: ROOT, encoding: "utf8", stdio: "pipe" });
    return { code: 0, out: "" };
  } catch (e: any) {
    return { code: e.status ?? 1, out: `${e.stdout ?? ""}${e.stderr ?? ""}` };
  }
}

test("N7: a complete bundle skeleton still passes", () => {
  const app = skeleton();
  const r = run(app);
  assert.equal(r.code, 0,
    `a skeleton with every route, the manifest, the tools, python, ffmpeg and ` +
    `static must pass -- otherwise the tests below prove nothing:\n${r.out}`);
  fs.rmSync(app, { recursive: true, force: true });
});

test("N7: a bundle missing /api/health is rejected and named", () => {
  const app = skeleton();
  const health = path.join(app, "Contents", "Resources", "server",
    ".next", "server", "app", "api", "health");
  assert.ok(fs.existsSync(path.join(health, "route.js")),
    "the repo must have app/api/health/route.ts for this test to mean anything");
  fs.rmSync(health, { recursive: true, force: true });

  const r = run(app);
  assert.notEqual(r.code, 0,
    "a bundle whose server cannot answer /api/health must not pass verification -- " +
    "that route IS the N1/P19 ownership check");
  assert.match(r.out, /api\/health/,
    "and it must name the missing route, not just say the server is wrong");
  fs.rmSync(app, { recursive: true, force: true });
});

test("N7: the marker-string check this replaces would have passed the broken bundle", () => {
  // Not a check of our code -- a check of the REASONING. Kept as a test so the
  // marker-string idea cannot be reintroduced as "cheaper and just as good".
  const app = skeleton();
  const chunks = path.join(app, "Contents", "Resources", "server", ".next", "server", "chunks");
  fs.mkdirSync(chunks, { recursive: true });
  fs.writeFileSync(path.join(chunks, "194.js"), "'-movflags','+faststart'");
  fs.rmSync(path.join(app, "Contents", "Resources", "server",
    ".next", "server", "app", "api", "health"), { recursive: true, force: true });

  const marker = fs.readFileSync(path.join(chunks, "194.js"), "utf8").includes("faststart");
  assert.ok(marker, "the faststart marker hits even with /api/health absent");
  assert.notEqual(run(app).code, 0, "the inventory catches what the marker does not");
  fs.rmSync(app, { recursive: true, force: true });
});

test("N7: python, ffmpeg and .next/static are each asserted", () => {
  for (const [rel, why] of [
    ["Contents/Resources/pipeline/python/bin/python3", "no interpreter"],
    ["Contents/Resources/pipeline/bin/ffmpeg", "no ffmpeg"],
    ["Contents/Resources/server/.next/static", "no stylesheets"],
  ]) {
    const app = skeleton();
    fs.rmSync(path.join(app, rel), { recursive: true, force: true });
    const r = run(app);
    assert.notEqual(r.code, 0, `a bundle with ${why} must not pass verification`);
    assert.ok(r.out.includes(rel) || r.out.includes(path.basename(rel)),
      `and it must name ${rel}; it said:\n${r.out}`);
    fs.rmSync(app, { recursive: true, force: true });
  }
});
