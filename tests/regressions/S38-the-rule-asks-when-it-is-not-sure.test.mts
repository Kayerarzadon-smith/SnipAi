import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import { scratchDir } from "../scratch.mts";
import { at, clip } from "./_seams.mts";

/**
 * LEDGER S38 -- the rule said it was not sure and the tray acted anyway.
 *
 * `needsYourEye` was `adjacent.filter((s) => s.verdict === "unsure")`, so it
 * collected only the third verdict, while `confident` -- computed two hundred
 * lines up and the whole point of "propose, do not decide" -- had no reader
 * on this path. On the three-clip run the split seam scored exactly **-0.1**
 * against `SEPARATE_AT = -0.1`, the weakest call the rule can make, with
 * `confident: false` against `CONFIDENT_AT = 0.5`. **`needsYourEye` came back
 * `[]`.** Nothing was flagged, and Kayer had to notice for himself and press
 * "Actually one video" on a video that was one video.
 *
 * KAYER'S RULING, 2026-09-11, which is what let this close. The measurement
 * put to him was that `!confident` flags the -0.1 seam that wrongly split his
 * video AND the -0.15 seam that correctly separates two different products --
 * 0.05 apart, same verdict, opposite correctness, and no predicate over
 * score/verdict/confident tells them apart. Asked whether a weak-but-correct
 * split should be questioned, he said **"sure ask me"**.
 *
 * THE EXIT IS TWO-SIDED AND HIS ANSWER DOES NOT SOFTEN IT. A fix that flags
 * everything is not what he chose; he chose "ask when you are not sure". So
 * both directions are asserted **in the same run**: a question on the seam
 * the rule could barely call, silence on the seam it called cleanly. A test
 * that only asserted the first half would pass for "flag everything", which
 * is the failure mode this row is one step away from.
 *
 * The shape that delivers, and it falls out of the thresholds rather than
 * being chosen: `SAME_AT = 0.55` already clears `CONFIDENT_AT = 0.5`, so
 * every `same` verdict is confident by construction; `SEPARATE_AT = -0.1`
 * only clears 0.5 at `score <= -0.5`, so every separate call in (-0.5, -0.1]
 * is not. **Silence on joins, a question on weak splits.** Until S37 sharpens
 * the rule that means nearly every split is a question -- one on these three
 * clips, four of five seams on his six-clip batch. That is the price of being
 * asked, he has accepted it, and S37 is what brings it down.
 */

const sandbox = scratchDir("s38");
fs.mkdirSync(path.join(sandbox, "projects"), { recursive: true });
process.env.SNIPAI_DATA = sandbox;

const { proposeGroups } = await import("@/lib/grouping");

/* His three clips, in the shape that reproduces the run: clip 1 stops on a
   function word minutes before clip 2 (the seam the rule calls confidently),
   clip 2 ends on a finished sentence one minute before clip 3 (the seam it
   can barely call). Nothing carries over either seam, so continuity scores
   zero on both -- as it did on all five real seams. */
const HOOK = clip("IMG_0060.MOV", at(0), [
  "A question my wife asked me the other day was whether creatine is safe for you",
]);
const MIDDLE = clip("IMG_0061.MOV", at(6), [
  "Creatine is straight up a supplement powerhouse for women.",
]);
const CTA = clip("IMG_0062.MOV", at(7), [
  "If you want to feel good and look your damn best, go and grab some.",
]);

const run = proposeGroups([HOOK, MIDDLE, CTA]);
const asked = run.needsYourEye.map((s) => `${s.from} -> ${s.to}`);
const seam = (from: string, to: string) =>
  run.seams.find((s) => s.from === from && s.to === to)!;

test("S38: the fixture reproduces the run -- one seam called cleanly, one barely", () => {
  /* The premise first, so nothing below can be measuring a pair of seams that
     do not actually disagree in confidence. */
  const confident = seam("IMG_0060.MOV", "IMG_0061.MOV");
  const close = seam("IMG_0061.MOV", "IMG_0062.MOV");
  assert.equal(confident.confident, true, `0060->0061 scored ${confident.score}`);
  assert.equal(close.confident, false, `0061->0062 scored ${close.score}`);
  assert.equal(close.verdict, "separate", "the weak seam is not the split any more");
});

test("S38: he is asked about the seam the rule could barely call", () => {
  /* The half the row is named for. `needsYourEye` was [] on his real run. */
  assert.ok(
    asked.includes("IMG_0061.MOV -> IMG_0062.MOV"),
    `the seam the rule scored at the boundary was not raised: ${JSON.stringify(asked)}`
  );
});

test("S38: and NOT asked about the seam it called cleanly, in the same run", () => {
  /* The anti-abdication half, and the reason the first test alone is not
     enough: it passes for "flag everything", which is not what he chose. */
  assert.ok(
    !asked.includes("IMG_0060.MOV -> IMG_0061.MOV"),
    `a seam scored ${seam("IMG_0060.MOV", "IMG_0061.MOV").score} with confident:true was put in ` +
    `front of him: ${JSON.stringify(asked)}`
  );
  assert.deepEqual(asked, ["IMG_0061.MOV -> IMG_0062.MOV"], "exactly one question, on the weak seam");
});

test("S38: a run whose every seam is confident asks nothing at all", () => {
  /* The promise the row also makes, and the one an existing test in
     `grouping.test.mts` used to hold for the whole batch. Two clips where the
     first is cut off mid-word and the second re-says the line: the case the
     rule exists to answer, and it must cost no questions. */
  const a = clip("IMG_1000.MOV", at(0), [
    "I have been using this stuff for like five months now and oh my gosh, I swear my",
  ]);
  const b = clip("IMG_1001.MOV", at(3), [
    "I have been using this stuff for like five months now and oh my gosh, I swear my life on this.",
  ]);
  const clean = proposeGroups([a, b]);
  assert.equal(clean.seams.length, 1);
  assert.equal(clean.seams[0].confident, true, `scored ${clean.seams[0].score}`);
  assert.deepEqual(
    clean.needsYourEye, [],
    "a run the rule is sure about still put a question in front of him"
  );
});

test("S38: every seam he is asked about arrives with the confidence, not just a verdict", () => {
  /* The plumbing half, which shipped with C37: `trayseam` was dropping
     `score`, `confident` and `decidedBy`, and `needsYourEye` had a second
     inline field list that dropped even the verdict -- so the tray could not
     have told a 0.95 "same" from a -0.1 "separate" on screen. */
  for (const s of run.needsYourEye) {
    assert.equal(typeof s.score, "number", `${s.from} -> ${s.to} arrived with no score`);
    assert.equal(typeof s.confident, "boolean", `${s.from} -> ${s.to} arrived with no confidence`);
    assert.ok(s.decidedBy.length > 0, `${s.from} -> ${s.to} arrived with nothing that decided it`);
    assert.equal(s.confident, false, "a confident seam is being asked about");
  }
});

/* =========================================================================
 * The 27-combination table.
 *
 * Three weighted branches, three distinct weights each: continuity
 * {0.85, 0.55, 0}, ending {+0.55, -0.25, -0.15}, gap {+0.15, 0, -0.25}. Every
 * one is realised with a real fixture and driven through the real
 * `evaluateSeam` -- not computed from the weights, which would be testing the
 * arithmetic against itself.
 *
 * Each row self-checks that it hit the branch it meant to (`signals`), so a
 * fixture that stops reaching its case fails loudly instead of quietly
 * shrinking the table.
 *
 * WHY IT IS WORTH THIS MUCH. It is the instrument S37 needs: any change to
 * SAME_AT, SEPARATE_AT, CONFIDENT_AT or a branch weight moves numbers in here
 * immediately and visibly. And it is what turns two arguments into facts --
 * that `confident` cannot carry a join, and that `decidedBy` used to
 * contradict 8 of the 9 `unsure` verdicts.
 * ====================================================================== */

/** A's last line, chosen for how it ends. ~14-16 words so a 12-word run fits. */
const ENDINGS = {
  dangling: "A question my wife asked me the other day was whether creatine is safe for you",
  punctuated: "The thing nobody tells you is that creatine is a supplement powerhouse for women.",
  neither: "The thing nobody tells you is that creatine is a supplement powerhouse for women",
} as const;

const GAP_MINUTES = { near: 1, middle: 10, far: 30 } as const;   // <=3, 3..20, >=20 (and <2h)
const RUNS = { conclusive: 12, strong: 7, none: 0 } as const;    // >=10, 6..9, <4

type Ending = keyof typeof ENDINGS;
type Gap = keyof typeof GAP_MINUTES;
type Run = keyof typeof RUNS;

/** B opens by re-saying the last `n` words of A's closing line. */
function seamPair(ending: Ending, run: Run, gap: Gap) {
  const lastLine = ENDINGS[ending];
  const words = lastLine.replace(/[.!?]$/, "").split(/\s+/);
  const n = RUNS[run];
  const echo = n > 0 ? words.slice(-n).join(" ") + " " : "";
  const a = clip("A.MOV", at(0), ["Right, listen.", lastLine]);
  const b = clip("B.MOV", at(GAP_MINUTES[gap]), [
    `${echo}and honestly I have not shut up about it since.`,
  ]);
  return { a, b };
}

type Row = {
  ending: Ending; run: Run; gap: Gap;
  score: number; verdict: string; confident: boolean; decidedBy: string;
};

const TABLE: Row[] = [];
for (const ending of Object.keys(ENDINGS) as Ending[]) {
  for (const run of Object.keys(RUNS) as Run[]) {
    for (const gap of Object.keys(GAP_MINUTES) as Gap[]) {
      const { a, b } = seamPair(ending, run, gap);
      const s = (await import("@/lib/grouping")).evaluateSeam(a, b);
      TABLE.push({
        ending, run, gap,
        score: s.score, verdict: s.verdict, confident: s.confident, decidedBy: s.decidedBy,
      });
      /* The row proves it reached its own case. Without this the table can
         silently become 27 copies of one combination. */
      const sig = s.signals;
      const where = `${ending}/${run}/${gap}`;
      assert.equal(sig.endsDangling, ending === "dangling", `${where}: endsDangling`);
      assert.equal(sig.endsPunctuated, ending === "punctuated", `${where}: endsPunctuated`);
      if (run === "conclusive") assert.ok((sig.restartRun ?? 0) >= 10, `${where}: run ${sig.restartRun}`);
      if (run === "strong") assert.ok((sig.restartRun ?? 0) >= 6 && (sig.restartRun ?? 0) < 10, `${where}: run ${sig.restartRun}`);
      if (run === "none") assert.ok((sig.restartRun ?? 0) < 4, `${where}: run ${sig.restartRun}`);
      const mins = (sig.gapSec ?? 0) / 60;
      if (gap === "near") assert.ok(mins <= 3, `${where}: gap ${mins}m`);
      if (gap === "middle") assert.ok(mins > 3 && mins < 20, `${where}: gap ${mins}m`);
      if (gap === "far") assert.ok(mins >= 20 && mins < 120, `${where}: gap ${mins}m`);
    }
  }
}

test("S38: all 27 reachable combinations are in the table, each having hit its own branch", () => {
  assert.equal(TABLE.length, 27);
  assert.equal(new Set(TABLE.map((r) => `${r.ending}/${r.run}/${r.gap}`)).size, 27, "a combination repeats");
});

test("S38: confident carries nothing on a join and one split in five", () => {
  /* The arithmetic behind the row's limitation, measured rather than argued.
     Every `same` verdict is confident because SAME_AT (0.55) already clears
     CONFIDENT_AT (0.5); a `separate` only clears it at score <= -0.5, which
     one combination reaches. */
  const of = (v: string) => TABLE.filter((r) => r.verdict === v);
  const conf = (v: string) => of(v).filter((r) => r.confident).length;

  assert.equal(of("same").length, 13, "the same-verdict count moved");
  assert.equal(conf("same"), 13, "a `same` verdict came back not-confident");
  assert.equal(of("unsure").length, 9);
  assert.equal(conf("unsure"), 0, "an `unsure` verdict came back confident");
  assert.equal(of("separate").length, 5, "the separate-verdict count moved");
  assert.equal(conf("separate"), 1, "the confident-separate count moved");

  const theOne = of("separate").find((r) => r.confident)!;
  assert.deepEqual(
    { ending: theOne.ending, run: theOne.run, gap: theOne.gap, score: theOne.score },
    { ending: "punctuated", run: "none", gap: "far", score: -0.5 },
    "the single confident split is somewhere else now"
  );
});

test("S38: so a weak JOIN can never be questioned, and that is a stated limitation", () => {
  /* Kayer said "sure ask me" about weak CALLS. `!confident` can only ever
     raise a split, because no `same` verdict is ever not-confident -- so the
     join direction is unreachable until S37 re-derives the thresholds.
     
     Asserted rather than left in prose so it cannot be mistaken for
     coverage: this is the shape of what he gets, not the shape he asked for.
     When S37 makes a weak join reachable, this test fails and says so. */
  const weakJoins = TABLE.filter((r) => r.verdict === "same" && !r.confident);
  assert.deepEqual(
    weakJoins, [],
    "a weak join is now reachable -- `!confident` can question it, so S38's limitation " +
    "has lifted and the row should say so"
  );
});

test("S38: no verdict is explained by a reason that argued against it", () => {
  /* C37, regenerated by C37's own fix and fixed here. The sort is magnitude
     only, so `decidedBy = ordered[0]` named the loudest signal whichever way
     it pushed -- and for 8 of these 9 `unsure` rows the loudest signal argues
     SAME while `proposeGroups` proposes the pair as a break. A pro-join
     sentence printed under a split divider. */
  const UNSURE = "not clear enough to call — worth a look";
  for (const r of TABLE) {
    if (r.verdict === "unsure") {
      assert.equal(
        r.decidedBy, UNSURE,
        `${r.ending}/${r.run}/${r.gap} scored ${r.score} and asserts a conclusion it did not reach: ` +
        `"${r.decidedBy}"`
      );
      continue;
    }
    /* For same/separate the sentence has to be one that pushed that way. The
       branch texts are distinctive enough to attribute without re-deriving
       the weights: a pro-same sentence is the restart/pick-up/mid-sentence or
       "only N between them" family. */
    const arguesSame =
      /opens by re-saying|picks up \d+ words|mid-sentence — that is not how a finished video ends|^only /.test(r.decidedBy) ||
      /^only \d/.test(r.decidedBy);
    const arguesSeparate =
      /ends on a finished sentence|ends on a complete thought|which is a while to be interrupted for/.test(r.decidedBy);
    assert.ok(
      arguesSame || arguesSeparate,
      `${r.ending}/${r.run}/${r.gap}: cannot tell which way "${r.decidedBy}" argues`
    );
    if (r.verdict === "same") {
      assert.ok(arguesSame, `a "same" verdict is explained by "${r.decidedBy}", which argues separate`);
    } else {
      assert.ok(arguesSeparate, `a "separate" verdict is explained by "${r.decidedBy}", which argues same`);
    }
  }
});

test("S38: the boundary that decided his video lands on it exactly", () => {
  /* The seam that split his three-clip video scored exactly -0.1 against
     SEPARATE_AT = -0.1 -- on the boundary, where `<=` decides it. This pins
     that it still does, because a change that nudged it to -0.099 would turn
     that seam `unsure` and change which of these rows he is asked about.
     
     A CORRECTION, measured rather than inherited: this was reported as
     resting on `-0.25 + 0.15` being `-0.10000000000000003` in float, so that
     `Number(clamp(...).toFixed(3))` was what rescued the comparison. On this
     engine that sum is already exactly -0.1 and `raw <= -0.1` is true without
     rounding. The conclusion holds -- the boundary fires deterministically --
     but not for that reason, so the rounding is belt rather than braces here.
     It is still worth keeping: it makes the result independent of the order
     the three weights happen to accumulate in. */
  const row = TABLE.find((r) => r.ending === "punctuated" && r.run === "none" && r.gap === "near")!;
  assert.equal(row.score, -0.1, "the boundary arithmetic moved");
  assert.equal(row.verdict, "separate", "the boundary case no longer lands on separate");
  assert.equal(row.confident, false, "the boundary case is not a confident call and must not read as one");
  assert.equal(Number((0 + -0.25 + 0.15).toFixed(3)), -0.1, "the rounding no longer yields the boundary");
});
