import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { runTool, checkAvailability } from "@/lib/pipeline";

/* Never prerendered. Every route here answers from the filesystem or from
   live job state, and Next will happily freeze a GET-only route at build
   time: /api/jobs/running shipped as a permanent {"job":null}, which is why
   the queue's progress bar never moved in the built app and always worked in
   dev. */
export const dynamic = "force-dynamic";

export const runtime = "nodejs";

/**
 * Turn a spoken instruction into text, on this machine.
 *
 * The recording is posted as a blob, written to a temp file, transcribed with
 * the same local faster-whisper the rest of the pipeline uses, and deleted.
 * Nothing is uploaded anywhere -- the point of doing the whole pipeline
 * locally is lost if the microphone is the exception.
 */
export async function POST(req: NextRequest) {
  const avail = checkAvailability();
  if (!avail.python3 || !avail.fasterWhisper || !avail.ffmpeg) {
    return NextResponse.json(
      { error: "speech recognition isn't set up on this machine", availability: avail },
      { status: 503 }
    );
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "expected an audio upload" }, { status: 400 });
  }
  const file = form.get("audio");
  if (!(file instanceof File) || file.size === 0) {
    return NextResponse.json({ error: "no audio received" }, { status: 400 });
  }
  if (file.size > 25 * 1024 * 1024) {
    return NextResponse.json({ error: "that recording is too long" }, { status: 413 });
  }

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "snipai-voice-"));
  const src = path.join(dir, "note.webm");
  try {
    fs.writeFileSync(src, Buffer.from(await file.arrayBuffer()));
    const res = await runTool("transcribe_note.py", [src]);
    if (!res.ok) {
      return NextResponse.json({ error: "could not transcribe that", log: res.stdout }, { status: 500 });
    }
    const text = res.stdout.trim();
    return NextResponse.json({ text });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
