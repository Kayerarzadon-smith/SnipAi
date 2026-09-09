import { test } from "node:test";
import assert from "node:assert/strict";
import { tempLibrary, readBeats, req } from "./_fixture.mts";

/**
 * LEDGER S1 — app/api/projects/[project]/pipeline/route.ts
 *
 * The PATCH handler validates label/start/end/text and then rebuilds each beat
 * from ONLY those four fields. Undo (⌘Z) and "restore deleted line" both go
 * through here with the full beat list, so one undo strips every hole, fade
 * and detached-audio range in the project.
 *
 * This test is expected to FAIL until S1 is fixed.
 */
test("S1: PATCH /pipeline keeps holes, fades and detached audio", async () => {
  const root = tempLibrary("fixture", [
    {
      label: "hook", start: 10, end: 20, text: "the hook",
      holes: [[12, 13]], audioStart: 9.2, audioEnd: 19.4, fadeIn: 0.2, fadeOut: 0.15,
    },
  ]);

  const { PATCH } = await import("../../app/api/projects/[project]/pipeline/route.ts");

  // what the undo path actually sends: the beat list as the client holds it
  const res = await PATCH(req({ beats: [{ label: "hook", start: 10, end: 20, text: "the hook" }] }),
                          { params: { project: "fixture" } });
  assert.equal(res.status, 200, "the write itself should succeed");

  const saved = readBeats(root).beats[0];
  assert.deepEqual(saved.holes, [[12, 13]], "holes must survive an undo");
  assert.equal(saved.audioStart, 9.2, "detached audio start must survive an undo");
  assert.equal(saved.audioEnd, 19.4, "detached audio end must survive an undo");
  assert.equal(saved.fadeIn, 0.2, "fadeIn must survive an undo");
  assert.equal(saved.fadeOut, 0.15, "fadeOut must survive an undo");
});
