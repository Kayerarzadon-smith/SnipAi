import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { projectDir, assertValidProjectName } from "@/lib/paths";
import { saveBeats } from "@/lib/beats";
import { summarizeAllProjects } from "@/lib/projectSummary";
import { runningJob } from "@/lib/jobs";

export async function GET() {
  // the dashboard animates a project's bar only while its job is live
  const busy = runningJob();
  return NextResponse.json({
    projects: summarizeAllProjects(),
    workingOn: busy ? { project: busy.project, step: busy.step, jobId: busy.id } : null,
  });
}

/**
 * Real "drop in raw footage" flow: multipart upload of the source file,
 * creates the same {raw,cuts,work} skeleton /new-video sets up by hand.
 * Does not draft beats.json here — that needs a transcript, which is a
 * separate (optional) pipeline step kicked off from the project page,
 * since it needs python3/ffmpeg/faster-whisper actually installed.
 */
const VIDEO_EXT_LIST = [".mov", ".mp4", ".m4v", ".avi", ".mkv", ".webm"];
const VIDEO_EXT = new RegExp(`(${VIDEO_EXT_LIST.join("|").replace(/\./g, "\\.")})$`, "i");

export async function POST(req: NextRequest) {
  const form = await req.formData();
  const name = String(form.get("name") ?? "").trim();
  const file = form.get("file");

  if (!name || !/^[a-z0-9-]+$/.test(name)) {
    return NextResponse.json({ error: "project name must be lowercase kebab-case" }, { status: 400 });
  }
  // a 300-character name passes the pattern and then blows up on mkdir
  if (name.length > 64) {
    return NextResponse.json({ error: "project name must be 64 characters or fewer" }, { status: 400 });
  }
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "missing file" }, { status: 400 });
  }
  // Only footage. A stray .txt used to create a whole project around a file
  // nothing downstream can read.
  if (!VIDEO_EXT.test(file.name)) {
    return NextResponse.json(
      { error: `${file.name} isn't a video — accepted: ${VIDEO_EXT_LIST.join(", ")}` },
      { status: 400 }
    );
  }
  if (file.size === 0) {
    return NextResponse.json({ error: `${file.name} is empty` }, { status: 400 });
  }

  assertValidProjectName(name);
  const dir = projectDir(name);
  if (fs.existsSync(dir)) {
    return NextResponse.json({ error: `project '${name}' already exists` }, { status: 409 });
  }

  for (const sub of ["raw", "cuts", "work"]) {
    fs.mkdirSync(path.join(dir, sub), { recursive: true });
  }

  const safeFileName = path.basename(file.name).replace(/[^a-zA-Z0-9._-]/g, "_");
  const destPath = path.join(dir, "raw", safeFileName);
  try {
    const buf = Buffer.from(await file.arrayBuffer());
    fs.writeFileSync(destPath, buf);
  } catch (err) {
    // don't leave an empty shell project on the dashboard
    fs.rmSync(dir, { recursive: true, force: true });
    return NextResponse.json(
      { error: `could not save ${safeFileName}: ${(err as Error).message}` },
      { status: 500 }
    );
  }
  const buf = fs.statSync(destPath);

  saveBeats(name, {
    source: `raw/${safeFileName}`,
    notes: "Created via SnipAi upload — beats.json not drafted yet. Run the transcribe step, then draft beats.",
    beats: [],
  });

  return NextResponse.json({ project: name, rawFile: safeFileName, sizeBytes: buf.size }, { status: 201 });
}
