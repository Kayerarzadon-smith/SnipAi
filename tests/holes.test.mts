import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { normaliseHoles } from "../lib/holes.ts";

const beat = { start: 10, end: 14 };
const ok = (r: ReturnType<typeof normaliseHoles>) => {
  assert.ok(r.ok, "ok" in r && !r.ok ? r.error : "expected success");
  return r as Extract<typeof r, { ok: true }>;
};

describe("holes", () => {
  test("a plain mid-line cut survives intact", () => {
    const r = ok(normaliseHoles([[11.5, 12.2]], beat));
    assert.deepEqual(r.holes, [[11.5, 12.2]]);
    assert.equal(r.kept, 3.3);
  });

  test("overlapping holes merge, so what is removed is not double-counted", () => {
    const r = ok(normaliseHoles([[11, 12], [11.5, 12.5]], beat));
    assert.deepEqual(r.holes, [[11, 12.5]]);
    assert.equal(r.kept, 2.5, "1.5s removed, not 2s");
  });

  test("touching holes become one", () => {
    const r = ok(normaliseHoles([[11, 12], [12, 12.5]], beat));
    assert.equal(r.holes.length, 1);
  });

  test("holes come back in order however they arrive", () => {
    const r = ok(normaliseHoles([[13, 13.5], [11, 11.5]], beat));
    assert.deepEqual(r.holes, [[11, 11.5], [13, 13.5]]);
  });

  test("a hole running past the line's end is clamped to it", () => {
    const r = ok(normaliseHoles([[13, 99]], beat));
    assert.deepEqual(r.holes, [[13, 14]]);
    assert.equal(r.kept, 3);
  });

  test("a hole entirely outside the line is dropped, not clamped to nothing", () => {
    const r = ok(normaliseHoles([[50, 60]], beat));
    assert.deepEqual(r.holes, []);
    assert.equal(r.kept, 4);
  });

  test("a sliver is not a cut", () => {
    assert.deepEqual(ok(normaliseHoles([[11, 11.005]], beat)).holes, []);
  });

  /* The two that would destroy a line. */
  test("a hole that swallows the whole line is refused", () => {
    const r = normaliseHoles([[10, 14]], beat);
    assert.equal(r.ok, false);
    assert.match((r as { error: string }).error, /whole line/);
  });

  test("holes that leave less than a beat's minimum are refused", () => {
    const r = normaliseHoles([[10.05, 13.95]], beat);
    assert.equal(r.ok, false);
    assert.match((r as { error: string }).error, /less than 0.15s/);
  });

  test("clearing every hole is allowed — that is how you undo them", () => {
    const r = ok(normaliseHoles([], beat));
    assert.deepEqual(r.holes, []);
    assert.equal(r.kept, 4);
  });

  /* Nothing here trusts the caller: this is reached straight off an HTTP body. */
  describe("malformed input is refused, never coerced", () => {
    for (const [name, input] of [
      ["not a list", { from: 1 }],
      ["not pairs", [[1]]],
      ["strings", [["1", "2"]]],
      ["NaN", [[NaN, 2]]],
      ["Infinity", [[1, Infinity]]],
      ["null entry", [null]],
    ] as [string, unknown][]) {
      test(name, () => assert.equal(normaliseHoles(input, beat).ok, false));
    }
  });
});
