import { NextResponse } from "next/server";
import { getJob } from "@/lib/jobs";

/** Any job by id, without needing to know which project it belongs to —
 *  reference measuring isn't a project, but it still reports progress. */
export async function GET(_req: Request, { params }: { params: { jobId: string } }) {
  const job = getJob(params.jobId);
  if (!job) return NextResponse.json({ error: "no such job" }, { status: 404 });
  return NextResponse.json(job);
}
