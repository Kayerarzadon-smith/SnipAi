import { NextRequest, NextResponse } from "next/server";
import { isCutStale } from "@/lib/cutFreshness";
import { readEdl } from "@/lib/edl";
import { loadBeats, findCutFile, findGraphicsFile } from "@/lib/beats";
import { loadReviewState } from "@/lib/reviewState";
import {
  computeWordCutoffMetric,
  buildScorecard,
  loadTranscriptWords,
  computeWordBoundaryFlags,
  parseVerifyCutOutput,
  parseCompareToReferenceOutput,
} from "@/lib/scorecard";
import { runTool, checkAvailability } from "@/lib/pipeline";
import { projectDir, TRASH_ROOT, DATA_ROOT } from "@/lib/paths";
import path from "node:path";
import fs from "node:fs";

/* Never prerendered. Every route here answers from the filesystem or from
   live job state, and Next will happily freeze a GET-only route at build
   time: /api/jobs/running shipped as a permanent {"job":null}, which is why
   the queue's progress bar never moved in the built app and always worked in
   dev. */
export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, { params }: { params: { project: string } }) {
  const { project } = params;

  // an invalid name throws out of projectDir(); catch it here so it reads as
  // a bad request rather than a server crash
  let beats;
  try {
    beats = loadBeats(project);
  } catch {
    return NextResponse.json({ error: "invalid project name" }, { status: 400 });
  }
  if (!beats) {
    return NextResponse.json({ error: `no project '${project}'` }, { status: 404 });
  }
  const state = loadReviewState(project);

  // What draft_beats.py concluded about each beat. Without this the review
  // screen only sees word-boundary flags and cheerfully reports "all clean"
  // on beats the drafter already marked as needing a human call.
  let beatAnalysis: Record<string, { confidence: number; attempts: number; needs_review?: boolean; why?: string[] }> = {};
  try {
    const ap = path.join(projectDir(project), "work", "beat-analysis.json");
    if (fs.existsSync(ap)) {
      const parsed = JSON.parse(fs.readFileSync(ap, "utf8")) as { beats: { label: string }[] };
      for (const b of parsed.beats ?? []) beatAnalysis[(b as { label: string }).label] = b as never;
    }
  } catch {
    // a missing or malformed sidecar must not break the review screen
  }
  const cutFile = findCutFile(project);
  const graphicsFile = findGraphicsFile(project);
  const cutStale = isCutStale(project, cutFile);
  // Live edit plays the raw file directly, so whether that file is really on
  // this machine decides what the player can honestly offer. These projects
  // came from iCloud and the footage is often still a placeholder.
  let hasSource = false;
  try {
    hasSource = !!beats.source && fs.statSync(path.join(projectDir(project), beats.source)).size > 0;
  } catch {
    hasSource = false;
  }
  // The EDL describes a RENDER. With no cut on disk it is either left over
  // from a build that was deleted, or from beats that have since changed --
  // either way it would lay the timeline out against a file that isn't there.
  const edl = readEdl(project, !!cutFile);
  // A 720p copy of the source with dense keyframes. Same timeline, same
  // timestamps -- but seeking lands ~13x faster, which is the difference
  // between Live edit hitching at every cut and playing straight through.
  const sourceProxy = fs.existsSync(path.join(projectDir(project), "work", "source-proxy.mp4"))
    ? "work/source-proxy.mp4"
    : null;
  const words = loadTranscriptWords(project);
  const wordBoundaryFlags = words ? computeWordBoundaryFlags(words, beats.beats) : [];

  // Word-cutoff is pure maths over transcript.json -- cheap, always fresh.
  const metrics = [computeWordCutoffMetric(project, beats.beats)];

  // Take quality, straight from the drafter. Without this the scorecard read
  // 100/100 on footage where a third of the beats were flagged, because word
  // cutoffs were the only thing it looked at.
  const analysisValues = Object.values(beatAnalysis);
  if (analysisValues.length) {
    const flagged = analysisValues.filter((a) => a.needs_review).length;
    const mean = analysisValues.reduce((sum, a) => sum + a.confidence, 0) / analysisValues.length;
    metrics.push({
      key: "take_confidence",
      label: "Take quality",
      value: Math.round(mean * 100),
      note: flagged
        ? `${flagged} of ${analysisValues.length} beats scored below the bar`
        : `all ${analysisValues.length} beats above the bar`,
    });
  } else {
    metrics.push({ key: "take_confidence", label: "Take quality", value: null, note: "needs a drafted beat list" });
  }

  // verify_cut.py and compare_to_reference.py are NOT run here. verify_cut
  // transcribes the entire cut with Whisper; doing that inline made this
  // endpoint hang the review screen on "Loading…". They run as part of the
  // build job, and their results are cached against the cut they describe.
  const avail = checkAvailability();
  const cached = state.checks;
  if (cutFile && cached && cached.cutFile === cutFile) {
    metrics.push(...cached.metrics);
  } else {
    metrics.push({
      key: "repeats",
      label: "Repeated phrases",
      value: null,
      note: cutFile ? "not checked yet — run checks on this cut" : "needs a built cut",
    });
    metrics.push({
      key: "pacing",
      label: "Pacing vs. house style",
      value: null,
      note: cutFile ? "not checked yet — run checks on this cut" : "needs a built cut",
    });
  }

  const scorecard = buildScorecard(metrics);

  // Where each beat lands in the CUT's own timeline, so the player can
  // highlight the line currently being spoken. work/edl.json holds the
  // rendered pieces in order; a beat may be several pieces when an internal
  // pause was trimmed, so they are summed back together per beat.
  const cutTimeline: { label: string; start: number; end: number }[] = [];
  try {
    const edlPath = path.join(projectDir(project), "work", "edl.json");
    if (fs.existsSync(edlPath)) {
      const edl = JSON.parse(fs.readFileSync(edlPath, "utf8")) as { label: string; dur: number }[];
      let t = 0;
      for (const piece of edl) {
        const base = /-\d+$/.test(piece.label) ? piece.label.replace(/-\d+$/, "") : piece.label;
        const last = cutTimeline[cutTimeline.length - 1];
        if (last && last.label === base) {
          last.end = t + piece.dur;
        } else {
          cutTimeline.push({ label: base, start: t, end: t + piece.dur });
        }
        t += piece.dur;
      }
    }
  } catch {
    // no timeline just means no highlighting; never break the page for it
  }

  return NextResponse.json({
    project,
    beats: beats.beats,
    source: beats.source,
    notes: beats.notes,
    reviewState: state,
    cutFile,
    graphicsFile,
    sourceProxy,
    cutStale,
    hasSource,
    scorecard,
    wordBoundaryFlags,
    beatAnalysis,
    cutTimeline,
    hasTranscript: words !== null,
    // the waveform under a trim labels each word, so the cut point can be
    // read against the speech instead of guessed at
    words: words ?? [],
    // What build_cut actually assembled: one entry per rendered piece, with
    // the source range it came from. A beat can be several pieces when an
    // internal pause was trimmed out, and the durations here are the real
    // rendered ones -- summing beats gives 2:17 where the file is 1:58.
    edl,
    pipelineAvailability: avail,
  });
}

/**
 * Remove a project.
 *
 * It is MOVED to ugc-edit-system/.trash, not deleted. A project directory
 * holds the raw footage -- for img9817 that is the only copy of a 1.4GB
 * original -- and an irreversible rm behind one button is not a risk worth
 * taking for a tidier list. Recovering it is a mv.
 *
 * ?purge=1 deletes for real, and is only ever reached by someone who has
 * already emptied the trash deliberately.
 */
export async function DELETE(req: NextRequest, { params }: { params: { project: string } }) {
  const { project } = params;

  let dir: string;
  try {
    dir = projectDir(project);
  } catch {
    return NextResponse.json({ error: "invalid project name" }, { status: 400 });
  }
  if (project.startsWith("_")) {
    return NextResponse.json({ error: "that's a template, not a project" }, { status: 400 });
  }
  if (!fs.existsSync(dir)) {
    return NextResponse.json({ error: `no project '${project}'` }, { status: 404 });
  }

  const purge = req.nextUrl.searchParams.get("purge") === "1";
  if (purge) {
    fs.rmSync(dir, { recursive: true, force: true });
    return NextResponse.json({ ok: true, purged: true });
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const trashDir = TRASH_ROOT;
  fs.mkdirSync(trashDir, { recursive: true });
  const dest = path.join(trashDir, `${project}-${stamp}`);
  fs.renameSync(dir, dest);

  // what was actually moved, so the answer isn't "it's gone somewhere"
  let bytes = 0;
  const walk = (d: string) => {
    for (const f of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, f.name);
      if (f.isDirectory()) walk(full);
      else if (f.isFile()) { try { bytes += fs.statSync(full).size; } catch { /* skip */ } }
    }
  };
  try { walk(dest); } catch { /* best effort */ }

  return NextResponse.json({
    ok: true,
    movedTo: path.relative(DATA_ROOT, dest),
    bytes,
  });
}
