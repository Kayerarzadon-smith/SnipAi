import { NextResponse } from "next/server";
import { runningJob, getJob } from "@/lib/jobs";

/** The one job currently running, if any -- with its live progress. */
export async function GET() {
  const r = runningJob();
  return NextResponse.json({ job: r ? getJob(r.id) ?? null : null });
}
