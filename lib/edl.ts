import fs from "node:fs";
import path from "node:path";
import { projectDir } from "./paths";
import type { EdlPiece } from "./timelineLayout";

/**
 * The edit list the last build wrote: which stretches of source it rendered,
 * in order, with the real duration of each piece.
 *
 * This is the difference between what the edit SAYS and what came out. A beat
 * running 8.0s to 12.0s is four seconds of line, but if the build dropped a
 * second of silence out of its middle, the file has three. Adding up beat
 * spans and calling that the cut length overstates every project that has any
 * interior silence removed -- which is all of them, because removing it is
 * what the app is for.
 *
 * The EDL describes a RENDER, so it is worthless without one: with no cut on
 * disk it is either left over from a build that was deleted, or from beats
 * that have since changed. Either way it would describe a file that is not
 * there, so it is not read.
 */
export function readEdl(project: string, hasCut: boolean): EdlPiece[] {
  if (!hasCut) return [];
  try {
    const parsed = JSON.parse(
      fs.readFileSync(path.join(projectDir(project), "work", "edl.json"), "utf8")
    );
    return Array.isArray(parsed) ? (parsed as EdlPiece[]) : [];
  } catch {
    // no build yet, or a malformed EDL: callers fall back to beat time
    return [];
  }
}
