import { NextResponse } from "next/server";
import { readBatch, discardBatch, assertValidBatchId } from "@/lib/importBatch";
import { getJob } from "@/lib/jobs";

export const dynamic = "force-dynamic";

/**
 * Where this import has got to, and what it proposes. (DOCKET M0.8)
 *
 * The tray polls this while the analyse job runs and renders the proposal
 * when it lands. The job is included rather than fetched separately so the
 * two can never disagree about whether the thing is still working.
 */
export async function GET(_req: Request, { params }: { params: { batch: string } }) {
  try {
    assertValidBatchId(params.batch);
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
  const batch = readBatch(params.batch);
  if (!batch) return NextResponse.json({ error: `no import ${params.batch}` }, { status: 404 });
  const job = batch.jobId ? getJob(batch.jobId) : undefined;
  return NextResponse.json({
    batch,
    job: job
      ? { id: job.id, status: job.status, progress: job.progress, stage: job.stage,
          etaSeconds: job.etaSeconds, error: job.error }
      : null,
  });
}

/** Throw the staged clips away. His originals are untouched -- these are the
 *  server's copies of files that still sit wherever he dragged them from. */
export async function DELETE(_req: Request, { params }: { params: { batch: string } }) {
  try {
    assertValidBatchId(params.batch);
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
  discardBatch(params.batch);
  return NextResponse.json({ discarded: params.batch });
}
