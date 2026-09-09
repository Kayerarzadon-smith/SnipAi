import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { layout, resolveSpanDelete, type Clip } from "../lib/timelineLayout.ts";

const clip = (label: string, start: number, end: number, extra: Partial<Clip> = {}): Clip =>
  ({ label, start, end, ...extra });

/* Three lines, each 2s of source, laid end to end: cut 0-2, 2-4, 4-6. */
const CLIPS = [clip("a", 10, 12), clip("b", 30, 32), clip("c", 50, 52)];
const P = layout(CLIPS).pieces;
const holesOf = (e: ReturnType<typeof resolveSpanDelete>[number]) =>
  "holes" in e ? e.holes : null;

describe("deleting a span of the timeline", () => {
  test("a span inside one line becomes a hole in that line", () => {
    const edits = resolveSpanDelete(P, CLIPS, 0.5, 1.0);
    assert.equal(edits.length, 1);
    assert.equal(edits[0].label, "a");
    // cut 0.5-1.0 of a clip starting at source 10 is source 10.5-11.0
    assert.deepEqual(holesOf(edits[0]), [[10.5, 11]]);
  });

  test("a span reaching a line's end trims that end", () => {
    // walk_pieces turns an edge-touching hole into a trim of that edge
    const edits = resolveSpanDelete(P, CLIPS, 1.5, 2);
    assert.deepEqual(holesOf(edits[0]), [[11.5, 12]]);
  });

  test("a span across a join touches both lines and nothing else", () => {
    const edits = resolveSpanDelete(P, CLIPS, 1.5, 2.5);
    assert.deepEqual(edits.map((e) => e.label), ["a", "b"]);
    assert.deepEqual(holesOf(edits[0]), [[11.5, 12]]);
    assert.deepEqual(holesOf(edits[1]), [[30, 30.5]]);
  });

  test("a line the span swallows whole is dropped, not hollowed out", () => {
    const edits = resolveSpanDelete(P, CLIPS, 1.5, 4.5);
    assert.deepEqual(edits.map((e) => e.label), ["a", "b", "c"]);
    assert.equal("drop" in edits[1] && edits[1].drop, true, "b is entirely inside the span");
    assert.ok(holesOf(edits[0]), "a is only clipped at the end");
    assert.ok(holesOf(edits[2]), "c is only clipped at the start");
  });

  test("a line left with less than a beat's minimum is dropped too", () => {
    // takes all but 0.1s of "a"
    const edits = resolveSpanDelete(P, CLIPS, 0, 1.9);
    assert.equal("drop" in edits[0] && edits[0].drop, true);
  });

  test("an empty or backwards span does nothing", () => {
    assert.deepEqual(resolveSpanDelete(P, CLIPS, 2, 2), []);
    assert.deepEqual(resolveSpanDelete(P, CLIPS, 3, 1), []);
  });

  test("a span past the end of the cut touches only what exists", () => {
    const edits = resolveSpanDelete(P, CLIPS, 5.5, 99);
    assert.deepEqual(edits.map((e) => e.label), ["c"]);
  });

  test("holes already on a line are kept, not replaced", () => {
    const withHole = [clip("a", 10, 14, { holes: [[11, 11.5]] })];
    const pieces = layout(withHole).pieces;
    const edits = resolveSpanDelete(pieces, withHole, 0.2, 0.5);
    const h = holesOf(edits[0])!;
    assert.ok(h.some((r) => r[0] === 11 && r[1] === 11.5), "the existing hole survives");
    assert.equal(h.length, 2);
  });

  /* The mapping that makes this non-obvious: a beat rendered as two runs of
     film has a gap in source time that cut time knows nothing about. */
  test("cut time maps through the pieces, not across the whole clip", () => {
    const c = [clip("a", 10, 14, { holes: [[11, 13]] })];   // keeps 10-11 and 13-14
    const pieces = layout(c).pieces;
    assert.equal(pieces.length, 2);
    // 1.5s into a 2s cut is the middle of the SECOND run: source 13.5
    const edits = resolveSpanDelete(pieces, c, 1.4, 1.6);
    const h = holesOf(edits[0])!;
    const added = h.filter((r) => !(r[0] === 11 && r[1] === 13));
    assert.deepEqual(added, [[13.4, 13.6]],
      "must land in the surviving run, not 1.5s from the clip's start");
  });
});

/* A span is applied atomically, so one line resolved wrongly throws away the
   whole cut. This is how a drag across the timeline could do nothing at all,
   with the reason buried in a toast that had already faded. */
describe("a line that is already mostly gone", () => {
  test("is dropped, not sent as holes the server will refuse", () => {
    // 4s line with 3.5s already cut out of it: 0.5s survives
    const c = [clip("a", 10, 14, { holes: [[10.2, 13.7]] })];
    const pieces = layout(c).pieces;
    // take another 0.4s of what is left
    const edits = resolveSpanDelete(pieces, c, 0, 0.4);
    assert.equal("drop" in edits[0] && edits[0].drop, true,
      "0.1s would be left, so this is a deletion");
  });

  test("existing and new holes are merged, not counted twice", () => {
    const c = [clip("a", 0, 10, { holes: [[2, 4]] })];
    const pieces = layout(c).pieces;          // 8s of cut: 0-2 and 4-10
    const edits = resolveSpanDelete(pieces, c, 1.5, 3);   // straddles the hole
    const h = "holes" in edits[0] ? edits[0].holes : null;
    assert.ok(h, "still has room, so it is holes not a drop");
    // the old hole and the new cut touch, so they come back as one range
    assert.equal(h!.length, 1);
    assert.equal(h![0][0], 1.5);
  });

  test("a line with room left is still holes", () => {
    const c = [clip("a", 0, 10, { holes: [[1, 2]] })];
    const edits = resolveSpanDelete(layout(c).pieces, c, 5, 6);
    assert.ok("holes" in edits[0]);
  });
});
