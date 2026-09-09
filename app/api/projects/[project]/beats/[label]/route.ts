import { NextRequest, NextResponse } from "next/server";
import { loadBeats, updateBeatRange, saveBeats as saveBeatsFor } from "@/lib/beats";
import { updateReviewState } from "@/lib/reviewState";
import { normaliseHoles } from "@/lib/holes";
import { readJsonObject } from "@/lib/requestBody";

/* Never prerendered. Every route here answers from the filesystem or from
   live job state, and Next will happily freeze a GET-only route at build
   time: /api/jobs/running shipped as a permanent {"job":null}, which is why
   the queue's progress bar never moved in the built app and always worked in
   dev. */
export const dynamic = "force-dynamic";

/**
 * Adjust one beat's in/out points.
 *
 * This is the common edit by a distance: the take is right, the edges are
 * wrong -- usually the last word needs a little more room. Writing straight
 * to beats.json keeps it in the same place build_cut.py reads, so the next
 * build picks it up with no extra state.
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: { project: string; label: string } }
) {
  const { project, label } = params;

  let body: { start?: unknown; end?: unknown; audioStart?: unknown; audioEnd?: unknown;
              track?: unknown; fadeIn?: unknown; fadeOut?: unknown; holes?: unknown };
  const parsed = await readJsonObject(req);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
  body = parsed.body as typeof body;

  // Number("") is 0 and Number(true) is 1, so coercing first would let a
  // malformed body silently move the beat to a real-looking time.
  if (body.track === "audio" && (body as { relink?: unknown }).relink === true) {
    let beatsFile;
    try { beatsFile = loadBeats(project); } catch {
      return NextResponse.json({ error: "invalid project name" }, { status: 400 });
    }
    if (!beatsFile) return NextResponse.json({ error: `no project '${project}'` }, { status: 404 });
    const b = beatsFile.beats.find((x) => x.label === label);
    if (!b) return NextResponse.json({ error: `no beat '${label}' in ${project}` }, { status: 404 });
    delete b.audioStart;
    delete b.audioEnd;
    saveBeatsFor(project, beatsFile);
    return NextResponse.json({ label, track: "audio", relinked: true });
  }

  /* A hole is a stretch cut out of the middle of the line. It changes which
     frames survive but not where the line begins or ends, so it is its own
     edit rather than a pair of start/end moves -- which is what kept it from
     splitting the beat into two rows saying the same thing. */
  if (body.holes !== undefined) {
    let bf;
    try { bf = loadBeats(project); } catch {
      return NextResponse.json({ error: "invalid project name" }, { status: 400 });
    }
    if (!bf) return NextResponse.json({ error: `no project '${project}'` }, { status: 404 });
    const beat = bf.beats.find((x) => x.label === label);
    if (!beat) return NextResponse.json({ error: `no beat '${label}' in ${project}` }, { status: 404 });
    const result = normaliseHoles(body.holes, beat);
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
    const merged = result.holes;
    const before = JSON.stringify(beat.holes ?? []);
    if (merged.length) beat.holes = merged;
    else delete beat.holes;
    const changed = saveBeatsFor(project, bf, `cut a hole in ${label}`);
    // A highlight that lands inside footage already cut merges into the hole
    // that is there, so the list comes out identical and there is nothing to
    // write. That is not a failure and it is not a success -- it is "that is
    // already gone", and the client has to be able to say so instead of
    // clearing the highlight and reporting a cut that did not happen.
    return NextResponse.json({
      label, holes: beat.holes ?? [], kept: result.kept, changed,
      ...(changed ? {} : {
        unchanged: JSON.stringify(beat.holes ?? []) === before
          ? "that stretch is already cut out"
          : "that would not change anything",
      }),
    });
  }

  // fades are their own edit: they change nothing about which frames are kept
  if (body.fadeIn !== undefined || body.fadeOut !== undefined) {
    let bf;
    try { bf = loadBeats(project); } catch {
      return NextResponse.json({ error: "invalid project name" }, { status: 400 });
    }
    if (!bf) return NextResponse.json({ error: `no project '${project}'` }, { status: 404 });
    const beat = bf.beats.find((x) => x.label === label);
    if (!beat) return NextResponse.json({ error: `no beat '${label}' in ${project}` }, { status: 404 });
    const dur = beat.end - beat.start;
    for (const [k, v] of [["fadeIn", body.fadeIn], ["fadeOut", body.fadeOut]] as const) {
      if (v === undefined) continue;
      if (typeof v !== "number" || !Number.isFinite(v) || v < 0) {
        return NextResponse.json({ error: `${k} must be a positive number` }, { status: 400 });
      }
      // a fade longer than the clip would ramp through the whole line
      const capped = Math.min(v, Math.max(0, dur / 2));
      if (capped <= 0.001) delete (beat as Record<string, unknown>)[k];
      else (beat as unknown as Record<string, number>)[k] = Math.round(capped * 1000) / 1000;
    }
    saveBeatsFor(project, bf);
    return NextResponse.json({ label, fadeIn: beat.fadeIn ?? 0, fadeOut: beat.fadeOut ?? 0 });
  }

  const start = body.start as number;
  const end = body.end as number;
  if (typeof start !== "number" || typeof end !== "number" ||
      !Number.isFinite(start) || !Number.isFinite(end)) {
    return NextResponse.json({ error: "start and end must be numbers" }, { status: 400 });
  }
  if (start < 0) {
    return NextResponse.json({ error: "start cannot be negative" }, { status: 400 });
  }
  if (end - start < 0.15) {
    return NextResponse.json(
      { error: "a beat must be at least 0.15s long" },
      { status: 400 }
    );
  }

  let beats;
  try {
    beats = loadBeats(project);
  } catch {
    return NextResponse.json({ error: "invalid project name" }, { status: 400 });
  }
  if (!beats) {
    return NextResponse.json({ error: `no project '${project}'` }, { status: 404 });
  }
  const existing = beats.beats.find((b) => b.label === label);
  if (!existing) {
    return NextResponse.json({ error: `no beat '${label}' in ${project}` }, { status: 404 });
  }

  // Detached audio: the beat's sound comes from a different range than its
  // picture, which is what a J- or L-cut is. Absent means locked to the
  // picture, so an untouched beat carries no extra fields at all.
  const track = body.track === "audio" ? "audio" : "video";
  if (track === "audio") {
    existing.audioStart = Math.round(start * 1000) / 1000;
    existing.audioEnd = Math.round(end * 1000) / 1000;
    saveBeatsFor(project, beats!);
    return NextResponse.json({
      label,
      track: "audio",
      after: { audioStart: existing.audioStart, audioEnd: existing.audioEnd },
      offset: Math.round((existing.audioStart - existing.start) * 1000) / 1000,
    });
  }

  const before = { start: existing.start, end: existing.end };
  const { changed } = updateBeatRange(project, label,
    Math.round(start * 1000) / 1000, Math.round(end * 1000) / 1000);

  const startDelta = Math.round((start - before.start) * 1000) / 1000;
  const endDelta = Math.round((end - before.end) * 1000) / 1000;

  // the whole point: a trim is evidence about where the edges should have been
  updateReviewState(project, (st) => {
    (st.trimEdits ??= []).push({
      beatLabel: label,
      startDelta,
      endDelta,
      at: new Date().toISOString(),
    });
  });

  return NextResponse.json({
    label,
    before,
    after: { start, end },
    // how much the human moved each edge -- the signal the tuner learns from
    delta: { start: startDelta, end: endDelta },
    // whether anything was actually written: a trim to where the edge already
    // is looks exactly like a trim that worked, and only one of them is
    changed,
    ...(changed ? {} : { unchanged: "that edge is already there" }),
  });
}
