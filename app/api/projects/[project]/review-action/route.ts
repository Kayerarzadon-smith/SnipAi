import { NextRequest, NextResponse } from "next/server";
import { updateReviewState } from "@/lib/reviewState";
import { loadBeats } from "@/lib/beats";
import type { CutStatus } from "@/lib/types";

type Body =
  | { kind: "level1"; status: CutStatus; note?: string }
  | { kind: "level2_marker"; atPct: number }
  | { kind: "level2_clear" }
  | { kind: "level3_diagnosis"; beatLabel: string; checks: string[]; note: string; fix?: string }
  | { kind: "cut_region"; beatLabel: string; from: number; to: number; words: string[]; silenceRatio: number };

const VALID_STATUSES: CutStatus[] = ["unreviewed", "approved", "needs_fixes", "trashed"];

function bad(message: string) {
  return NextResponse.json({ error: message }, { status: 400 });
}

/**
 * Everything here is validated before it touches disk. review-state.json is
 * read back by the dashboard and the scorer, so an unchecked write puts
 * garbage into state that later code treats as real -- posting
 * {"status":"banana"} used to return 200 and persist it.
 */
export async function POST(req: NextRequest, { params }: { params: { project: string } }) {
  const { project } = params;

  if (!loadBeats(project)) {
    return NextResponse.json({ error: `no project '${project}'` }, { status: 404 });
  }

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return bad("body must be JSON");
  }
  if (!body || typeof body !== "object" || !("kind" in body)) {
    return bad("body must include a 'kind'");
  }

  switch (body.kind) {
    case "level1": {
      if (!VALID_STATUSES.includes(body.status)) {
        return bad(`status must be one of: ${VALID_STATUSES.join(", ")}`);
      }
      if (body.note !== undefined && typeof body.note !== "string") {
        return bad("note must be a string");
      }
      break;
    }
    case "level2_marker": {
      if (typeof body.atPct !== "number" || !Number.isFinite(body.atPct) ||
          body.atPct < 0 || body.atPct > 100) {
        return bad("atPct must be a number between 0 and 100");
      }
      break;
    }
    case "level2_clear":
      break;
    case "level3_diagnosis": {
      if (typeof body.beatLabel !== "string" || !body.beatLabel) {
        return bad("beatLabel is required");
      }
      if (!Array.isArray(body.checks) || body.checks.some((c) => typeof c !== "string")) {
        return bad("checks must be an array of strings");
      }
      if (typeof body.note !== "string") return bad("note must be a string");
      const beats = loadBeats(project);
      if (!beats?.beats.some((b) => b.label === body.beatLabel)) {
        return NextResponse.json(
          { error: `no beat '${body.beatLabel}' in ${project}` },
          { status: 404 }
        );
      }
      break;
    }
    case "cut_region": {
      if (typeof body.beatLabel !== "string" || !body.beatLabel) return bad("beatLabel is required");
      if (typeof body.from !== "number" || typeof body.to !== "number" ||
          !Number.isFinite(body.from) || !Number.isFinite(body.to) || body.to <= body.from) {
        return bad("from and to must be numbers, to after from");
      }
      if (!Array.isArray(body.words) || body.words.some((w) => typeof w !== "string")) {
        return bad("words must be an array of strings");
      }
      if (typeof body.silenceRatio !== "number" || body.silenceRatio < 0 || body.silenceRatio > 1) {
        return bad("silenceRatio must be between 0 and 1");
      }
      break;
    }
    default:
      return bad(`unknown kind: ${(body as { kind: string }).kind}`);
  }

  const state = updateReviewState(project, (s) => {
    switch (body.kind) {
      case "level1":
        s.cutStatus = body.status;
        s.statusNote = body.note;
        break;
      case "level2_marker":
        s.timelineMarkers.push({ atPct: body.atPct, createdAt: new Date().toISOString() });
        break;
      case "level2_clear":
        s.timelineMarkers = [];
        break;
      case "cut_region":
        (s.cutRegions ??= []).push({
          beatLabel: body.beatLabel,
          from: body.from,
          to: body.to,
          seconds: Math.round((body.to - body.from) * 1000) / 1000,
          words: body.words.slice(0, 40),
          silenceRatio: body.silenceRatio,
          at: new Date().toISOString(),
        });
        break;
      case "level3_diagnosis":
        s.beatDiagnoses[body.beatLabel] = {
          checks: body.checks,
          note: body.note,
          fix: body.fix,
          answeredAt: new Date().toISOString(),
        };
        break;
    }
  });

  return NextResponse.json({ reviewState: state });
}
