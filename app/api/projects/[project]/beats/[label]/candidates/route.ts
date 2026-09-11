import { NextRequest, NextResponse } from "next/server";
import { loadBeats, updateBeatRange } from "@/lib/beats";
import { runTool } from "@/lib/pipeline";
import { updateReviewState, loadReviewState } from "@/lib/reviewState";
import type { CandidateTakesResult } from "@/lib/types";
import { projectDir } from "@/lib/paths";

/* Never prerendered. Every route here answers from the filesystem or from
   live job state, and Next will happily freeze a GET-only route at build
   time: /api/jobs/running shipped as a permanent {"job":null}, which is why
   the queue's progress bar never moved in the built app and always worked in
   dev. */
export const dynamic = "force-dynamic";

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

  // A read, and only a read. This was updateReviewState(p, () => {}), which
  // rewrites the whole file to peek at one field -- so a GET wrote to disk,
  // and on an unreadable file it wrote defaults over the real thing.
  const state = loadReviewState(project);
  const cacheKey = label;
  if (!forceRefresh && state.candidateCache[cacheKey]) {
    return NextResponse.json(state.candidateCache[cacheKey]);
  }

  const result = await runTool("list_candidate_takes.py", [
    // absolute, for the same reason as peaks: a relative path resolves
    // against CODE_ROOT, which has held no projects since the library moved
    projectDir(project),
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

  const state = loadReviewState(project);
  const cached = state.candidateCache[label];
  const candidate = cached?.candidates.find((c) => c.id === candidateId);
  if (!candidate) {
    return NextResponse.json({ error: "candidate not found in cache — GET candidates first" }, { status: 404 });
  }

  /* The take picker moves a line's edges further than any drag does, so it is
     the other way a line's existing holes can end up covering everything left
     of it. Refuse before the pick is recorded, not after -- writing takePicks
     for a take that was never applied is how review-state and beats.json come
     to disagree about which take is on screen. */
  const moved = updateBeatRange(project, label, candidate.start, candidate.end);
  if (!moved.ok) {
    return NextResponse.json({ error: moved.error }, { status: 400 });
  }
  const newState = updateReviewState(project, (s) => {
    s.takePicks[label] = { chosenId: candidateId, pickedAt: new Date().toISOString() };
  });

  return NextResponse.json({ beatLabel: label, chosen: candidate, reviewState: newState });
}
