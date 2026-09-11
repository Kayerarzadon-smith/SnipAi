import { NextResponse } from "next/server";
import { createBatch, sweepAbandonedBatches } from "@/lib/importBatch";

/* Never prerendered: this hands out a new id every time it is called, and a
   frozen one would hand every import the same staging directory. */
export const dynamic = "force-dynamic";

/**
 * Start an import. (DOCKET M0.8)
 *
 * The bytes land in staging, belonging to no project, because which projects
 * there are is the question this import exists to answer -- and it cannot be
 * answered until the clips are on the server and transcribed.
 */
export async function POST() {
  const swept = sweepAbandonedBatches();
  const batch = createBatch();
  return NextResponse.json({ batch: batch.id, swept: swept.length }, { status: 201 });
}
