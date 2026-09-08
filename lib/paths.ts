import path from "node:path";
import fs from "node:fs";

export const REPO_ROOT = process.cwd();
export const PIPELINE_ROOT = path.join(REPO_ROOT, "ugc-edit-system");
export const PROJECTS_ROOT = path.join(PIPELINE_ROOT, "projects");
export const STATE_ROOT = path.join(PIPELINE_ROOT, "state");
export const TOOLS_ROOT = path.join(PIPELINE_ROOT, "tools");

/** A project name is a single path segment — no slashes, no traversal. */
export function assertValidProjectName(name: string): void {
  if (!/^[a-zA-Z0-9_-]+$/.test(name)) {
    throw new Error(`invalid project name: ${name}`);
  }
}

export function projectDir(name: string): string {
  assertValidProjectName(name);
  return path.join(PROJECTS_ROOT, name);
}

export function listProjectNames(): string[] {
  if (!fs.existsSync(PROJECTS_ROOT)) return [];
  return fs
    .readdirSync(PROJECTS_ROOT, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !d.name.startsWith("_"))
    .map((d) => d.name)
    .sort();
}

/**
 * Resolve a media path requested by the client against PROJECTS_ROOT and
 * verify the resolved path never escapes it (blocks ../ traversal and
 * symlink escapes).
 */
export function resolveMediaPath(relSegments: string[]): string {
  const rel = relSegments.join("/");
  const resolved = path.resolve(PROJECTS_ROOT, rel);
  const root = path.resolve(PROJECTS_ROOT) + path.sep;
  if (!resolved.startsWith(root)) {
    throw new Error("path escapes projects root");
  }
  return resolved;
}

export function ensureStateDir(): void {
  fs.mkdirSync(STATE_ROOT, { recursive: true });
}
