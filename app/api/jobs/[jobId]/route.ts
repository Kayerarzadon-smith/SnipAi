import { NextResponse } from "next/server";
import { getJob } from "@/lib/jobs";

/* Never prerendered. Every route here answers from the filesystem or from
   live job state, and Next will happily freeze a GET-only route at build
   time: /api/jobs/running shipped as a permanent {"job":null}, which is why
   the queue's progress bar never moved in the built app and always worked in
   dev. */
export const dynamic = "force-dynamic";

/** Any job by id, without needing to know which project it belongs to —
 *  reference measuring isn't a project, but it still reports progress. */
export async function GET(_req: Request, { params }: { params: { jobId: string } }) {
  const job = getJob(params.jobId);
  if (!job) return NextResponse.json({ error: "no such job" }, { status: 404 });
  return NextResponse.json(job);
}
