import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { PROJECTS_ROOT } from "../lib/paths.ts";
import { readEdl, readEdlForTimeline } from "../lib/edl.ts";

/* Two screens, two questions, one file.

   The Queue card sits beside a filename and says how long THAT FILE is. The
   timeline is the surface you edit on and has to show the EDIT. On a project
   edited since its last build those are different numbers and both are right --
   and the card already says "that file was rendered before your latest edit".

   Reading one number for both is how img-9817 came to show 2m 10s beside a
   file that is 1m 38s (fixed in a52aa3d by reading the EDL), and how qa-clip
   came to show a 14.8s timeline for a 33.4s edit whose last 18.6s could not be
   clicked. Fixing either one by itself brings the other back. */
const P = "_test_edl_freshness";
const dir = path.join(PROJECTS_ROOT, P);

const write = (edl: unknown[], beatsNewer: boolean) => {
  fs.mkdirSync(path.join(dir, "work"), { recursive: true });
  fs.mkdirSync(path.join(dir, "cuts"), { recursive: true });
  fs.writeFileSync(path.join(dir, "cuts", "c.mp4"), "");
  fs.writeFileSync(path.join(dir, "work", "edl.json"), JSON.stringify(edl));
  fs.writeFileSync(path.join(dir, "beats.json"),
    JSON.stringify({ source: "raw/x.mov", beats: [{ label: "a", start: 0, end: 5 }] }));
  // the edit is touched after the build, or before it
  const built = Date.now();
  fs.utimesSync(path.join(dir, "work", "edl.json"), built / 1000, built / 1000);
  const edited = beatsNewer ? built + 60_000 : built - 60_000;
  fs.utimesSync(path.join(dir, "beats.json"), edited / 1000, edited / 1000);
};

const old = [{ label: "a", src_start: 0, src_end: 0.35, dur: 0.35 }];
const recorded = [{ label: "a", src_start: 0, src_end: 0.35, dur: 0.35, of_start: 0, of_end: 5 }];

before(() => fs.rmSync(dir, { recursive: true, force: true }));
after(() => fs.rmSync(dir, { recursive: true, force: true }));

describe("what the EDL is allowed to describe", () => {
  test("an old EDL edited over is still the file, and no longer the edit", () => {
    write(old, true);
    assert.equal(readEdl(P, true).length, 1, "the Queue still describes the file");
    assert.equal(readEdlForTimeline(P, true).length, 0, "the timeline will not");
  });

  test("an old EDL nobody has edited since is trusted by both", () => {
    write(old, false);
    assert.equal(readEdl(P, true).length, 1);
    assert.equal(readEdlForTimeline(P, true).length, 1);
  });

  /* Once the builder records what it cut, the coarse timestamp rule stops
     being needed: layout() compares beat by beat, so an edit to ONE line no
     longer throws away the rendered lengths of the other thirty-three. */
  test("an EDL that records what it cut is kept, and judged per beat instead", () => {
    write(recorded, true);
    assert.equal(readEdlForTimeline(P, true).length, 1,
      "not discarded wholesale — layout decides, beat by beat");
  });

  test("with no cut on disk there is nothing to describe", () => {
    write(recorded, true);
    assert.equal(readEdl(P, false).length, 0);
    assert.equal(readEdlForTimeline(P, false).length, 0);
  });
});
