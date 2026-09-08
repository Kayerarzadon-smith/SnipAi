import { NextRequest, NextResponse } from "next/server";
import { loadBeats, updateBeatRange } from "@/lib/beats";
import { runTool } from "@/lib/pipeline";
import { updateReviewState } from "@/lib/reviewState";
import type { CandidateTakesResult } from "@/lib/types";

export async function GET(req: NextRequest, { params }: { params: { project: string; label: string } }) {
  const { project, label } = params;
  const beats = loadBeats(project);
  const beat = beats?.beats.find((b) => b.label === label);
  if (!beats || !beat) {
    return NextResponse.json({ error: `no beat '${label}' in ${project}` }, { status: 404 });
  }

  const url = new URL(req.url);
  const forceRefresh = url.searchParams.get("refresh") === "1";
  const regionStart = Number(url.searchParams.get("start") ?? beat.start - 8);
  const regionEnd = Number(url.searchParams.get("end") ?? beat.end + 8);

  const state = updateReviewState(project, () => {}); // read current cache
  const cacheKey = label;
  if (!forceRefresh && state.candidateCache[cacheKey]) {
    return NextResponse.json(state.candidateCache[cacheKey]);
  }

  const result = await runTool("list_candidate_takes.py", [
    `projects/${project}`,
    String(regionStart),
    String(regionEnd),
    "--label",
    label,
  ]);

  if (result.code !== 0) {
    return NextResponse.json(
      { error: "candidate scan unavailable", detail: result.stdout || result.stderr },
      { status: 422 }
    );
  }

  let parsed: CandidateTakesResult;
  try {
    parsed = JSON.parse(result.stdout);
  } catch {
    return NextResponse.json({ error: "could not parse candidate scan output", raw: result.stdout }, { status: 500 });
  }

  updateReviewState(project, (s) => {
    s.candidateCache[cacheKey] = parsed;
  });

  return NextResponse.json(parsed);
}

export async function POST(req: NextRequest, { params }: { params: { project: string; label: string } }) {
  const { project, label } = params;
  let candidateId: string;
  try {
    ({ candidateId } = (await req.json()) as { candidateId: string });
  } catch {
    return NextResponse.json({ error: "body must be JSON" }, { status: 400 });
  }
  if (typeof candidateId !== "string" || !candidateId) {
    return NextResponse.json({ error: "candidateId required" }, { status: 400 });
  }

  const beatsFile = loadBeats(project);
  if (!beatsFile?.beats.some((b) => b.label === label)) {
    return NextResponse.json({ error: `no beat '${label}' in ${project}` }, { status: 404 });
  }

  const state = updateReviewState(project, () => {});
  const cached = state.candidateCache[label];
  const candidate = cached?.candidates.find((c) => c.id === candidateId);
  if (!candidate) {
    return NextResponse.json({ error: "candidate not found in cache — GET candidates first" }, { status: 404 });
  }

  updateBeatRange(project, label, candidate.start, candidate.end);
  const newState = updateReviewState(project, (s) => {
    s.takePicks[label] = { chosenId: candidateId, pickedAt: new Date().toISOString() };
  });

  return NextResponse.json({ beatLabel: label, chosen: candidate, reviewState: newState });
}
