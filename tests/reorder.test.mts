import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { reorderTo } from "../lib/timelineLayout.ts";

const L = ["a", "b", "c", "d"];

describe("dragging a clip to a new place", () => {
  test("to the front", () => {
    assert.deepEqual(reorderTo(L, "c", 0), ["c", "a", "b", "d"]);
  });

  test("to the end", () => {
    assert.deepEqual(reorderTo(L, "a", 4), ["b", "c", "d", "a"]);
  });

  test("one step right", () => {
    // dropAt counts gaps in the CURRENT order, so landing after "c" is gap 3
    assert.deepEqual(reorderTo(L, "b", 3), ["a", "c", "b", "d"]);
  });

  test("one step left", () => {
    assert.deepEqual(reorderTo(L, "c", 1), ["a", "c", "b", "d"]);
  });

  /* The no-ops. A six-pixel wobble must not rewrite the beat list, because
     every write is a real write: it saves the file and burns a snapshot. */
  describe("dropping where it already is changes nothing", () => {
    test("into its own gap", () => assert.equal(reorderTo(L, "b", 1), null));
    test("into the gap just after it", () => assert.equal(reorderTo(L, "b", 2), null));
    test("first clip, to the front", () => assert.equal(reorderTo(L, "a", 0), null));
    test("last clip, to the end", () => assert.equal(reorderTo(L, "d", 4), null));
  });

  test("every line survives the move, exactly once", () => {
    for (const label of L) {
      for (let at = 0; at <= L.length; at++) {
        const next = reorderTo(L, label, at);
        if (!next) continue;
        assert.deepEqual([...next].sort(), [...L].sort(),
          `moving ${label} to ${at} lost or duplicated a line`);
      }
    }
  });

  test("a label that is not there is refused, not guessed at", () => {
    assert.equal(reorderTo(L, "nope", 2), null);
  });

  test("an out-of-range drop is refused", () => {
    assert.equal(reorderTo(L, "a", -1), null);
    assert.equal(reorderTo(L, "a", 99), null);
  });

  test("a single clip cannot be reordered anywhere", () => {
    assert.equal(reorderTo(["only"], "only", 0), null);
    assert.equal(reorderTo(["only"], "only", 1), null);
  });
});
