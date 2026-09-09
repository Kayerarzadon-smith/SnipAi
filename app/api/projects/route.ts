import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { projectDir, assertValidProjectName, PROJECTS_ROOT } from "@/lib/paths";
import { VIDEO_EXT, VIDEO_EXT_LIST } from "@/lib/videoFiles";
import { saveBeats } from "@/lib/beats";
import { summarizeAllProjects } from "@/lib/projectSummary";
import { runningJob } from "@/lib/jobs";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

/* Never prerendered. Every route here answers from the filesystem or from
   live job state, and Next will happily freeze a GET-only route at build
   time: /api/jobs/running shipped as a permanent {"job":null}, which is why
   the queue's progress bar never moved in the built app and always worked in
   dev. */
export const dynamic = "force-dynamic";

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

/**
 * Footage arrives as a raw body, not multipart, and is streamed to disk.
 *
 * It used to be `await req.formData()` and then
 * `Buffer.from(await file.arrayBuffer())` -- the whole file buffered by the
 * multipart parser, then copied into a second buffer, then written. On a
 * 1.8GB phone clip that is 3.7GB of resident memory for one import, which on
 * this machine meant minutes of swapping, an "importing..." that never
 * finished, and a Mac that fell over. Streaming holds one 64KB chunk at a
 * time no matter how big the file is.
 *
 * The name and filename travel as headers because a raw body cannot carry
 * fields. They are validated exactly as the form fields were.
 */
export async function POST(req: NextRequest) {
  const isRaw = !!req.headers.get("x-snipai-filename");
  let name: string;
  let originalName: string;
  let declaredSize = 0;
  let file: File | null = null;

  if (isRaw) {
    name = (req.headers.get("x-snipai-project") ?? "").trim();
    // a filename can hold anything; it is decoded, then reduced to a basename
    try { originalName = decodeURIComponent(req.headers.get("x-snipai-filename") ?? ""); }
    catch { originalName = req.headers.get("x-snipai-filename") ?? ""; }
    declaredSize = Number(req.headers.get("content-length") ?? 0);
  } else {
    const form = await req.formData();
    name = String(form.get("name") ?? "").trim();
    const f = form.get("file");
    if (!(f instanceof File)) {
      return NextResponse.json({ error: "missing file" }, { status: 400 });
    }
    file = f;
    originalName = f.name;
    declaredSize = f.size;
  }

  if (!name || !/^[a-z0-9-]+$/.test(name)) {
    return NextResponse.json({ error: "project name must be lowercase kebab-case" }, { status: 400 });
  }
  // a 300-character name passes the pattern and then blows up on mkdir
  if (name.length > 64) {
    return NextResponse.json({ error: "project name must be 64 characters or fewer" }, { status: 400 });
  }
  // Only footage. A stray .txt used to create a whole project around a file
  // nothing downstream can read.
  if (!VIDEO_EXT.test(originalName)) {
    return NextResponse.json(
      { error: `${originalName || "that file"} isn't a video — accepted: ${VIDEO_EXT_LIST.join(", ")}` },
      { status: 400 }
    );
  }
  if (declaredSize === 0 && !isRaw) {
    return NextResponse.json({ error: `${originalName} is empty` }, { status: 400 });
  }

  /* Refuse a file the disk cannot hold BEFORE it is sent, not during.
     Running out of space part-way through writes an ENOSPC to the stream,
     the server answers while the browser is still uploading, and the browser
     reports the early close as a network fault -- so "the connection dropped
     mid-import" for a full disk. It reproduced on 1.5GB and not on 300MB,
     because the smaller one finished sending before the answer came back.
     Content-Length is exactly what is about to arrive. */
  if (declaredSize > 0) {
    try {
      fs.mkdirSync(PROJECTS_ROOT, { recursive: true });
      const vfs = fs.statfsSync(PROJECTS_ROOT);
      const free = Number(vfs.bavail) * Number(vfs.bsize);
      // Leave room for the transcript, the silence maps and the proxy, which
      // land right after this and are what the import is for.
      const headroom = 256 * 1024 * 1024;
      if (free < declaredSize + headroom) {
        const gb = (n: number) => `${(n / 1024 ** 3).toFixed(1)} GB`;
        return NextResponse.json(
          { error: `not enough room for ${originalName}: it needs ${gb(declaredSize)} and there is ${gb(free)} free` },
          { status: 507 }
        );
      }
    } catch {
      // statfs is not available everywhere; the write error below still
      // catches it, just later and less clearly
    }
  }

  assertValidProjectName(name);
  const dir = projectDir(name);
  if (fs.existsSync(dir)) {
    return NextResponse.json({ error: `project '${name}' already exists` }, { status: 409 });
  }

  for (const sub of ["raw", "cuts", "work"]) {
    fs.mkdirSync(path.join(dir, sub), { recursive: true });
  }

  const safeFileName = path.basename(originalName).replace(/[^a-zA-Z0-9._-]/g, "_");
  const destPath = path.join(dir, "raw", safeFileName);
  try {
    const body = isRaw ? req.body : file!.stream();
    if (!body) throw new Error("no body to read");
    // Node's stream, so backpressure is real: the socket stops being read
    // while the disk catches up, instead of the whole file piling up in RAM.
    await pipeline(Readable.fromWeb(body as Parameters<typeof Readable.fromWeb>[0]),
                   fs.createWriteStream(destPath));
  } catch (err) {
    // don't leave an empty shell project on the dashboard
    fs.rmSync(dir, { recursive: true, force: true });
    return NextResponse.json(
      { error: `could not save ${safeFileName}: ${(err as Error).message}` },
      { status: 500 }
    );
  }
  const stat = fs.statSync(destPath);
  // A connection dropped halfway leaves a short file that looks like footage
  // and fails four steps later inside ffmpeg. Catch it here, where it can
  // still be described as what it is.
  if (stat.size === 0) {
    fs.rmSync(dir, { recursive: true, force: true });
    return NextResponse.json({ error: `${safeFileName} arrived empty` }, { status: 400 });
  }

  saveBeats(name, {
    source: `raw/${safeFileName}`,
    notes: "Created via SnipAi upload — beats.json not drafted yet. Run the transcribe step, then draft beats.",
    beats: [],
  });

  return NextResponse.json({ project: name, rawFile: safeFileName, sizeBytes: stat.size }, { status: 201 });
}
