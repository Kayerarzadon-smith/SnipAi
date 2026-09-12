import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * The silence maps and the edit list, as the pipeline writes them.
 *
 * Shared by E7 and S71, which ask different questions of the same two files:
 * E7 asks how much detected silence SURVIVES into the cut, S71 asks whether
 * every span the build REMOVED was certified silent first. Both are answerable
 * with no audio and no ffmpeg, which is what makes them testable at all.
 */

export type Span = { start: number; end: number };

export type EdlPiece = {
  label: string;
  dur: number;
  src_start: number;
  src_end: number;
  of_start: number;
  of_end: number;
};

/**
 * `silence_map.py` shells out to ffmpeg's `silencedetect` and keeps its
 * stderr verbatim, so the map is a log rather than a data file:
 *
 *     [silencedetect @ 0x...] silence_start: 0.290542
 *     [silencedetect @ 0x...] silence_end: 1.073896 | silence_duration: 0.783354
 *
 * A `silence_start` with no matching `silence_end` is a run that reached the
 * end of the file; it is dropped rather than guessed at, because a span with
 * an invented end would be a span the build never saw.
 */
export function parseSilence(file: string): Span[] {
  const out: Span[] = [];
  let start: number | null = null;
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    const s = /silence_start:\s*([\d.]+)/.exec(line);
    if (s) { start = Number(s[1]); continue; }
    const e = /silence_end:\s*([\d.]+)/.exec(line);
    if (e && start !== null) { out.push({ start, end: Number(e[1]) }); start = null; }
  }
  return out.sort((a, b) => a.start - b.start);
}

/** Seconds of `spans` lying inside [a, b). */
export function overlap(a: number, b: number, spans: Span[]): number {
  let n = 0;
  for (const s of spans) {
    if (s.end <= a || s.start >= b) continue;
    n += Math.min(s.end, b) - Math.max(s.start, a);
  }
  return n;
}

export type Project = {
  dir: string;
  edl: EdlPiece[];
  /** the -28dB map the build trims pauses against */
  loose: Span[];
  /** the -50dB map it snaps beat edges against */
  strict: Span[];
  cutSeconds: number;
};

/**
 * His real finished project from the M0.8 exit run, read-only.
 *
 * Preserved evidence: the numbers in E7's and S71's rows came off these files
 * and the rows cite them, so the tests read the same bytes rather than a
 * hand-written approximation. Returns null when the evidence is not on this
 * machine -- it is his, not the repo's.
 */
export function exitRunProject(): Project | null {
  const candidates = [
    path.join(os.homedir(), "Movies", "SnipAi", "qa-exit-0912", "projects", "img-0060", "work"),
    path.join(os.homedir(), "Documents", "SnipAi-evidence", "qa-exit-0912", "img-0060", "work"),
  ];
  const dir = candidates.find((d) =>
    fs.existsSync(path.join(d, "edl.json")) &&
    fs.existsSync(path.join(d, "silence.txt")) &&
    fs.existsSync(path.join(d, "silence-strict.txt"))
  );
  if (!dir) return null;
  const edl = JSON.parse(fs.readFileSync(path.join(dir, "edl.json"), "utf8")) as EdlPiece[];
  return {
    dir,
    edl,
    loose: parseSilence(path.join(dir, "silence.txt")),
    strict: parseSilence(path.join(dir, "silence-strict.txt")),
    cutSeconds: edl.reduce((n, p) => n + p.dur, 0),
  };
}
