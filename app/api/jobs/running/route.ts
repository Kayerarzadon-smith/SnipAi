import { NextResponse } from "next/server";
import { runningJob, getJob } from "@/lib/jobs";

/* Never prerendered. Every route here answers from the filesystem or from
   live job state, and Next will happily freeze a GET-only route at build
   time: /api/jobs/running shipped as a permanent {"job":null}, which is why
   the queue's progress bar never moved in the built app and always worked in
   dev. */
export const dynamic = "force-dynamic";

/** The one job currently running, if any -- with its live progress. */
export async function GET() {
  const r = runningJob();
  return NextResponse.json({ job: r ? getJob(r.id) ?? null : null });
}
