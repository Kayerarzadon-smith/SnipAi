import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { tempLibrary } from "./_fixture.mts";

/**
 * LEDGER S2 — lib/jobs.ts:184
 *
 * createJob, finishJob and appendLog all persist(). failJob does not. jobs.json
 * is the shared truth between route modules (Next gives each route its own copy
 * of the map), so a failed build stays "running" everywhere else: the UI spins
 * with no error, and the graphics route then 409s "already running build".
 *
 * This test is expected to FAIL until S2 is fixed.
 */
test("S2: a failed job reaches jobs.json", async () => {
  const root = tempLibrary();
  const jobs = await import("../../lib/jobs.ts");

  const job = jobs.createJob("fixture", "build");
  jobs.failJob(job.id, "build failed — see log");

  const onDisk = JSON.parse(fs.readFileSync(path.join(root, "state", "jobs.json"), "utf8")) as any[];
  const saved = onDisk.find((j) => j.id === job.id);

  assert.ok(saved, "the job should be in jobs.json at all");
  assert.equal(saved.status, "error", "another route reading the file must see it failed");
  assert.equal(saved.error, "build failed — see log", "and must be able to say why");
});
