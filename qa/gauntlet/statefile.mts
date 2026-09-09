/* CATEGORY 011/019 — the review state, which is where the user's decisions live.
 *
 * review-state.json holds takePicks, trimEdits, cutRegions, deletedBeats,
 * beatDiagnoses and the cached scorecard: every judgement the person has made
 * that is not in beats.json. readJson() falls back to defaults when the file
 * cannot be parsed, and updateReviewState() then WRITES those defaults back.
 * So an unreadable state file is not a read that fails -- it is a read that
 * silently erases the work. */
import fs from "node:fs";
import path from "node:path";
import type { Report } from "../report.mts";

export async function run(rep: Report, root: string) {
  const P = "fixture";
  const file = path.join(root, "projects", P, "review-state.json");
  const { updateReviewState, loadReviewState } = await import("../../lib/reviewState.ts");

  /** A state file with real decisions in it, the kind that took hours. */
  const REAL = {
    project: P, cutStatus: "reviewed", updatedAt: "2026-09-08T00:00:00Z",
    timelineMarkers: [{ at: 12.5, note: "check this" }],
    beatDiagnoses: { hook: "stutter" },
    takePicks: { hook: "take-3", cta: "take-1" },
    candidateCache: {},
    deletedBeats: [{ label: "dropped", text: "a line he cut", start: 1, end: 2 }],
    trimEdits: [{ label: "hook", from: 10, to: 11 }],
    cutRegions: [{ label: "hook", from: 12, to: 13 }],
  };

  const CORRUPT: [string, string][] = [
    ["truncated mid-write", '{"project":"fixture","takePicks":{"hook":"tak'],
    ["not JSON", "some notes"],
    ["empty file", ""],
    ["a trailing comma", '{"takePicks":{},}'],
    ["null", "null"],
  ];

  for (const [what, body] of CORRUPT) {
    await rep.checkAsync("011 integrity", `an unreadable state file (${what}) is not silently replaced`, async () => {
      const dir = path.dirname(file);
      for (const f of fs.readdirSync(dir).filter((x) => x.includes(".corrupt-"))) {
        fs.rmSync(path.join(dir, f), { force: true });
      }
      fs.writeFileSync(file, body);
      // the read-only path: this is what a GET does to peek at the cache
      const state = loadReviewState(P) as unknown as Record<string, unknown>;
      updateReviewState(P, () => {});

      const live = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : null;
      if (live === body) return;                        // left alone: also fine

      // The bytes must still exist somewhere. Losing them is the defect: the
      // decisions in that file took hours and there is no other copy.
      const kept = fs.readdirSync(dir).filter((f) => f.startsWith("review-state.json.corrupt-"));
      if (!kept.length) {
        throw new Error("the unreadable file was replaced and not kept — every take pick, trim and cut region gone, with nothing to recover from");
      }
      const saved = fs.readFileSync(path.join(dir, kept[kept.length - 1]), "utf8");
      if (saved !== body) throw new Error("what was kept is not what was on disk");
      // and the app has to SAY so, not just carry on looking empty
      if (typeof state.stateProblem !== "string" || !state.stateProblem) {
        throw new Error("the state came back empty with no explanation");
      }
      if (!state.stateProblem.includes("corrupt-")) {
        throw new Error("the message does not say where the file went");
      }
      for (const f of kept) fs.rmSync(path.join(dir, f), { force: true });
    });
  }

  await rep.checkAsync("011 integrity", "a good state file survives a read", async () => {
    fs.writeFileSync(file, JSON.stringify(REAL, null, 2));
    updateReviewState(P, () => {});
    const back = loadReviewState(P) as unknown as Record<string, unknown>;
    for (const key of ["takePicks", "deletedBeats", "trimEdits", "cutRegions", "beatDiagnoses", "timelineMarkers"]) {
      const v = back[key];
      const n = Array.isArray(v) ? v.length : Object.keys((v ?? {}) as object).length;
      if (!n) throw new Error(`${key} was emptied by a read`);
    }
  });

  await rep.checkAsync("011 integrity", "reading the state does not write it", async () => {
    fs.writeFileSync(file, JSON.stringify(REAL, null, 2));
    const before = fs.statSync(file).mtimeMs;
    await new Promise((r) => setTimeout(r, 12));
    loadReviewState(P);
    if (fs.statSync(file).mtimeMs !== before) throw new Error("a read wrote to disk");
  });

  await rep.checkAsync("011 integrity", "an update that changes nothing does not write", async () => {
    fs.writeFileSync(file, JSON.stringify(REAL, null, 2));
    const before = fs.statSync(file).mtimeMs;
    await new Promise((r) => setTimeout(r, 12));
    updateReviewState(P, () => {});
    if (fs.statSync(file).mtimeMs !== before) {
      throw new Error("a no-op update rewrote review-state.json");
    }
  });

  await rep.checkAsync("011 integrity", "an update that changes something does write", async () => {
    fs.writeFileSync(file, JSON.stringify(REAL, null, 2));
    updateReviewState(P, (s) => { (s as unknown as Record<string, unknown>).cutStatus = "approved"; });
    const back = JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, unknown>;
    if (back.cutStatus !== "approved") throw new Error("a real change was not saved");
  });
}
