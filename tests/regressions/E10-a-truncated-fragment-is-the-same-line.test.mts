import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  isRetakeOf, similarity, tokens, findRetakeRuns, collapseRetakes,
} from "@/lib/retakes";
import type { Beat } from "@/lib/types";

/**
 * LEDGER E10 -- E5's residual is a shape, not a leftover: a truncated
 * fragment standing beside the attempt that supersedes it.
 *
 * After E5, the closing run still said three lines one and a half times:
 *
 *     "like shit after."        then "Creatine is going to help you not feel like shit."
 *     "you use, could"          then "Could you use creatine without working out?"
 *     "creatine's been helped," then "Creatine's been said to help cognitive function?"
 *
 * THE REPORTED CAUSE WAS WRONG AND IT WAS MY OWN, which is why it is written
 * down here. I read it as the denominator: *"the shorter utterance's ratio is
 * measured against its own length, so a two-word false start scores 1.00
 * while a six-word fragment of a sixteen-word line scores low."* That is
 * internally inconsistent, and measurement says so -- `similarity` ALREADY
 * divides by the shorter length, so a fragment wholly inside a long line
 * scores 1.00, not low. The denominator was never the problem.
 *
 * WHAT ACTUALLY BLOCKED THEM was a rule of mine one branch along: a beat
 * shorter than four words had to be WHOLLY contained (`ratio >= 1`) before it
 * would join a run. Correct about false positives, wrong about how he speaks
 * -- he cuts himself off and restarts with a different word, so the fragment
 * is nearly contained rather than exactly. All three measure **2 of 3 words
 * matched**, ratio 0.67, and 0.67 is not 1.
 *
 * THE FIX, AND ITS MARGIN, MEASURED BOTH WAYS. A short fragment now joins
 * when at least two of its words match and at most one is unaccounted for.
 * On the same corpus, five known-distinct short pairs match **0 or 1 of 3**,
 * so one unaccounted word is the gap. Requiring two matches is what stops a
 * single shared article joining two unrelated lines.
 *
 * AND THE DANGEROUS DIRECTION IS THE SAME ONE E5 HAD. A looser rule collapses
 * two beats that are genuinely different lines, which silently deletes
 * something he said once and nothing flags it. So the control is run again:
 * 3000 pairs drawn from DIFFERENT videos, same speaker, same product, same
 * phrasings, not retakes of each other. **Of the 339 with a short beat in
 * them, zero would be collapsed.** That is the number that makes this safe.
 */

/* His real closing run, after E5 collapsed it -- 43 beats with the three
   fragments still standing. Read-only; skipped rather than failed when the
   evidence is not on this machine, because it is his. */
const BEATS_AT = [
  path.join(os.homedir(), "Movies", "SnipAi", "qa-exit-0912", "projects", "img-0060", "beats.json"),
  path.join(os.homedir(), "Documents", "SnipAi-evidence", "qa-exit-0912", "img-0060", "beats.json"),
];
const beatsPath = BEATS_AT.find(fs.existsSync) ?? null;
const REAL: Beat[] = beatsPath
  ? (JSON.parse(fs.readFileSync(beatsPath, "utf8")).beats as Beat[])
  : [];
const skip = !REAL.length && "the exit run's beats are not on this machine";

/** The three fragment pairs, by the labels they carry in his own beats.json. */
const FRAGMENTS: [string, string][] = [
  ["use-could", "could-use-creatine"],
  ["like-shit-after", "creatine-going-help-3"],
  ["creatines-been-helped", "creatines-been-said"],
];

/** Short pairs from the same corpus that a person reading them calls
 *  different lines. Hand-read, and the reason the rule is not looser. */
const DISTINCT_SHORT: [string, string][] = [
  ["I got also", "Also, they're writing a BOGO deal right now."],
  ["only do tell my wife to use", "this guy not"],
  ["Shit! You recover faster!", "Like for instance when..."],
  ["hydrating and plumping up your muscles,", "creatine's been helped,"],
  ["You get an", "It does not get any better than this."],
];

const beat = (text: string): Beat => ({ label: "x", start: 0, end: 2, text });
const at = (label: string) => REAL.find((b) => b.label === label);

/* ---------------------------------------------------------------- the harm */

test("E10: the three fragments really are in his cut, and really are not contained", { skip }, () => {
  /* The premise, and the correction to the reported cause in one assertion.
     If these were wholly contained the old `ratio >= 1` branch would have
     joined them and E10 would not exist; they are 2 of 3, which is why it
     did not. */
  for (const [a, b] of FRAGMENTS) {
    const x = at(a), y = at(b);
    assert.ok(x && y, `${a} / ${b} are not both in his beats.json any more`);
    const A = tokens(x!.text), B = tokens(y!.text);
    const shorter = Math.min(A.length, B.length);
    assert.ok(shorter < 4, `${a} is ${shorter} words, so it is not the short-fragment case`);
    const s = similarity(x!.text, y!.text);
    assert.ok(
      s < 1,
      `${a} is wholly contained in ${b} (${s.toFixed(2)}), so the old rule would have joined it ` +
      `and E10's diagnosis is wrong`
    );
    assert.ok(s > 0.5, `${a} / ${b} only match ${s.toFixed(2)} -- too little to call one line`);
  }
});

/* ------------------------------------------------------- what it now does */

test("E10: a truncated fragment is recognised as the line it is an attempt at", { skip }, () => {
  for (const [a, b] of FRAGMENTS) {
    assert.equal(
      isRetakeOf(at(a)!, at(b)!), true,
      `${a} still stands beside ${b}, so the cut says that line one and a half times`
    );
  }
});

test("E10: and the cut gets shorter by the fragments, not by anything else", { skip }, () => {
  const before = REAL.length;
  const { beats, collapsed } = collapseRetakes(REAL);
  assert.ok(beats.length < before, "nothing collapsed on a cut that still holds three fragments");
  /* Every run it finds is a pair or more of attempts at one line, and each
     surviving beat keeps them all as takes -- E5's invariant, re-checked
     because a change to the matcher is exactly what could break it. */
  const reachable = new Set<string>();
  for (const b of beats) {
    reachable.add(`${b.start}-${b.end}`);
    for (const t of b.retakes ?? []) reachable.add(`${t.start}-${t.end}`);
  }
  const lost = REAL.filter((b) => !reachable.has(`${b.start}-${b.end}`));
  assert.deepEqual(lost.map((b) => b.label), [], "a beat vanished rather than becoming a take");
  assert.ok(collapsed.length >= 3, `only ${collapsed.length} line(s) collapsed; three fragments were named`);
});

/* ------------------------------------------------ the dangerous direction */

test("E10: no genuinely different short line is collapsed into its neighbour", { skip }, () => {
  /* The error that is silent. Over-collapsing deletes something he said once
     and nothing on the review screen says so; under-collapsing leaves a
     repeat the screen already marks. */
  const wrong = DISTINCT_SHORT.filter(([a, b]) => isRetakeOf(beat(a), beat(b)));
  assert.deepEqual(
    wrong.map(([a, b]) => `${JSON.stringify(a)} / ${JSON.stringify(b)}`),
    [],
    "a pair of different lines would be collapsed"
  );
});

test("E10: one shared word is never enough, however short the beats", () => {
  /* What `FRAGMENT_MIN_MATCHED` is for. Without it, any three-word beat
     sharing a single article with its neighbour would join it -- which is the
     failure mode a ratio cannot see, because one of three is 0.33 and two of
     three is 0.67 and both are "some". */
  assert.equal(isRetakeOf(beat("the end"), beat("the beginning of something else")), false);
  assert.equal(isRetakeOf(beat("and then"), beat("and now for the next part of this")), false);
  /* Two matched and one unaccounted for is the line, and it is on the join
     side of it. */
  assert.equal(isRetakeOf(beat("like shit after"), beat("you will not feel like shit")), true);
});

test("E10: the control still holds -- his formulas across videos do not collapse", { skip: !fs.existsSync(path.join(os.homedir(), "Movies", "SnipAi", "qa-m08", "qa-transcripts")) && "the transcript corpus is not on this machine" }, () => {
  /* The hazard specific to his footage: he films the same product over and
     over with the same phrasings, which is what killed the topic-overlap
     heuristic in grouping. A looser fragment rule is exactly the change that
     could start matching them. Deterministic sampling so a green run means
     the same thing twice. */
  const D = path.join(os.homedir(), "Movies", "SnipAi", "qa-m08", "qa-transcripts");
  const files = fs.readdirSync(D).filter((f) => f.startsWith("IMG_") && f.endsWith(".transcript.json")).sort();
  const segs: Record<string, string[]> = {};
  for (const f of files) {
    segs[f] = (JSON.parse(fs.readFileSync(path.join(D, f), "utf8")) as { text?: string }[])
      .map((s) => (s.text ?? "").trim())
      .filter((t) => tokens(t).length >= 1);
  }
  let seed = 11;
  const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  let shortPairs = 0, shortJoins = 0, joins = 0, n = 0;
  for (let i = 0; i < files.length; i++) {
    for (let j = i + 1; j < files.length; j++) {
      for (let k = 0; k < 200; k++) {
        const a = segs[files[i]][Math.floor(rnd() * segs[files[i]].length)];
        const b = segs[files[j]][Math.floor(rnd() * segs[files[j]].length)];
        if (!a || !b) continue;
        const short = Math.min(tokens(a).length, tokens(b).length) < 4;
        const join = isRetakeOf(beat(a), beat(b));
        n++;
        if (join) joins++;
        if (short) { shortPairs++; if (join) shortJoins++; }
      }
    }
  }
  assert.ok(n > 1000, `only ${n} control pairs drawn; the corpus may have shrunk`);
  assert.ok(shortPairs > 100, `only ${shortPairs} pairs had a short beat, so E10's branch is barely exercised`);
  assert.equal(
    shortJoins, 0,
    `${shortJoins} of ${shortPairs} cross-video pairs with a short beat would be collapsed as retakes`
  );
  /* The long-beat behaviour is E5's and must not have moved. */
  assert.ok(
    joins / n < 0.01,
    `${((100 * joins) / n).toFixed(2)}% of cross-video pairs would be collapsed; E5 measured 0.30%`
  );
});

test("E10: adjacency is still required, so a call-back is not a fragment", () => {
  /* The matcher only ever compares neighbours, and E10 does not change that.
     The same words twenty beats later are the line coming round on purpose. */
  const beats: Beat[] = [
    { label: "a", start: 0, end: 2, text: "like shit after" },
    { label: "b", start: 3, end: 8, text: "Creatine is one of the most studied supplements on the planet." },
    { label: "c", start: 9, end: 12, text: "you will not feel like shit" },
  ];
  assert.deepEqual(findRetakeRuns(beats), []);
});
