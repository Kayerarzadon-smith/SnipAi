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
