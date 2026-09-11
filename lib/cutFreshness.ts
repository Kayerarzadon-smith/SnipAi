import fs from "node:fs";
import path from "node:path";
import { projectDir, CODE_ROOT } from "./paths";
import { versionStatus, type VersionStatus } from "./pipelineVersion";

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

/**
 * Was this file rendered by an older pipeline than the one installed?
 *
 * isCutStale answers "does the file match the EDIT". This answers the other
 * half: the edit can be untouched and the file still wrong, because the
 * CUTTING changed underneath it. Both of Kayer's cuts were built before
 * WORD_RESCUE (10ab9c3) and still carry the two clipped consonants that fix
 * removed -- and nothing on screen said so, so the Queue offered them and a
 * tester measuring them files a bug that is already fixed.
 *
 * The build stamps work/pipeline.json with the version it ran; the current
 * version ships beside the pipeline in pipeline-version.json. A build with no
 * stamp is a build from before stamping existed, which is by definition older
 * -- so absence reads correctly and no project has to be migrated.
 */
export function pipelineVersion(): VersionStatus {
  return versionStatus(CODE_ROOT);
}

/**
 * "We could not read the manifest" is a different answer from "nothing is
 * stale", and for a year the code gave the second when it meant the first.
 *
 * The bundle shipped no pipeline-version.json -- bundle-app copied tools/ and
 * the manifest is that directory's sibling -- so inside the .app this
 * returned 0 and isPipelineBehind answered false to every question. The badge
 * was off, permanently and quietly, at the exact moment both of Kayer's cuts
 * were behind. Still returning false is right: a manifest we cannot read is
 * no grounds for telling someone to re-render 500MB. Being silent about it is
 * not. Said once per process, because this is read on every dashboard load.
 */
let announcedUnknown = false;
function currentPipelineVersion(): number {
  const status = pipelineVersion();
  if (!status.ok && !announcedUnknown) {
    announcedUnknown = true;
    console.warn(
      `[cutFreshness] ${status.reason} -- the "cutting has improved" badge cannot fire. ` +
      `This is what a bundle missing its pipeline manifest looks like (ledger N2).`
    );
  }
  return status.version;
}

function builtPipelineVersion(project: string): number {
  try {
    const raw = fs.readFileSync(path.join(projectDir(project), "work", "pipeline.json"), "utf8");
    const v = Number(JSON.parse(raw).version);
    return Number.isFinite(v) ? v : 0;
  } catch {
    return 0;                          // unstamped: built before this existed
  }
}

export function isPipelineBehind(project: string, cutFile: string | null): boolean {
  if (!cutFile) return false;          // nothing rendered cannot be out of date
  const current = currentPipelineVersion();
  if (current <= 0) return false;      // we do not know, so we do not say
  return builtPipelineVersion(project) < current;
}
