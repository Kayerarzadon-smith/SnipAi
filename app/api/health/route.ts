import { NextResponse } from "next/server";
import { DATA_ROOT, CODE_ROOT } from "@/lib/paths";
import { pipelineVersion } from "@/lib/cutFreshness";

/* Never prerendered -- and here that is a correctness requirement, not a
   performance one. Next will freeze a GET-only route at build time (see
   /api/jobs/running, which shipped as a permanent {"job":null}), and a frozen
   answer here would report the BUILD machine's data root forever: a confident
   lie, and worse for the launcher than having no endpoint at all. */
export const dynamic = "force-dynamic";

/**
 * Who this server is.
 *
 * Port 4737 does not identify our server -- that assumption is ledger N1 and
 * P19, and it has cost data. The launcher used to decide whether the thing on
 * the port was ours by comparing BUILD IDs, which answers a question nobody
 * was hurt by. The dangerous difference is the DATA ROOT: a run launched with
 * SNIPAI_DATA pointed at a sandbox would adopt a server serving
 * ~/Movies/SnipAi and edit the real footage while believing it was isolated.
 *
 * `/api/projects` cannot settle it. It returns the project names the server
 * found, and two libraries can hold the same names -- a sandbox copy is
 * precisely that case. So the server states its root outright.
 *
 * `pid` is the other half: it lets the launcher tell its OWN orphaned server,
 * which it may stop, from one a person started in a terminal, which it may
 * not. Everything here is derived at request time from this process's own
 * resolved configuration, so it cannot drift from what the server is really
 * using -- these are the same constants every other route reads.
 *
 * `pipeline` is here so the one thing that can silently disable the "cutting
 * has improved" badge is visible from outside the process. A packaged build
 * shipped with no pipeline-version.json for days: currentPipelineVersion()
 * read 0, isPipelineBehind returned false to everything, and no screen and no
 * log said a word (ledger N2). A release check can now ask the running server
 * whether it knows what pipeline it has, instead of inferring it from a cut.
 */
export async function GET() {
  const pipeline = pipelineVersion();
  return NextResponse.json({
    dataRoot: DATA_ROOT,
    codeRoot: CODE_ROOT,
    pid: process.pid,
    pipeline: {
      version: pipeline.version,
      known: pipeline.ok,
      ...(pipeline.ok ? {} : { problem: pipeline.reason }),
    },
  });
}
