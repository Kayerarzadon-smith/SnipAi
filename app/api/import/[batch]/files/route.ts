import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import {
  readBatch,
  recordStagedFile,
  stagedPath,
  refuseFile,
  safeFileName,
  freeBytes,
} from "@/lib/importBatch";
import { VIDEO_EXT_LIST } from "@/lib/videoFiles";

export const dynamic = "force-dynamic";

/**
 * One clip into staging. (DOCKET M0.8)
 *
 * Raw body, streamed to disk, exactly as the old importer did it -- the
 * reasons have not changed: `await req.formData()` followed by
 * `arrayBuffer()` held 3.7GB resident for one 1.8GB phone clip and took this
 * Mac down. The only difference is the destination: a staging directory that
 * belongs to no project, because nothing yet knows what the projects are.
 *
 * The name travels as a header because a raw body cannot carry fields.
 */
export async function POST(req: NextRequest, { params }: { params: { batch: string } }) {
  const batch = readBatch(params.batch);
  if (!batch) return NextResponse.json({ error: `no import ${params.batch}` }, { status: 404 });
  if (batch.status === "importing" || batch.status === "analysing") {
    return NextResponse.json(
      { error: "this import is already under way — start a new one to add more clips" },
      { status: 409 }
    );
  }

  let originalName: string;
  try {
    originalName = decodeURIComponent(req.headers.get("x-snipai-filename") ?? "");
  } catch {
    originalName = req.headers.get("x-snipai-filename") ?? "";
  }
  if (!originalName.trim()) {
    return NextResponse.json({ error: "no filename was sent with the clip" }, { status: 400 });
  }

  const refusal = refuseFile(originalName);
  if (refusal) {
    return NextResponse.json(
      { error: `${refusal} — accepted: ${VIDEO_EXT_LIST.join(", ")}` },
      { status: 400 }
    );
  }

  const declaredSize = Number(req.headers.get("content-length") ?? 0);
  if (declaredSize > 0) {
    const free = freeBytes();
    // Room for the clip, plus the transcript, the maps and the proxy that
    // follow it. Refused before the bytes are sent, not during -- answering
    // mid-upload reads to the browser as a dropped connection.
    const headroom = 256 * 1024 * 1024;
    if (free !== null && free < declaredSize + headroom) {
      const gb = (n: number) => `${(n / 1024 ** 3).toFixed(1)} GB`;
      return NextResponse.json(
        { error: `not enough room for ${originalName}: it needs ${gb(declaredSize)} and there is ${gb(free)} free` },
        { status: 507 }
      );
    }
  }

  let dest: string;
  try {
    dest = stagedPath(params.batch, originalName);
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
  fs.mkdirSync(path.dirname(dest), { recursive: true });

  try {
    if (!req.body) throw new Error("no body to read");
    await pipeline(
      Readable.fromWeb(req.body as Parameters<typeof Readable.fromWeb>[0]),
      fs.createWriteStream(dest)
    );
  } catch (err) {
    fs.rmSync(dest, { force: true });
    return NextResponse.json(
      { error: `could not save ${safeFileName(originalName)}: ${(err as Error).message}` },
      { status: 500 }
    );
  }

  const stat = fs.statSync(dest);
  // A connection dropped halfway leaves a short file that looks like footage
  // and fails four steps later inside ffmpeg.
  if (stat.size === 0) {
    fs.rmSync(dest, { force: true });
    return NextResponse.json({ error: `${safeFileName(originalName)} arrived empty` }, { status: 400 });
  }

  const updated = recordStagedFile(params.batch, originalName, stat.size);
  return NextResponse.json(
    { batch: params.batch, file: safeFileName(originalName), sizeBytes: stat.size, files: updated?.files.length ?? 0 },
    { status: 201 }
  );
}
