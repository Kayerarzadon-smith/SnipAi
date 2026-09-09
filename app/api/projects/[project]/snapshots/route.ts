import { NextRequest, NextResponse } from "next/server";
import { assertValidProjectName } from "@/lib/paths";
import { list, restore } from "@/lib/snapshots";

/* Never prerendered. Every route here answers from the filesystem or from
   live job state, and Next will happily freeze a GET-only route at build
   time: /api/jobs/running shipped as a permanent {"job":null}, which is why
   the queue's progress bar never moved in the built app and always worked in
   dev. */
export const dynamic = "force-dynamic";

/**
 * The edit's history.
 *
 * Every write to beats.json leaves a copy behind, so this is a complete
 * record of the edit going back a session or more -- including edits made
 * from somewhere other than the review screen, and edits made before the
 * page was last reloaded, neither of which the in-memory undo stack knows
 * anything about.
 */

export async function GET(
  _req: NextRequest,
  { params }: { params: { project: string } }
) {
  try {
    assertValidProjectName(params.project);
  } catch {
    return NextResponse.json({ error: "invalid project name" }, { status: 400 });
  }
  return NextResponse.json({ snapshots: list(params.project) });
}

/** Put one back. The current state is snapshotted first, so this is undoable
 *  in exactly the same way everything else is. */
export async function POST(
  req: NextRequest,
  { params }: { params: { project: string } }
) {
  try {
    assertValidProjectName(params.project);
  } catch {
    return NextResponse.json({ error: "invalid project name" }, { status: 400 });
  }

  let body: { id?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "body must be JSON" }, { status: 400 });
  }
  if (typeof body.id !== "string") {
    return NextResponse.json({ error: "id must be a snapshot name" }, { status: 400 });
  }

  try {
    restore(params.project, body.id);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "could not restore that";
    // a bad name is the caller's fault; a missing file is not found
    const status = /not a snapshot name/.test(msg) ? 400 : 404;
    return NextResponse.json({ error: msg }, { status });
  }
  return NextResponse.json({ restored: body.id, snapshots: list(params.project) });
}
