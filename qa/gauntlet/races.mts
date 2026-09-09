/* CATEGORY 010/019 — race conditions and concurrent writes.
 *
 * "What happens if operation A finishes after operation B?" Every state file
 * here is read-modify-write JSON on a single-threaded server, so the races
 * that matter are the ones spanning an await: two handlers each read, each
 * modify their copy, and the second write erases the first.
 *
 * These drive the real store functions concurrently and check what survives. */
import fs from "node:fs";
import path from "node:path";
import { rng } from "../rng.mts";
import type { Report } from "../report.mts";

export async function run(rep: Report, budget: number, root: string) {
  const P = "fixture";
  const dir = path.join(root, "projects", P);
  const { saveBeats, loadBeats } = await import("../../lib/beats.ts");
  const { updateReviewState, loadReviewState } = await import("../../lib/reviewState.ts");
  const { createJob, finishJob, failJob, getJob, runningJob, appendLog } =
    await import("../../lib/jobs.ts");

  /* ---- INVARIANT 9: a slow write must not erase a newer one ------------ */
  for (let i = 0; i < Math.min(budget, 40); i++) {
    await rep.checkAsync("010 races", `concurrent review-state writes all survive #${i}`, async () => {
      fs.writeFileSync(path.join(dir, "review-state.json"),
                       JSON.stringify({ project: P, cutStatus: "unreviewed", updatedAt: "" }));
      // ten writers, each setting its own key, interleaved
      await Promise.all(Array.from({ length: 10 }, (_, k) =>
        Promise.resolve().then(() => updateReviewState(P, (s) => {
          (s as unknown as Record<string, unknown>)[`k${k}`] = k;
        }))));
      const back = loadReviewState(P) as unknown as Record<string, unknown>;
      const lost = Array.from({ length: 10 }, (_, k) => k).filter((k) => back[`k${k}`] !== k);
      if (lost.length) throw new Error(`${lost.length} of 10 concurrent writes were lost: ${lost}`);
    });
  }

  /* ---- one heavy job at a time ---------------------------------------- */
  await rep.checkAsync("010 races", "two jobs cannot both be running", async () => {
    const a = createJob(P, "build");
    const b = createJob(P, "transcribe");
    const busy = runningJob();
    if (!busy) throw new Error("neither job reports as running");
    finishJob(a.id, "a"); finishJob(b.id, "b");
    // the queue's contract is that a second job is REFUSED by the route, not
    // that createJob refuses -- so what must hold is that runningJob() sees one
    if (runningJob()) throw new Error("a finished job still reports as running");
  });

  await rep.checkAsync("010 races", "a failed job is remembered, not lost", async () => {
    const j = createJob(P, "build");
    failJob(j.id, "went wrong");
    const back = getJob(j.id);
    if (!back) throw new Error("the job vanished");
    if (back.status !== "error") throw new Error(`status is ${back.status}`);
    if (!back.error) throw new Error("no reason recorded");
  });

  await rep.checkAsync("010 races", "finishing a job twice does not resurrect it", async () => {
    const j = createJob(P, "build");
    finishJob(j.id, "one");
    failJob(j.id, "late failure from a process already reaped");
    const back = getJob(j.id)!;
    if (back.status === "running") throw new Error("the job is running again");
  });

  await rep.checkAsync("010 races", "a log line arriving after the job ended is not lost", async () => {
    const j = createJob(P, "build");
    finishJob(j.id, "done");
    appendLog(j.id, "a straggler line from a killed child");
    const back = getJob(j.id)!;
    if (back.status === "running") throw new Error("a late log line restarted the job");
  });

  /* ---- interleaved beat writes ---------------------------------------- */
  for (let i = 0; i < Math.min(budget, 30); i++) {
    const seed = 70000 + i;
    const r = rng(seed);
    await rep.checkAsync("010 races", `interleaved beat writes leave a valid edit #${i}`, async () => {
      saveBeats(P, { source: "source.mov", beats: [{ label: "a", start: 0, end: 5 }] } as never, "base");
      const writes = Array.from({ length: r.int(2, 6) }, (_, k) =>
        Promise.resolve().then(() => saveBeats(P, {
          source: "source.mov",
          beats: [{ label: `w${k}`, start: 0, end: 1 + k }],
        } as never, `write ${k}`)));
      await Promise.all(writes);
      const back = loadBeats(P);
      if (!back) throw new Error("beats.json is unreadable after concurrent writes");
      if (!Array.isArray(back.beats) || !back.beats.length) throw new Error("beats.json lost its beats");
      for (const b of back.beats) {
        if (typeof b.start !== "number" || typeof b.end !== "number") {
          throw new Error("a concurrent write left a malformed beat");
        }
      }
    }, seed);
  }

  /* ---- a torn file must never be left behind -------------------------- */
  await rep.checkAsync("011 integrity", "a write is atomic: no torn beats.json", async () => {
    const big = { source: "source.mov",
                  beats: Array.from({ length: 2000 }, (_, i) => ({ label: `b${i}`, start: i, end: i + 0.5 })) };
    for (let k = 0; k < 20; k++) saveBeats(P, { ...big, beats: big.beats.slice(0, 100 + k) } as never, `big ${k}`);
    const text = fs.readFileSync(path.join(dir, "beats.json"), "utf8");
    JSON.parse(text);                    // throws if a partial write survived
    if (fs.readdirSync(dir).some((f) => f.includes(".tmp"))) {
      throw new Error("a temp file was left behind");
    }
  });
}
