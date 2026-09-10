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

/**
 * The same list, for the timeline — which is asking a different question.
 *
 * The Queue card sits next to a filename and reports how long THAT FILE is, so
 * it wants the EDL as written even when the edit has moved on; the card says
 * "that file was rendered before your latest edit" beside it. The timeline is
 * the surface you edit on, so it has to show the EDIT. On a project where the
 * two have diverged those are different numbers, and both are right.
 *
 * Pieces record the beat they were cut from — but only since build_cut started
 * writing of_start/of_end, and layout() compares them per beat where it can.
 * Without that field there is no way to tell a piece that still describes its
 * beat from one left over from before the beat was edited, and no measurement
 * separates them: a healthy beat can render at 0.15 of its span, which is
 * lower than the fragment that caused the bug.
 *
 * So for an older EDL the question is answered once, coarsely: if the edit has
 * been touched since this was written, none of it can be trusted to describe
 * the edit. That is the same choice layout() makes for a piece that no longer
 * fits, made with less information, and it errs toward showing the edit rather
 * than the last render. It corrects itself at the next build, which an edit
 * schedules anyway.
 */
export function readEdlForTimeline(project: string, hasCut: boolean): EdlPiece[] {
  const pieces = readEdl(project, hasCut);
  if (!pieces.length) return pieces;
  if (pieces.some((p) => typeof p.of_start === "number")) return pieces;
  try {
    const dir = projectDir(project);
    const built = fs.statSync(path.join(dir, "work", "edl.json")).mtimeMs;
    const edited = fs.statSync(path.join(dir, "beats.json")).mtimeMs;
    if (edited > built) return [];
  } catch {
    // no stat, no claim
  }
  return pieces;
}
