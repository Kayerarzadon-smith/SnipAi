import path from "node:path";
import fs from "node:fs";
import os from "node:os";

/**
 * Where things are.
 *
 * Two roots, and the distinction matters: CODE ships with the app and is
 * read-only once the app is signed; DATA is the footage and the edits, and
 * belongs to the person, not the app. They used to be the same directory,
 * which is fine for a repo you run from a terminal and impossible for an
 * app bundle.
 */

export const REPO_ROOT = process.cwd();

/* ---- code: the Python tools and their venv, shipped with the app -------- */
export const CODE_ROOT = path.join(REPO_ROOT, "ugc-edit-system");
export const TOOLS_ROOT = path.join(CODE_ROOT, "tools");
export const VENV_ROOT = path.join(CODE_ROOT, ".venv");

/* ---- data: footage, edits, learned rules -------------------------------- */

/** The default home for a person's work: visible in Finder, swept up by Time
 *  Machine, and somewhere you can reach your own 4K masters without going
 *  through the app. */
export const DEFAULT_DATA_ROOT = path.join(os.homedir(), "Movies", "SnipAi");

/**
 * SNIPAI_DATA wins, so a second copy of the app can be pointed at a test
 * library without touching the real one. Otherwise the standard location, if
 * the migration has run. Otherwise the old in-repo layout, so a checkout that
 * has not been migrated keeps working exactly as it did.
 */
function resolveDataRoot(): string {
  const env = process.env.SNIPAI_DATA?.trim();
  if (env) return path.resolve(env);
  if (fs.existsSync(path.join(DEFAULT_DATA_ROOT, "projects"))) return DEFAULT_DATA_ROOT;
  return CODE_ROOT;
}

export const DATA_ROOT = resolveDataRoot();
/** True while the data still lives inside the repo -- the pre-migration state. */
export const DATA_IS_LEGACY = DATA_ROOT === CODE_ROOT;

export const PROJECTS_ROOT = path.join(DATA_ROOT, "projects");
export const STATE_ROOT = path.join(DATA_ROOT, "state");
export const TRASH_ROOT = path.join(DATA_ROOT, ".trash");
export const REFERENCE_ROOT = path.join(DATA_ROOT, "reference");

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
