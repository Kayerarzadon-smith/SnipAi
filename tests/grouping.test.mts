import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { scratchDir } from "./scratch.mts";

/**
 * Which dropped clips are one interrupted TikTok. (DOCKET M0.8, R5)
 *
 * The fixtures are hand-written but the language is his: every line below is
 * either lifted verbatim from `img-9817`/`img-9823`'s transcripts or built
 * from the same formula ("If your X looks like this, you need EGF"). That
 * matters because the hard case here is not "two different videos" -- it is
 * two different videos ABOUT THE SAME PRODUCT, which is what he actually
 * shoots, and which is what killed the topic-overlap heuristic (see
 * lib/grouping.ts's header for the measurement).
 *
 * SNIPAI_DATA first, dynamic import second: lib/paths.ts reads it once, at
 * import, and its fallback is his real library.
 */
const sandbox = scratchDir("grouping");
fs.mkdirSync(path.join(sandbox, "projects"), { recursive: true });
process.env.SNIPAI_DATA = sandbox;

const { proposeGroups, evaluateSeam, HOURS_APART_MS } = await import("@/lib/grouping");
type ClipProbe = import("@/lib/clipProbe").ClipProbe;
type ClipForGrouping = import("@/lib/grouping").ClipForGrouping;

/* ---- fixture helpers ---- */

const T0 = Date.UTC(2026, 7, 19, 17, 18, 4); // IMG_9817's real creation_time

function probe(name: string, startMs: number | null, durationSec: number): ClipProbe {
  return {
    path: `/tmp/${name}`,
    name,
    durationSec,
    rawDurationSec: durationSec,
    /* Per track, and equal on purpose: measured on all eight of his real
       clips, the VIDEO track is identical with and without its edit list --
       nothing is hidden from the picture. Omitting these was not cosmetic.
       `undefined` passes a `=== null` check, so `videoEditListTrimSec` used
       to return NaN here, and NaN fails every comparison -- which made
       `joinRefusal` wave through the one clip it exists to refuse. Both of
       this repo's probe fixtures feed `analyseBatch -> joinRefusal`, and
       neither was typechecked until N18. (S34, N18) */
    videoDurationSec: durationSec,
    videoRawDurationSec: durationSec,
    creationTimeMs: startMs,
    video: { codec: "hevc", width: 3840, height: 2160, fps: 30, rotation: -90 },
    audio: { codec: "aac", sampleRate: 48000, channels: "stereo" },
    dataStreams: 4,
  };
}

/** Turn lines of speech into the shape transcribe.py writes, one segment per
 *  line, laid end to end with a breath between them. */
function transcript(lines: string[], opts: { endsAtSec?: number } = {}) {
  let t = 1.2;
  const segs = lines.map((text) => {
    const words = text.trim().split(/\s+/);
    const start = t;
    const ws = words.map((w) => {
      const s = t;
      t += 0.28;
      return { w: ` ${w}`, s: Number(s.toFixed(2)), e: Number(t.toFixed(2)) };
    });
    const end = t;
    t += 0.6;
    return { start: Number(start.toFixed(2)), end: Number(end.toFixed(2)), text: ` ${text}`, words: ws };
  });
  if (opts.endsAtSec !== undefined) void opts.endsAtSec;
  return segs;
}

function spokenSec(lines: string[]): number {
  return transcript(lines).slice(-1)[0].end;
}

function clip(
  name: string,
  startMs: number | null,
  lines: string[] | null,
  opts: { tailSilenceSec?: number } = {}
): ClipForGrouping {
  const tail = opts.tailSilenceSec ?? 1.3;
  const dur = lines ? spokenSec(lines) + tail : 30;
  return { probe: probe(name, startMs, dur), transcript: lines ? transcript(lines) : null };
}

/** minutes after T0 */
const at = (min: number) => T0 + min * 60_000;

/* His real hook formula, and his real closing line -- note that the closing
   line carries NO terminal punctuation, which is true of both real videos. */
const HOOK = [
  "If between your eyes looks like this, you need EGF.",
  "If your smile lines look like this, you need EGF.",
];
const CLOSE = ["Do not sleep on this because these will sell out in the next day or two"];

/* ---- 1. the gap of hours is an early exit, and nothing else is consulted ---- */

test("a gap of hours separates two clips without reading a word of either", () => {
  /* The transcripts below are IDENTICAL, so every continuity signal there is
     screams "same video". The gap has to win anyway: 6h 8m apart is not an
     interruption, and the design says stop there. */
  const same = [...HOOK, "I have been using this stuff for like five months now and"];
  const a = clip("IMG_9817.MOV", T0, same);
  const b = clip("IMG_9823.MOV", T0 + 6 * 3600_000 + 8 * 60_000, same);

  const seam = evaluateSeam(a, b);
  assert.equal(seam.verdict, "separate");
  assert.equal(seam.confident, true);
  assert.equal(seam.signals.restartRun, null, "the transcripts must not be read once the gap decides");
  assert.match(seam.reasons.join(" "), /6h 8m/);

  const p = proposeGroups([a, b]);
  assert.equal(p.groups.length, 2);
});

test("the hours threshold is two hours, and his real pair clears it three times over", () => {
  assert.equal(HOURS_APART_MS, 2 * 60 * 60 * 1000);
  const real = 6 * 3600_000 + 8 * 60_000;
  assert.ok(real > HOURS_APART_MS * 3);
});

/* ---- 2. a restart across the seam is the strong same-video signal ---- */

test("a clip that restarts the line the last one was cut off in is the same video", () => {
  const a = clip("IMG_9901.MOV", at(0), [
    ...HOOK,
    "I have been using this stuff for like five months now and oh my gosh, I swear my",
  ], { tailSilenceSec: 0.1 });
  const b = clip("IMG_9902.MOV", at(4), [
    "I have been using this stuff for like five months now and oh my gosh, I swear my life on this.",
    "My skin texture is completely different.",
  ]);

  const seam = evaluateSeam(a, b);
  assert.equal(seam.verdict, "same");
  assert.ok(seam.signals.restartRun !== null && seam.signals.restartRun >= 10, `run was ${seam.signals.restartRun}`);
  assert.match(seam.reasons.join(" "), /re-say|picks up/i);

  const p = proposeGroups([a, b]);
  assert.equal(p.groups.length, 1);
  assert.deepEqual(p.groups[0].clips.map((c) => c.name), ["IMG_9901.MOV", "IMG_9902.MOV"]);
});

/* ---- 3. two finished videos about the same product, minutes apart ---- */

test("two finished videos filmed back to back are two projects, same product or not", () => {
  /* This is the case topic overlap gets backwards. Both clips sell EGF and
     share most of their vocabulary; they are still two TikToks. */
  const a = clip("IMG_9901.MOV", at(0), [
    "If between your eyes looks like this, you need EGF.",
    "I have been using this stuff for five months.",
    ...CLOSE,
  ]);
  const b = clip("IMG_9902.MOV", at(9), [
    "If your cheeks look like this, you need EGF.",
    "My skin texture was terrible and you can see the fine lines.",
    "Grab it before they are gone",
  ]);

  const seam = evaluateSeam(a, b);
  assert.equal(seam.verdict, "separate");

  const p = proposeGroups([a, b]);
  assert.equal(p.groups.length, 2);
  assert.deepEqual(p.groups.map((g) => g.clips.length), [1, 1]);
});

test("a finished ending is recognised without a full stop -- neither of his real videos has one", () => {
  /* Verbatim last lines of img-9817 and img-9823. Whisper punctuates only
     41-56% of segments and ended BOTH of these without a mark, so a rule that
     needs a full stop to believe a video is finished would propose joining
     his entire library into one project. */
  for (const line of [
    "Do not sleep on this because these will sell out in the next day or two",
    "day because they're probably gonna sell out of these in the next day or two",
  ]) {
    const a = clip("A.MOV", at(0), ["If your cheeks look like this, you need EGF.", line]);
    const b = clip("B.MOV", at(12), ["If your 11's look like this, you need EGF.", "And if your eyes have bags, you need EGF."]);
    assert.equal(evaluateSeam(a, b).verdict, "separate", `on: ${line}`);
  }
});

/* ---- 4. cut off mid-sentence, with no words in common ---- */

test("a clip cut off on a dangling word, minutes before the next, is the same video", () => {
  /* He was interrupted mid-thought and carried on rather than restarting, so
     there is no lexical overlap at the seam at all. The ending is what says
     this clip is not a finished TikTok. */
  const a = clip("IMG_9901.MOV", at(0), [
    "If between your eyes looks like this, you need EGF.",
    "The reason this works is because",
  ], { tailSilenceSec: 0.2 });
  const b = clip("IMG_9902.MOV", at(3), [
    "growth factors tell your skin to behave like it did ten years ago.",
    ...CLOSE,
  ]);

  const seam = evaluateSeam(a, b);
  assert.equal(seam.signals.endsDangling, true);
  assert.equal(seam.verdict, "same");
  assert.equal(proposeGroups([a, b]).groups.length, 1);
});

test("cut off mid-sentence but half an hour later is a question, not an answer", () => {
  const a = clip("IMG_9901.MOV", at(0), ["If your cheeks look like this, you need EGF.", "The reason this works is because"]);
  const b = clip("IMG_9902.MOV", at(40), ["growth factors tell your skin to behave like it did ten years ago.", ...CLOSE]);

  const seam = evaluateSeam(a, b);
  assert.equal(seam.verdict, "unsure");
  const p = proposeGroups([a, b]);
  assert.equal(p.groups.length, 2, "an unsure seam is proposed as a break, not a join");
  assert.equal(p.needsYourEye.length, 1);
  assert.equal(p.needsYourEye[0].to, "IMG_9902.MOV");
});

/* ---- 5. interleaving: part 1 of A, all of B, part 2 of A ---- */

test("part 1 of A, then all of B, then part 2 of A comes out as two projects", () => {
  const a1 = clip("IMG_9901.MOV", at(0), [
    "If between your eyes looks like this, you need EGF.",
    "I have been using this stuff for like five months now and oh my gosh, I swear my",
  ], { tailSilenceSec: 0.1 });
  const b = clip("IMG_9902.MOV", at(5), [
    "If your cheeks look like this, you need the body wash.",
    "It smells unbelievable and my arms have never been softer.",
    "Grab one before they are gone",
  ]);
  const a2 = clip("IMG_9903.MOV", at(12), [
    "I have been using this stuff for like five months now and oh my gosh, I swear my life on this.",
    ...CLOSE,
  ]);

  const p = proposeGroups([a1, b, a2]);
  assert.equal(p.groups.length, 2);
  const bySize = [...p.groups].sort((x, y) => y.clips.length - x.clips.length);
  assert.deepEqual(bySize[0].clips.map((c) => c.name), ["IMG_9901.MOV", "IMG_9903.MOV"]);
  assert.deepEqual(bySize[1].clips.map((c) => c.name), ["IMG_9902.MOV"]);
  assert.equal(bySize[0].interleaved, true, "the group skips over a clip that is not in it");
});

test("a clip is matched against every candidate, not only the one next to it", () => {
  const a1 = clip("A1.MOV", at(0), ["If your cheeks look like this, you need EGF.", "The reason this works is because"], { tailSilenceSec: 0.1 });
  const b = clip("B.MOV", at(6), ["Completely different topic about a completely different product.", "Buy the tumbler before it sells out"]);
  const a2 = clip("A2.MOV", at(14), ["The reason this works is because growth factors tell your skin what to do.", ...CLOSE]);
  const p = proposeGroups([a1, b, a2]);
  assert.deepEqual(
    p.groups.map((g) => g.clips.map((c) => c.name)),
    [["A1.MOV", "A2.MOV"], ["B.MOV"]]
  );
});

/* ---- 6. the matching is one-to-one ---- */

test("three clips of one video chain rather than all hanging off the first", () => {
  const line = "I have been using this stuff for like five months now and oh my gosh, I swear my";
  const a = clip("A.MOV", at(0), ["If your cheeks look like this, you need EGF.", line], { tailSilenceSec: 0.1 });
  const b = clip("B.MOV", at(3), [`${line} life on this.`, "And my skin texture is completely different now and"], { tailSilenceSec: 0.1 });
  const c = clip("C.MOV", at(6), ["And my skin texture is completely different now and I can see it.", ...CLOSE]);

  const p = proposeGroups([a, b, c]);
  assert.equal(p.groups.length, 1);
  assert.deepEqual(p.groups[0].clips.map((x) => x.name), ["A.MOV", "B.MOV", "C.MOV"]);
  assert.equal(p.groups[0].interleaved, false);
});

test("every clip lands in exactly one group", () => {
  const clips = [
    clip("A.MOV", at(0), ["If your cheeks look like this, you need EGF.", "The reason this works is because"], { tailSilenceSec: 0.1 }),
    clip("B.MOV", at(4), ["The reason this works is because growth factors do the work.", ...CLOSE]),
    clip("C.MOV", at(300), ["If your 11's look like this, you need EGF.", ...CLOSE]),
    clip("D.MOV", null, null),
  ];
  const p = proposeGroups(clips);
  const seen = p.groups.flatMap((g) => g.clips.map((c) => c.name)).sort();
  assert.deepEqual(seen, ["A.MOV", "B.MOV", "C.MOV", "D.MOV"]);
});

/* ---- 7. determinism: the order he dropped them in is never consulted ---- */

test("the same batch proposes the same grouping however it was dropped", () => {
  const clips = [
    clip("A1.MOV", at(0), ["If your cheeks look like this, you need EGF.", "The reason this works is because"], { tailSilenceSec: 0.1 }),
    clip("B.MOV", at(6), ["Completely different topic about a completely different product.", "Buy the tumbler before it sells out"]),
    clip("A2.MOV", at(14), ["The reason this works is because growth factors tell your skin what to do.", ...CLOSE]),
    clip("C.MOV", at(600), ["If your 11's look like this, you need EGF.", ...CLOSE]),
  ];
  const expected = JSON.stringify(proposeGroups(clips).groups.map((g) => g.clips.map((c) => c.name)));
  const orders = [
    [3, 2, 1, 0],
    [1, 0, 3, 2],
    [2, 3, 0, 1],
  ];
  for (const o of orders) {
    const shuffled = o.map((i) => clips[i]);
    const got = JSON.stringify(proposeGroups(shuffled).groups.map((g) => g.clips.map((c) => c.name)));
    assert.equal(got, expected, `drop order ${o.join(",")} changed the proposal`);
  }
});

/* ---- 8. degrading honestly ---- */

test("with no transcripts nothing is joined silently, and the tray is told why", () => {
  const a = clip("A.MOV", at(0), null);
  const b = clip("B.MOV", at(3), null);
  const seam = evaluateSeam(a, b);
  assert.equal(seam.verdict, "unsure");
  assert.match(seam.reasons.join(" "), /transcrib/i);
  const p = proposeGroups([a, b]);
  assert.equal(p.groups.length, 2);
  assert.equal(p.needsYourEye.length, 1);
});

test("with no transcripts a gap of hours still decides, because it never needed them", () => {
  const a = clip("A.MOV", T0, null);
  const b = clip("B.MOV", T0 + 7 * 3600_000, null);
  const seam = evaluateSeam(a, b);
  assert.equal(seam.verdict, "separate");
  assert.equal(seam.confident, true);
  assert.equal(proposeGroups([a, b]).groups.length, 2);
});

test("a clip with no timestamp is grouped on what it says instead of guessed at", () => {
  const a = clip("A.MOV", null, ["If your cheeks look like this, you need EGF.", "The reason this works is because"], { tailSilenceSec: 0.1 });
  const b = clip("B.MOV", null, ["The reason this works is because growth factors do the work.", ...CLOSE]);
  const p = proposeGroups([a, b]);
  assert.equal(p.basis, "filename");
  assert.equal(p.groups.length, 1);
  assert.equal(p.seams[0].signals.gapSec, null);
});

test("one clip is one group, and an empty batch is no groups", () => {
  assert.equal(proposeGroups([]).groups.length, 0);
  const only = proposeGroups([clip("A.MOV", at(0), HOOK)]);
  assert.equal(only.groups.length, 1);
  assert.equal(only.seams.length, 0);
  assert.equal(only.needsYourEye.length, 0);
});

/* ---- 9. what the tray is given to show him ---- */

test("every group carries the project name it would be imported as", () => {
  const p = proposeGroups([
    clip("IMG_9817.MOV", at(0), ["If your cheeks look like this, you need EGF.", ...CLOSE]),
    clip("IMG_9823.MOV", T0 + 7 * 3600_000, ["If your 11's look like this, you need EGF.", ...CLOSE]),
  ]);
  assert.deepEqual(p.groups.map((g) => g.projectName), ["img-9817", "img-9823"]);
});

test("a group of several says how long it will be once joined", () => {
  const a = clip("A.MOV", at(0), ["If your cheeks look like this, you need EGF.", "The reason this works is because"], { tailSilenceSec: 0.1 });
  const b = clip("B.MOV", at(3), ["The reason this works is because growth factors do the work.", ...CLOSE]);
  const p = proposeGroups([a, b]);
  assert.equal(p.groups.length, 1);
  const g = p.groups[0];
  assert.ok(g.totalDurationSec !== null && g.totalDurationSec > 0);
  assert.equal(
    Number(g.totalDurationSec!.toFixed(2)),
    Number((a.probe.durationSec! + b.probe.durationSec!).toFixed(2))
  );
});

test("every seam says why, in a sentence he could read out loud", () => {
  const a = clip("A.MOV", at(0), ["If your cheeks look like this, you need EGF.", "The reason this works is because"], { tailSilenceSec: 0.1 });
  const b = clip("B.MOV", at(3), ["The reason this works is because growth factors do the work.", ...CLOSE]);
  for (const seam of proposeGroups([a, b]).seams) {
    assert.ok(seam.reasons.length > 0, "a seam with no reason cannot be confirmed");
    for (const r of seam.reasons) {
      assert.ok(r.length > 8 && /[a-z]/.test(r), `not a sentence: ${r}`);
      assert.ok(!/\bundefined\b|\bNaN\b|\bnull\b/.test(r), `leaked a value: ${r}`);
    }
  }
});

/* ---- 10. the milestone's exit line, as a proposal ---- */

test("four clips of one interrupted TikTok plus one standalone propose 2 projects, not 5 and not 1", () => {
  /* M0.8's exit line, minus the parts only the packaged app can prove. The
     four parts are one recitation he was interrupted in three times -- twice
     he restarted the line, once he just carried on -- and the fifth is a
     different product filmed in the same sitting. */
  const p1 = clip("IMG_9901.MOV", at(0), [
    "If between your eyes looks like this, you need EGF.",
    "I have been using this stuff for like five months now and oh my gosh, I swear my",
  ], { tailSilenceSec: 0.1 });
  const p2 = clip("IMG_9902.MOV", at(3), [
    "I have been using this stuff for like five months now and oh my gosh, I swear my life on this.",
    "You can definitely tell my skin texture is terrible and there's",
  ], { tailSilenceSec: 0.1 });
  const p3 = clip("IMG_9903.MOV", at(7), [
    "fine lines everywhere, and the reason this works is because",
  ], { tailSilenceSec: 0.2 });
  const p4 = clip("IMG_9904.MOV", at(11), [
    "growth factors tell your skin to behave like it did ten years ago.",
    ...CLOSE,
  ]);
  const standalone = clip("IMG_9905.MOV", at(26), [
    "If your hair looks like this, you need the rosemary oil.",
    "Three weeks and my edges came back",
  ]);

  const p = proposeGroups([p3, standalone, p1, p4, p2]); // dropped in a mess
  assert.equal(p.groups.length, 2, p.seams.map((s) => `${s.from}->${s.to}: ${s.verdict} ${s.score}`).join("; "));
  assert.deepEqual(p.groups.map((g) => g.clips.map((c) => c.name)), [
    ["IMG_9901.MOV", "IMG_9902.MOV", "IMG_9903.MOV", "IMG_9904.MOV"],
    ["IMG_9905.MOV"],
  ]);
  assert.deepEqual(p.groups.map((g) => g.projectName), ["img-9901", "img-9905"]);
  assert.equal(p.needsYourEye.length, 0, "the common case should cost him one click, not five");
});

/* ---- 11. the seams a group was built from are the ones inside it ---- */

test("a group reports the seams it was built from, and they are the ones inside it", () => {
  const a1 = clip("A1.MOV", at(0), ["If your cheeks look like this, you need EGF.", "The reason this works is because"], { tailSilenceSec: 0.1 });
  const b = clip("B.MOV", at(6), ["Completely different topic about a completely different product.", "Buy the tumbler before it sells out"]);
  const a2 = clip("A2.MOV", at(14), ["The reason this works is because growth factors tell your skin what to do.", ...CLOSE]);
  const p = proposeGroups([a1, b, a2]);
  const big = p.groups.find((g) => g.clips.length === 2)!;
  assert.equal(big.joinedBy.length, 1);
  assert.equal(big.joinedBy[0].from, "A1.MOV");
  assert.equal(big.joinedBy[0].to, "A2.MOV");
  assert.equal(p.groups.find((g) => g.clips.length === 1)!.joinedBy.length, 0);
});
