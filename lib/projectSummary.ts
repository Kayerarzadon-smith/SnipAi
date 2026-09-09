import fs from "node:fs";
import path from "node:path";
import { listProjectNames, projectDir } from "./paths";
import { loadBeats, readBeats, findCutFile } from "./beats";
import { loadReviewState } from "./reviewState";
import { computeWordCutoffMetric, buildScorecard, loadTranscriptWords, computeWordBoundaryFlags } from "./scorecard";
import type { CutStatus } from "./types";

export type PipelineStage = {
  key: string;
  label: string;
  weight: number;
  done: boolean;
};

export type ProjectSummary = {
  name: string;
  title: string;
  beatCount: number;
  cutStatus: CutStatus;
  cutFile: string | null;
  hasRawFootage: boolean;
  hasTranscript: boolean;
  scorecardOverall: number | null;
  flaggedBeatLabels: string[];
  progressPct: number;
  stages: PipelineStage[];
  nextStep: string;
  /** How much footage the edit removes. sourceSeconds comes from the last
   * word in the transcript (no ffmpeg call needed); cutSeconds is the sum of
   * the beats actually kept. */
  sourceSeconds: number | null;
  cutSeconds: number | null;
  removedSeconds: number | null;
  /** name + byte size of the footage already in this project, so an upload
   * can warn before importing the same file twice under a different name. */
  rawFiles: { name: string; size: number }[];
  /** Set only when the project is on disk but unreadable. */
  problem?: string;
};

/**
 * Progress is derived from real artifacts on disk -- each stage is a fact we
 * can check, not an estimate. That keeps the percentage honest: it only moves
 * when the pipeline actually produced something.
 */
function computeStages(opts: {
  hasRawFootage: boolean;
  hasTranscript: boolean;
  beatCount: number;
  cutFile: string | null;
  cutStatus: CutStatus;
}): PipelineStage[] {
  return [
    { key: "footage", label: "Raw footage in", weight: 15, done: opts.hasRawFootage },
    { key: "transcript", label: "Transcribed", weight: 15, done: opts.hasTranscript },
    { key: "beats", label: "Beats drafted", weight: 20, done: opts.beatCount > 0 },
    { key: "cut", label: "Cut built", weight: 25, done: opts.cutFile !== null },
    { key: "reviewed", label: "Reviewed", weight: 10, done: opts.cutStatus !== "unreviewed" },
    { key: "approved", label: "Approved", weight: 15, done: opts.cutStatus === "approved" },
  ];
}

function nextStepFor(stages: PipelineStage[]): string {
  const pending = stages.find((s) => !s.done);
  if (!pending) return "Ready to post";
  switch (pending.key) {
    case "footage": return "Drop in raw footage";
    case "transcript": return "Transcribe the footage";
    case "beats": return "Draft the beat list";
    case "cut": return "Build the cut";
    case "reviewed": return "Needs your review";
    case "approved": return "Awaiting your approval";
    default: return pending.label;
  }
}

function titleFromName(name: string): string {
  return name
    .split("-")
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(" ");
}

export function summarizeProject(name: string): ProjectSummary | null {
  const read = readBeats(name);
  if (!read.ok) {
    // A project whose beats.json is missing is not a project. One whose
    // beats.json is BROKEN is a project with a problem, and silently dropping
    // it from the queue is how footage appears to vanish -- so it stays on
    // screen, saying what is wrong with it.
    if (read.missing) return null;
    return brokenProject(name, read.why);
  }
  const beats = read.data;
  const dir = projectDir(name);
  const state = loadReviewState(name);
  const cutFile = findCutFile(name);
  const rawDir = path.join(dir, "raw");
  const rawFiles: { name: string; size: number }[] = [];
  if (fs.existsSync(rawDir)) {
    for (const f of fs.readdirSync(rawDir)) {
      if (f.startsWith(".")) continue;
      try {
        rawFiles.push({ name: f, size: fs.statSync(path.join(rawDir, f)).size });
      } catch {
        // a broken symlink shouldn't take out the dashboard
      }
    }
  }
  const hasRawFootage = rawFiles.length > 0;
  const transcriptWords = loadTranscriptWords(name);

  const flaggedBeatLabels = transcriptWords
    ? computeWordBoundaryFlags(transcriptWords, beats.beats).map((f) => f.beatLabel)
    : [];

  const metrics = [computeWordCutoffMetric(name, beats.beats)];
  const scorecard = buildScorecard(metrics);

  // what the edit actually removes
  let sourceSeconds: number | null = null;
  if (transcriptWords && transcriptWords.length) {
    sourceSeconds = Math.max(...transcriptWords.map((w) => w.e));
  }
  const cutSeconds = beats.beats.length
    ? beats.beats.reduce((sum, b) => sum + Math.max(0, b.end - b.start), 0)
    : null;
  const removedSeconds =
    sourceSeconds !== null && cutSeconds !== null ? Math.max(0, sourceSeconds - cutSeconds) : null;

  const stages = computeStages({
    hasRawFootage,
    hasTranscript: transcriptWords !== null,
    beatCount: beats.beats.length,
    cutFile,
    cutStatus: state.cutStatus,
  });
  const progressPct = stages.reduce((sum, s) => sum + (s.done ? s.weight : 0), 0);

  return {
    name,
    title: titleFromName(name),
    beatCount: beats.beats.length,
    cutStatus: state.cutStatus,
    cutFile,
    hasRawFootage,
    hasTranscript: transcriptWords !== null,
    scorecardOverall: scorecard.overall,
    flaggedBeatLabels: Array.from(new Set(flaggedBeatLabels)),
    progressPct,
    stages,
    nextStep: nextStepFor(stages),
    sourceSeconds: sourceSeconds === null ? null : Math.round(sourceSeconds * 10) / 10,
    cutSeconds: cutSeconds === null ? null : Math.round(cutSeconds * 10) / 10,
    removedSeconds: removedSeconds === null ? null : Math.round(removedSeconds * 10) / 10,
    rawFiles,
  };
}

/** A project that is on disk but cannot be read, rendered as itself so the
 *  queue can show it instead of pretending it is not there. */
function brokenProject(name: string, why: string): ProjectSummary {
  return {
    name, title: titleFromName(name), beatCount: 0, cutStatus: "unreviewed",
    cutFile: null, hasRawFootage: fs.existsSync(path.join(projectDir(name), "raw")),
    hasTranscript: false, scorecardOverall: null, flaggedBeatLabels: [],
    progressPct: 0, stages: [], nextStep: why,
    sourceSeconds: null, cutSeconds: null, removedSeconds: null, rawFiles: [],
    problem: why,
  };
}

export function summarizeAllProjects(): ProjectSummary[] {
  return listProjectNames()
    .map((name) => {
      // One project must never be able to empty the queue. Anything that gets
      // past summarizeProject's own guards still stops here.
      try { return summarizeProject(name); }
      catch (e) { return brokenProject(name, `could not read this project: ${(e as Error).message}`); }
    })
    .filter((p): p is ProjectSummary => p !== null);
}
