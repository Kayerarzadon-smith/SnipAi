import path from "node:path";
import { projectDir } from "./paths";
import { readJson, writeJsonAtomic } from "./jsonStore";
import type { ReviewState } from "./types";

function statePath(project: string): string {
  return path.join(projectDir(project), "review-state.json");
}

export function loadReviewState(project: string): ReviewState {
  return readJson<ReviewState>(statePath(project), {
    project,
    cutStatus: "unreviewed",
    updatedAt: new Date().toISOString(),
    timelineMarkers: [],
    beatDiagnoses: {},
    takePicks: {},
    candidateCache: {},
  });
}

export function saveReviewState(project: string, state: ReviewState): void {
  state.updatedAt = new Date().toISOString();
  writeJsonAtomic(statePath(project), state);
}

export function updateReviewState(
  project: string,
  mutate: (state: ReviewState) => void
): ReviewState {
  const state = loadReviewState(project);
  mutate(state);
  saveReviewState(project, state);
  return state;
}
