import type { Beat } from "./types";

/**
 * He says a line over and over until he nails it. The drafter kept every
 * attempt as its own beat. (ledger E5)
 *
 * `draft_beats.py`'s own definition of a beat is "ONE complete recitation",
 * and on the joined three-clip project it produced **67 beats for far fewer
 * lines**: six consecutive attempts at *"right here is straight up a
 * supplement powerhouse for women"* (beats 45-50), three at *"I'm telling
 * you, ladies, start using this"*, and the pair the take picker chose between
 * on 2026-09-11 -- his 98% delivery of *"It is one of the best things you can
 * possibly do to put inside your body"* over a 90% attempt of the same line.
 *
 * His own account of the method, 2026-09-11: *"I first take the best take. If
 * I don't have a best take I do option two."* This module is option one. It
 * collapses a run of attempts into ONE beat that carries all of them, so the
 * existing picker -- which demonstrably works -- has them to choose between.
 * It does not compose one line out of fragments of several; that is option
 * two, it is filed as E8, and it is deliberately not attempted here.
 *
 * ---------------------------------------------------------------------------
 * THE INSTRUMENT, AND ITS CONTROL CONDITION.
 *
 * Similarity is the longest common SUBSEQUENCE of tokens over the shorter
 * beat's length. Two alternatives were tried on the real beats first and both
 * fail, which is why this is not an obvious choice:
 *
 *   - longest common SUBSTRING over the shorter length looks clean until it
 *     meets a stumble. The pair the picker actually chose between --
 *     "It is one of the best things THAT YOU CAN do..." against
 *     "It is one of the best things YOU CAN POSSIBLY do..." -- scores 0.44,
 *     because the middle words break the contiguous run. It misses most real
 *     retakes for exactly the reason retakes exist.
 *   - a plain sequence ratio scores that pair 0.94 but scores two genuinely
 *     different lines ("It does not get any better than this" against "The
 *     price on this right now does not get any better") at 0.43, too close to
 *     real retakes to separate.
 *
 * CALIBRATED AGAINST THE SHIPPED FUNCTION, and that correction matters: the
 * first calibration used Python's difflib, which returns a non-crossing match
 * set rather than a true LCS and therefore scores lower. It put the weakest
 * real retake at 0.61 when this code puts it at 0.75. The numbers below are
 * this file's own `similarity`, measured over
 * `qa-3clip/qa-evidence/beats.json` -- 66 adjacent pairs against a hand-read
 * ground truth of 15 unambiguous retakes and 30 unambiguous distinct lines:
 *
 *     retakes   min 0.75   (weakest: "as a retired pro," / "me being a retired pro,")
 *     distinct  max 0.43   (strongest: two different benefit lines)
 *
 * A gap of 0.32, with the threshold below inside it.
 *
 * AND THE CONTROL, because a measurement without one told us his J-cut did
 * not exist. The hazard specific to his footage is that he films the same
 * product over and over with the same formulas -- topic overlap is what
 * killed the grouping heuristic (see `grouping.ts`'s header). So the same
 * function was run over 1800 pairs of segments drawn from DIFFERENT videos in
 * `qa-m08/qa-transcripts`: same speaker, same product, same phrasings, not
 * retakes of one another.
 *
 *     cross-video   median 0.00   p90 0.20   p99 0.40   >= 0.55: 3 of 1800
 *
 * So it measures repetition and not subject matter. Without that run the
 * threshold would have been a number that happened to fit one file.
 * ---------------------------------------------------------------------------
 */

/**
 * How alike two beats have to be before they are treated as attempts at one
 * line.
 *
 * 0.55 sits inside the gap between the weakest real retake (0.75) and the
 * strongest genuinely different pair (0.43), and above the cross-video
 * control's 99th percentile (0.40). **Deliberately nearer the distinct
 * side** -- 0.12 above what a distinct pair reaches, 0.20 below what a real
 * retake falls to. Over-collapsing deletes
 * something he said once and never notices; under-collapsing leaves a repeat
 * in the cut, which the review screen already flags. Of the two errors only
 * one is silent.
 */
export const RETAKE_SIMILARITY = 0.55;

/**
 * Below this many words, a beat is a stumble rather than a line, and the
 * ratio stops meaning anything -- two tokens shared out of two is 1.00. Such
 * a fragment still collapses, but only into a neighbour it is contained in,
 * never on its own similarity score.
 */
const MIN_TOKENS_FOR_RATIO = 4;

/**
 * The shortest beat the app will accept, from `pipeline/route.ts`'s PATCH
 * validator. A collapsed run may not keep an attempt below it, or the line
 * disappears from the cut instead of being said once.
 */
const MIN_BEAT_SECONDS = 0.15;

export function tokens(text: string | undefined): string[] {
  return (text ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9' ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean);
}

/** Longest common subsequence length, by the usual table. */
function lcsLength(a: string[], b: string[]): number {
  if (!a.length || !b.length) return 0;
  let prev = new Array<number>(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i++) {
    const cur = new Array<number>(b.length + 1).fill(0);
    for (let j = 1; j <= b.length; j++) {
      cur[j] = a[i - 1] === b[j - 1] ? prev[j - 1] + 1 : Math.max(prev[j], cur[j - 1]);
    }
    prev = cur;
  }
  return prev[b.length];
}

/**
 * 0..1. How much of the shorter beat's wording the longer one also says, in
 * order. 1.0 means the shorter is entirely contained -- a false start, or a
 * clean repeat.
 */
export function similarity(a: string | undefined, b: string | undefined): number {
  const A = tokens(a);
  const B = tokens(b);
  const shorter = Math.min(A.length, B.length);
  if (!shorter) return 0;
  return lcsLength(A, B) / shorter;
}

/** Are these two adjacent beats attempts at the same line? */
export function isRetakeOf(a: Beat, b: Beat): boolean {
  const A = tokens(a.text);
  const B = tokens(b.text);
  const shorter = Math.min(A.length, B.length);
  if (!shorter) return false;
  const ratio = similarity(a.text, b.text);
  /* A very short fragment only joins a run when it is fully contained in its
     neighbour. "You get an" before "You get an extra month of this for free."
     is a false start and belongs to it; three words that merely overlap
     something longer do not. */
  if (shorter < MIN_TOKENS_FOR_RATIO) return ratio >= 1;
  return ratio >= RETAKE_SIMILARITY;
}

/**
 * Runs of adjacent beats that are attempts at one line, as index ranges.
 *
 * Adjacency is required: he re-records a line immediately, and two beats that
 * say the same thing twenty beats apart are a call-back, not a retake.
 * Chained transitively -- attempt 1 to 2 to 3 -- because the middle attempt is
 * often the bridge between a stumble and a clean delivery, and comparing only
 * the first and last of a run misses it.
 */
export function findRetakeRuns(beats: Beat[]): { from: number; to: number }[] {
  const runs: { from: number; to: number }[] = [];
  let i = 0;
  while (i < beats.length) {
    let j = i;
    while (j + 1 < beats.length && isRetakeOf(beats[j], beats[j + 1])) j++;
    if (j > i) runs.push({ from: i, to: j });
    i = j + 1;
  }
  return runs;
}

export type Collapse = {
  /** the label the surviving beat carries */
  label: string;
  /** how many attempts went into it */
  attempts: number;
  /** seconds of beat span the cut no longer spends saying it again */
  secondsSaved: number;
};

/**
 * One beat per line, carrying every attempt at it.
 *
 * WHICH ATTEMPT BECOMES THE BEAT'S RANGE is provisional and says so: the
 * LAST one, because that is what he describes doing -- *"he says each line
 * over and over until he nails it, then stops recording after a completed
 * take"*. It is not a claim that the last attempt is the best. The point of
 * `retakes` is that the picker gets all of them: `candidates/route.ts` widens
 * its search region to cover the run, `list_candidate_takes.py` ranks them by
 * its own confidence, and picking one rewrites the range through
 * `updateBeatRange`. This module deliberately does not rank takes -- the
 * picker already does, and it chose his 98% delivery over the 90% one
 * unaided.
 */
export function collapseRetakes(beats: Beat[]): { beats: Beat[]; collapsed: Collapse[] } {
  const runs = findRetakeRuns(beats);
  if (!runs.length) return { beats, collapsed: [] };

  const out: Beat[] = [];
  const collapsed: Collapse[] = [];
  let at = 0;
  for (const run of runs) {
    for (; at < run.from; at++) out.push(beats[at]);

    const attempts = beats.slice(run.from, run.to + 1);
    const spanOf = (b: Beat) => Math.max(0, b.end - b.start);

    /* The LAST USABLE attempt, not simply the last.
       
       His real beats.json contains a beat of zero length --
       `chasing-them-kids-2`, 396.17 to 396.17, which is the last attempt in
       its run and is shorter than the 0.15s minimum the app's own PATCH
       validator enforces. Keeping it would have collapsed three attempts into
       a beat that renders nothing, turning a repeated line into a missing
       one: the exact silent content loss this row has to avoid. Falling back
       to the previous usable attempt keeps 15.06s of speech that would
       otherwise have gone. (The zero-length beat itself is a drafter defect
       and is filed separately, not worked around beyond this.) */
    const usable = attempts.filter((b) => spanOf(b) >= MIN_BEAT_SECONDS);
    const kept = usable.length ? usable[usable.length - 1] : attempts[attempts.length - 1];
    out.push({
      ...kept,
      /* Every attempt, the kept one included, so the region is complete and
         the picker is not choosing from a list with a hole in it. */
      retakes: attempts.map((b) => ({
        start: b.start,
        end: b.end,
        ...(b.text === undefined ? {} : { text: b.text }),
      })),
    });
    collapsed.push({
      label: kept.label,
      attempts: attempts.length,
      secondsSaved: Number(
        (attempts.reduce((n, b) => n + spanOf(b), 0) - spanOf(kept)).toFixed(2)
      ),
    });
    at = run.to + 1;
  }
  for (; at < beats.length; at++) out.push(beats[at]);
  return { beats: out, collapsed };
}

/** The span the take picker should search for a beat: its whole run, or itself. */
export function takeRegion(beat: Beat): { start: number; end: number } {
  const takes = beat.retakes;
  if (!takes?.length) return { start: beat.start, end: beat.end };
  return {
    start: Math.min(beat.start, ...takes.map((t) => t.start)),
    end: Math.max(beat.end, ...takes.map((t) => t.end)),
  };
}
