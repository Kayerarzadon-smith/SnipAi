import fs from "node:fs";
import path from "node:path";
import { TRASH_ROOT, PROJECTS_ROOT } from "./paths";

export const TRASH_DIR = TRASH_ROOT;
export const RETAIN_DAYS = 5;

/**
 * When a folder was deleted, from the stamp in its own name.
 *
 * NOT the directory mtime: that is when the folder last CHANGED, which for a
 * project untouched for a week is a week ago -- so an mtime-based expiry
 * would erase it the moment it was deleted, instead of five days later. The
 * name is written at delete time and is the only trustworthy record.
 */
export function deletedAtOf(id: string): number | null {
  const m = /-(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})$/.exec(id);
  if (!m) return null;
  const t = Date.parse(`${m[1]}T${m[2]}:${m[3]}:${m[4]}Z`);
  return Number.isFinite(t) ? t : null;
}

export type TrashedProject = {
  /** folder name in .trash, e.g. "img9817-2026-09-07T21-57-48" */
  id: string;
  project: string;
  deletedAt: string;
  /** whole days left before it's erased for good */
  daysLeft: number;
  bytes: number;
  hasRawFootage: boolean;
};

function dirBytes(dir: string): number {
  let n = 0;
  const walk = (d: string) => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const full = path.join(d, e.name);
      if (e.isDirectory()) walk(full);
      else if (e.isFile()) {
        try { n += fs.statSync(full).size; } catch { /* skip */ }
      }
    }
  };
  walk(dir);
  return n;
}

/**
 * Erase anything past its retention.
 *
 * Deleting means deleting -- the five days are a grace period, not storage.
 * Called whenever the trash is read, so it happens without needing a daemon,
 * and the deadline is computed from the folder's own timestamp rather than
 * anything that could drift.
 */
export function purgeExpired(now = Date.now()): string[] {
  if (!fs.existsSync(TRASH_DIR)) return [];
  const gone: string[] = [];
  for (const name of fs.readdirSync(TRASH_DIR)) {
    const full = path.join(TRASH_DIR, name);
    try {
      if (!fs.statSync(full).isDirectory()) continue;
      const at = deletedAtOf(name);
      // no readable stamp means we cannot know its age -- keep it rather than
      // guess, since guessing wrong here destroys footage
      if (at === null) continue;
      const ageDays = (now - at) / 86_400_000;
      if (ageDays >= RETAIN_DAYS) {
        fs.rmSync(full, { recursive: true, force: true });
        gone.push(name);
      }
    } catch {
      // a folder that can't be read is left alone rather than guessed at
    }
  }
  return gone;
}

export function listTrash(now = Date.now()): TrashedProject[] {
  purgeExpired(now);
  if (!fs.existsSync(TRASH_DIR)) return [];
  const out: TrashedProject[] = [];
  for (const id of fs.readdirSync(TRASH_DIR)) {
    const full = path.join(TRASH_DIR, id);
    try {
      if (!fs.statSync(full).isDirectory()) continue;
      const at = deletedAtOf(id) ?? fs.statSync(full).mtimeMs;
      const ageDays = (now - at) / 86_400_000;
      out.push({
        id,
        project: id.replace(/-\d{4}-\d{2}-\d{2}T[\d-]+$/, ""),
        deletedAt: new Date(at).toISOString(),
        daysLeft: Math.max(0, Math.ceil(RETAIN_DAYS - ageDays)),
        bytes: dirBytes(full),
        hasRawFootage: fs.existsSync(path.join(full, "raw")) &&
          fs.readdirSync(path.join(full, "raw")).some((f) => !f.startsWith(".")),
      });
    } catch {
      // skip
    }
  }
  return out.sort((a, b) => b.deletedAt.localeCompare(a.deletedAt));
}

/** Put one back. Fails rather than clobbering a project of the same name. */
export function restoreFromTrash(id: string): { ok: true; project: string } | { ok: false; error: string } {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(id)) return { ok: false, error: "invalid id" };
  const src = path.join(TRASH_DIR, id);
  if (!fs.existsSync(src)) return { ok: false, error: "that isn't in the trash any more" };
  const project = id.replace(/-\d{4}-\d{2}-\d{2}T[\d-]+$/, "");
  const dest = path.join(PROJECTS_ROOT, project);
  if (fs.existsSync(dest)) {
    return { ok: false, error: `a project called '${project}' already exists` };
  }
  fs.renameSync(src, dest);
  return { ok: true, project };
}

export function purgeOne(id: string): boolean {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(id)) return false;
  const dir = path.join(TRASH_DIR, id);
  if (!fs.existsSync(dir)) return false;
  fs.rmSync(dir, { recursive: true, force: true });
  return true;
}
