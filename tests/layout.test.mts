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

/* The EDL is written at build time. Once a beat is trimmed or has a stretch
   cut out of it, those pieces describe a video that no longer matches the
   edit -- and laying the beat out from them reports the LAST RENDER's length.
   That is how a cut could remove ten seconds and leave the timeline saying
   exactly what it said before, which reads as "my edit did not save". */
describe("stale EDL pieces are not trusted", () => {
  const edlFor = (label: string, a: number, b: number): EdlPiece[] =>
    [{ label, src_start: a, src_end: b, dur: b - a }];

  test("a hole punched since the build makes its pieces stale", () => {
    const c = clip("a", 10, 14, { holes: [[11, 12]] });
    // the EDL still spans the hole, so it is from before the cut
    const { total } = layout([c], edlFor("a", 10, 14));
    assert.equal(total, 3, "must report the edit (4s - 1s), not the render (4s)");
  });

  test("a beat trimmed since the build makes its pieces stale", () => {
    const c = clip("a", 10, 12);                    // trimmed in from 14
    const { total } = layout([c], edlFor("a", 10, 14));
    assert.equal(total, 2);
  });

  test("pieces that still fit are used, so a built cut keeps its real length", () => {
    // build_cut snaps edges inward, so the render is legitimately shorter
    const c = clip("a", 10, 14);
    const { total } = layout([c], edlFor("a", 10.2, 13.8));
    assert.equal(total, 3.6, "the rendered length is the honest one here");
  });

  test("a hole clear of the pieces still trusts them", () => {
    const c = clip("a", 10, 14, { holes: [[13.9, 13.95]] });
    const { total } = layout([c], edlFor("a", 10, 13.8));
    assert.equal(total, 3.8);
  });
});

/* A piece left over from before its beat was edited must not describe it.
   
   QA on 2026-09-10: qa-clip's timeline read `10 clips · 0:14.8` while the
   player read `0:33.4` for the same edit at the same moment, and the last 18.6
   seconds of the cut could not be clicked because the timeline did not extend
   that far. The beat `between-eyes-its` spans 5.02s; the EDL still held a
   0.345s fragment from an earlier version of it, the fragment sat inside the
   beat and clear of its holes, so it "fitted" and the beat was drawn at
   0.345s.
   
   Coverage cannot decide this. On img-9817 a healthy beat covers 0.15 of its
   span and on img-9823 0.20, against qa-clip's 0.07 and 0.17 -- the two
   populations overlap, because pause trimming legitimately removes most of a
   line that is mostly pause. So the builder records the beat it cut, and the
   layout compares it. */
describe("an EDL piece has to be a picture of the beat it is laid against", () => {
  test("a fragment from an older version of the beat is not trusted", () => {
    const stale: EdlPiece[] = [
      { label: "between-eyes-its", src_start: 0.178, src_end: 0.523, dur: 0.345,
        of_start: 0.178, of_end: 0.523 },   // the beat as it was THEN
    ];
    const { total, placed } = layout([clip("between-eyes-its", 0, 5.02)], stale);
    assert.equal(total, 5.02, "the beat is 5.02s now, whatever the last render was");
    assert.equal(placed[0].dur, 5.02);
  });

  test("a piece that does record this beat is trusted, however little it covers", () => {
    // 0.15 of its span, which is a real ratio from img-9817 and not a defect
    const good: EdlPiece[] = [
      { label: "swear-by-glowing", src_start: 10, src_end: 11.98, dur: 1.98,
        of_start: 10, of_end: 23.16 },
    ];
    const { total } = layout([clip("swear-by-glowing", 10, 23.16)], good);
    assert.equal(total, 1.98, "the render is the truth when it describes this beat");
  });

  test("a millisecond of rounding is not a changed beat", () => {
    const edl: EdlPiece[] = [
      { label: "a", src_start: 10, src_end: 11, dur: 1, of_start: 9.9999, of_end: 12.0001 },
    ];
    assert.equal(layout([clip("a", 10, 12)], edl).total, 1);
  });

  /* Every EDL written before the builder recorded this has no of_start, and
     those must keep working exactly as they did -- the fallback for them is in
     readEdl, not here. */
  test("an EDL with no record of what it cut behaves as it always did", () => {
    const old: EdlPiece[] = [
      { label: "a-0", src_start: 10, src_end: 10.8, dur: 0.8 },
      { label: "a-1", src_start: 11.4, src_end: 12, dur: 0.6 },
    ];
    assert.equal(layout([clip("a", 10, 12)], old).total, 1.4);
  });
});
