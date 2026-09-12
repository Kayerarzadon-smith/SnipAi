import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  similarity, isRetakeOf, findRetakeRuns, collapseRetakes, takeRegion,
  RETAKE_SIMILARITY,
} from "@/lib/retakes";
import type { Beat } from "@/lib/types";

/**
 * LEDGER E5 -- eight beats for eight attempts at one line.
 *
 * `draft_beats.py` defines a beat as "ONE complete recitation" and keeps
 * every attempt as its own. On the joined three-clip project that is 67 beats
 * with six consecutive goes at *"right here is straight up a supplement
 * powerhouse for women"*, four at the cognitive-function line, three at
 * *"I'm telling you, ladies, start using this"*. His own method, in his
 * words: *"I first take the best take."* Composing one line from fragments of
 * several is option two, filed as E8, and deliberately not attempted here.
 *
 * WHAT THIS FILE ASSERTS, AND THE ORDER MATTERS.
 *
 * The trap named for this row is a test that asserts the collapse -- "eight
 * near-duplicates become one" -- which is testing the instruction. What
 * matters is what SURVIVES it. So: the harm reproduces first (the same
 * discipline as S8's file, and the one the J-cut measurement skipped), then
 * **no genuinely distinct line is ever collapsed**, which is the dangerous
 * direction because over-collapsing deletes something he said once and
 * nothing flags it. Under-collapsing leaves a repeat that the review screen
 * already marks. Only one of those two errors is silent.
 *
 * The ground truth is hand-read from his real transcript text and lives in
 * this file, so a threshold change has to argue with named lines rather than
 * with a number.
 */

const ROOT = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));

/* His real beats, read-only, from the preserved evidence. Copied into the
   test's own memory and never written back -- the directory is the record
   behind a dozen rows. Skipped rather than failed if the evidence is not on
   this machine, because it is his, not the repo's. */
const EVIDENCE = path.join(os.homedir(), "Movies", "SnipAi", "qa-3clip", "qa-evidence", "beats.json");
const FALLBACK = path.join(os.homedir(), "Documents", "SnipAi-evidence", "beats.json");
const evidencePath = fs.existsSync(EVIDENCE) ? EVIDENCE : fs.existsSync(FALLBACK) ? FALLBACK : null;
const REAL: Beat[] = evidencePath
  ? (JSON.parse(fs.readFileSync(evidencePath, "utf8")).beats as Beat[])
  : [];

/* Hand-read ground truth, by beat index in his real beats.json. Adjacent
   pairs only, and only cases a person reading the two sentences would not
   argue about.
   
   Measured with the shipped `similarity`: retakes bottom out at 0.75,
   distinct pairs top out at 0.43, so the 0.55 threshold has 0.12 of margin on
   the dangerous side and 0.20 on the other. Both directions were checked by
   moving it -- at 0.40 the distinct test fails, at 0.80 three retake tests
   fail. An earlier calibration of these numbers used Python's difflib, which
   is not a true LCS and scored the weakest retake at 0.61; the threshold
   survived the correction but the recorded margins did not, which is why they
   are asserted below rather than only written down. */
const KNOWN_RETAKE_PAIRS = [5, 6, 9, 11, 13, 15, 29, 30, 34, 36, 47, 48, 49, 64, 65];
const KNOWN_DISTINCT_PAIRS = [
  1, 7, 8, 10, 12, 14, 16, 17, 18, 19, 20, 21, 25, 27, 28, 31, 32, 37, 38, 40,
  41, 44, 50, 51, 52, 55, 56, 59, 61, 63,
];

/* ---------------------------------------------------------------- the harm */

test("E5: the harm reproduces -- he says one line six times and gets six beats", { skip: !REAL.length && "no preserved evidence on this machine" }, () => {
  /* Asserted before anything about the fix, so this file cannot quietly
     become a test of a problem that went away. */
  const runs = findRetakeRuns(REAL);
  const longest = Math.max(...runs.map((r) => r.to - r.from + 1));
  assert.ok(
    longest >= 4,
    `the longest run of attempts at one line is ${longest}; E5 was filed on runs of 4+`
  );
  const repeated = runs.reduce((n, r) => n + (r.to - r.from), 0);
  assert.ok(
    repeated >= 20,
    `only ${repeated} beats are repeat attempts, so there is little for this row to collapse`
  );
});

/* ------------------------------------------------- the dangerous direction */

test("E5: no genuinely distinct line is ever collapsed into its neighbour", { skip: !REAL.length && "no preserved evidence on this machine" }, () => {
  /* The one that matters. Each index below is a pair of adjacent beats that a
     person reading them would call different lines. If any is judged a
     retake, the collapse deletes something he said once and nothing on the
     review screen says so. */
  const wrong: string[] = [];
  for (const i of KNOWN_DISTINCT_PAIRS) {
    if (isRetakeOf(REAL[i], REAL[i + 1])) {
      wrong.push(
        `${REAL[i].label} -> ${REAL[i + 1].label} (${similarity(REAL[i].text, REAL[i + 1].text).toFixed(2)}): ` +
        `${JSON.stringify(REAL[i].text)} / ${JSON.stringify(REAL[i + 1].text)}`
      );
    }
  }
  assert.deepEqual(wrong, [], `${wrong.length} distinct line(s) would be collapsed:\n  ${wrong.join("\n  ")}`);
});

test("E5: and every line he really did repeat is recognised", { skip: !REAL.length && "no preserved evidence on this machine" }, () => {
  const missed: string[] = [];
  for (const i of KNOWN_RETAKE_PAIRS) {
    if (!isRetakeOf(REAL[i], REAL[i + 1])) {
      missed.push(`${REAL[i].label} -> ${REAL[i + 1].label} (${similarity(REAL[i].text, REAL[i + 1].text).toFixed(2)})`);
    }
  }
  assert.deepEqual(missed, [], `${missed.length} real retake(s) not recognised: ${missed.join("; ")}`);
});

test("E5: the threshold sits in a measured gap, with the margins named", { skip: !REAL.length && "no preserved evidence on this machine" }, () => {
  /* The number is not a guess and this is where that is checked. If a future
     change narrows the gap, this fails with both margins rather than letting
     the threshold drift into the overlap. */
  const score = (i: number) => similarity(REAL[i].text, REAL[i + 1].text);
  const weakestRetake = Math.min(...KNOWN_RETAKE_PAIRS.map(score));
  const strongestDistinct = Math.max(...KNOWN_DISTINCT_PAIRS.map(score));
  assert.ok(
    strongestDistinct < RETAKE_SIMILARITY && RETAKE_SIMILARITY < weakestRetake,
    `the threshold ${RETAKE_SIMILARITY} is not inside the gap: distinct top out at ` +
    `${strongestDistinct.toFixed(2)}, retakes bottom out at ${weakestRetake.toFixed(2)}`
  );
  assert.ok(
    weakestRetake - strongestDistinct >= 0.1,
    `the gap has narrowed to ${(weakestRetake - strongestDistinct).toFixed(2)} -- ` +
    `the threshold is no longer separating two populations`
  );
});

/* -------------------------------------------------------- what survives it */

test("E5: a collapsed line keeps every attempt as a take to choose from", { skip: !REAL.length && "no preserved evidence on this machine" }, () => {
  /* The row's fix is "one beat carrying many candidate takes", not "one beat".
     Losing the alternatives would make this a selector, which is the thing it
     is explicitly not. */
  const { beats, collapsed } = collapseRetakes(REAL);
  assert.ok(collapsed.length > 0, "nothing collapsed, so there is nothing to check");

  const withTakes = beats.filter((b) => b.retakes?.length);
  assert.equal(withTakes.length, collapsed.length, "a collapsed beat came out with no takes on it");
  for (const b of withTakes) {
    assert.ok(b.retakes!.length >= 2, `${b.label} carries ${b.retakes!.length} take(s)`);
    /* The kept range is one of the takes, so the list has no hole in it. */
    assert.ok(
      b.retakes!.some((t) => t.start === b.start && t.end === b.end),
      `${b.label}'s own range is not among its takes, so the picker sees an incomplete set`
    );
  }
});

test("E5: no speech is lost -- every original beat is still reachable", { skip: !REAL.length && "no preserved evidence on this machine" }, () => {
  /* The strongest form of the dangerous direction: after collapsing, every
     beat that existed before is either still a beat or recorded as a take.
     Nothing is simply gone. */
  const { beats } = collapseRetakes(REAL);
  const reachable = new Set<string>();
  for (const b of beats) {
    reachable.add(`${b.start}-${b.end}`);
    for (const t of b.retakes ?? []) reachable.add(`${t.start}-${t.end}`);
  }
  const lost = REAL.filter((b) => !reachable.has(`${b.start}-${b.end}`));
  assert.deepEqual(
    lost.map((b) => b.label), [],
    `${lost.length} beat(s) vanished rather than becoming a take`
  );
});

test("E5: the beat a run keeps is one the cut can actually render", { skip: !REAL.length && "no preserved evidence on this machine" }, () => {
  /* His real beats.json contains `chasing-them-kids-2` at 396.17-396.17 --
     zero length, and the LAST attempt in its run. Keeping it would have
     collapsed three attempts into a beat that renders nothing: a repeated
     line becoming a missing one, which is precisely the silent loss this row
     must not cause. */
  const { beats } = collapseRetakes(REAL);
  const unrenderable = beats.filter((b) => b.end - b.start < 0.15);
  assert.deepEqual(
    unrenderable.map((b) => `${b.label} (${(b.end - b.start).toFixed(2)}s)`),
    [],
    "a collapsed run kept an attempt the builder cannot render"
  );
});

test("E5: the picker is given the whole run to choose from", { skip: !REAL.length && "no preserved evidence on this machine" }, () => {
  /* `candidates/route.ts` searches `takeRegion(beat)` now. On the six goes at
     the powerhouse line those attempts are ~70s apart, so the old fixed 8s
     window would have offered the picker one candidate and called it a
     choice. */
  const { beats } = collapseRetakes(REAL);
  for (const b of beats.filter((x) => x.retakes?.length)) {
    const r = takeRegion(b);
    for (const t of b.retakes!) {
      assert.ok(
        t.start >= r.start && t.end <= r.end,
        `${b.label}: take ${t.start}-${t.end} is outside the region ${r.start}-${r.end} the picker searches`
      );
    }
  }
});

test("E5: it is worth doing -- the repetition removed is a real share of the cut", { skip: !REAL.length && "no preserved evidence on this machine" }, () => {
  const span = (bs: { start: number; end: number }[]) =>
    bs.reduce((n, b) => n + Math.max(0, b.end - b.start), 0);
  const before = span(REAL);
  const { beats, collapsed } = collapseRetakes(REAL);
  const after = span(beats);
  const saved = collapsed.reduce((n, c) => n + c.secondsSaved, 0);

  assert.ok(after < before, "collapsing did not shorten the beat list at all");
  assert.ok(
    Math.abs(before - after - saved) < 0.05,
    `the saving reported (${saved.toFixed(2)}s) does not match the span removed (${(before - after).toFixed(2)}s)`
  );
  /* Measured 2026-09-12: 259.40s of beats becomes 170.64s, 88.76s off. Stated
     as a floor rather than an equality so a better threshold can improve it
     without failing here. */
  assert.ok(
    saved > 60,
    `only ${saved.toFixed(1)}s of repetition removed; E5 was filed on ~26s of a 100s cut and this is a longer one`
  );
});

test("E5: cuts per minute stays inside his hand-cut range -- a guard, not a target", { skip: !REAL.length && "no preserved evidence on this machine" }, () => {
  /* The app already matches his rhythm: 22.6-28.1 cuts per minute against his
     17.0-28.9 across his own videos. So this number is a REGRESSION GUARD,
     not something to improve -- its whole remaining value is stopping an E5
     fix from breaking a rhythm that is already right. If collapsing pushed it
     outside his range that would be a finding, not a win.
     
     `build_cut` trims pauses and snaps edges, so the cut is shorter than the
     beats it is built from. The ratio is taken from the real `edl.json`
     (183.27s rendered from 259.40s of beats, 0.707) rather than assumed, and
     applied to the collapsed span to estimate the new cut. An estimate is
     honest here: re-rendering needs ffmpeg and his footage. */
  const edlPath = path.join(path.dirname(evidencePath!), "edl.json");
  if (!fs.existsSync(edlPath)) return;
  const edl = JSON.parse(fs.readFileSync(edlPath, "utf8")) as { dur: number }[];
  const renderedSec = edl.reduce((n, p) => n + p.dur, 0);

  const span = (bs: { start: number; end: number }[]) =>
    bs.reduce((n, b) => n + Math.max(0, b.end - b.start), 0);
  const ratio = renderedSec / span(REAL);
  const { beats } = collapseRetakes(REAL);
  const afterSec = span(beats) * ratio;

  const before = REAL.length / (renderedSec / 60);
  const after = beats.length / (afterSec / 60);

  /* His measured range across his own hand-cut videos. */
  const HIS_LOW = 17.0;
  const HIS_HIGH = 28.9;
  assert.ok(
    before >= HIS_LOW && before <= HIS_HIGH,
    `the app was already outside his rhythm at ${before.toFixed(1)} cuts/min, so this guard ` +
    `is measuring the wrong thing`
  );
  assert.ok(
    after >= HIS_LOW && after <= HIS_HIGH,
    `collapsing moved the rhythm to ${after.toFixed(1)} cuts/min, outside his ${HIS_LOW}-${HIS_HIGH}. ` +
    `That is a finding, not an improvement`
  );

  /* And it does move toward the length he actually posts -- about a minute --
     without this row having to get there on its own. */
  assert.ok(
    afterSec < renderedSec * 0.8,
    `the cut only came down from ${renderedSec.toFixed(0)}s to ${afterSec.toFixed(0)}s`
  );
});

/* ------------------------------------------------------------ the mechanics */

test("E5: a line said once is left completely alone", () => {
  const beats: Beat[] = [
    { label: "hook", start: 0, end: 3, text: "If between your eyes looks like this, you need EGF." },
    { label: "benefit", start: 4, end: 8, text: "Growth factors tell your skin to behave like it did ten years ago." },
    { label: "cta", start: 9, end: 12, text: "So I'll get you that sale link." },
  ];
  const { beats: out, collapsed } = collapseRetakes(beats);
  assert.deepEqual(collapsed, []);
  assert.deepEqual(out, beats, "an unrepeated line was rewritten");
  assert.ok(out.every((b) => b.retakes === undefined), "a `retakes` field appeared on a line said once");
});

test("E5: a short false start joins the line it starts, but a bare overlap does not", () => {
  /* "You get an" before "You get an extra month of this for free." is a false
     start and belongs to it. Three words that merely appear inside something
     longer are not the same claim, which is why a fragment has to be wholly
     contained rather than merely similar. */
  const falseStart: Beat = { label: "get", start: 0, end: 1, text: "You get an" };
  const whole: Beat = { label: "get-extra", start: 2, end: 6, text: "You get an extra month of this for free." };
  assert.equal(isRetakeOf(falseStart, whole), true);

  const overlap: Beat = { label: "frag", start: 0, end: 1, text: "of this for" };
  const different: Beat = { label: "other", start: 2, end: 6, text: "Creatine is going to help you not feel like shit." };
  assert.equal(isRetakeOf(overlap, different), false, "a fragment collapsed into a line it is not an attempt at");
});

test("E5: a run chains through the stumble in the middle of it", () => {
  /* Attempt 1 to 2 to 3, where 1 and 3 are the clean versions and 2 is the
     stumble. Comparing only the ends of a run would miss it. */
  const beats: Beat[] = [
    { label: "a", start: 0, end: 2, text: "right here is straight up a woman's powerhouse" },
    { label: "b", start: 3, end: 5, text: "right here is straight up a" },
    { label: "c", start: 6, end: 9, text: "This right here is straight up a supplement powerhouse for women." },
  ];
  const runs = findRetakeRuns(beats);
  assert.deepEqual(runs, [{ from: 0, to: 2 }]);
  const { beats: out } = collapseRetakes(beats);
  assert.equal(out.length, 1);
  assert.equal(out[0].label, "c", "the run did not keep the last usable attempt");
  assert.equal(out[0].retakes?.length, 3);
});

test("E5: two beats that say the same thing far apart are a call-back, not a retake", () => {
  /* Adjacency is required. He re-records immediately; the same words twenty
     beats later are the line coming round again on purpose. */
  const same = "I'm telling you, ladies, start using this.";
  const beats: Beat[] = [
    { label: "first", start: 0, end: 3, text: same },
    { label: "middle", start: 4, end: 8, text: "Creatine is one of the most studied supplements on the planet." },
    { label: "last", start: 9, end: 12, text: same },
  ];
  assert.deepEqual(findRetakeRuns(beats), []);
  assert.equal(collapseRetakes(beats).beats.length, 3);
});

test("E5: both callers of the drafter collapse, so an import and a re-draft agree", () => {
  /* Staleness guard. `draft_beats.py` has two callers -- the standalone job
     and the auto pipeline's phase -- and a collapse on one of them only would
     mean the beats depended on which button was pressed. */
  const src = fs.readFileSync(path.join(ROOT, "lib", "pipeline.ts"), "utf8");
  const direct = [...src.matchAll(/runTool\("draft_beats\.py"/g)].length;
  assert.equal(direct, 1, `draft_beats.py is invoked from ${direct} places; it should go through one helper`);
  assert.match(src, /draftBeatsAndCollapse/, "the collapse helper is gone from the pipeline");
  assert.equal(
    [...src.matchAll(/draftBeatsAndCollapse\(/g)].length, 3,
    "expected one definition and two callers of draftBeatsAndCollapse"
  );
});
