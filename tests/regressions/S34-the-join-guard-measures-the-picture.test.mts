import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

import { buildKit, haveFfmpeg } from "./_elst.mts";
import { tempLibrary } from "./_fixture.mts";
import type { ClipProbe } from "@/lib/clipProbe";

/**
 * LEDGER S34 -- the edit-list guard refused a join on every clip Kayer owns.
 *
 * `joinRefusal` refused when `editListTrimSec(p) > 1 / fps` -- 0.0333s at
 * 30fps -- and told him:
 *
 *   "IMG_0060.MOV was trimmed after it was filmed — Photos does that without
 *    re-encoding — so 0.05s of it is still in the file, just hidden. […]
 *    Duplicate it in Photos and import the copy, or import IMG_0060.MOV on
 *    its own."
 *
 * Nothing was trimmed, and the remedy cannot work: a Photos duplicate carries
 * the same offset, so following the instruction spends the disk on a 4K copy
 * and arrives back at the same wall. Multi-clip import was 0% functional on
 * his footage, which is why S37-S39 are all held behind it.
 *
 * THE INSTRUMENT WAS WRONG, NOT THE THRESHOLD, and that is the whole content
 * of this file. A container's duration is the max across its tracks, so
 * `rawDurationSec - durationSec` carries AAC encoder priming and the
 * audio/video length difference along with any real edit list. Widening it to
 * clear his 0.05-0.09s would pass his clips today and silently accept a 0.2s
 * Photos trim tomorrow -- worse than the bug, because the bug at least
 * refuses loudly.
 *
 * MEASURED PER TRACK, the two cases separate completely. Every number below
 * was taken on this machine on 2026-09-11 by demuxing each track to `-f null`
 * with and without `-ignore_editlist`:
 *
 *   all six of Nadia's clips, and both files in his library
 *     video  identical both ways -- 0.0000s of picture hidden, all eight
 *     audio  0.05s hidden (IMG_0062: 215.31 -> 215.36)
 *   the same clip after `ffmpeg -ss 1.1 -c copy`
 *     video  4.83 -> 6.00 -- the trim is hidden from the PICTURE too
 *
 * So a trim shows in the picture and priming does not. That is a mechanism,
 * not a magnitude: his clips hide exactly nothing, rather than a little.
 *
 * The one allowance left is B-frame reorder delay, which is a genuine video
 * edit list on re-encoded material (0.07s on x264 defaults) and is bounded by
 * the encoder's reorder depth rather than chosen to fit. `phone*` (no
 * B-frames, shaped like his camera) and `reorder*` (B-frames) are both
 * untrimmed and both have to pass, because a guard that only passes one is
 * calibrated to an encoder instead of to the question.
 */

/* His real clips, as the probe would report them. Held as data because the
   files are 4K and 6.5GB and this assertion is about arithmetic, not I/O --
   and because the row's exit condition names these eight specifically. */
const REAL: { name: string; dur: number; raw: number; vDur: number; vRaw: number }[] = [
  { name: "IMG_0060.MOV", dur: 333.45, raw: 333.50, vDur: 333.38, vRaw: 333.38 },
  { name: "IMG_0061.MOV", dur: 581.83, raw: 581.89, vDur: 581.76, vRaw: 581.76 },
  { name: "IMG_0062.MOV", dur: 215.31, raw: 215.36, vDur: 215.24, vRaw: 215.24 },
  { name: "IMG_0063.MOV", dur: 309.45, raw: 309.50, vDur: 309.38, vRaw: 309.38 },
  { name: "IMG_0064.MOV", dur: 398.05, raw: 398.14, vDur: 397.98, vRaw: 397.98 },
  { name: "IMG_0065.MOV", dur: 437.09, raw: 437.14, vDur: 437.02, vRaw: 437.02 },
  { name: "IMG_9817.MOV", dur: 526.66, raw: 526.72, vDur: 526.59, vRaw: 526.59 },
  { name: "IMG_9823.MOV", dur: 651.03, raw: 651.09, vDur: 650.96, vRaw: 650.96 },
];

function realProbe(r: (typeof REAL)[number]): ClipProbe {
  return {
    path: `/Users/kayer.arzadon-smith/Downloads/${r.name}`,
    name: r.name,
    durationSec: r.dur,
    rawDurationSec: r.raw,
    videoDurationSec: r.vDur,
    videoRawDurationSec: r.vRaw,
    creationTimeMs: 1788980375000,
    video: { codec: "hevc", width: 3840, height: 2160, fps: 30, rotation: -90 },
    audio: { codec: "aac", sampleRate: 48000, channels: "stereo" },
    dataStreams: 4,
  };
}

test("S34: the old instrument really did refuse all eight -- this file is not vacuous", async () => {
  /* Asserted before the fix is asserted, the way S8's file pins the harm
     first. If this ever goes green the premise has moved and the rest of the
     file is measuring nothing. */
  const { editListTrimSec } = await import("@/lib/clipProbe");
  for (const r of REAL) {
    const p = realProbe(r);
    const oldThreshold = 1 / (p.video!.fps || 30);
    assert.ok(
      editListTrimSec(p) > oldThreshold,
      `${r.name} would have passed the old guard, so it is the wrong witness for S34`
    );
  }
});

test("S34: not one of his clips hides any picture", async () => {
  const { videoEditListTrimSec } = await import("@/lib/clipProbe");
  for (const r of REAL) {
    assert.equal(
      videoEditListTrimSec(realProbe(r)), 0,
      `${r.name} reports hidden picture; the per-track measurement says otherwise`
    );
  }
});

test("S34: joinRefusal passes every clip he owns", async () => {
  /* The row's exit condition, first half. Both groups Nadia would import and
     both library files. */
  const { joinRefusal } = await import("@/lib/stitch");
  const groups = [
    ["IMG_0060.MOV", "IMG_0061.MOV", "IMG_0062.MOV"],
    ["IMG_0063.MOV", "IMG_0064.MOV", "IMG_0065.MOV"],
    ["IMG_9817.MOV", "IMG_9823.MOV"],
    REAL.map((r) => r.name),
  ];
  for (const names of groups) {
    const probes = names.map((n) => realProbe(REAL.find((r) => r.name === n)!));
    assert.equal(
      joinRefusal(probes), null,
      `{${names.join(", ")}} is still refused: ${joinRefusal(probes)}`
    );
  }
});

test("S34: a real trim is still refused, and a reorder edit list is not", async () => {
  /* The other half, and the reason this is not a widened threshold. Both
     clips are measured by the real `probeClip` off real files: one untrimmed
     with B-frames (a genuine 0.07s video edit list), one trimmed by 1.1s. */
  assert.ok(haveFfmpeg(), "no ffmpeg -- S34's discrimination cannot be checked, and a skip here would be permanent");
  const { probeClip, videoEditListTrimSec, reorderAllowanceSec } = await import("@/lib/clipProbe");
  const { joinRefusal } = await import("@/lib/stitch");
  const kit = buildKit("s34");

  const [phoneA, phoneB, reorderA, reorderB, trimmed] = await Promise.all(
    [kit.phoneA, kit.phoneB, kit.reorderA, kit.reorderB, kit.trimmed].map(probeClip)
  );

  assert.equal(videoEditListTrimSec(phoneA), 0, "the no-B-frame clip should hide no picture, like his camera's");
  assert.ok(
    (videoEditListTrimSec(reorderA) ?? 0) > 0,
    "the B-frame clip has no video edit list, so it cannot show that a benign one is tolerated"
  );
  assert.ok(
    (videoEditListTrimSec(reorderA) ?? 0) <= reorderAllowanceSec(reorderA),
    `reorder delay ${videoEditListTrimSec(reorderA)}s exceeds the derived allowance ` +
    `${reorderAllowanceSec(reorderA)}s -- the allowance is wrong, not the clip`
  );

  assert.equal(joinRefusal([phoneA, phoneB]), null, "two untrimmed camera-shaped clips are refused");
  assert.equal(joinRefusal([reorderA, reorderB]), null, "two untrimmed B-frame clips are refused");

  const hid = videoEditListTrimSec(trimmed) ?? 0;
  assert.ok(hid > 1, `the trim fixture only hides ${hid}s of picture; it is meant to hide ~1.1s`);
  const why = joinRefusal([trimmed, phoneB]);
  assert.ok(why, `a clip hiding ${hid.toFixed(2)}s of picture was accepted for a join`);
});

test("S34: the refusal states what was measured and does not diagnose a cause", async () => {
  /* Same family as C35 and C36. We can measure that picture is hidden; we
     cannot measure what hid it. The old sentence asserted Photos AND gave a
     remedy that could not work, and that is the half he would have acted on. */
  assert.ok(haveFfmpeg(), "no ffmpeg");
  const { probeClip } = await import("@/lib/clipProbe");
  const { joinRefusal } = await import("@/lib/stitch");
  const kit = buildKit("s34-copy");
  const [trimmed, phoneB] = await Promise.all([probeClip(kit.trimmed), probeClip(kit.phoneB)]);
  const why = joinRefusal([trimmed, phoneB])!;

  /* The distinction this file settled, and the one judgement call in S34.
     
     The first draft removed the Photos remedy outright, and that was wrong in
     the other direction. `tests/stitch.test.mts` requires it and is right to:
     this branch now fires only on MEASURED hidden picture, so something did
     take that footage out, and duplicating in Photos genuinely bakes the trim
     in -- the duplicate is re-encoded. What was indefensible was asserting
     Photos as the cause on clips nothing had touched.
     
     So: the cause may not be stated as fact, the remedy may be offered, and
     there must be one remedy that works whatever the cause. */
  assert.ok(
    !/Photos does that/.test(why),
    `the refusal still states Photos as the cause: "${why}"`
  );
  assert.ok(
    !/was trimmed after it was filmed/.test(why),
    `the refusal still asserts a trim it cannot attribute: "${why}"`
  );
  /* The property, not the phrasing -- asserted as "the Photos remedy and a
     condition live in the same sentence". The first version of this pinned
     the exact words `if that is where`, which is the same over-specification
     that made `tests/stitch.test.mts` refuse a better sentence for reasons
     its own comments did not actually require. */
  assert.ok(
    /Duplicate it in Photos[^.]*\bif\b/.test(why),
    `the Photos remedy is prescribed rather than offered: "${why}"`
  );
  assert.ok(why.includes("trimmed.mov"), "the refusal does not name the file it is about");
  assert.ok(
    /on its own/.test(why),
    `the refusal leaves him nothing that works whatever the cause: "${why}"`
  );
});

/* ---------------------------------------------------------------------------
 * The end of S34, driven through the real `joinClips` rather than through
 * `joinRefusal` alone: passing the guard has to actually produce a join.
 *
 * These two also stand in for S35's board file, which does not exist on
 * purpose. S35's premise -- a correct join refused for 0.1s of drift -- could
 * not be reproduced (see that row), so there is no red-then-green test to
 * write for it and claiming one would be the C22 mistake. What is left worth
 * asserting is that the drift check still has both ends: it accepts a clean
 * join and it still catches a stream copy that silently lost media. That is a
 * guard on the tolerance change, not a proof of it.
 * ------------------------------------------------------------------------ */

const kit = haveFfmpeg() ? buildKit("s34-join") : null;
test("S34: a join of untrimmed clips is not refused for drift either", async () => {
  assert.ok(kit, "no ffmpeg -- S35 cannot be checked and a skip here would be permanent");
  tempLibrary("s35");
  const { joinClips } = await import("@/lib/stitch");
  const dest = path.join(kit!.dir, "out", "joined.mov");
  const out = await joinClips([kit!.phoneA, kit!.phoneB], dest);
  assert.equal(out.ok, true, `a clean two-clip join was refused: ${out.ok ? "" : out.error}`);
  assert.ok(fs.existsSync(dest), "the join reported success and wrote nothing");
});

test("S34/S35: media silently dropped by a stream copy is still refused", async () => {
  /* The row's exit condition, second half, and the reason the check stays.
     A truncated input is the real shape of "ffmpeg exits 0 and drops
     media": the moov still claims 4.00s while the mdat ends early, so the
     join comes out 1.8s against an expected 10.0s. */
  assert.ok(kit, "no ffmpeg");
  tempLibrary("s35b");
  const { joinClips } = await import("@/lib/stitch");

  const short = path.join(kit!.dir, "short.mov");
  fs.copyFileSync(kit!.phoneB, short);
  fs.truncateSync(short, Math.floor(fs.statSync(short).size * 0.45));

  const dest = path.join(kit!.dir, "out2", "joined.mov");
  const out = await joinClips([short, kit!.phoneA], dest);
  assert.equal(out.ok, false, "a join that lost most of a clip was accepted");
  assert.match(
    out.ok ? "" : out.error,
    /add up to/,
    `refused for the wrong reason: ${out.ok ? "" : out.error}`
  );
});
