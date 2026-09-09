import path from "node:path";
import { projectDir } from "./paths";
import { readJson, readJsonChecked, preserveCorrupt, writeJsonAtomic } from "./jsonStore";
import type { ReviewState } from "./types";

function statePath(project: string): string {
  return path.join(projectDir(project), "review-state.json");
}

function defaults(project: string): ReviewState {
  return {
    project,
    cutStatus: "unreviewed",
    updatedAt: new Date().toISOString(),
    timelineMarkers: [],
    beatDiagnoses: {},
    takePicks: {},
    candidateCache: {},
  };
}

/**
 * The decisions the person has made about this cut.
 *
 * An unreadable file is NOT treated as an absent one. It used to be: readJson
 * handed back bare defaults, and the next write -- including the no-op write a
 * GET used to do just to peek at the cache -- put those defaults on disk.
 * Every take pick, trim, cut region and deleted-line record erased by a read,
 * with the file that held them overwritten too, so there was nothing to
 * recover. The file is now moved aside intact and the path reported, so the
 * work still exists even when the app cannot use it.
 */
export function loadReviewState(project: string): ReviewState {
  const p = statePath(project);
  const r = readJsonChecked<ReviewState>(p);
  if (r.state === "ok") return { ...defaults(project), ...r.value };
  if (r.state === "broken") {
    const kept = preserveCorrupt(p);
    const base = defaults(project);
    base.stateProblem = kept
      ? `review-state.json could not be read (${r.why}). It was kept at ${kept.split("/").pop()} — your picks and edits are still in it.`
      : `review-state.json could not be read (${r.why}) and could not be moved aside.`;
    return base;
  }
  return defaults(project);
}

export function saveReviewState(project: string, state: ReviewState): void {
  state.updatedAt = new Date().toISOString();
  writeJsonAtomic(statePath(project), state);
}

/** Everything except the timestamp, which changes on every save and so cannot
 *  be part of deciding whether anything actually changed. */
function withoutStamp(s: ReviewState): string {
  const { updatedAt, ...rest } = s as ReviewState & { updatedAt?: string };
  void updatedAt;
  return JSON.stringify(rest);
}

export function updateReviewState(
  project: string,
  mutate: (state: ReviewState) => void
): ReviewState {
  const state = loadReviewState(project);
  const before = withoutStamp(state);
  mutate(state);
  // A mutation that changed nothing is not a write. Two routes used
  // `updateReviewState(p, () => {})` purely to read the cache, so a GET
  // rewrote the whole file -- and on an unreadable file that rewrite was what
  // destroyed the decisions in it. Those call sites now read; this makes the
  // shape harmless even if someone writes it again.
  if (withoutStamp(state) === before) return state;
  saveReviewState(project, state);
  return state;
}
