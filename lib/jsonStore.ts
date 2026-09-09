import fs from "node:fs";
import path from "node:path";

/** The one on-disk form, so a comparison against the file is exact. */
export function serialize(data: unknown): string {
  return JSON.stringify(data, null, 2) + "\n";
}

/** Would writing this change the file? Used to skip no-op writes, which would
 *  otherwise churn the mtime and fill the snapshot history with duplicates of
 *  a state nobody edited. */
export function wouldChange(filePath: string, data: unknown): boolean {
  try {
    return fs.readFileSync(filePath, "utf8") !== serialize(data);
  } catch {
    return true;                       // missing or unreadable: writing changes it
  }
}

/** Atomic JSON write: write to a temp file then rename, so a crash mid-write
 * never leaves a corrupt file behind. */
export function writeJsonAtomic(filePath: string, data: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmp, serialize(data));
  fs.renameSync(tmp, filePath);
}

export function readJson<T>(filePath: string, fallback: T): T {
  if (!fs.existsSync(filePath)) return fallback;
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8")) as T;
  } catch {
    return fallback;
  }
}

/**
 * Read JSON, telling "there is no file" apart from "the file is broken".
 *
 * `readJson` collapses both into the fallback, and that is fine for a cache.
 * It is not fine for a file holding decisions a person made: `loadReviewState`
 * returned bare defaults for an unparseable file, and the very next
 * `updateReviewState` wrote those defaults back over it. Every take pick,
 * trim, cut region, deleted-line record and diagnosis, gone, with nothing on
 * screen to say so -- and the file that held them overwritten, so there was
 * nothing left to recover from either.
 */
export function readJsonChecked<T>(filePath: string):
  { state: "missing" } | { state: "ok"; value: T } | { state: "broken"; why: string } {
  if (!fs.existsSync(filePath)) return { state: "missing" };
  let text: string;
  try { text = fs.readFileSync(filePath, "utf8"); }
  catch (e) { return { state: "broken", why: (e as Error).message }; }
  let parsed: unknown;
  try { parsed = JSON.parse(text); }
  catch (e) { return { state: "broken", why: (e as Error).message }; }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { state: "broken", why: "not a JSON object" };
  }
  return { state: "ok", value: parsed as T };
}

/** Move a file that cannot be read out of the way, keeping it. Returns where
 *  it went, so the person can be told rather than left guessing. */
export function preserveCorrupt(filePath: string): string | null {
  try {
    const to = `${filePath}.corrupt-${new Date().toISOString().replace(/[:.]/g, "-")}`;
    fs.renameSync(filePath, to);
    return to;
  } catch {
    return null;
  }
}
