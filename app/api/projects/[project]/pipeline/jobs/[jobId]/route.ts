import { NextRequest, NextResponse } from "next/server";
import { getJob } from "@/lib/jobs";

export async function GET(_req: NextRequest, { params }: { params: { project: string; jobId: string } }) {
  const job = getJob(params.jobId);
  if (!job || job.project !== params.project) {
    return NextResponse.json({ error: "no such job" }, { status: 404 });
  }
  return NextResponse.json(job);
}
