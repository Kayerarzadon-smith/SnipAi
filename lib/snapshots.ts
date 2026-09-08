import fs from "node:fs";
import path from "node:path";
import { projectDir } from "./paths";

/**
 * A copy of the edit, taken before anything changes it.
 *
 * beats.json is the edit. Everything else in a project is either the raw
 * footage (never written) or derived and rebuildable (peaks, filmstrips,
 * proxies, cuts). So the whole of what a person can lose is one small JSON
 * file -- which makes keeping a history of it cheap enough to do on every
 * single write, with no thought about which writes "deserve" one.
 *
 * This exists because the in-app undo stack lives in memory and dies with the
 * page: reload, restart, or a bad write from anywhere that isn't the review
 * screen, and there is nothing to go back to. A file on disk survives all of
 * those.
 */

const DIRNAME = ".snapshots";
/** Enough to walk back through a session's worth of edits without unbounded
 *  growth. At roughly 6KB a copy this is single-digit megabytes at worst. */
export const KEEP = 60;

export type Snapshot = {
  /** file name, which is also the sort key */
  id: string;
  takenAt: string;
  reason: string;
  bytes: number;
  /** What this version IS, not what the edit was called. Two trims of the
   *  same line a second apart carry the same reason and the same clock time;
   *  without this you cannot tell which one you are going back to, which is
   *  the only question the list exists to answer. */
  beats: number;
  duration: number;
};

export function snapshotDir(project: string): string {
  return path.join(projectDir(project), DIRNAME);
}

/** Timestamps go in the NAME, not the mtime: a copy operation sets mtime to
 *  now, so mtime cannot tell you when an edit happened. Same lesson the trash
 *  expiry taught -- see deletedAtOf in trash.ts. */
function stamp(at: Date): string {
  return at.toISOString().replace(/[:.]/g, "-").replace(/Z$/, "");
}

/**
 * Filesystem-safe, and short enough to read in a list.
 *
 * Spaces become underscores rather than hyphens so that hyphens in the reason
 * survive: beat labels are full of them, and "cut a hole in need-egf" read
 * back as "cut a hole in need egf" is a different sentence about a beat that
 * does not exist.
 */
function slug(reason: string): string {
  return (reason || "edit")
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "_")
    .replace(/^[_-]+|[_-]+$/g, "")
    .slice(0, 48) || "edit";
}

const NAME_RE = /^(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3})__([a-z0-9_-]+)\.json$/;

function parseName(name: string): { takenAt: string; reason: string } | null {
  const m = NAME_RE.exec(name);
  if (!m) return null;
  // 2026-09-08T04-15-20-650 -> 2026-09-08T04:15:20.650Z
  const iso = m[1].replace(
    /T(\d{2})-(\d{2})-(\d{2})-(\d{3})$/,
    (_, h, mi, s, ms) => `T${h}:${mi}:${s}.${ms}Z`
  );
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  return { takenAt: new Date(t).toISOString(), reason: m[2].replace(/_/g, " ") };
}

/**
 * Copy beats.json aside before it is written.
 *
 * Never throws. A failed snapshot must not stop the edit the person actually
 * asked for -- losing the safety net is bad, refusing to work is worse.
 * Returns the snapshot id, or null if there was nothing to copy.
 */
export function takeSnapshot(project: string, reason: string): string | null {
  try {
    const src = path.join(projectDir(project), "beats.json");
    if (!fs.existsSync(src)) return null;
    const body = fs.readFileSync(src, "utf8");

    const dir = snapshotDir(project);
    fs.mkdirSync(dir, { recursive: true });

    // An edit that changed nothing is not worth a copy, and a burst of them
    // would push real history out of the window.
    const latest = list(project)[0];
    if (latest) {
      try {
        if (fs.readFileSync(path.join(dir, latest.id), "utf8") === body) return null;
      } catch {
        /* unreadable: fall through and take a fresh one */
      }
    }

    const name = `${stamp(new Date())}__${slug(reason)}.json`;
    fs.writeFileSync(path.join(dir, name), body);
    prune(project);
    return name;
  } catch {
    return null;
  }
}

type Summary = { beats: number; duration: number };

/** How long the edit in this file runs, holes taken out. */
function summarise(body: string): Summary {
  try {
    const parsed = JSON.parse(body) as {
      beats?: { start: number; end: number; holes?: [number, number][] }[];
    };
    const beats = parsed.beats ?? [];
    let dur = 0;
    for (const b of beats) {
      dur += Math.max(0, b.end - b.start);
      for (const [f, t] of b.holes ?? []) dur -= Math.max(0, Math.min(t, b.end) - Math.max(f, b.start));
    }
    return { beats: beats.length, duration: Math.round(dur * 10) / 10 };
  } catch {
    return { beats: 0, duration: 0 };
  }
}

/** Newest first. Anything that isn't a snapshot name is ignored rather than
 *  guessed at. Each file is read to summarise it -- they are a few KB and
 *  capped at KEEP, so this stays in the low milliseconds. */
export function list(project: string): Snapshot[] {
  const dir = snapshotDir(project);
  if (!fs.existsSync(dir)) return [];
  const out: Snapshot[] = [];
  for (const name of fs.readdirSync(dir)) {
    const parsed = parseName(name);
    if (!parsed) continue;
    const full = path.join(dir, name);
    let bytes = 0;
    let sum: Summary = { beats: 0, duration: 0 };
    try {
      bytes = fs.statSync(full).size;
      sum = summarise(fs.readFileSync(full, "utf8"));
    } catch { continue; }
    out.push({ id: name, takenAt: parsed.takenAt, reason: parsed.reason, bytes, ...sum });
  }
  return out.sort((a, b) => (a.id < b.id ? 1 : -1));
}

/** Drop the oldest beyond KEEP. */
export function prune(project: string, keep = KEEP): string[] {
  const all = list(project);
  const dropped: string[] = [];
  for (const s of all.slice(keep)) {
    try {
      fs.unlinkSync(path.join(snapshotDir(project), s.id));
      dropped.push(s.id);
    } catch {
      /* already gone */
    }
  }
  return dropped;
}

/**
 * Put one back.
 *
 * Snapshots the current state first, under "before restore", so restoring to
 * the wrong point is itself undoable -- otherwise the recovery tool is the
 * one operation with no way back.
 */
export function restore(project: string, id: string): string {
  if (!NAME_RE.test(id)) throw new Error("not a snapshot name");
  const src = path.join(snapshotDir(project), id);
  if (!fs.existsSync(src)) throw new Error(`no snapshot '${id}'`);
  const body = fs.readFileSync(src, "utf8");
  // must parse, or "restore" would install a broken beats.json
  JSON.parse(body);
  takeSnapshot(project, "before restore");
  const dest = path.join(projectDir(project), "beats.json");
  const tmp = `${dest}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmp, body);
  fs.renameSync(tmp, dest);
  return id;
}
