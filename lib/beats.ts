import fs from "node:fs";
import path from "node:path";
import { projectDir } from "./paths";
import { writeJsonAtomic } from "./jsonStore";
import type { BeatsFile } from "./types";

export function beatsPath(project: string): string {
  return path.join(projectDir(project), "beats.json");
}

export function loadBeats(project: string): BeatsFile | null {
  const p = beatsPath(project);
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, "utf8")) as BeatsFile;
}

export function saveBeats(project: string, data: BeatsFile): void {
  writeJsonAtomic(beatsPath(project), data);
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
  saveBeats(project, data);
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
