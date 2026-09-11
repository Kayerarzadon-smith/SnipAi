import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fsSync from "node:fs";
import path from "node:path";
import { tempLibrary, readBeats, req } from "./_fixture.mts";

/**
 * LEDGER S8 — lib/beats.ts:88-90, reached from
 * app/api/projects/[project]/beats/[label]/route.ts:166
 *
 * A trim can push a line's existing holes across the whole of what is left of
 * it. `updateBeatRange` writes `beat.start`/`beat.end` straight in and never
 * re-checks the holes against the new range; the PATCH path validates only
 * `end - start >= 0.15`, so it never reaches normaliseHoles' own "that hole is
 * the whole line" guard, which is only wired to the `body.holes` branch.
 *
 * The line then disappears from the finished video with nothing anywhere
 * saying so: it still sits in beats.json looking fine, and the timeline draws
 * it 0px wide so it cannot even be clicked.
 *
 * This file asserts BOTH halves, because a TypeScript-only proof would go
 * green while the line still vanished from the render:
 *
 *   the guard   — the trim is refused, beats.json is untouched, and the
 *                 refusal says which edit it is refusing and why
 *   the render  — walk_pieces (ugc-edit-system/tools/build_cut.py, read, not
 *                 edited) emits at least one piece for every range the guard
 *                 accepts, and zero for the range it refuses
 *
 * No video and no ffmpeg: walk_pieces is pure arithmetic over numbers.
 */

const ROOT = path.dirname(path.dirname(path.dirname(new URL(import.meta.url).pathname)));
const TOOLS = path.join(ROOT, "ugc-edit-system", "tools");

/* lib/paths.ts resolves SNIPAI_DATA once, at import, so a second tempLibrary()
 * in the same file makes a directory the app modules will never look at -- the
 * test then reads the new root while the code writes the old one, and passes
 * or fails for reasons that have nothing to do with the bug. One library per
 * file, one project per test inside it. */
const LIB = tempLibrary("untouched", []);

function project(name: string, beats: unknown[]): string {
  const dir = path.join(LIB, "projects", name);
  fsSync.mkdirSync(dir, { recursive: true });
  fsSync.writeFileSync(path.join(dir, "beats.json"),
    JSON.stringify({ source: "source.mov", beats }, null, 2));
  return name;
}

const holedLine = () => [
  { label: "hook", start: 10, end: 20, text: "the hook", holes: [[12, 18]] },
];

type Case = { s: number; e: number; holes: [number, number][]; sil?: [number, number][] };

/** Ask build_cut.py itself how many pieces each beat renders as. */
function piecesFor(cases: Case[]): number[] {
  const script = `
import sys, json
sys.path.insert(0, ${JSON.stringify(TOOLS)})
import build_cut as bc
out = []
for c in json.load(sys.stdin):
    pieces, removed, splits = bc.walk_pieces(
        "hook", c["s"], c["e"], c.get("sil") or [], c["holes"])
    out.append(len(pieces))
json.dump(out, sys.stdout)
`;
  const r = spawnSync("python3", ["-c", script], {
    input: JSON.stringify(cases), encoding: "utf8",
  });
  assert.equal(r.status, 0, `walk_pieces could not be called: ${r.stderr}`);
  return JSON.parse(r.stdout) as number[];
}

/* ------------------------------------------------------------------ */
/* The harm, stated in the pipeline's own terms before anything else.   */
/* ------------------------------------------------------------------ */

test("S8: the render half — the reported trim renders as nothing at all", () => {
  const [whole, trimmed] = piecesFor([
    { s: 10.0, e: 20.0, holes: [[12.0, 18.0]] },   // as drafted: two pieces
    { s: 12.5, e: 15.0, holes: [[12.0, 18.0]] },   // after the trim: silence
  ]);
  assert.ok(whole >= 1, "the untrimmed line should render");
  assert.equal(trimmed, 0,
    "this test's premise is gone: walk_pieces no longer drops the trimmed line, " +
    "so the guard below is being proved against a harm that does not exist");
});

/* ------------------------------------------------------------------ */
/* The guard.                                                          */
/* ------------------------------------------------------------------ */

test("S8: updateBeatRange refuses a trim its holes would swallow", async () => {
  const p = project("swallowed", holedLine());
  const { updateBeatRange } = await import("../../lib/beats.ts");

  const r = updateBeatRange(p, "hook", 12.5, 15.0);
  assert.equal(r.ok, false, "a trim leaving nothing of the line was accepted");
  assert.match((r as { error: string }).error, /already cut out|leave/i,
    "the refusal has to say what it is refusing and why");

  const after = readBeats(LIB, p).beats[0];
  assert.deepEqual([after.start, after.end], [10, 20],
    "a refused trim must not have been written");
});

test("S8: PATCH answers 4xx with the reason, and does not write", async () => {
  const p = project("via-patch", holedLine());
  const { PATCH } = await import(
    "../../app/api/projects/[project]/beats/[label]/route.ts");

  const res = await PATCH(req({ start: 12.5, end: 15.0 }),
    { params: { project: p, label: "hook" } });
  assert.equal(res.status, 400,
    "the trim that empties a line came back as a success");
  const body = await res.json();
  assert.ok(typeof body.error === "string" && body.error.length > 10,
    `the refusal must carry a sentence a person can act on, got ${JSON.stringify(body)}`);

  const after = readBeats(LIB, p).beats[0];
  assert.deepEqual([after.start, after.end], [10, 20]);
});

test("S8: a trim that leaves footage is still allowed, holes intact", async () => {
  const p = project("legal-trim", holedLine());
  const { updateBeatRange } = await import("../../lib/beats.ts");

  const r = updateBeatRange(p, "hook", 11.0, 19.0);
  assert.equal(r.ok, true, "11-19 keeps 1s either side of the hole and must be allowed");

  const after = readBeats(LIB, p).beats[0];
  assert.deepEqual([after.start, after.end], [11, 19]);
  assert.deepEqual(after.holes, [[12, 18]],
    "the hole is stored as drawn; build_cut clamps it at read time, and " +
    "rewriting it here would lose its edges the moment the line is trimmed back out");
});

test("S8: a line with no holes trims exactly as it always did", async () => {
  const p = project("no-holes", [{ label: "hook", start: 10, end: 20, text: "t" }]);
  const { updateBeatRange } = await import("../../lib/beats.ts");
  const r = updateBeatRange(p, "hook", 12.5, 15.0);
  assert.equal(r.ok, true, "the guard is refusing trims that have no hole to swallow them");
  assert.deepEqual(
    [readBeats(LIB, p).beats[0].start, readBeats(LIB, p).beats[0].end], [12.5, 15]);
});

/* ------------------------------------------------------------------ */
/* The two halves tied together, over a sweep rather than one example.  */
/* ------------------------------------------------------------------ */

test("S8: every trim the guard accepts renders at least one piece", async () => {
  const { keptAfterTrim } = await import("../../lib/holes.ts");

  const beat = { start: 10, end: 20, holes: [[12, 18]] as [number, number][] };
  const cases: Case[] = [];
  const accepted: boolean[] = [];
  const reasons: string[] = [];

  for (let s = 10.0; s <= 17.5; s += 0.25) {
    for (let e = s + 0.15; e <= 20.0; e += 0.25) {
      const start = Math.round(s * 1000) / 1000;
      const end = Math.round(e * 1000) / 1000;
      const k = keptAfterTrim(beat, start, end);
      cases.push({ s: start, e: end, holes: beat.holes, sil: [[14.0, 16.0]] });
      accepted.push(k.ok);
      reasons.push(`${start}-${end}`);
    }
  }

  const counts = piecesFor(cases);

  // The implication is only worth anything if both sides of it occur.
  assert.ok(accepted.some(Boolean), "the sweep accepted nothing");
  assert.ok(accepted.some((a) => !a), "the sweep refused nothing — it cannot fail");

  const vanished = reasons.filter((_, i) => accepted[i] && counts[i] === 0);
  assert.deepEqual(vanished, [],
    "these trims were accepted and render as nothing at all");

  // And the guard is not simply refusing everything: the ranges it allows are
  // the ones that survive.
  const refusedButFine = reasons.filter((_, i) => !accepted[i] && counts[i] > 0);
  assert.ok(refusedButFine.length < counts.length / 2,
    "the guard is refusing most of the trims that would have worked");
});

test("S8: holes are the only way to empty a beat — a pause alone cannot", () => {
  // walk_pieces also removes detected pauses. If those could empty a line on
  // their own, a hole-shaped guard would be the wrong shape. They cannot: the
  // head guard skips a pause within 0.18s of the in-point and a tail-reaching
  // pause only moves the out-point, so something always survives.
  const cases: Case[] = [];
  for (let s = 10.0; s <= 12.0; s += 0.5) {
    for (let e = s + 0.2; e <= 20.0; e += 0.5) {
      cases.push({ s, e, holes: [], sil: [[10.0, 13.0], [14.0, 19.5]] });
    }
  }
  const counts = piecesFor(cases);
  assert.equal(counts.filter((n) => n === 0).length, 0,
    "a beat with no holes rendered as nothing — the guard is aimed at the wrong thing");
});

/* ------------------------------------------------------------------ */
/* The sibling call site, and the surface that has to say so.          */
/* ------------------------------------------------------------------ */

test("S8: picking a take cannot empty the line either", async () => {
  // The take picker is the other caller of updateBeatRange, and it moves the
  // edges further than a drag ever does.
  const p = project("take-pick", holedLine());
  const { updateBeatRange } = await import("../../lib/beats.ts");
  const r = updateBeatRange(p, "hook", 13.0, 16.0);
  assert.equal(r.ok, false);
  assert.deepEqual(
    [readBeats(LIB, p).beats[0].start, readBeats(LIB, p).beats[0].end], [10, 20]);
});

test("S8: the timeline drag reports a refused trim instead of snapping back", async () => {
  // A shape assertion, and labelled as one: there is no DOM harness, so what
  // can be proved here is that the failure branch is not silent. The harm it
  // stands against is ledger BUG-011 — "delete says it cut, and cuts nothing"
  // — reappearing as "the handle springs back and nothing says why".
  const fs = await import("node:fs");
  const src = fs.readFileSync(
    path.join(ROOT, "app", "projects", "[project]", "review", "page.tsx"), "utf8");
  const fn = src.slice(src.indexOf("function timelineTrim("));
  const body = fn.slice(0, fn.indexOf("\n  }\n") + 4);
  assert.ok(body.includes("toast("),
    "timelineTrim's PATCH failure branch reloads and says nothing");
});
