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
 * `pid`, `serverPath` and `launchToken` are the other half: they let the
 * launcher tell its OWN server, which it may stop, from one a person started
 * in a terminal, which it may not. Everything here is derived at request time
 * from this process's own resolved configuration, so it cannot drift from what
 * the server is really using -- these are the same constants every other route
 * reads.
 *
 * Why the server has to say those two rather than the launcher looking them
 * up: **this process re-titles itself.** `ps -ww -o command= -p <pid>` on the
 * packaged server returns exactly `next-server (v14.2.35)` -- the path it was
 * launched from is gone from the outside world, and `next dev` re-titles to
 * the identical string, so from outside the two are indistinguishable. The
 * launcher used to decide ownership by looking for its own server path in that
 * command line, which therefore could never match in the packaged app. It
 * failed safe (it stopped nothing, ever) but for a reason nobody intended.
 * `process.argv[1]` survives the retitle inside the process, so the server can
 * state what the outside can no longer see.
 *
 * `launchToken` is SNIPAI_LAUNCH_TOKEN, which the native wrapper sets to a
 * fresh UUID when it spawns a server, and is "" for a server a person started.
 * It is an identity nonce and NOT a credential: nothing is authorised by it.
 *
 * This paragraph used to end "the worst a local process can do by echoing back
 * a token it read here is get itself SIGTERMed instead of somebody else", and
 * that was false on 2026-09-11 (ledger N12) -- no token was needed to get a
 * third party signalled, because the launcher also accepts our own
 * `serverPath`, which is not a secret but merely where the app is installed.
 * What is true, and is what `ourListeningPIDs` in native/LaunchDecision.swift
 * now actually enforces, is that the app will SIGTERM a process only if ALL of:
 *
 *   - it identified itself here at all (silence is never ownership); and
 *   - it named a pid that is the ONE and only listener on the port, which is
 *     therefore the process that answered -- so a server cannot nominate a
 *     bystander, and cannot hide behind a second listener on the other address
 *     family; and
 *   - it carries THIS launch's token, or was launched from this bundle's own
 *     server file.
 *
 * So the old sentence is true again, for the reason it always claimed: the only
 * process a liar can get SIGTERMed is itself.
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
    serverPath: process.argv[1] ?? "",
    launchToken: process.env.SNIPAI_LAUNCH_TOKEN ?? "",
    pipeline: {
      version: pipeline.version,
      known: pipeline.ok,
      ...(pipeline.ok ? {} : { problem: pipeline.reason }),
    },
  });
}
