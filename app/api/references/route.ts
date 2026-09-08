import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs";
import { writeJsonAtomic } from "@/lib/jsonStore";
import path from "node:path";
import { PIPELINE_ROOT } from "@/lib/paths";
import { runTool, checkAvailability } from "@/lib/pipeline";
import { createJob, failJob, runningJob, appendLog, finishJob } from "@/lib/jobs";

const REF_DIR = path.join(PIPELINE_ROOT, "reference", "inspiration");
const STYLE = path.join(PIPELINE_ROOT, "reference", "house-style.json");
const VIDEO = /\.(mp4|mov|m4v|webm)$/i;

type Measured = {
  file: string;
  bytes: number;
  measuredAt?: string;
  duration?: number;
  segments?: number;
  seconds_per_cut?: number;
  words_per_second?: number;
  segment_seconds?: { min: number; median: number; max: number };
};

function readAll(): Measured[] {
  if (!fs.existsSync(REF_DIR)) return [];
  return fs.readdirSync(REF_DIR)
    .filter((f) => VIDEO.test(f))
    .map((file) => {
      const out: Measured = { file, bytes: 0 };
      try { out.bytes = fs.statSync(path.join(REF_DIR, file)).size; } catch { /* skip */ }
      const j = path.join(REF_DIR, file.replace(VIDEO, "") + ".style.json");
      if (fs.existsSync(j)) {
        try { Object.assign(out, JSON.parse(fs.readFileSync(j, "utf8"))); } catch { /* skip */ }
      }
      return out;
    });
}

export async function GET() {
  let target: unknown = null;
  try { target = JSON.parse(fs.readFileSync(STYLE, "utf8")); } catch { /* none yet */ }
  return NextResponse.json({ references: readAll(), target, availability: checkAvailability() });
}

/** Add a reference video to learn a style from. */
export async function PUT(req: NextRequest) {
  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return NextResponse.json({ error: "no video received" }, { status: 400 });
  }
  if (!VIDEO.test(file.name)) {
    return NextResponse.json({ error: `${file.name} isn't a video` }, { status: 400 });
  }
  if (file.size > 600 * 1024 * 1024) {
    return NextResponse.json({ error: "that file is too big for a reference" }, { status: 413 });
  }
  fs.mkdirSync(REF_DIR, { recursive: true });
  const safe = path.basename(file.name).replace(/[^a-zA-Z0-9._-]/g, "_");
  fs.writeFileSync(path.join(REF_DIR, safe), Buffer.from(await file.arrayBuffer()));
  return NextResponse.json({ ok: true, file: safe }, { status: 201 });
}

/** Measure them all, then average into the target the drafter aims at. */
export async function POST(req: NextRequest) {
  let body: { action?: unknown; file?: unknown };
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: "body must be JSON" }, { status: 400 });
  }

  if (body.action === "remove") {
    if (typeof body.file !== "string" || body.file.includes("/") || body.file.includes("..")) {
      return NextResponse.json({ error: "bad file" }, { status: 400 });
    }
    for (const f of [body.file, body.file.replace(VIDEO, "") + ".style.json"]) {
      const p = path.join(REF_DIR, f);
      if (fs.existsSync(p)) fs.rmSync(p);
    }
    return NextResponse.json({ ok: true });
  }

  if (body.action !== "measure") {
    return NextResponse.json({ error: "action must be 'measure' or 'remove'" }, { status: 400 });
  }

  const avail = checkAvailability();
  if (!avail.python3 || !avail.ffmpeg || !avail.fasterWhisper) {
    return NextResponse.json({ error: "the analysis tools aren't set up", availability: avail }, { status: 503 });
  }
  const busy = runningJob();
  if (busy) {
    return NextResponse.json(
      { error: `already running ${busy.step} on "${busy.project}"` }, { status: 409 });
  }

  const job = createJob("references", "measure-references");
  measureAll(job.id).catch((e) => failJob(job.id, e instanceof Error ? e.message : String(e)));
  return NextResponse.json({ jobId: job.id }, { status: 202 });
}

/**
 * Measure every reference, then take the MEDIAN of each figure.
 *
 * A median rather than a mean: one unusually long or frantic reference
 * shouldn't drag the target, and the point is the shape these videos have in
 * common. Fields the measurement genuinely can't recover from a finished cut
 * -- whether there are captions, whether there's a music bed -- are carried
 * over from the existing target rather than invented.
 */
async function measureAll(jobId: string) {
  const log = (l: string) => appendLog(jobId, l);
  const files = readAll();
  if (!files.length) { failJob(jobId, "no reference videos to measure"); return; }

  const measured: Record<string, unknown>[] = [];
  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    log(`measuring ${f.file}...`);
    appendLog(jobId, `PROGRESS ${Math.round((i / files.length) * 95)}`);
    const outJson = path.join(REF_DIR, f.file.replace(VIDEO, "") + ".style.json");
    const res = await runTool("measure_finished.py",
      [path.join(REF_DIR, f.file), "-o", outJson], { onLine: log });
    if (!res.ok) { log(`  could not measure ${f.file}`); continue; }
    try {
      const d = JSON.parse(fs.readFileSync(outJson, "utf8"));
      d.measuredAt = new Date().toISOString();
      writeJsonAtomic(outJson, d);
      measured.push(d);
    } catch { /* skip */ }
  }

  if (!measured.length) { failJob(jobId, "nothing could be measured"); return; }

  const med = (key: string): number | null => {
    const vals = measured.map((m) => Number(m[key])).filter((n) => Number.isFinite(n)).sort((a, b) => a - b);
    return vals.length ? Math.round(vals[Math.floor(vals.length / 2)] * 100) / 100 : null;
  };
  let prev: Record<string, unknown> = {};
  try { prev = JSON.parse(fs.readFileSync(STYLE, "utf8")); } catch { /* first time */ }

  const target = {
    ...prev,
    measured_from: measured.map((_, i) => `inspiration/${files[i].file}`),
    how: "tools/measure_finished.py across reference/inspiration — median of them all",
    duration: med("duration"),
    segments: med("segments"),
    seconds_per_cut: med("seconds_per_cut"),
    words_per_second: med("words_per_second"),
    segment_seconds: {
      min: med("segment_min") ?? (prev.segment_seconds as { min?: number })?.min ?? null,
      median: med("segment_median") ?? (prev.segment_seconds as { median?: number })?.median ?? null,
      max: med("segment_max") ?? (prev.segment_seconds as { max?: number })?.max ?? null,
    },
    references_analysed: measured.length,
    updated: new Date().toISOString(),
  };
  writeJsonAtomic(STYLE, target);
  log(`target style updated from ${measured.length} reference(s)`);
  appendLog(jobId, "PROGRESS 100");
  finishJob(jobId);
}
