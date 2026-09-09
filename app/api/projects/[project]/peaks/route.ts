import { NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { projectDir } from "@/lib/paths";
import { loadBeats } from "@/lib/beats";
import { runTool, checkAvailability } from "@/lib/pipeline";

/* Never prerendered. Every route here answers from the filesystem or from
   live job state, and Next will happily freeze a GET-only route at build
   time: /api/jobs/running shipped as a permanent {"job":null}, which is why
   the queue's progress bar never moved in the built app and always worked in
   dev. */
export const dynamic = "force-dynamic";

/**
 * The audio envelope for a project, used to draw the waveform behind a trim.
 *
 * Generated once per source and cached in work/peaks.json — the whole 8:46
 * take takes about a second, and without it trimming is typing numbers at a
 * black box.
 */
export async function GET(_req: Request, { params }: { params: { project: string } }) {
  const { project } = params;

  let dir: string;
  try {
    dir = projectDir(project);
  } catch {
    return NextResponse.json({ error: "invalid project name" }, { status: 400 });
  }

  const beats = loadBeats(project);
  if (!beats) return NextResponse.json({ error: `no project '${project}'` }, { status: 404 });

  const peaksPath = path.join(dir, "work", "peaks.json");
  if (!fs.existsSync(peaksPath)) {
    const src = path.join(dir, beats.source);
    if (!fs.existsSync(src)) {
      return NextResponse.json({ error: "raw footage isn't on this machine" }, { status: 404 });
    }
    const avail = checkAvailability();
    if (!avail.python3 || !avail.ffmpeg) {
      return NextResponse.json({ error: "ffmpeg not available", availability: avail }, { status: 503 });
    }
    // Cheap enough to do inline: audio only, ~1.4s for a nine-minute take.
    const res = await runTool("audio_peaks.py", [`projects/${project}`]);
    if (!res.ok || !fs.existsSync(peaksPath)) {
      return NextResponse.json({ error: "could not read the audio", log: res.stdout }, { status: 500 });
    }
  }

  try {
    const body = fs.readFileSync(peaksPath, "utf8");
    return new NextResponse(body, {
      headers: {
        "Content-Type": "application/json",
        // keyed to the file's mtime by the client; safe to hold onto
        "Cache-Control": "private, max-age=3600",
      },
    });
  } catch {
    return NextResponse.json({ error: "could not read peaks" }, { status: 500 });
  }
}
