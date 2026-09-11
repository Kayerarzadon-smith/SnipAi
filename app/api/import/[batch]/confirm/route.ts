import { NextRequest, NextResponse } from "next/server";
import { confirmBatch, readBatch, validateGroups, type ConfirmGroup } from "@/lib/importBatch";
import { checkAvailability } from "@/lib/pipeline";
import { createJob, failJob, runningJob } from "@/lib/jobs";
import { readJsonObject } from "@/lib/requestBody";

export const dynamic = "force-dynamic";

/**
 * He has seen the proposal and said yes. (DOCKET M0.8)
 *
 * The grouping in the body is HIS, not the proposal's -- the tray sends back
 * whatever is on screen after any regrouping he did, so confirming is the
 * only path that creates projects and the proposal is never acted on by
 * itself.
 *
 * Refused as a whole if the grouping does not account for every staged clip,
 * before a single project is created: a clip in no group would be deleted
 * with the staging directory, which is the same shape of loss as deleting
 * footage.
 */
export async function POST(req: NextRequest, { params }: { params: { batch: string } }) {
  const batch = readBatch(params.batch);
  if (!batch) return NextResponse.json({ error: `no import ${params.batch}` }, { status: 404 });

  const parsed = await readJsonObject(req);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
  const groups = (parsed.body as { groups?: ConfirmGroup[] }).groups ?? [];

  const checked = validateGroups(batch, groups);
  if (!checked.ok) return NextResponse.json({ error: checked.error }, { status: 400 });

  const avail = checkAvailability();
  if (!avail.python3 || !avail.ffmpeg) {
    return NextResponse.json(
      { error: "pipeline tools not available in this environment", availability: avail },
      { status: 503 }
    );
  }

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

  /* One job for the whole import, named after the first project it will
     create: joining and building run one after another because the machine
     can only do one at a time, and one job means one honest bar rather than
     four that fight each other. */
  const job = createJob(checked.groups[0].project, "import");
  confirmBatch(job.id, params.batch, checked.groups).catch((e) =>
    failJob(job.id, e instanceof Error ? e.message : String(e))
  );
  return NextResponse.json(
    { jobId: job.id, projects: checked.groups.map((g) => g.project) },
    { status: 202 }
  );
}
