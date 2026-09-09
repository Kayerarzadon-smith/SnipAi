import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { projectDir } from "@/lib/paths";
import { loadBeats, findCutFile } from "@/lib/beats";
import { runTool, checkAvailability } from "@/lib/pipeline";

/* Never prerendered. Every route here answers from the filesystem or from
   live job state, and Next will happily freeze a GET-only route at build
   time: /api/jobs/running shipped as a permanent {"job":null}, which is why
   the queue's progress bar never moved in the built app and always worked in
   dev. */
export const dynamic = "force-dynamic";

/**
 * A strip of real frames for a timeline.
 *
 * ?of=cut          the built cut, end to end (the "needs fixes" scrubber)
 * ?of=source&start=&end=   a window of the raw file (behind a trim)
 *
 * Cached on disk by its parameters, because the answer never changes for a
 * given file and range. The cut is sampled from the 720p proxy rather than
 * the 4K source — same pictures, a fraction of the decode.
 */
export async function GET(req: NextRequest, { params }: { params: { project: string } }) {
  const { project } = params;

  let dir: string;
  try {
    dir = projectDir(project);
  } catch {
    return NextResponse.json({ error: "invalid project name" }, { status: 400 });
  }
  const beats = loadBeats(project);
  if (!beats) return NextResponse.json({ error: `no project '${project}'` }, { status: 404 });

  const q = req.nextUrl.searchParams;
  const of = q.get("of") === "source" ? "source" : "cut";
  const count = Math.max(4, Math.min(120, Number(q.get("count") ?? 40)));
  const aspect = q.get("aspect") === "tall" ? "tall" : "square";
  const start = Math.max(0, Number(q.get("start") ?? 0));
  const end = Number(q.get("end") ?? 0);

  let input: string;
  let realEnd = end;
  if (of === "cut") {
    const cut = findCutFile(project);
    if (!cut) return NextResponse.json({ error: "no cut built yet" }, { status: 404 });
    input = path.join(dir, "cuts", cut);
    // the cut's own length; build_cut wrote the timeline, so sum the beats
    if (!realEnd) realEnd = beats.beats.reduce((s, b) => s + Math.max(0, b.end - b.start), 0);
    // a window of the cut is as valid a request as the whole thing
  } else {
    input = path.join(dir, beats.source);
    if (!realEnd || realEnd <= start) {
      return NextResponse.json({ error: "start and end are required for a source strip" }, { status: 400 });
    }
  }
  if (!fs.existsSync(input)) {
    return NextResponse.json({ error: "that file isn't on this machine" }, { status: 404 });
  }
  if (!Number.isFinite(start) || !Number.isFinite(realEnd) || realEnd <= start) {
    return NextResponse.json({ error: "bad range" }, { status: 400 });
  }

  const key = `strip-${of}-${aspect}-${start.toFixed(2)}-${realEnd.toFixed(2)}-${count}.jpg`;
  const outPath = path.join(dir, "work", "strips", key);

  if (!fs.existsSync(outPath)) {
    const avail = checkAvailability();
    if (!avail.python3 || !avail.ffmpeg) {
      return NextResponse.json({ error: "ffmpeg not available", availability: avail }, { status: 503 });
    }
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    const res = await runTool("filmstrip.py", [
      `projects/${project}`,
      "--input", input,
      "--start", String(start),
      "--end", String(realEnd),
      "--count", String(count),
      "--size", "64",
      "--aspect", aspect,
      "-o", outPath,
    ]);
    if (!res.ok || !fs.existsSync(outPath)) {
      return NextResponse.json({ error: "could not build the strip", log: res.stdout }, { status: 500 });
    }
  }

  const buf = fs.readFileSync(outPath);
  return new NextResponse(new Uint8Array(buf), {
    headers: {
      "Content-Type": "image/jpeg",
      "Content-Length": String(buf.length),
      "Cache-Control": "private, max-age=86400",
      "X-Frame-Count": String(count),
    },
  });
}
