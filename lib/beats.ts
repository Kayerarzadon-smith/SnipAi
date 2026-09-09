import fs from "node:fs";
import path from "node:path";
import { projectDir } from "./paths";
import { writeJsonAtomic, wouldChange } from "./jsonStore";
import { takeSnapshot } from "./snapshots";
import type { BeatsFile } from "./types";

export function beatsPath(project: string): string {
  return path.join(projectDir(project), "beats.json");
}

/**
 * Read the edit, or say why it cannot be read.
 *
 * `null` used to be the answer to "no such project" only, and anything else
 * threw: a bare JSON.parse with a cast on the end. beats.json is the edit,
 * it is a file Kayer opens by hand, and every route plus the dashboard's
 * summary calls this -- so one stray comma in one project threw out of
 * summarizeAllProjects, 500'd /api/projects, and emptied the whole queue.
 * Every project, because of one file.
 *
 * The cast was the other half: `{"beats": null}` parsed happily and handed
 * back a document whose `beats` is not a list, and the TypeError surfaced
 * somewhere else entirely, at a .map() four calls away.
 */
export function readBeats(project: string):
  { ok: true; data: BeatsFile } | { ok: false; missing: true } | { ok: false; missing: false; why: string } {
  const p = beatsPath(project);
  if (!fs.existsSync(p)) return { ok: false, missing: true };
  let text: string;
  try { text = fs.readFileSync(p, "utf8"); }
  catch (e) { return { ok: false, missing: false, why: `could not read beats.json: ${(e as Error).message}` }; }
  let parsed: unknown;
  try { parsed = JSON.parse(text); }
  catch (e) { return { ok: false, missing: false, why: `beats.json is not valid JSON: ${(e as Error).message}` }; }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { ok: false, missing: false, why: "beats.json is not an object" };
  }
  const doc = parsed as Partial<BeatsFile>;
  if (!Array.isArray(doc.beats)) {
    return { ok: false, missing: false, why: "beats.json has no list of beats" };
  }
  return { ok: true, data: doc as BeatsFile };
}

/** The edit, or null if there isn't one that can be read. Callers that want
 *  to tell "no project" from "broken project" apart use readBeats. */
export function loadBeats(project: string): BeatsFile | null {
  const r = readBeats(project);
  return r.ok ? r.data : null;
}

/**
 * Write the edit.
 *
 * Every path that changes a beat goes through here, which makes this the one
 * place worth putting the safety net: a copy of the previous state is taken
 * first, on every write, with no judgement about which edits are risky. The
 * expensive lesson was that the risky ones are never the ones you expect.
 */
export function saveBeats(project: string, data: BeatsFile, reason = "edit"): void {
  const p = beatsPath(project);
  // An edit that changes nothing is not an edit. Writing anyway would churn
  // the file and fill the history with copies of a state nobody touched.
  if (!wouldChange(p, data)) return;
  takeSnapshot(project, reason);
  writeJsonAtomic(p, data);
}

/** Update one beat's start/end in place — the same edit Kayer already makes
 * by hand in beats.json when he resolves an ambiguous take. */
export function updateBeatRange(project: string, label: string, start: number, end: number): BeatsFile {
  const data = loadBeats(project);
  if (!data) throw new Error(`no beats.json for project ${project}`);
  const beat = data.beats.find((b) => b.label === label);
  if (!beat) throw new Error(`no beat '${label}' in ${project}`);
  beat.start = start;
  beat.end = end;
  saveBeats(project, data, `trim ${label}`);
  return data;
}

/**
 * The most recent render.
 *
 * The newest CLEAN cut -- graphics renders are excluded and reported
 * separately by findGraphicsFile.
 *
 * This used to sort by name and take the last, which quietly picked the wrong
 * file the moment graphics were burned in: "cut-graphics.mp4" sorts before
 * "cut.mp4", because "-" is below "." So the burn succeeded and the player
 * kept showing the version with no graphics on it.
 */
export function findCutFile(project: string): string | null {
  const cutsDir = path.join(projectDir(project), "cuts");
  if (!fs.existsSync(cutsDir)) return null;
  const files = fs
    .readdirSync(cutsDir)
    // The graphics render is a separate deliverable, not a newer cut -- if it
    // counted here, "Clean cut" would play the version with graphics on it.
    .filter((f) => /\.(mp4|mov)$/i.test(f) && !/-graphics\.mp4$/i.test(f))
    .map((f) => {
      let mtime = 0;
      try { mtime = fs.statSync(path.join(cutsDir, f)).mtimeMs; } catch { /* skip */ }
      return { f, mtime };
    })
    .sort((a, b) => a.mtime - b.mtime || a.f.localeCompare(b.f));
  return files.length ? files[files.length - 1].f : null;
}

/** The graphics render sitting beside a cut, if one has been made. */
export function findGraphicsFile(project: string): string | null {
  const cutsDir = path.join(projectDir(project), "cuts");
  if (!fs.existsSync(cutsDir)) return null;
  try {
    const g = fs.readdirSync(cutsDir).filter((f) => /-graphics\.mp4$/i.test(f));
    if (!g.length) return null;
    return g.sort((a, b) =>
      fs.statSync(path.join(cutsDir, a)).mtimeMs - fs.statSync(path.join(cutsDir, b)).mtimeMs
    )[g.length - 1];
  } catch {
    return null;
  }
}
