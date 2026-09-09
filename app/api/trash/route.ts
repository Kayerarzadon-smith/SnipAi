import { NextRequest, NextResponse } from "next/server";
import { listTrash, restoreFromTrash, purgeOne, RETAIN_DAYS } from "@/lib/trash";

/* Never prerendered. Every route here answers from the filesystem or from
   live job state, and Next will happily freeze a GET-only route at build
   time: /api/jobs/running shipped as a permanent {"job":null}, which is why
   the queue's progress bar never moved in the built app and always worked in
   dev. */
export const dynamic = "force-dynamic";

/** What's in the trash, and how long each item has left. Purges as it reads. */
export async function GET() {
  return NextResponse.json({ items: listTrash(), retainDays: RETAIN_DAYS });
}

/** Put one back, or erase it now. */
export async function POST(req: NextRequest) {
  let body: { action?: unknown; id?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "body must be JSON" }, { status: 400 });
  }
  if (typeof body.id !== "string") {
    return NextResponse.json({ error: "id is required" }, { status: 400 });
  }
  if (body.action === "restore") {
    const r = restoreFromTrash(body.id);
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: 400 });
    return NextResponse.json({ ok: true, project: r.project });
  }
  if (body.action === "purge") {
    if (!purgeOne(body.id)) {
      return NextResponse.json({ error: "not in the trash" }, { status: 404 });
    }
    return NextResponse.json({ ok: true, purged: true });
  }
  return NextResponse.json({ error: "action must be 'restore' or 'purge'" }, { status: 400 });
}
