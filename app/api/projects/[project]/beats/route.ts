import { NextRequest, NextResponse } from "next/server";
import { loadBeats, saveBeats } from "@/lib/beats";
import { updateReviewState } from "@/lib/reviewState";
import { normaliseHoles } from "@/lib/holes";
import { splitBeat } from "@/lib/splitBeat";
import { readJsonObject } from "@/lib/requestBody";

/* Never prerendered. Every route here answers from the filesystem or from
   live job state, and Next will happily freeze a GET-only route at build
   time: /api/jobs/running shipped as a permanent {"job":null}, which is why
   the queue's progress bar never moved in the built app and always worked in
   dev. */
export const dynamic = "force-dynamic";

/* The four fields this route validates, plus the ones it must not lose or
   duplicate. The local type used to declare only the first four, which is
   exactly why `{ ...b }` on a split looked safe: the extra fields were
   invisible to the type checker and got copied onto both halves. */
type Beat = {
  label: string; start: number; end: number; text?: string;
  holes?: [number, number][];
  audioStart?: number; audioEnd?: number;
  fadeIn?: number; fadeOut?: number;
};

const MIN_DUR = 0.15;

function uniqueLabel(base: string, taken: Set<string>) {
  const clean = base.replace(/[^a-z0-9-]/gi, "").toLowerCase() || "beat";
  if (!taken.has(clean)) return clean;
  for (let i = 2; ; i++) {
    const c = `${clean}-${i}`;
    if (!taken.has(c)) return c;
  }
}

/**
 * Structural edits to the beat list: remove a line, split one in two, or
 * change the order. Trimming a single beat's edges stays on
 * beats/[label] — this is for edits that change what clips exist.
 *
 * beats.json is what build_cut.py reads, so nothing is written until the
 * whole resulting list is valid.
 */
export async function POST(req: NextRequest, { params }: { params: { project: string } }) {
  const { project } = params;

  let body: { op?: unknown; label?: unknown; at?: unknown; order?: unknown;
              edits?: unknown; span?: unknown };
  const parsed = await readJsonObject(req);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
  body = parsed.body as typeof body;

  let existing;
  try {
    existing = loadBeats(project);
  } catch {
    return NextResponse.json({ error: "invalid project name" }, { status: 400 });
  }
  if (!existing) return NextResponse.json({ error: `no project '${project}'` }, { status: 404 });

  const beats: Beat[] = existing.beats;
  const op = body.op;

  if (op === "delete") {
    if (typeof body.label !== "string") {
      return NextResponse.json({ error: "label is required" }, { status: 400 });
    }
    const gone = beats.find((b) => b.label === body.label);
    if (!gone) {
      return NextResponse.json({ error: `no beat '${body.label}'` }, { status: 404 });
    }
    if (beats.length <= 1) {
      return NextResponse.json({ error: "a cut needs at least one beat" }, { status: 400 });
    }
    existing.beats = beats.filter((b) => b.label !== body.label);
    saveBeats(project, existing);
    // dropping a line is a judgement about the take; worth remembering
    updateReviewState(project, (st) => {
      (st.deletedBeats ??= []).push({
        label: gone.label, text: gone.text, start: gone.start, end: gone.end,
        at: new Date().toISOString(),
      });
    });
    return NextResponse.json({ ok: true, removed: gone, beats: existing.beats });
  }

  if (op === "split") {
    if (typeof body.label !== "string" || typeof body.at !== "number" || !Number.isFinite(body.at)) {
      return NextResponse.json({ error: "label and a numeric 'at' are required" }, { status: 400 });
    }
    const i = beats.findIndex((b) => b.label === body.label);
    if (i < 0) return NextResponse.json({ error: `no beat '${body.label}'` }, { status: 404 });
    const b = beats[i];
    const at = body.at;
    if (at - b.start < MIN_DUR || b.end - at < MIN_DUR) {
      return NextResponse.json(
        { error: `split too close to an edge — each half must be at least ${MIN_DUR}s` },
        { status: 400 }
      );
    }
    const taken = new Set(beats.map((x) => x.label));
    const { left, right } = splitBeat(b, round(at), uniqueLabel(`${b.label}-b`, taken));
    existing.beats = [...beats.slice(0, i), left, right, ...beats.slice(i + 1)];
    saveBeats(project, existing);
    return NextResponse.json({ ok: true, beats: existing.beats });
  }

  if (op === "reorder") {
    if (!Array.isArray(body.order) || body.order.some((l) => typeof l !== "string")) {
      return NextResponse.json({ error: "order must be an array of labels" }, { status: 400 });
    }
    const order = body.order as string[];
    const byLabel = new Map(beats.map((b) => [b.label, b]));
    if (order.length !== beats.length || order.some((l) => !byLabel.has(l))) {
      return NextResponse.json(
        { error: "order must list every existing beat exactly once" },
        { status: 400 }
      );
    }
    existing.beats = order.map((l) => byLabel.get(l)!);
    const changed = saveBeats(project, existing, "moved a line");
    if (!changed) {
      return NextResponse.json({ ok: true, beats: existing.beats, changed: false,
                                 unchanged: "that line is already there" });
    }
    return NextResponse.json({ ok: true, beats: existing.beats, changed: true });
  }

  /* One drag across the timeline, applied as one edit.
   *
   * A span pays no attention to where lines begin and end: it can clip the
   * tail of one, swallow the next whole, and bite the head off a third. The
   * caller resolves it against the pieces the cut is made of (resolveSpanDelete)
   * and sends the result; this validates every part of it and writes once, so
   * a span that is bad anywhere changes nothing -- rather than deleting two
   * lines and then refusing the third. */
  if (op === "cut_span") {
    if (!Array.isArray(body.edits) || body.edits.length === 0) {
      return NextResponse.json({ error: "edits must be a non-empty list" }, { status: 400 });
    }
    const byLabel = new Map(beats.map((b) => [b.label, b]));
    const dropping = new Set<string>();
    const holing: { beat: Beat; holes: [number, number][] }[] = [];

    for (const raw of body.edits) {
      const e = raw as { label?: unknown; drop?: unknown; holes?: unknown };
      if (typeof e.label !== "string") {
        return NextResponse.json({ error: "each edit needs a label" }, { status: 400 });
      }
      const beat = byLabel.get(e.label);
      if (!beat) {
        return NextResponse.json({ error: `no beat '${e.label}'` }, { status: 404 });
      }
      if (e.drop === true) { dropping.add(e.label); continue; }
      const result = normaliseHoles(e.holes, beat);
      if (!result.ok) {
        return NextResponse.json({ error: `${e.label}: ${result.error}` }, { status: 400 });
      }
      holing.push({ beat, holes: result.holes });
    }

    if (dropping.size === beats.length) {
      return NextResponse.json(
        { error: "that would delete the whole video" }, { status: 400 });
    }

    for (const { beat, holes } of holing) {
      if (holes.length) (beat as Beat & { holes?: unknown }).holes = holes;
      else delete (beat as Beat & { holes?: unknown }).holes;
    }
    const kept = beats.filter((b) => !dropping.has(b.label));
    existing.beats = kept;
    /* The same "it said it cut and cut nothing" as the snippet editor, on the
       other surface: drag a span across the timeline that lands entirely
       inside footage already removed and every edit resolves to the holes
       that are already there. Nothing is written, and the drag reports a cut.
       The learning log is only written when something moved, for the same
       reason -- a recorded span cut that removed nothing is a lesson in
       cutting nothing. */
    const changed = saveBeats(project, existing, "cut a span out of the timeline");
    if (!changed) {
      return NextResponse.json({
        ok: true, beats: existing.beats, dropped: [], changed: false,
        unchanged: "that stretch is already cut out",
      });
    }

    // What was taken out, so the drafter can make the same cut unprompted.
    updateReviewState(project, (st) => {
      const log = (st as { spanCuts?: unknown[] }).spanCuts ?? [];
      (st as { spanCuts?: unknown[] }).spanCuts = [
        ...log,
        {
          at: new Date().toISOString(),
          span: body.span ?? null,
          dropped: [...dropping],
          holed: holing.map((h) => ({ label: h.beat.label, holes: h.holes })),
        },
      ].slice(-200);
      return st;
    });
    return NextResponse.json({ ok: true, beats: existing.beats, dropped: [...dropping], changed: true });
  }

  return NextResponse.json({ error: `unknown op '${String(op)}'` }, { status: 400 });
}

function round(n: number) {
  return Math.round(n * 1000) / 1000;
}
