import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { isCutStale, isPipelineBehind } from "../lib/cutFreshness.ts";
import { PROJECTS_ROOT, CODE_ROOT } from "../lib/paths.ts";

/* A render is a snapshot of two things, not one: of the EDIT, and of the
   CUTTING that produced it. isCutStale has covered the first since 86a90d4.
   The second went unnoticed until a QA pass measured both of Kayer's cuts and
   found the two clipped consonants WORD_RESCUE was written to remove still
   sitting in the files the Queue was offering -- the edits were untouched, so
   nothing said a word. A tester then files a bug that is already fixed, and a
   person posts a video carrying a defect the code no longer produces. */

const P = "_test_pipeline_version";
const dir = path.join(PROJECTS_ROOT, P);
const work = path.join(dir, "work");
const cuts = path.join(dir, "cuts");

function current(): number {
  return Number(
    JSON.parse(fs.readFileSync(path.join(CODE_ROOT, "pipeline-version.json"), "utf8")).version
  );
}

before(() => {
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(work, { recursive: true });
  fs.mkdirSync(cuts, { recursive: true });
  fs.writeFileSync(path.join(dir, "beats.json"),
    JSON.stringify({ source: "x.mov", beats: [{ label: "a", start: 0, end: 1 }] }));
  fs.writeFileSync(path.join(cuts, "cut.mp4"), "not really a video");
});
after(() => fs.rmSync(dir, { recursive: true, force: true }));

describe("a build knows which pipeline made it", () => {
  test("the pipeline ships a version, and it is a positive whole number", () => {
    assert.ok(Number.isInteger(current()) && current() > 0,
      "pipeline-version.json must carry a version, or nothing can be compared to it");
  });

  test("an unstamped build is behind -- that is what no stamp MEANS", () => {
    fs.rmSync(path.join(work, "pipeline.json"), { force: true });
    assert.equal(isPipelineBehind(P, "cut.mp4"), true);
  });

  test("a build stamped with the current pipeline is not behind", () => {
    fs.writeFileSync(path.join(work, "pipeline.json"),
      JSON.stringify({ version: current(), built: "2026-09-10T00:00:00" }));
    assert.equal(isPipelineBehind(P, "cut.mp4"), false);
  });

  test("a build stamped with an older pipeline is behind", () => {
    fs.writeFileSync(path.join(work, "pipeline.json"),
      JSON.stringify({ version: current() - 1, built: "2026-09-01T00:00:00" }));
    assert.equal(isPipelineBehind(P, "cut.mp4"), true);
  });

  test("a stamp that is not readable asks for a rebuild rather than claiming freshness", () => {
    fs.writeFileSync(path.join(work, "pipeline.json"), "{ this is not json");
    assert.equal(isPipelineBehind(P, "cut.mp4"), true);
  });

  test("with no cut on disk there is nothing to be out of date", () => {
    fs.rmSync(path.join(work, "pipeline.json"), { force: true });
    assert.equal(isPipelineBehind(P, null), false);
  });

  test("it is a separate question from whether the file matches the edit", () => {
    fs.writeFileSync(path.join(work, "pipeline.json"),
      JSON.stringify({ version: current() }));
    const later = Date.now() / 1000 + 60;
    fs.utimesSync(path.join(dir, "beats.json"), later, later);
    assert.equal(isCutStale(P, "cut.mp4"), true, "the edit moved, so the file is stale");
    assert.equal(isPipelineBehind(P, "cut.mp4"), false, "but the cutting did not");
  });
});
