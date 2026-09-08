import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { layout, type Clip, type EdlPiece } from "../lib/timelineLayout.ts";

const clip = (label: string, start: number, end: number, extra: Partial<Clip> = {}): Clip =>
  ({ label, start, end, ...extra });

describe("timeline layout", () => {
  test("with no EDL, a clip is laid out at its own length", () => {
    const { total, placed } = layout([clip("a", 10, 12), clip("b", 20, 20.5)]);
    assert.equal(total, 2.5);
    assert.deepEqual(placed.map((p) => [p.at, p.dur]), [[0, 2], [2, 0.5]]);
  });

  /* A beat rendered as several pieces -- an internal pause trimmed out -- is
     still ONE clip on the timeline. Grouping by base label is what keeps it
     from showing up as three. */
  test("EDL pieces from one beat group back into one clip", () => {
    const edl: EdlPiece[] = [
      { label: "a-0", src_start: 10, src_end: 10.8, dur: 0.8 },
      { label: "a-1", src_start: 11.4, src_end: 12, dur: 0.6 },
    ];
    const { placed, pieces, total } = layout([clip("a", 10, 12)], edl);
    assert.equal(placed.length, 1, "one clip");
    assert.equal(pieces.length, 2, "two runs of film");
    assert.equal(total, 1.4, "the trimmed pause is not in the length");
  });

  /* The regression that made a 2:08 project read as 2:49: a label like
     "need-egf-2" is its own beat, not piece 2 of "need-egf". */
  test("a numbered beat is not mistaken for a piece of another beat", () => {
    const clips = [clip("need-egf", 81, 82), clip("need-egf-2", 91, 92)];
    const edl: EdlPiece[] = [
      { label: "need-egf", src_start: 81, src_end: 82, dur: 1 },
      { label: "need-egf-2", src_start: 91, src_end: 92, dur: 1 },
    ];
    const { placed, total } = layout(clips, edl);
    assert.equal(placed.length, 2);
    assert.equal(total, 2, "each beat contributes its own second");
  });

  test("an EDL entry for a beat that has since been deleted is ignored", () => {
    const edl: EdlPiece[] = [{ label: "gone", src_start: 0, src_end: 5, dur: 5 }];
    const { total } = layout([clip("a", 10, 11)], edl);
    assert.equal(total, 1, "the deleted beat must not pad the timeline");
  });

  /* Holes: a stretch the editor cut out of the MIDDLE of a line. The gap has
     to close in the layout straight away, not at the next render. */
  describe("holes", () => {
    test("a hole shortens the clip and splits it into runs", () => {
      const c = clip("a", 10, 14, { holes: [[11.5, 12.2]] });
      const { placed, pieces, total } = layout([c]);
      assert.equal(total, 3.3, "4s line minus a 0.7s hole");
      assert.equal(placed.length, 1, "still one clip");
      assert.deepEqual(pieces.map((p) => [p.srcStart, p.srcEnd]),
                       [[10, 11.5], [12.2, 14]]);
    });

    test("the runs butt together — no gap is left in the cut", () => {
      const { pieces } = layout([clip("a", 10, 14, { holes: [[11.5, 12.2]] })]);
      assert.equal(pieces[0].at + pieces[0].dur, pieces[1].at,
                   "the second run starts exactly where the first ends");
    });

    test("several holes all come out", () => {
      const c = clip("a", 0, 10, { holes: [[1, 2], [5, 6]] });
      assert.equal(layout([c]).total, 8);
    });

    test("a hole reaching past the line's end is clamped, not overcounted", () => {
      const c = clip("a", 0, 5, { holes: [[4, 99]] });
      const { total, pieces } = layout([c]);
      assert.equal(total, 4);
      assert.equal(pieces.length, 1);
    });

    test("a rendered EDL wins over the hole fallback", () => {
      // once built, the EDL already has the hole taken out; applying it twice
      // would report a cut shorter than the file actually is
      const c = clip("a", 10, 14, { holes: [[11.5, 12.2]] });
      const edl: EdlPiece[] = [
        { label: "a-0", src_start: 10, src_end: 11.5, dur: 1.5 },
        { label: "a-1", src_start: 12.2, src_end: 14, dur: 1.8 },
      ];
      assert.equal(layout([c], edl).total, 3.3);
    });
  });
});
