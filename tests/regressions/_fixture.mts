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

/** Next route handlers are ordinary functions over Request. */
export function req(body: unknown, method = "PATCH"): any {
  return new Request("http://127.0.0.1:4737/test", {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}
