import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { PROJECTS_ROOT } from "../lib/paths.ts";
import { loadReviewState, updateReviewState } from "../lib/reviewState.ts";

/* REGRESSION — a read used to destroy the decisions it was reading.
 *
 * review-state.json holds everything the person decided that is not in
 * beats.json: which take they picked, which stretches they cut, which lines
 * they deleted, what they said was wrong with a beat, the cached scorecard.
 *
 * readJson() returns the fallback for an unparseable file, so loadReviewState
 * handed back bare defaults — and updateReviewState then wrote those defaults
 * to disk. Two routes called `updateReviewState(p, () => {})` purely to READ
 * the candidate cache, so opening the Takes panel on a project whose state
 * file had been truncated erased the lot, and overwrote the only copy of it.
 *
 * Found by the gauntlet. There is no way to hit it by hand until the day it
 * costs you a day's work. */

const P = "zz-reg-reviewstate";
const dir = path.join(PROJECTS_ROOT, P);
const file = path.join(dir, "review-state.json");

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

const corruptFiles = () =>
  fs.readdirSync(dir).filter((f) => f.startsWith("review-state.json.corrupt-"));
const clean = () => fs.rmSync(dir, { recursive: true, force: true });

before(() => { clean(); fs.mkdirSync(dir, { recursive: true }); });
after(clean);

describe("an unreadable review-state.json", () => {
  const bad: [string, string][] = [
    ["truncated mid-write", '{"project":"x","takePicks":{"hook":"tak'],
    ["not JSON", "some notes"],
    ["empty", ""],
    ["a trailing comma", '{"takePicks":{},}'],
    ["null", "null"],
    ["an array", "[]"],
  ];

  for (const [what, body] of bad) {
    test(`${what}: the bytes are kept, not overwritten`, () => {
      for (const f of corruptFiles()) fs.rmSync(path.join(dir, f), { force: true });
      fs.writeFileSync(file, body);
      loadReviewState(P);
      updateReviewState(P, () => {});          // the shape that used to destroy it
      const kept = corruptFiles();
      assert.ok(kept.length, "the unreadable file must be kept, not replaced");
      assert.equal(fs.readFileSync(path.join(dir, kept[0]), "utf8"), body,
                   "what was kept must be exactly what was on disk");
    });

    test(`${what}: the app says what happened`, () => {
      for (const f of corruptFiles()) fs.rmSync(path.join(dir, f), { force: true });
      fs.writeFileSync(file, body);
      const s = loadReviewState(P) as unknown as Record<string, unknown>;
      assert.equal(typeof s.stateProblem, "string",
                   "coming back empty with no explanation is the same as losing it silently");
      assert.match(String(s.stateProblem), /corrupt-/, "it must say where the file went");
    });
  }
});

describe("a healthy review-state.json", () => {
  test("survives being read", () => {
    fs.writeFileSync(file, JSON.stringify(REAL, null, 2));
    updateReviewState(P, () => {});
    const back = loadReviewState(P) as unknown as Record<string, unknown>;
    assert.deepEqual(back.takePicks, REAL.takePicks);
    assert.deepEqual(back.trimEdits, REAL.trimEdits);
    assert.deepEqual(back.cutRegions, REAL.cutRegions);
    assert.deepEqual(back.deletedBeats, REAL.deletedBeats);
    assert.equal(back.stateProblem, undefined);
  });

  test("a read does not write", async () => {
    fs.writeFileSync(file, JSON.stringify(REAL, null, 2));
    const before = fs.statSync(file).mtimeMs;
    await new Promise((r) => setTimeout(r, 12));
    loadReviewState(P);
    assert.equal(fs.statSync(file).mtimeMs, before, "reading must not touch the file");
  });

  test("an update that changes nothing does not write", async () => {
    fs.writeFileSync(file, JSON.stringify(REAL, null, 2));
    const before = fs.statSync(file).mtimeMs;
    await new Promise((r) => setTimeout(r, 12));
    updateReviewState(P, () => {});
    assert.equal(fs.statSync(file).mtimeMs, before);
  });

  test("an update that changes something is saved", () => {
    fs.writeFileSync(file, JSON.stringify(REAL, null, 2));
    updateReviewState(P, (s) => { s.cutStatus = "approved"; });
    const back = JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, unknown>;
    assert.equal(back.cutStatus, "approved");
    assert.deepEqual(back.takePicks, REAL.takePicks, "the rest must come through untouched");
  });

  test("a state file missing newer keys gains their defaults", () => {
    fs.writeFileSync(file, JSON.stringify({ project: P, cutStatus: "unreviewed" }));
    const back = loadReviewState(P);
    assert.deepEqual(back.takePicks, {}, "an older file must not crash a .map() later");
    assert.deepEqual(back.timelineMarkers, []);
  });
});
