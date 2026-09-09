import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { PROJECTS_ROOT } from "../lib/paths.ts";
import { loadBeats, readBeats } from "../lib/beats.ts";
import { summarizeAllProjects } from "../lib/projectSummary.ts";
import { layout, type EdlPiece } from "../lib/timelineLayout.ts";

/* REGRESSION-001 — one bad beats.json emptied the entire queue.
   loadBeats was a bare JSON.parse with a cast on the end. beats.json is the
   edit and Kayer opens it by hand, so a stray comma threw out of
   summarizeAllProjects, 500'd /api/projects, and took every OTHER project
   off the dashboard with it. Found by the gauntlet, not by use. */

const BROKEN = "zz-reg-broken";
const GOOD = "zz-reg-good";
const dirOf = (n: string) => path.join(PROJECTS_ROOT, n);
const clean = () => { for (const n of [BROKEN, GOOD]) fs.rmSync(dirOf(n), { recursive: true, force: true }); };

before(() => {
  clean();
  fs.mkdirSync(dirOf(GOOD), { recursive: true });
  fs.writeFileSync(path.join(dirOf(GOOD), "beats.json"),
    JSON.stringify({ source: "raw/a.mov", beats: [{ label: "a", start: 0, end: 2 }] }));
  fs.mkdirSync(dirOf(BROKEN), { recursive: true });
});
after(clean);

describe("a project whose beats.json cannot be read", () => {
  const bad: [string, string][] = [
    ["truncated mid-write", '{"source":"raw/a.mov","beats":[{"lab'],
    ["not JSON at all", "notes to self"],
    ["empty file", ""],
    ["an array, not an object", "[]"],
    ["beats is null", '{"beats":null}'],
    ["beats is an object", '{"beats":{}}'],
    ["a trailing comma", '{"beats":[],}'],
  ];

  for (const [what, body] of bad) {
    test(`${what}: loadBeats returns null instead of throwing`, () => {
      fs.writeFileSync(path.join(dirOf(BROKEN), "beats.json"), body);
      assert.doesNotThrow(() => loadBeats(BROKEN));
      assert.equal(loadBeats(BROKEN), null);
    });

    test(`${what}: the rest of the queue still loads`, () => {
      fs.writeFileSync(path.join(dirOf(BROKEN), "beats.json"), body);
      const all = summarizeAllProjects();
      assert.ok(all.some((p) => p.name === GOOD),
                "a healthy project must survive a broken neighbour");
    });

    test(`${what}: the broken project stays visible, and says why`, () => {
      fs.writeFileSync(path.join(dirOf(BROKEN), "beats.json"), body);
      const row = summarizeAllProjects().find((p) => p.name === BROKEN);
      assert.ok(row, "a project on disk must not silently disappear");
      assert.ok(row!.problem && row!.problem.length > 0, "it has to say what is wrong");
    });
  }

  test("readBeats tells a missing project from a broken one", () => {
    fs.rmSync(path.join(dirOf(BROKEN), "beats.json"), { force: true });
    const gone = readBeats(BROKEN);
    assert.equal(gone.ok, false);
    assert.equal((gone as { missing: boolean }).missing, true);

    fs.writeFileSync(path.join(dirOf(BROKEN), "beats.json"), "{oops");
    const broke = readBeats(BROKEN);
    assert.equal(broke.ok, false);
    assert.equal((broke as { missing: boolean }).missing, false);
  });
});

/* REGRESSION-002 — an EDL piece with a negative duration ran the timeline
   backwards. Positions are a running sum, so one bad piece gave a negative
   total, and every playhead position and filmstrip offset inherited it. */
describe("an EDL that cannot describe real footage", () => {
  const clip = [{ label: "a", start: 0, end: 4 }];
  const cases: [string, EdlPiece[]][] = [
    ["negative duration", [{ label: "a", src_start: 0, src_end: 4, dur: -4 }]],
    ["NaN duration", [{ label: "a", src_start: 0, src_end: 4, dur: NaN }]],
    ["infinite duration", [{ label: "a", src_start: 0, src_end: 4, dur: Infinity }]],
    ["inverted source range", [{ label: "a", src_start: 4, src_end: 0, dur: 4 }]],
    ["non-finite source", [{ label: "a", src_start: NaN, src_end: 4, dur: 4 }]],
  ];
  for (const [what, edl] of cases) {
    test(`${what} falls back to the beat's own length`, () => {
      const { total, placed } = layout(clip, edl);
      assert.ok(total >= 0, `total went backwards: ${total}`);
      assert.ok(Number.isFinite(total), `total is ${total}`);
      assert.equal(placed.length, 1);
      assert.ok(placed[0].dur >= 0, `clip duration went backwards: ${placed[0].dur}`);
      // the honest answer is the beat itself, 4s
      assert.ok(Math.abs(total - 4) < 0.01, `expected the beat's own 4s, got ${total}`);
    });
  }
});
