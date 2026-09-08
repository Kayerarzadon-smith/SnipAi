import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { projectDir } from "@/lib/paths";
import { loadBeats, findCutFile } from "@/lib/beats";
import { runTool, checkAvailability } from "@/lib/pipeline";

/**
 * One frame to represent the project.
 *
 * Taken from the built cut when there is one, else from the source at the
 * first beat -- or a little way in, before anything has been drafted, since
 * the first second of a take is usually someone reaching for the record
 * button. Cached on disk; it never changes for a given file.
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

  const cut = findCutFile(project);
  const source = path.join(dir, beats.source);
  const input = cut ? path.join(dir, "cuts", cut) : source;
  if (!fs.existsSync(input)) {
    return NextResponse.json({ error: "nothing to make a thumbnail from" }, { status: 404 });
  }

  const at = cut ? 1.5 : (beats.beats[0]?.start ?? 0) + 0.4;
  const key = `poster-${cut ?? "src"}-${at.toFixed(2)}.jpg`;
  const out = path.join(dir, "work", "strips", key);

  if (!fs.existsSync(out)) {
    const avail = checkAvailability();
    if (!avail.python3 || !avail.ffmpeg) {
      return NextResponse.json({ error: "ffmpeg not available" }, { status: 503 });
    }
    fs.mkdirSync(path.dirname(out), { recursive: true });
    const res = await runTool("filmstrip.py", [
      `projects/${project}`, "--input", input,
      "--start", String(at), "--end", String(at + 0.2),
      "--count", "1", "--size", "160", "-o", out,
    ]);
    if (!res.ok || !fs.existsSync(out)) {
      return NextResponse.json({ error: "could not make a thumbnail" }, { status: 500 });
    }
  }

  const buf = fs.readFileSync(out);
  return new NextResponse(new Uint8Array(buf), {
    headers: {
      "Content-Type": "image/jpeg",
      "Content-Length": String(buf.length),
      "Cache-Control": "private, max-age=86400",
    },
  });
}
