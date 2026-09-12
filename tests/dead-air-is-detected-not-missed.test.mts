import test from "node:test";
import assert from "node:assert/strict";

import { exitRunProject, overlap } from "./silence-maps.mts";

/**
 * LEDGER E7 -- the cuts carry internal dead air his own videos do not, and
 * this file settles WHY before anyone tunes a number.
 *
 * His seven reference videos contain essentially no internal pause: five
 * measure exactly 0.00s, the other two have a single gap at the tail. The
 * app's cuts measure 5.6-6.2%, and the three-clip exit cut ends on 1.73s of
 * silence. In his words: *"I cut out dead space so there's zero dead air."*
 *
 * TWO HYPOTHESES, AND THEY WANT OPPOSITE FIXES.
 *
 *   NEVER DETECTED -- the threshold is hardcoded at -28dB and his room tone
 *   varies 15dB across one join, so on a hot clip a real pause can sit ABOVE
 *   -28dB and never be found. The lever would be the threshold, and that is
 *   blocked: `calibrate_silence.py` has never been called (S72) and returns
 *   one number for a whole file anyway, which is wrong for a join whose parts
 *   differ by 15dB.
 *
 *   DETECTED AND KEPT -- the map found the pause and the build kept it. The
 *   lever is the keep rule, and the threshold is innocent.
 *
 * MEASURED, on his own finished project from the M0.8 exit run. The -28dB map
 * already identifies **22.48s of silence sitting inside kept EDL pieces --
 * 18.4% of a 122.24s cut**, against a measured residual of 5.6-6.2%. Three
 * times more is detected than actually reads as dead air, because the -28dB
 * map is generous and counts quiet word tails. Against the strict -50dB map
 * it is 9.51s / 7.8%, which brackets the measurement.
 *
 * So it is **DETECTED AND KEPT**, decisively. Where it sits:
 *
 *     head of a piece   11.34s   9.3% of the cut
 *     tail of a piece     4.54s   3.7%
 *     interior            6.60s   5.4%
 *
 * AND THE CUT'S OWN ENDING IS THE CLINCHER. The final piece runs 2.08s, of
 * which **1.77s reads as silence at -28dB and 1.65s at -50dB** -- so even the
 * strict map, the one edge snapping uses, sees it. My own first guess was
 * that the strict map could not see the tail; it can. The out-point simply
 * was not pulled in. The information was there and the rule did not act on
 * it.
 *
 * WHAT THIS FILE ASSERTS, and why it is green rather than red. It pins the
 * MECHANISM, which survives the fix: the surviving silence is detected, not
 * missed. That is the finding whoever takes E7 needs, because tuning the
 * threshold would be tuning the innocent number. The AMOUNT is recorded in
 * E7's row rather than asserted here -- an assertion on 18.4% would have to
 * be rewritten by the fix it is meant to guard, which is how a test becomes
 * something you edit to make a change pass.
 *
 * NOT FIXED HERE, and not for want of an answer. Every lever is under
 * `ugc-edit-system/`: the threshold at `silence_map.py:14`, the pause trim
 * and edge snap in `build_cut.py`. That is outside this seat's scope without
 * Kayer saying so in the run, and he is asleep.
 */

const P = exitRunProject();
const skip = !P && "the exit run's evidence is not on this machine";

test("E7: the cut really does carry dead air his own videos do not", { skip }, () => {
  /* The premise, asserted first so nothing below is measuring a problem that
     went away. Silence inside kept pieces is what survives into the cut --
     between pieces there is no gap, they are concatenated. */
  const inKept = P!.edl.reduce(
    (n, p) => n + overlap(p.src_start, p.src_end, P!.loose), 0
  );
  assert.ok(
    inKept / P!.cutSeconds > 0.05,
    `only ${((100 * inKept) / P!.cutSeconds).toFixed(1)}% of the cut is silence inside kept pieces; ` +
    `E7 was filed on 5.6-6.2% measured and 18.4% detected`
  );
});

test("E7: that dead air was DETECTED by the map, not missed by it", { skip }, () => {
  /* The finding, and the one that decides which number to touch. If the
     surviving silence were invisible to the -28dB map, the threshold would be
     the lever. It is not invisible: there is more detected silence inside the
     kept pieces than the finished cut measures as dead air. */
  const inKept = P!.edl.reduce(
    (n, p) => n + overlap(p.src_start, p.src_end, P!.loose), 0
  );
  const measuredResidualShare = 0.062;   // Nadia's upper bound, 6.2%
  assert.ok(
    inKept >= P!.cutSeconds * measuredResidualShare,
    `the map sees only ${inKept.toFixed(2)}s of silence inside kept pieces but the cut measures ` +
    `${(P!.cutSeconds * measuredResidualShare).toFixed(2)}s of dead air -- some of it was never ` +
    `detected, and E7's diagnosis needs redoing before the keep rule is touched`
  );
});

test("E7: and the strict map sees the trailing silence too, so snapping had the facts", { skip }, () => {
  /* My own first hypothesis, disproved and kept here so it is not proposed
     again: that edge snapping missed the tail because it uses the -50dB map
     and the tail is not that quiet. The -50dB map sees 1.65s of the final
     2.08s piece. Both maps had it. */
  const last = P!.edl[P!.edl.length - 1];
  const loose = overlap(last.src_start, last.src_end, P!.loose);
  const strict = overlap(last.src_start, last.src_end, P!.strict);
  assert.ok(
    strict > 1.0,
    `the strict map sees only ${strict.toFixed(2)}s of the final ${last.dur.toFixed(2)}s piece, ` +
    `so "edge snapping could not see it" becomes a live explanation again`
  );
  assert.ok(
    loose >= strict,
    `the -28dB map sees ${loose.toFixed(2)}s and the -50dB map ${strict.toFixed(2)}s; the looser ` +
    `threshold should never see less silence than the stricter one`
  );
});

test("E7: the surviving silence is not one freak span", { skip }, () => {
  /* A single 20s outlier would be a different row -- one bad beat, not a rule
     that keeps pauses. It is spread: several pieces are more than half
     silence, and no single piece accounts for most of the total. */
  const per = P!.edl
    .map((p) => ({ label: p.label, sil: overlap(p.src_start, p.src_end, P!.loose), span: p.dur }))
    .sort((a, b) => b.sil - a.sil);
  const total = per.reduce((n, x) => n + x.sil, 0);
  assert.ok(
    per[0].sil < total * 0.5,
    `${per[0].label} alone holds ${per[0].sil.toFixed(2)}s of the ${total.toFixed(2)}s -- ` +
    `that is one bad beat, not a keep rule`
  );
  assert.ok(
    per.filter((x) => x.sil > 0.5).length >= 5,
    `only ${per.filter((x) => x.sil > 0.5).length} piece(s) carry over half a second of detected ` +
    `silence, so this may be local rather than systematic`
  );
});

test("E7: the map is the app's own choice, made by omission", { skip }, async () => {
  /* Where the threshold comes from, recorded because it is the number the
     diagnosis says NOT to touch -- and because the app picks it silently.
     `lib/pipeline.ts` invokes `silence_map.py` with no `--noise`, so -28dB is
     the tool's default rather than a decision anyone wrote down. That is the
     one lever inside this seat's scope, and the diagnosis says it is the
     wrong one. */
  const fs = await import("node:fs");
  const path = await import("node:path");
  const { fileURLToPath } = await import("node:url");
  const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
  const src = fs.readFileSync(path.join(root, "lib", "pipeline.ts"), "utf8");
  const call = /runTool\("silence_map\.py",\s*\[([^\]]*)\]/.exec(src);
  assert.ok(call, "lib/pipeline.ts no longer invokes silence_map.py");
  assert.ok(
    !/--noise/.test(call![1]),
    "the app now names a threshold for the loose map -- E7's diagnosis assumed it took the " +
    "tool's -28dB default, so re-read it"
  );
});
