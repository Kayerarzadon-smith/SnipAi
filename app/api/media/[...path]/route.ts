import { NextRequest } from "next/server";
import fs from "node:fs";
import { Readable } from "node:stream";
import { resolveMediaPath } from "@/lib/paths";

/* Never prerendered. Every route here answers from the filesystem or from
   live job state, and Next will happily freeze a GET-only route at build
   time: /api/jobs/running shipped as a permanent {"job":null}, which is why
   the queue's progress bar never moved in the built app and always worked in
   dev. */
export const dynamic = "force-dynamic";

export const runtime = "nodejs";

function webStream(nodeStream: fs.ReadStream): ReadableStream {
  return Readable.toWeb(nodeStream) as unknown as ReadableStream;
}

const MIME: Record<string, string> = {
  ".mp4": "video/mp4",
  ".mov": "video/quicktime",
  ".m4a": "audio/mp4",
  ".wav": "audio/wav",
};

/**
 * Streams a file from ugc-edit-system/projects/** with HTTP Range support,
 * required for video scrubbing. Path-traversal guarded via resolveMediaPath.
 */
export async function GET(req: NextRequest, { params }: { params: { path: string[] } }) {
  let filePath: string;
  try {
    filePath = resolveMediaPath(params.path);
  } catch {
    return new Response("Forbidden", { status: 403 });
  }

  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    return new Response("Not found", { status: 404 });
  }

  const stat = fs.statSync(filePath);
  const ext = filePath.slice(filePath.lastIndexOf(".")).toLowerCase();
  const contentType = MIME[ext] ?? "application/octet-stream";

  const range = req.headers.get("range");
  if (!range) {
    const stream = fs.createReadStream(filePath);
    return new Response(webStream(stream), {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Content-Length": String(stat.size),
        "Accept-Ranges": "bytes",
      },
    });
  }

  const match = /bytes=(\d*)-(\d*)/.exec(range);
  if (!match) {
    return new Response("Malformed Range header", { status: 416 });
  }
  let start: number;
  let end: number;
  if (!match[1] && match[2]) {
    // "bytes=-500" is the LAST 500 bytes, not the first 500. Players use this
    // to find the moov atom in a file that wasn't written faststart.
    const suffix = Math.min(parseInt(match[2], 10), stat.size);
    if (suffix <= 0) {
      return new Response("Range Not Satisfiable", {
        status: 416, headers: { "Content-Range": `bytes */${stat.size}` },
      });
    }
    start = stat.size - suffix;
    end = stat.size - 1;
  } else {
    start = match[1] ? parseInt(match[1], 10) : 0;
    end = match[2] ? parseInt(match[2], 10) : stat.size - 1;
  }
  if (start >= stat.size || end >= stat.size || start > end) {
    return new Response("Range Not Satisfiable", { status: 416, headers: { "Content-Range": `bytes */${stat.size}` } });
  }

  const stream = fs.createReadStream(filePath, { start, end });
  return new Response(webStream(stream), {
    status: 206,
    headers: {
      "Content-Type": contentType,
      "Content-Length": String(end - start + 1),
      "Content-Range": `bytes ${start}-${end}/${stat.size}`,
      "Accept-Ranges": "bytes",
    },
  });
}
