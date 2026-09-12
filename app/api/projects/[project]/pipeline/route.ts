import { NextRequest, NextResponse } from "next/server";
import path from "node:path";
import fs from "node:fs";
import { checkAvailability, runBuildJob, runCheckJob, runTranscribeJob, runSourceProxyJob, runDraftBeatsJob, runAutoPipelineJob } from "@/lib/pipeline";
import { loadBeats, saveBeats } from "@/lib/beats";
import { projectDir } from "@/lib/paths";
import { createJob, failJob, runningJob } from "@/lib/jobs";
import { readJsonObject } from "@/lib/requestBody";

/* Never prerendered. Every route here answers from the filesystem or from
   live job state, and Next will happily freeze a GET-only route at build
   time: /api/jobs/running shipped as a permanent {"job":null}, which is why
   the queue's progress bar never moved in the built app and always worked in
   dev. */
export const dynamic = "force-dynamic";

type Body = {
  step: "transcribe" | "draft-beats" | "build" | "check" | "source-proxy" | "auto";
  /**
   * True when the app asked for this build rather than the person.
   *
   * The auto-apply after an edit used to post a body identical to the Build
   * button's, so the server could not tell them apart and rendered every
   * automatic re-export at full resolution -- 24.7x the bytes for deleting
   * one line (ledger S42). An automatic build keeps the resolution of the cut
   * already on disk; an explicit one is free to change it.
   */
  auto?: boolean;
};

/**
 * Runs one step of the existing pipeline against a real project. Every step
 * needs python3 + ffmpeg (+ faster-whisper for transcribe/draft-beats) —
 * none of which are installed on this dev machine, so this returns a clear
 * 503 with what's missing instead of hanging or silently no-op'ing.
 */
export async function POST(req: NextRequest, { params }: { params: { project: string } }) {
  const { project } = params;
  let body: Body;
  const parsed = await readJsonObject(req);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
  body = parsed.body as typeof body;
  const avail = checkAvailability();

  if (!avail.python3 || !avail.ffmpeg) {
    return NextResponse.json(
      {
        error: "pipeline tools not available in this environment",
        availability: avail,
        hint: "Run this on the Mac with the venv set up (see ugc-edit-system/SETUP.md), or use Claude Code's /new-video and /build commands directly.",
      },
      { status: 503 }
    );
  }

  const beats = loadBeats(project);
  if (!beats) return NextResponse.json({ error: `no project '${project}'` }, { status: 404 });
  const rawPath = path.join(projectDir(project), beats.source);
  const workDir = path.join(projectDir(project), "work");

  // One heavy job at a time, whichever kind. Transcribe and build both pin
  // the CPU; running them together is what crashed this machine.
  const busy = runningJob();
  if (busy) {
    return NextResponse.json(
      {
        error: `already running ${busy.step} on "${busy.project}" — one at a time, so the machine stays usable`,
        runningJobId: busy.id,
      },
      { status: 409 }
    );
  }

  if (body.step === "auto") {
    if (!avail.fasterWhisper) {
      return NextResponse.json({ error: "faster-whisper not installed" }, { status: 503 });
    }
    if (!fs.existsSync(rawPath)) {
      return NextResponse.json({ error: `raw footage not found at ${beats.source}` }, { status: 404 });
    }
    const job = createJob(project, "auto");
    runAutoPipelineJob(job.id, project).catch((e) =>
      failJob(job.id, e instanceof Error ? e.message : String(e)));
    return NextResponse.json({ jobId: job.id }, { status: 202 });
  }

  if (body.step === "source-proxy") {
    if (!fs.existsSync(rawPath)) {
      return NextResponse.json({ error: `raw footage not found at ${beats.source}` }, { status: 404 });
    }
    const job = createJob(project, "source-proxy");
    runSourceProxyJob(job.id, project).catch((e) =>
      failJob(job.id, e instanceof Error ? e.message : String(e)));
    return NextResponse.json({ jobId: job.id }, { status: 202 });
  }

  if (body.step === "transcribe") {
    if (!avail.fasterWhisper) {
      return NextResponse.json({ error: "faster-whisper not installed", availability: avail }, { status: 503 });
    }
    if (!fs.existsSync(rawPath)) {
      return NextResponse.json({ error: `raw footage not found at ${beats.source}` }, { status: 404 });
    }
    const job = createJob(project, "transcribe");
    runTranscribeJob(job.id, project).catch((err) => {
      failJob(job.id, err instanceof Error ? err.message : String(err));
    });
    return NextResponse.json({ jobId: job.id }, { status: 202 });
  }

  if (body.step === "draft-beats") {
    const job = createJob(project, "draft-beats");
    runDraftBeatsJob(job.id, project).catch((e) =>
      failJob(job.id, e instanceof Error ? e.message : String(e)));
    return NextResponse.json({ jobId: job.id }, { status: 202 });
  }

  // Re-score the cut that already exists. Cheap next to a rebuild -- it reads
  // files rather than re-encoding them -- and it is the only way to recover a
  // check that was computed while one of the two tools was broken.
  if (body.step === "check") {
    const job = createJob(project, "check");
    runCheckJob(job.id, project).catch((e) =>
      failJob(job.id, e instanceof Error ? e.message : String(e)));
    return NextResponse.json({ jobId: job.id }, { status: 202 });
  }

  if (body.step === "build") {
    if (body.auto !== undefined && typeof body.auto !== "boolean") {
      return NextResponse.json({ error: "auto must be a boolean" }, { status: 400 });
    }
    const job = createJob(project, "build");
    // Fire and forget — a real render can take minutes; the client polls
    // /pipeline/jobs/[id] for progress instead of holding this request open.
    runBuildJob(job.id, project, { keepResolution: body.auto === true }).catch((err) => {
      // runBuildJob handles its own failJob() calls; this only catches a
      // genuinely unexpected throw so the job doesn't hang as "running" forever.
      failJob(job.id, err instanceof Error ? err.message : String(err));
    });
    return NextResponse.json({ jobId: job.id }, { status: 202 });
  }

  return NextResponse.json({ error: "unknown step" }, { status: 400 });
}

export async function GET() {
  return NextResponse.json({ availability: checkAvailability() });
}

// Save beats.json edits made from the review UI's beat editor.
export async function PATCH(req: NextRequest, { params }: { params: { project: string } }) {
  const { project } = params;
  let body: { beats?: unknown };
  const parsed = await readJsonObject(req);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
  body = parsed.body as typeof body;
  const existing = loadBeats(project);
  if (!existing) return NextResponse.json({ error: `no project '${project}'` }, { status: 404 });

  // beats.json is what build_cut.py reads. An unchecked write here corrupts
  // the edit itself, so every entry is validated before anything is saved.
  if (!Array.isArray(body.beats)) {
    return NextResponse.json({ error: "beats must be an array" }, { status: 400 });
  }
  /* Undo restores a beat list. Rebuilding each beat from a fixed list of
     fields silently dropped everything else on it -- holes, fades, detached
     audio -- so pressing undo once after cutting a stretch out threw away
     work that had nothing to do with the thing being undone. The validated
     fields are checked and normalised; everything else on the beat is carried
     through untouched. */
  const clean: Record<string, unknown>[] = [];
  for (const [i, raw] of body.beats.entries()) {
    const b = raw as { label?: unknown; start?: unknown; end?: unknown; text?: unknown };
    if (typeof b?.label !== "string" || !b.label) {
      return NextResponse.json({ error: `beat ${i}: label must be a non-empty string` }, { status: 400 });
    }
    if (typeof b.start !== "number" || typeof b.end !== "number" ||
        !Number.isFinite(b.start) || !Number.isFinite(b.end)) {
      return NextResponse.json({ error: `beat ${i} (${b.label}): start and end must be numbers` }, { status: 400 });
    }
    if (b.start < 0) {
      return NextResponse.json({ error: `beat ${i} (${b.label}): start cannot be negative` }, { status: 400 });
    }
    if (b.end - b.start < 0.15) {
      return NextResponse.json({ error: `beat ${i} (${b.label}): must be at least 0.15s long` }, { status: 400 });
    }
    if (b.text !== undefined && typeof b.text !== "string") {
      return NextResponse.json({ error: `beat ${i} (${b.label}): text must be a string` }, { status: 400 });
    }
    clean.push({
      ...(raw as Record<string, unknown>),          // holes, fades, detached audio
      label: b.label,
      start: b.start,
      end: b.end,
      ...(b.text === undefined ? {} : { text: b.text }),
    });
  }
  existing.beats = clean as unknown as typeof existing.beats;
  // Undoing to the state you are already in writes nothing. Saying "Undid
  // that trim" anyway is the same lie in a quieter place -- the history moved
  // and the edit did not.
  const changed = saveBeats(project, existing, "undo");
  return NextResponse.json({
    ok: true, changed,
    ...(changed ? {} : { unchanged: "there was nothing to undo" }),
  });
}
