import fs from "node:fs";
import path from "node:path";
import { projectDir } from "./paths";
import type { Beat, Scorecard, ScorecardMetric } from "./types";

type Word = { w: string; s: number; e: number };

export function loadTranscriptWords(project: string): Word[] | null {
  const p = path.join(projectDir(project), "work", "transcript.json");
  if (!fs.existsSync(p)) return null;
  try {
    const segs = JSON.parse(fs.readFileSync(p, "utf8")) as { words: Word[] }[];
    const words = segs.flatMap((s) => s.words).sort((a, b) => a.s - b.s);
    return words;
  } catch {
    return null;
  }
}

export type WordBoundaryFlag = {
  beatLabel: string;
  edge: "start" | "end";
  distanceSec: number;
  nearWord: string;
};

/** Flags a beat edge that lands STRICTLY inside some transcript word's span
 * (not touching either edge of it) — i.e. the cut point splits that word,
 * so part of it plays and part is cut. Landing exactly at a word's own
 * start/end is the clean, intended case and is not flagged. distanceSec is
 * how far into the word the cut sits (small = likely inaudible, larger =
 * more likely an audible clip) — this is the real version of the prototype's
 * "this cut sits 0.03s from a word boundary — did the last word sound
 * clipped?" line. */
export function computeWordBoundaryFlags(
  words: Word[],
  beats: Beat[]
): WordBoundaryFlag[] {
  const flags: WordBoundaryFlag[] = [];
  const insideWord = (point: number) => words.find((w) => w.s < point && point < w.e);

  for (const beat of beats) {
    const startWord = insideWord(beat.start);
    if (startWord) {
      const dist = Math.min(beat.start - startWord.s, startWord.e - beat.start);
      flags.push({ beatLabel: beat.label, edge: "start", distanceSec: dist, nearWord: startWord.w.trim() });
    }
    const endWord = insideWord(beat.end);
    if (endWord) {
      const dist = Math.min(beat.end - endWord.s, endWord.e - beat.end);
      flags.push({ beatLabel: beat.label, edge: "end", distanceSec: dist, nearWord: endWord.w.trim() });
    }
  }
  return flags;
}

function parseVerifyCutOutput(stdout: string): ScorecardMetric {
  if (/PASS -- no repeated phrases\./.test(stdout)) {
    return { key: "repeats", label: "Repeated phrases", value: 100, note: "verify_cut.py: PASS" };
  }
  const m = stdout.match(/FAIL -- (\d+) repeated phrase/);
  if (m) {
    const n = parseInt(m[1], 10);
    return {
      key: "repeats",
      label: "Repeated phrases",
      value: Math.max(0, 100 - n * 25),
      note: `verify_cut.py: FAIL — ${n} repeated phrase(s)`,
    };
  }
  return { key: "repeats", label: "Repeated phrases", value: null, note: "needs a built cut to verify" };
}

function parseCompareToReferenceOutput(stdout: string): ScorecardMetric {
  const offMatches = [...stdout.matchAll(/<-- (\d+)% off/g)].map((m) => parseInt(m[1], 10));
  if (offMatches.length === 0 && /In line with the reference\./.test(stdout)) {
    return { key: "pacing", label: "Pacing vs. house style", value: 100, note: "within tolerance of reference" };
  }
  if (offMatches.length > 0) {
    const worst = Math.max(...offMatches);
    return {
      key: "pacing",
      label: "Pacing vs. house style",
      value: Math.max(0, 100 - worst),
      note: `compare_to_reference.py: ${offMatches.length} metric(s) out of tolerance (worst ${worst}% off)`,
    };
  }
  return { key: "pacing", label: "Pacing vs. house style", value: null, note: "needs a built cut to compare" };
}

export function computeWordCutoffMetric(project: string, beats: Beat[]): ScorecardMetric {
  const words = loadTranscriptWords(project);
  if (!words) {
    return { key: "word_cutoffs", label: "Word cutoffs", value: null, note: "needs work/transcript.json — footage not transcribed on this machine" };
  }
  const flags = computeWordBoundaryFlags(words, beats);
  const score = Math.max(0, Math.round(100 * (1 - flags.length / Math.max(beats.length, 1))));
  return {
    key: "word_cutoffs",
    label: "Word cutoffs",
    value: score,
    note: flags.length === 0 ? "no beat sits within 0.05s of a word boundary" : `${flags.length} beat(s) sit within 0.05s of a word boundary`,
  };
}

export function buildScorecard(metrics: ScorecardMetric[]): Scorecard {
  const scored = metrics.filter((m) => m.value !== null) as (ScorecardMetric & { value: number })[];
  const overall = scored.length ? Math.round(scored.reduce((a, m) => a + m.value, 0) / scored.length) : null;
  return { overall, metrics };
}

export { parseVerifyCutOutput, parseCompareToReferenceOutput };
