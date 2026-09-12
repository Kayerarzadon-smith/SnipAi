import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { scratchDir } from "../scratch.mts";

/**
 * LEDGER S54 -- a wholly failed import told him it was done, and by then his
 * footage had already been moved.
 *
 * `confirmBatch` called `discardBatch(id)` and only THEN `failJob(jobId, ...)`.
 * The tray polls `GET /api/import/[batch]`, which 404s on a missing batch, so
 * `pollBatch` returned null, `confirmGroups` tested
 * `finished?.job?.status === "error"`, read `undefined`, and fell through to
 * `setPhase("done")`. **The only record of the failure was deleted one
 * statement before the code that reported it.**
 *
 * THE ASYMMETRY IS WHAT MAKES IT URGENT. A failed JOIN leaves the clips
 * staged, so `leftovers` was non-empty, the batch survived, and the tray
 * threw correctly. A failed PIPELINE happens after `moveInto` has consumed
 * the staged clips, so `leftovers` was empty, the batch was discarded, and
 * the tray said done. **The case reported honestly was the one where nothing
 * had happened; the case reported as success was the one where his footage
 * had already moved.**
 *
 * Partial failure was silent by a second route: some groups succeed,
 * `finishJob` runs, the job ends `done`, and the reasons written to
 * `b.error` went into a file that had just been deleted. Nothing read it on
 * this path in any case -- `DropZone.tsx` read `batch.error` only while
 * analysing.
 *
 * WHAT THIS FILE ASSERTS, AND WHY NOT THE ORDERING. An assertion that
 * `failJob` runs before `discardBatch` is an assertion about the
 * instruction, and it would have passed a version of this fix that still
 * left the client unable to see anything -- which is exactly what a reorder
 * on its own does, because the gap between the two is a few filesystem
 * operations against a 1200ms poll. So every assertion here is made through
 * the route a client actually calls, and the claim is the one that matters:
 *
 *     a failed import must not be indistinguishable from a successful one
 *
 * THE CLIENT HALF IS NOT TESTED HERE and that is stated rather than faked.
 * `confirmGroups` now treats a null poll as unknown instead of success, and
 * reads `batch.error` on the confirm path; both need M2's DOM harness, which
 * does not exist. The source-shape guard at the bottom is a staleness check,
 * not a proof, and is labelled as one.
 */

const ROOT = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));

/* One library for the file: `lib/paths.ts` resolves SNIPAI_DATA once, at
   import, so a second one would be a directory the app never looks at. */
const LIB = scratchDir("s54");
fs.mkdirSync(path.join(LIB, "projects"), { recursive: true });
fs.mkdirSync(path.join(LIB, "state"), { recursive: true });
process.env.SNIPAI_DATA = LIB;

const { createBatch, recordStagedFile, stagedPath, confirmBatch, readBatch } =
  await import("@/lib/importBatch");
const { createJob, getJob } = await import("@/lib/jobs");
const { GET, DELETE } = await import("@/app/api/import/[batch]/route");
const { sweepAbandonedBatches } = await import("@/lib/importBatch");

type Observed = {
  status: number;
  job: { status?: string; error?: string } | null;
  batchError?: string;
  batchStatus?: string;
};

/** What the tray can see, through the endpoint it actually polls. */
async function whatTheTrayCanSee(batchId: string): Promise<Observed> {
  const res = await GET(new Request(`http://127.0.0.1:4737/api/import/${batchId}`), {
    params: { batch: batchId },
  });
  if (!res.ok) return { status: res.status, job: null };
  const body = (await res.json()) as {
    job: { status?: string; error?: string } | null;
    batch: { error?: string; status?: string };
  };
  return {
    status: res.status,
    job: body.job,
    batchError: body.batch?.error,
    batchStatus: body.batch?.status,
  };
}

function stage(files: string[]): string {
  const b = createBatch();
  for (const name of files) {
    const p = stagedPath(b.id, name);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, "clip bytes");
    recordStagedFile(b.id, name, 10);
  }
  return b.id;
}

const OK_PIPELINE = async () => ({ ok: true }) as never;
const DEAD_PIPELINE = async () => ({ ok: false, error: "build_cut.py failed — see log" }) as never;
const OK_JOIN = async (_files: string[], dest: string) => {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, "joined");
  return {
    ok: true, dest, ordered: [], basis: "creation_time",
    expectedSec: 20, actualSec: 20, driftSec: 0, dataStreamsDropped: 0,
  } as never;
};

/* ------------------------------------------------------------- the harm */

test("S54: a wholly failed import is visible to the tray as a failure", async () => {
  const id = stage(["IMG_0001.MOV"]);
  const job = createJob("s54-dead", "import");
  await confirmBatch(job.id, id, [{ project: "s54-dead", files: ["IMG_0001.MOV"] }], {
    join: OK_JOIN, pipeline: DEAD_PIPELINE,
  });

  /* The job really did fail -- otherwise nothing below is about S54. */
  assert.equal(getJob(job.id)?.status, "error", "the fixture did not produce a failed import");

  const seen = await whatTheTrayCanSee(id);
  assert.equal(
    seen.status, 200,
    `the tray's poll got ${seen.status}; the record of the failure was deleted before it could be read`
  );
  assert.equal(
    seen.job?.status, "error",
    `the tray sees job status ${JSON.stringify(seen.job?.status)} on an import that failed outright`
  );
  assert.ok(seen.job?.error, "the failure reached the tray with no reason attached");
});

test("S54: and a successful one is visible as a success, so the two differ", async () => {
  /* The dangerous direction. Everything above passes for an app that reports
     failure on every import; this is what makes it a distinction. */
  const id = stage(["IMG_0002.MOV"]);
  const job = createJob("s54-live", "import");
  await confirmBatch(job.id, id, [{ project: "s54-live", files: ["IMG_0002.MOV"] }], {
    join: OK_JOIN, pipeline: OK_PIPELINE,
  });

  assert.equal(getJob(job.id)?.status, "done", "the fixture did not produce a successful import");
  const seen = await whatTheTrayCanSee(id);
  assert.equal(seen.status, 200, "a clean import is unobservable, so the tray cannot confirm it either");
  assert.equal(seen.job?.status, "done");
  assert.equal(seen.batchError, undefined, "a clean import reported an error");
});

test("S54: a PARTLY failed import does not read as a whole one", async () => {
  /* The second silent route. One group builds, one does not: `finishJob` runs,
     the job ends `done`, and the reasons live on the batch -- which used to be
     deleted, and which nothing on this path read even when it was not. */
  const id = stage(["IMG_0003.MOV", "IMG_0004.MOV"]);
  const job = createJob("s54-half", "import");
  let call = 0;
  await confirmBatch(
    job.id, id,
    [
      { project: "s54-half-a", files: ["IMG_0003.MOV"] },
      { project: "s54-half-b", files: ["IMG_0004.MOV"] },
    ],
    {
      join: OK_JOIN,
      pipeline: (async () => (++call === 1 ? { ok: true } : { ok: false, error: "the second one died" })) as never,
    }
  );

  assert.equal(getJob(job.id)?.status, "done", "a partial failure should still finish the job");
  const seen = await whatTheTrayCanSee(id);
  assert.equal(seen.status, 200);
  assert.ok(
    seen.batchError && /died/.test(seen.batchError),
    `a partial failure left nothing for the tray to read: ${JSON.stringify(seen.batchError)}`
  );
  assert.equal(seen.batchStatus, "failed", "a partly failed import is recorded as imported");
});

test("S54: the asymmetry is gone -- a failed join and a failed pipeline both show", async () => {
  /* Before the fix only the join case was honest, and it was honest by
     accident: it left clips staged, so the batch survived. The pipeline case
     is the one where his footage has already moved, which is the worse of the
     two to be silent about. */
  const joinId = stage(["IMG_0005.MOV", "IMG_0006.MOV"]);
  const joinJob = createJob("s54-join", "import");
  await confirmBatch(joinJob.id, joinId, [{ project: "s54-join", files: ["IMG_0005.MOV", "IMG_0006.MOV"] }], {
    join: async () => ({ ok: false, error: "IMG_0005.MOV hides 1.50s of picture" }) as never,
    pipeline: OK_PIPELINE,
  });
  const joinSeen = await whatTheTrayCanSee(joinId);

  const pipeId = stage(["IMG_0007.MOV"]);
  const pipeJob = createJob("s54-pipe", "import");
  await confirmBatch(pipeJob.id, pipeId, [{ project: "s54-pipe", files: ["IMG_0007.MOV"] }], {
    join: OK_JOIN, pipeline: DEAD_PIPELINE,
  });
  const pipeSeen = await whatTheTrayCanSee(pipeId);

  assert.equal(joinSeen.job?.status, "error", "a refused join is no longer reported");
  assert.equal(pipeSeen.job?.status, "error", "a failed pipeline is still not reported");
  assert.equal(
    joinSeen.status, pipeSeen.status,
    "the two failure kinds are still observable in different ways"
  );
});

test("S54: a refused join still leaves his clips exactly where they were", async () => {
  /* Must not regress. importBatch.ts:613-615: "the difference between 'try
     again' and 're-shoot'." */
  const id = stage(["IMG_0008.MOV", "IMG_0009.MOV"]);
  const job = createJob("s54-keep", "import");
  await confirmBatch(job.id, id, [{ project: "s54-keep", files: ["IMG_0008.MOV", "IMG_0009.MOV"] }], {
    join: async () => ({ ok: false, error: "cannot be stream-copied together" }) as never,
    pipeline: OK_PIPELINE,
  });
  for (const f of ["IMG_0008.MOV", "IMG_0009.MOV"]) {
    assert.ok(fs.existsSync(stagedPath(id, f)), `${f} was thrown away by a failed join`);
  }
});

test("S54: a clean import leaves none of his clips staged", async () => {
  /* The other side of that, and the property the older assertion in
     `tests/import-batch.test.mts` was really about. The batch RECORD survives
     -- that is the fix -- but nothing of his does. */
  const id = stage(["IMG_0010.MOV"]);
  const job = createJob("s54-clean", "import");
  await confirmBatch(job.id, id, [{ project: "s54-clean", files: ["IMG_0010.MOV"] }], {
    join: OK_JOIN, pipeline: OK_PIPELINE,
  });
  assert.equal(fs.existsSync(stagedPath(id, "IMG_0010.MOV")), false, "a clip stayed staged after a clean import");
  assert.ok(readBatch(id), "the record went, so the tray could not have confirmed the outcome");
});

/* ----------------------------------------------------------- the reclaim
 *
 * MARA'S CONDITION on the change above, and she was right to make it: the
 * assertion this fix replaced in `tests/import-batch.test.mts` was quietly
 * doing a second job nobody had named -- proving the record does not
 * accumulate. Keeping it until observed trades a silent "done" for a slow
 * leak unless something actually reclaims it, and S58 is already an open row
 * about that class. So both reclaim paths are asserted, not assumed.
 * ---------------------------------------------------------------------- */

test("S54: the tray's DELETE reclaims a terminal batch", async () => {
  /* The path the fix relies on: the tray deletes the record once it has
     observed a clean outcome. If this stopped working, every import would
     leave one behind until the sweeper's 24 hours were up. */
  const id = stage(["IMG_0011.MOV"]);
  const job = createJob("s54-reclaim", "import");
  await confirmBatch(job.id, id, [{ project: "s54-reclaim", files: ["IMG_0011.MOV"] }], {
    join: OK_JOIN, pipeline: OK_PIPELINE,
  });
  assert.ok(readBatch(id), "nothing to reclaim -- the record was already gone");

  const res = await DELETE(new Request(`http://127.0.0.1:4737/api/import/${id}`, { method: "DELETE" }), {
    params: { batch: id },
  });
  assert.ok(res.ok, `the tray's DELETE answered ${res.status}`);
  assert.equal(readBatch(id), null, "the record survived the DELETE the tray sends");
  const seen = await whatTheTrayCanSee(id);
  assert.equal(seen.status, 404, "the batch is reclaimed but still answers");
});

test("S54: and the sweeper reclaims one nobody came back for", async () => {
  /* The other path, for a browser closed mid-import. `sweepAbandonedBatches`
     already existed for exactly this and its own comment says so; what is
     new is that it is now load-bearing rather than a tidy-up. */
  const id = stage(["IMG_0012.MOV"]);
  const job = createJob("s54-abandoned", "import");
  await confirmBatch(job.id, id, [{ project: "s54-abandoned", files: ["IMG_0012.MOV"] }], {
    join: OK_JOIN, pipeline: DEAD_PIPELINE,
  });
  assert.ok(readBatch(id), "nothing to sweep");

  /* Age 0: everything terminal is old enough. */
  const swept = sweepAbandonedBatches(0);
  assert.ok(swept.includes(id), `the sweeper left ${id} behind; it swept ${JSON.stringify(swept)}`);
  assert.equal(readBatch(id), null, "the record survived the sweep");
});

test("S54: the sweeper will not reclaim one that is still running", async () => {
  /* The direction that would be a disaster: sweeping a live import deletes
     the clips out from under it. `sweepAbandonedBatches` skips `importing`
     and `analysing`, and that has to keep being true now that the terminal
     records it collects are the ones this fix leaves behind. */
  const { readBatch: rb, writeBatch } = await import("@/lib/importBatch");
  const id = stage(["IMG_0013.MOV"]);
  const b = rb(id)!;
  b.status = "importing";
  writeBatch(b);
  /* Prove the fixture took. Without this the test passes whenever the write
     silently missed, because a batch the sweeper cannot read is skipped for a
     different reason entirely. */
  assert.equal(rb(id)?.status, "importing", "the fixture did not mark the batch as running");

  const swept = sweepAbandonedBatches(0);
  assert.ok(!swept.includes(id), "the sweeper took a batch that was still importing");
  assert.ok(rb(id), "a running import's record was reclaimed under it");
});

/* ------------------------------------------------- the client, not proven */

test("S54: the tray no longer reads a failed poll as a finished import", () => {
  /* STALENESS GUARD, NOT A PROOF. The client half needs M2's DOM harness,
     which does not exist; this only pins that the two changes are still in
     the file, so a green suite cannot be mistaken for having tested them.
     What it guards: `pollBatch` returns null on any non-ok response, and
     `confirmGroups` used to fall from that straight into setPhase("done"). */
  const src = fs.readFileSync(path.join(ROOT, "app", "dashboard", "DropZone.tsx"), "utf8");
  const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, "");
  const confirm = code.slice(code.indexOf("async function confirmGroups"));

  assert.match(confirm, /if \(!finished\)/, "confirmGroups no longer checks for a poll that returned nothing");
  assert.ok(
    confirm.indexOf("if (!finished)") < confirm.indexOf('setPhase("done")'),
    "the unknown-outcome check runs after the tray has already said done"
  );
  assert.match(confirm, /finished\.batch\.error/, "confirmGroups does not read the partial-failure reasons");
});

test("S54: confirmBatch does not delete the record it was about to report", () => {
  /* Also a staleness guard. The behavioural claim is the first test in this
     file; this stops the old shape returning by a different route, since
     `discardBatch` inside `confirmBatch` is what made the outcome
     unobservable however the calls were ordered. */
  const src = fs.readFileSync(path.join(ROOT, "lib", "importBatch.ts"), "utf8");
  const fn = src.slice(src.indexOf("export async function confirmBatch"));
  const body = fn.slice(0, fn.indexOf("\n}\n"));
  assert.ok(
    !/discardBatch\(/.test(body),
    "confirmBatch discards the batch again -- the tray's poll 404s and the failure is unobservable"
  );
});
