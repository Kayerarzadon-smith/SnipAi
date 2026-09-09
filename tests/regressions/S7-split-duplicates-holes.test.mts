import { test } from "node:test";
import assert from "node:assert/strict";
import { tempLibrary, readBeats, req } from "./_fixture.mts";

/**
 * LEDGER S7 — app/api/projects/[project]/beats/route.ts:87
 *
 * The split op builds both halves with `{ ...b }`, so holes, fades and the
 * detached-audio range are copied onto BOTH. The local Beat type only declares
 * four fields, which is why the spread looks safe.
 *
 * Concretely: a beat 10-20 with audio 9.2-19.4, split at 15, produces two beats
 * that each claim the same ten seconds of speech — build_cut lays it down twice
 * and the line is spoken twice in the render.
 *
 * This test is expected to FAIL until S7 is fixed.
 */
test("S7: splitting a beat does not duplicate its audio and holes", async () => {
  const root = tempLibrary("fixture", [
    { label: "hook", start: 10, end: 20, text: "the hook",
      holes: [[12, 13]], audioStart: 9.2, audioEnd: 19.4 },
  ]);

  const { POST } = await import("../../app/api/projects/[project]/beats/route.ts");
  const res = await POST(req({ op: "split", label: "hook", at: 15 }, "POST"),
                         { params: { project: "fixture" } });
  assert.equal(res.status, 200);

  const [left, right] = readBeats(root).beats;
  const bothClaimTheSameAudio =
    left.audioStart === right.audioStart && left.audioEnd === right.audioEnd &&
    left.audioStart !== undefined;
  assert.equal(bothClaimTheSameAudio, false,
    "both halves claim the same detached audio — the line renders twice");

  for (const [name, b] of [["left", left], ["right", right]] as const) {
    for (const h of b.holes ?? []) {
      assert.ok(h[0] >= b.start && h[1] <= b.end,
        `${name} half carries a hole ${JSON.stringify(h)} outside its own ${b.start}-${b.end} range`);
    }
  }
});
