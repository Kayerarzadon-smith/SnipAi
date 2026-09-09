import fs from "node:fs";
import path from "node:path";
import { projectDir } from "./paths";

/**
 * Does the rendered file still describe the edit?
 *
 * A render is a snapshot. Edit anything afterwards and the file on disk is a
 * video of a previous decision -- and the Queue was presenting exactly that as
 * "Approved · Ready to post", pairing the new beat count with the old file. A
 * person following the app's own signals would have posted a video still
 * containing the line they deleted.
 *
 * This used to be read off the trim log, which only knows about trims. Delete
 * a line, split one, reorder, undo, put a version back -- none of those are
 * trims, so none of them made the cut look stale. That is why QA saw the
 * warning on one project and not on another whose file disagreed just as
 * badly: the second one's edit had been a delete.
 *
 * Every edit rewrites beats.json, and a no-op edit does not (saveBeats
 * declines to write when nothing changed), so the file's own timestamp
 * answers the question for every kind of edit at once, including ones nobody
 * has thought of yet. The build does not write beats.json, so rendering
 * always leaves the cut newer than the edit.
 */
export function isCutStale(project: string, cutFile: string | null): boolean {
  if (!cutFile) return false;          // nothing rendered is not the same as out of date
  try {
    const dir = projectDir(project);
    const built = fs.statSync(path.join(dir, "cuts", cutFile)).mtimeMs;
    const edited = fs.statSync(path.join(dir, "beats.json")).mtimeMs;
    return edited > built;
  } catch {
    return false;                      // no stat, no claim
  }
}
