import { NextResponse } from "next/server";
import { analyseBatch, readBatch } from "@/lib/importBatch";
import { checkAvailability } from "@/lib/pipeline";
import { createJob, failJob, runningJob } from "@/lib/jobs";

export const dynamic = "force-dynamic";

/**
 * Work out what these clips are, and propose it. (DOCKET M0.8)
 *
 * A job rather than a held-open request: this transcribes every clip, which
 * is the slowest thing the app does. The tray polls GET /api/import/<id> for
 * the proposal and shows the same bar the queue shows.
 *
 * It decides nothing. The answer is written into the batch and waits for him.
 */
export async function POST(_req: Request, { params }: { params: { batch: string } }) {
  const batch = readBatch(params.batch);
  if (!batch) return NextResponse.json({ error: `no import ${params.batch}` }, { status: 404 });
  if (batch.files.length === 0) {
    return NextResponse.json({ error: "no clips have been uploaded yet" }, { status: 400 });
  }

  const avail = checkAvailability();
  if (!avail.python3 || !avail.ffmpeg || !avail.fasterWhisper) {
    return NextResponse.json(
      {
        error: "the editing tools aren't set up on this machine, so these clips cannot be listened to",
        availability: avail,
      },
      { status: 503 }
    );
  }

  // One heavy job at a time, whichever kind: transcription pins every core.
  const busy = runningJob();
  if (busy) {
    return NextResponse.json(
      {
        error: `already running ${busy.step} on "${busy.project}" — one at a time, so the machine stays usable`,
        runningJobId: busy.id,
      },
      { status: 409 }
    );
  }

  const job = createJob(params.batch, "analyse-import");
  analyseBatch(job.id, params.batch).catch((e) =>
    failJob(job.id, e instanceof Error ? e.message : String(e))
  );
  return NextResponse.json({ jobId: job.id }, { status: 202 });
}
