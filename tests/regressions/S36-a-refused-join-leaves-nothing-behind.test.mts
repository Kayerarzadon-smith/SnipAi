import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import { buildKit, haveFfmpeg } from "./_elst.mts";
import { tempLibrary } from "./_fixture.mts";

/**
 * LEDGER S36 -- a refused join kept the file it had written, and took the
 * project name with it.
 *
 * `joinClips`'s drift branch returned `ok: false` without unlinking `dest`.
 * ffmpeg had already succeeded by then, so what was left behind was a
 * COMPLETE join -- 546 MB of his 4K footage sitting in `raw/` under a project
 * with no `beats.json`, which nothing ever collects because no project owns
 * it.
 *
 * And then it costs him the name as well, which is the part that makes this
 * more than disk. `confirmBatch`'s catch removes the project directory only
 * `if (isEmptyShell(dir))`, and `isEmptyShell` reads `raw/` -- so the orphan
 * is precisely why the shell survives. `validateGroups` then refuses the
 * obvious retry by name, because `listProjectNames` sees the directory. One
 * failed import, and the name he just typed is taken by the wreckage of the
 * thing that failed.
 *
 * TWO NARROWINGS, so nobody chases a hole that is not there:
 *
 *   - the ffmpeg-failure branch (`if (!run.ok)`) ALREADY unlinks `dest`. It is
 *     the shape this fix copies, not a second site. Asserted below so that
 *     stays true.
 *   - the two staged clips surviving in `.staging` is deliberate and
 *     documented at importBatch.ts:572-574 -- "a failed join leaves his
 *     footage exactly where it was, which is the difference between 'try
 *     again' and 're-shoot'". This file asserts they SURVIVE, so a later
 *     tidy-up cannot quietly remove the retention and call it a cleanup fix.
 *
 * HOW THE DRIFT BRANCH IS REACHED. It needs ffmpeg to exit 0 and still lose
 * media, which is the exact case the check exists for. A truncated input does
 * it deterministically: the moov still claims 4.00s while the mdat ends
 * early, so the join measures 1.8s against an expected 10.0s. No fake, no
 * injected failure -- the real refusal, on a real file ffmpeg really wrote.
 */

const kit = haveFfmpeg() ? buildKit("s36") : null;

/** phoneB with its tail cut off: ffmpeg reads it, exits 0, loses most of it. */
function truncatedClip(): string {
  const short = path.join(kit!.dir, `short-${Math.random().toString(36).slice(2, 8)}.mov`);
  fs.copyFileSync(kit!.phoneB, short);
  fs.truncateSync(short, Math.floor(fs.statSync(short).size * 0.45));
  return short;
}

test("S36: a drift refusal leaves raw/ empty", async () => {
  assert.ok(kit, "no ffmpeg -- S36's filesystem claim cannot be checked, and a skip here would be permanent");
  const root = tempLibrary("s36");
  const { joinClips } = await import("@/lib/stitch");

  const raw = path.join(root, "projects", "s36", "raw");
  fs.mkdirSync(raw, { recursive: true });
  const dest = path.join(raw, "s36.mov");

  const out = await joinClips([truncatedClip(), kit!.phoneA], dest);
  assert.equal(out.ok, false, "the join was accepted, so there is no refusal to clean up after");

  assert.equal(fs.existsSync(dest), false, `the refused join kept ${path.basename(dest)}`);
  assert.deepEqual(
    fs.readdirSync(raw), [],
    `raw/ still holds ${JSON.stringify(fs.readdirSync(raw))} after a refusal`
  );
  /* The concat list is scratch too, and was already being cleaned -- pinned
     so a rearrangement of this block cannot drop it. */
  assert.equal(fs.existsSync(`${dest}.concat.txt`), false, "the concat list was left behind");
});

test("S36: and so does an ffmpeg failure -- the branch this fix copied", async () => {
  /* Not a second instance. This asserts the shape that was already right,
     because it is the reason the fix is two lines instead of a redesign. */
  assert.ok(kit, "no ffmpeg");
  const root = tempLibrary("s36b");
  const { joinClips } = await import("@/lib/stitch");
  const raw = path.join(root, "projects", "s36b", "raw");
  fs.mkdirSync(raw, { recursive: true });
  const dest = path.join(raw, "s36b.mov");

  /* Two clips ffmpeg cannot concatenate at all: different dimensions, which
     `joinBlocker` would normally catch -- so this goes straight at joinClips
     with a file that is not video to force the demuxer to fail. */
  const junk = path.join(kit!.dir, "junk.mov");
  fs.writeFileSync(junk, "this is not a quicktime file");
  const out = await joinClips([kit!.phoneA, junk], dest);
  assert.equal(out.ok, false, "joining a non-video file was accepted");
  assert.equal(fs.existsSync(dest), false, "the ffmpeg-failure branch stopped cleaning up after itself");
});

test("S36: the name he typed is free again after a failed import", async () => {
  /* The consequence the row is really about, end to end through the real
     importer and the real join. Before the fix `raw/` held the orphan,
     `isEmptyShell` was false, the shell survived, and this same name came
     back as "there is already a project called s36-retry". */
  assert.ok(kit, "no ffmpeg");
  const root = tempLibrary("unused");
  const {
    createBatch, recordStagedFile, stagedPath, readBatch, validateGroups, confirmBatch, discardBatch,
  } = await import("@/lib/importBatch");
  const { joinClips } = await import("@/lib/stitch");
  const { listProjectNames } = await import("@/lib/paths");
  const { createJob } = await import("@/lib/jobs");

  const NAME = "s36-retry";
  const clips = { "A.mov": truncatedClip(), "B.mov": kit!.phoneA };

  const b = createBatch();
  for (const [staged, src] of Object.entries(clips)) {
    const p = stagedPath(b.id, staged);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.copyFileSync(src, p);
    recordStagedFile(b.id, staged, fs.statSync(p).size);
  }

  const job = createJob(NAME, "import");
  await confirmBatch(job.id, b.id, [{ project: NAME, files: Object.keys(clips) }], {
    join: joinClips,
    pipeline: async () => ({ ok: true }) as never,
  });

  assert.ok(
    !listProjectNames().includes(NAME),
    `the failed import left the project directory behind, so '${NAME}' is still taken`
  );
  assert.equal(
    fs.existsSync(path.join(root, "projects", NAME)), false,
    "the empty shell survived the failure"
  );

  /* The retry he would actually attempt. */
  const retry = validateGroups(readBatch(b.id)!, [{ project: NAME, files: Object.keys(clips) }]);
  assert.equal(
    retry.ok, true,
    `the same name is still refused on retry: ${retry.ok ? "" : retry.error}`
  );

  /* And his footage is where he left it, which is the documented half that
     must NOT be tidied away. */
  for (const staged of Object.keys(clips)) {
    assert.ok(
      fs.existsSync(stagedPath(b.id, staged)),
      `${staged} was removed from .staging by a failed import — importBatch.ts:572-574 says it stays`
    );
  }
  discardBatch(b.id);
});
