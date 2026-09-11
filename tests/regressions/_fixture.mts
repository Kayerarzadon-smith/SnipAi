import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * A throwaway SnipAi library.
 *
 * lib/paths.ts reads SNIPAI_DATA once, at import. So every regression test
 * sets it up here BEFORE its first `await import(...)` of an app module, and
 * imports dynamically rather than at the top of the file. Get that order
 * wrong and the test writes into the real ~/Movies/SnipAi.
 */
export function tempLibrary(project = "fixture", beats: unknown[] = []): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "snipai-qa-"));
  fs.mkdirSync(path.join(root, "projects", project), { recursive: true });
  fs.mkdirSync(path.join(root, "state"), { recursive: true });
  fs.writeFileSync(
    path.join(root, "projects", project, "beats.json"),
    JSON.stringify({ source: "source.mov", beats }, null, 2)
  );
  process.env.SNIPAI_DATA = root;
  return root;
}

export function readBeats(root: string, project = "fixture"): { beats: any[] } {
  return JSON.parse(fs.readFileSync(path.join(root, "projects", project, "beats.json"), "utf8"));
}

const ROOT = path.dirname(path.dirname(path.dirname(new URL(import.meta.url).pathname)));

/** Every `app/api/(**)/route.ts` in the repo, as a route path like `api/health`. */
export function repoApiRoutes(): string[] {
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
 * A bundle skeleton that `scripts/verify-bundle.mjs` accepts: every piece it
 * asserts, and nothing more.
 *
 * This lives here, shared, for a reason. It used to be inline in N2's test,
 * so when N7 added four new assertions to verify-bundle (routes, python,
 * ffmpeg, static) N2's fixture silently became an invalid bundle and its
 * "with the manifest in place it must pass" half went red -- a passing test
 * broken by a change it has no opinion about. One definition means the next
 * assertion added to verify-bundle is a one-line edit here, and every bundle
 * test keeps testing its own variable with all else equal.
 *
 * Caller deletes exactly the piece it wants to be missing.
 */
export function bundleSkeleton(tag = "bundle"): string {
  const app = fs.mkdtempSync(path.join(os.tmpdir(), `snipai-${tag}-`));
  const res = path.join(app, "Contents", "Resources");
  fs.mkdirSync(path.join(res, "server"), { recursive: true });
  fs.mkdirSync(path.join(app, "Contents", "MacOS"), { recursive: true });
  for (const f of ["Contents/Info.plist", "Contents/MacOS/SnipAi",
                   "Contents/Resources/node", "Contents/Resources/server/server.js"]) {
    fs.writeFileSync(path.join(app, f), "");
  }

  // the pipeline: tools byte-identical to the repo, plus their manifest
  fs.cpSync(path.join(ROOT, "ugc-edit-system", "tools"),
    path.join(res, "pipeline", "tools"), { recursive: true });
  fs.copyFileSync(path.join(ROOT, "ugc-edit-system", "pipeline-version.json"),
    path.join(res, "pipeline", "pipeline-version.json"));

  // interpreter, ffmpeg, stylesheets
  fs.mkdirSync(path.join(res, "pipeline", "python", "bin"), { recursive: true });
  fs.writeFileSync(path.join(res, "pipeline", "python", "bin", "python3"), "");
  fs.mkdirSync(path.join(res, "pipeline", "bin"), { recursive: true });
  fs.writeFileSync(path.join(res, "pipeline", "bin", "ffmpeg"), "");
  fs.mkdirSync(path.join(res, "server", ".next", "static", "chunks"), { recursive: true });
  fs.writeFileSync(path.join(res, "server", ".next", "static", "chunks", "main.js"), "");

  // one compiled route per route the repo declares
  for (const r of repoApiRoutes()) {
    const d = path.join(res, "server", ".next", "server", "app", r);
    fs.mkdirSync(d, { recursive: true });
    fs.writeFileSync(path.join(d, "route.js"), "");
  }
  return app;
}

/** Next route handlers are ordinary functions over Request. */
export function req(body: unknown, method = "PATCH"): any {
  return new Request("http://127.0.0.1:4737/test", {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}
