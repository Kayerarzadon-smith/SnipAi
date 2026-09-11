#!/usr/bin/env -S node --no-warnings=MODULE_TYPELESS_PACKAGE_JSON
/**
 * Does SnipAi.app contain what the repo says it should?
 *
 *   ./scripts/verify-bundle.mjs [path/to/SnipAi.app]
 *
 * Nothing used to ask. bundle-app assembled an artifact, printed some sizes,
 * and that was the end of it -- so on 2026-09-10 the app Kayer opens was three
 * days behind the repo and three separate fixes (E1, S18, S19) were all green
 * in the suite and all absent from the thing he was running (ledger T5).
 *
 * The specific miss this was written for is smaller and worse: `cp -a
 * ugc-edit-system/tools pipeline/tools` copies the tools and not
 * pipeline-version.json, which is that directory's SIBLING. So the packaged
 * server read no manifest, currentPipelineVersion() returned 0, and the
 * "Rebuild -- the cutting has improved" badge could never fire in the only
 * build that matters (ledger N2). A one-line omission, invisible for as long
 * as nobody looked.
 *
 * What is checked and what is not: the pipeline half is checked by content --
 * every file in the bundle's tools/ must be byte-identical to the repo's, and
 * the manifest must be present and agree. The server half is checked by
 * INVENTORY, not by content: Next's output is not reproducible byte-for-byte,
 * so a digest of it would be a check that cries wolf, but "which routes
 * compiled" is stable and is exactly the thing that went wrong.
 *
 * It went wrong on 2026-09-11 (ledger N7). The repo had 24 `app/api/(**)/route.ts`
 * and the bundle had 23 `route.js`; the missing one was `api/health`, which is
 * the whole N1/P19 server-ownership mechanism. `LaunchDecision.swift:163`
 * polled a route its own bundled server 404s, so the check that keeps a
 * sandboxed run out of ~/Movies/SnipAi was inert in the only build Kayer
 * opens -- while the ledger recorded it as fixed. This script said the bundle
 * matched, because its server assertion was `server/server.js` exists.
 *
 * The marker-string idea that was proposed for T5 -- `grep -rl faststart
 * Contents/Resources/server` -- is deliberately NOT what this does, because it
 * was measured against the broken bundle and PASSED it: that string hits in
 * `.next/server/chunks/194.js` whether or not /api/health compiled. A marker
 * proves some code got in. An inventory proves a named route did.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { digestTools, readManifest, MANIFEST_NAME } from "../lib/pipelineVersion.ts";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const APP = path.resolve(process.argv[2] ?? path.join(ROOT, "SnipAi.app"));
const RES = path.join(APP, "Contents", "Resources");
const CODE_ROOT = path.join(ROOT, "ugc-edit-system");

const RED = "[31m", GRN = "[32m", DIM = "[2m", OFF = "[0m";
const problems = [];
const bad = (m) => problems.push(m);

if (!fs.existsSync(APP)) {
  console.error(`${RED}no bundle at ${APP}${OFF}`);
  process.exit(1);
}

/* ---- the pieces that make it a runnable app ---------------------------- */
// Each of the last three was unasserted until N7: a bundle with no
// interpreter, no ffmpeg and no stylesheets passed verification, and each of
// those is a silent, total failure of a different half of the app.
for (const [rel, what] of [
  ["Contents/Info.plist", "the launcher will not open without it"],
  ["Contents/MacOS/SnipAi", "no launcher binary"],
  ["Contents/Resources/node", "no Node runtime"],
  ["Contents/Resources/server/server.js", "no standalone server"],
  ["Contents/Resources/pipeline/tools", "no pipeline tools"],
  ["Contents/Resources/pipeline/python/bin/python3", "no interpreter -- every pipeline run fails"],
  ["Contents/Resources/pipeline/bin/ffmpeg", "no ffmpeg -- nothing can be cut or exported"],
  ["Contents/Resources/server/.next/static", "no static assets -- the app loads unstyled"],
]) {
  if (!fs.existsSync(path.join(APP, rel))) bad(`missing ${rel} -- ${what}`);
}

/* ---- the server, by route inventory: N7 -------------------------------- */
// Not by digest (Next is not byte-reproducible) and not by marker string (that
// approach was measured against the broken bundle and passed it). By name:
// every route the repo declares must have compiled into the bundle.
const API_SRC = path.join(ROOT, "app", "api");
const API_OUT = path.join(RES, "server", ".next", "server", "app", "api");

const collect = (dir, rel, leaf, out) => {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) collect(path.join(dir, e.name), path.posix.join(rel, e.name), leaf, out);
    else if (e.name === leaf) out.push(rel);
  }
  return out;
};

const srcRoutes = collect(API_SRC, "api", "route.ts", []).sort();
const outRoutes = collect(API_OUT, "api", "route.js", []).sort();

if (!srcRoutes.length) {
  bad(`no app/api/**/route.ts found in the repo -- this check cannot mean anything`);
} else if (!fs.existsSync(API_OUT)) {
  bad(`the bundled server has no compiled routes at all ` +
      `(Contents/Resources/server/.next/server/app/api) -- the repo declares ${srcRoutes.length}`);
} else {
  const have = new Set(outRoutes);
  for (const r of srcRoutes) {
    if (!have.has(r)) {
      bad(`/${r} is in the repo and did not compile into the bundle -- ` +
          `the packaged server will 404 it`);
    }
  }
  // The other direction is a stale bundle, not a broken build: a route that was
  // deleted from the repo and is still being served out of the .app.
  const want = new Set(srcRoutes);
  for (const r of outRoutes) {
    if (!want.has(r)) bad(`/${r} is in the bundle and not in the repo -- this bundle is stale`);
  }
}

/* ---- the pipeline manifest: N2, the reason this script exists ----------- */
const bundlePipeline = path.join(RES, "pipeline");
const bundleManifestPath = path.join(bundlePipeline, MANIFEST_NAME);
const repoManifest = readManifest(CODE_ROOT);

if (!fs.existsSync(bundleManifestPath)) {
  bad(`missing Contents/Resources/pipeline/${MANIFEST_NAME} -- the packaged app ` +
      `cannot tell an old cut from a current one, so the "cutting has improved" badge is dead`);
} else {
  const bundled = readManifest(bundlePipeline);
  if (!bundled) {
    bad(`Contents/Resources/pipeline/${MANIFEST_NAME} is not readable JSON`);
  } else if (!repoManifest) {
    bad(`the repo has no readable ${MANIFEST_NAME} to compare against`);
  } else if (Number(bundled.version) !== Number(repoManifest.version)) {
    bad(`bundled pipeline version ${bundled.version} but the repo is at ${repoManifest.version} ` +
        `-- this bundle was built from older code`);
  }
}

/* ---- the tools themselves, by content ---------------------------------- */
const repoTools = digestTools(path.join(CODE_ROOT, "tools"));
const bundleTools = digestTools(path.join(bundlePipeline, "tools"));
for (const [name, hash] of Object.entries(repoTools)) {
  if (!(name in bundleTools)) bad(`tools/${name} is in the repo and not in the bundle`);
  else if (bundleTools[name] !== hash) bad(`tools/${name} in the bundle is not the repo's version`);
}
for (const name of Object.keys(bundleTools)) {
  if (!(name in repoTools)) bad(`tools/${name} is in the bundle and not in the repo`);
}

if (problems.length) {
  console.error(`${RED}the bundle does not match the repo:${OFF}`);
  for (const p of problems) console.error(`  ${RED}${p}${OFF}`);
  console.error(`  ${DIM}rebuild it: ./scripts/bundle-app${OFF}`);
  process.exit(1);
}

console.log(`${GRN}bundle matches the repo${OFF} ${DIM}(pipeline v${repoManifest?.version}, ` +
            `${Object.keys(repoTools).length} tools identical, ${srcRoutes.length} API routes compiled)${OFF}`);
