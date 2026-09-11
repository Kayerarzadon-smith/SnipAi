import test from "node:test";
import assert from "node:assert/strict";

import { layout, liveClock, cutTimeOf, type Clip, type EdlPiece } from "@/lib/timelineLayout";

/**
 * LEDGER C29 -- Your cut plays the whole edit and the clock stops 28.8s early.
 *
 * Measured on img-9817 on 2026-09-11. The transport reads `1:38.0 / 2:06.8`
 * and the timeline header reads `34 clips · 1:38.0`, on a project whose edit is
 * 34 spans totalling 130.20s less 3.37s of trims = **126.83s = 2:06.8**. The
 * tester checked four sources rather than trusting the card:
 *
 *     queue card                     cutSeconds: 98, cutStale: true
 *     review timeline header         34 clips · 1:38.0, PICTURE OUT OF DATE
 *     work/edl.json                  52 segments summing 98.249s
 *     rendered img-9817-v6.mp4       mvhd 98.389s
 *     the live edit (beats.json)     126.83s
 *
 * So 2:06.8 is the edit and 1:38.0 is the last RENDER, and the Live edit
 * transport was showing one of each, either side of the slash.
 *
 * MECHANISM. `layout()` prefers the EDL's durations wherever the EDL still
 * fits the beat, and it is right to -- build_cut snaps every edge inward
 * against the silence map, so the rendered file is genuinely shorter than the
 * beats, and using those lengths is what keeps the filmstrip lined up with the
 * rendered picture. But in **Live edit** nothing rendered is playing: the
 * player runs the source through the beat ranges as they are now, and
 * build_cut's inward snapping has not been applied to a single frame of it. The
 * page took the clock from `layout(beats, edl)` all the same, so live playback
 * was being measured on the last build's timeline. Replayed against the real
 * project, 32 of 34 beats still fit their EDL pieces and the layout totals
 * **98.084s** -- which is the 1:38.0 exactly, and the ceiling the clock could
 * not pass however long the cut went on running.
 *
 * page.tsx:1506-1516 had already settled which number is authoritative -- "it
 * reports the edit now" -- and `cutDuration` at :1529 obeys it. The clock, the
 * scrub mapping and the timeline the playhead is drawn on were the call sites
 * that never got the same treatment. This is not two defensible numbers to
 * choose between; it is one decision applied in one place out of four.
 *
 * SECOND HALF, from the same mismatch: inside a line the old clock clamped a
 * SOURCE offset against a CUT duration -- `min(c.dur, srcTime - c.start)`, two
 * units in one expression. On the real line 27 (13.16s of footage, rendered as
 * 1.98s) that freezes the readout for 11.2 seconds while the picture plays on.
 */

/* A three-line edit, shaped like the real one: the render trimmed the pauses
   off every line, so its pieces sit inside the beats and `edlStillFits`
   accepts them. The edit runs 30s; the render of it runs 15s. */
const BEATS: Clip[] = [
  { label: "one", start: 10, end: 20 },                  // 10s
  { label: "two", start: 30, end: 44 },                  // 14s -- mostly pause, like line 27
  { label: "three", start: 50, end: 56 },                //  6s
];
const EDL: EdlPiece[] = [
  { label: "one", src_start: 10.5, src_end: 18.5, dur: 8, of_start: 10, of_end: 20 },
  { label: "two", src_start: 30.2, src_end: 32.2, dur: 2, of_start: 30, of_end: 44 },
  { label: "three", src_start: 50, src_end: 55, dur: 5, of_start: 50, of_end: 56 },
];
const EDIT_RUNS = 30;
const RENDER_RUNS = 15;

test("C29: the render really is shorter than the edit -- that part is not the bug", () => {
  // Stated so the next reader does not "fix" layout(). Pause trimming is real
  // and the EDL is the honest length of the FILE.
  assert.equal(layout(BEATS, EDL).total, RENDER_RUNS);
  assert.equal(layout(BEATS).total, EDIT_RUNS);
});

test("C29: the live clock reaches the end of the live edit", () => {
  /* The headline. Play to the last frame of the last line and the elapsed
     readout must arrive at the number printed on the other side of the slash.
     It stopped 15s short here and 28.8s short on img-9817, which is every line
     from "swear by this and are glowing up because of" to the end of the call
     to action -- `So I'll get you that sale link`, `But just do yourself a
     favor` -- reading as never played. */
  const { at, total } = liveClock(BEATS, 2, 56);
  assert.equal(total, EDIT_RUNS, "the stated length of the edit changed");
  assert.equal(at, total, `the clock stopped at ${at} on an edit that runs ${total}`);
});

test("C29: the clock does not freeze inside a line the render trimmed", () => {
  /* Line two is 14s of footage the render kept 2s of. The old arithmetic
     clamped the source offset against the RENDERED duration, so the readout
     advanced for two seconds and then sat still for twelve while the picture
     carried on -- and every line after it started from the wrong place. */
  const a = liveClock(BEATS, 1, 31)!.at!;
  const b = liveClock(BEATS, 1, 41)!.at!;
  assert.ok(
    Math.abs((b - a) - 10) < 0.01,
    `ten seconds of footage moved the clock ${(b - a).toFixed(2)}s`,
  );
});

test("C29: every line starts where the one before it ended", () => {
  // Cumulative, so one compressed line throws off everything after it.
  const starts = [0, 1, 2].map((i) => liveClock(BEATS, i, BEATS[i].start)!.at!);
  assert.deepEqual(starts, [0, 10, 24]);
});

test("C29: a stretch cut out of a line comes out of the clock too", () => {
  /* Source time vs cut time. The player skips a hole, so the clock must not
     count it -- this is the same conversion `cutToSource` does in the other
     direction, and the reason both have to go through the pieces. */
  const withHole: Clip[] = [{ label: "one", start: 10, end: 20, holes: [[13, 17]] }];
  const { placed, pieces, total } = layout(withHole);
  assert.equal(total, 6, "a 10s line with 4s cut out of it does not run 6s");
  assert.equal(cutTimeOf(pieces, placed[0], 12), 2);
  assert.equal(cutTimeOf(pieces, placed[0], 15), 3, "the clock ran through the hole");   // inside it
  assert.equal(cutTimeOf(pieces, placed[0], 18), 4);
});

test("C29: the live clock cannot be handed the render's timeline at all", () => {
  /* Structural, and the reason it is structural. The decision -- report the
     edit, not the last build -- was made and written down at
     review/page.tsx:1526-1536 and then applied at one call site out of four.
     `liveClock` takes no `edl` parameter, so the same omission cannot be made
     again by someone adding the fifth. This asserts the signature, because the
     signature IS the guarantee. */
  assert.equal(liveClock.length, 3, "liveClock grew a parameter -- if it is the EDL, C29 is back");
});

test("C29: the rendered file still gets the rendered timeline", () => {
  /* The other half of the rule, and the one that keeps this from being a
     revert. Watching the built mp4, the EDL's clock IS the player's clock, and
     the filmstrip lines up with the clips because of it. Nothing here may take
     that away. */
  const { placed, pieces, total } = layout(BEATS, EDL);
  assert.equal(total, RENDER_RUNS);
  assert.equal(cutTimeOf(pieces, placed[1], 31.2), 9, "the rendered timeline moved");
});
