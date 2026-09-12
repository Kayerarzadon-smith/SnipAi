import { orderProbes, type OrderBasis } from "./stitch";
import { projectNameFor } from "./videoFiles";
import type { ClipProbe } from "./clipProbe";

/**
 * Which of the dropped clips are one interrupted TikTok. (DOCKET M0.8, R5)
 *
 * `lib/stitch.ts` can join clips; this decides WHICH clips. It proposes, it
 * does not decide -- every answer here is shown in the import tray for Kayer
 * to confirm or regroup before a single stage runs, because being wrong is
 * expensive in both directions: stitching two separate videos produces a
 * garbage cut, and splitting one interrupted video into halves means
 * re-shooting.
 *
 * ## The rule, cheapest test first
 *
 * 1. **A gap of hours separates, and stops there.** `creation_time + duration`
 *    is when recording stopped; the gap to the next clip's `creation_time` is
 *    how long he was away. Measured on his own files: IMG_9817 stopped
 *    10:26:51 and IMG_9823 started 16:35:16 -- 6h 8m, unambiguous. When this
 *    fires, no transcript is read at all.
 * 2. **Otherwise, ask the transcripts two questions:** did clip N end on a
 *    complete sentence, and does clip N+1 open by re-saying or carrying on
 *    clip N's last line? Mid-sentence end plus continuation is one video.
 * 3. **The gap is a tiebreaker, never the decision.** He batch-films -- several
 *    different TikToks back to back in one sitting -- so a three-minute gap
 *    means either "the kid came in" or "on to the next product" and time
 *    cannot tell them apart.
 *
 * ## What was measured, and what it killed
 *
 * Calibrated against his two real transcripts (`img-9817`, 64 segments;
 * `img-9823`, 88) on 2026-09-11. Read-only; no fixture was written from them.
 *
 * - **Topic overlap is inverted and must never be used.** Content-word
 *   containment between the two genuinely separate videos is **0.66**, while
 *   between the two halves of a single video it is **0.20-0.26**. He sells the
 *   same product in both, so shared vocabulary means "same shelf", not "same
 *   video"; the two halves of one video score LOW because a hook and a CTA
 *   share nothing. A same-product heuristic would have joined his whole
 *   library. The design's phrase "a different script or product" is right
 *   about what distinguishes them and wrong about vocabulary being able to see
 *   it.
 * - **A full stop cannot be required.** Whisper terminates only 56% / 41% of
 *   his segments with `.`/`!`/`?`, and **neither** of his two real videos ends
 *   its final, plainly finished CTA with one ("...in the next day or two").
 *   Requiring punctuation to believe a video is finished scores 0 for 2 on the
 *   only real examples there are.
 * - **A dangling function word is the usable ending signal.** "...is because",
 *   "...I swear my" -- 25-27% of his segments end that way and *neither* real
 *   ending does. It is the best available proxy for "he was cut off".
 * - **Tail silence is recorded and NOT scored.** His two finished videos end
 *   with 1.26s and 2.25s of silence, but he has to reach over and stop the
 *   recording after an interruption too, so both cases have it. There is no
 *   interrupted sample to calibrate against, so it is reported for his eye and
 *   given no weight.
 * - **Seam continuity works, with a measured noise floor.** Longest run of
 *   identical words across a 20-word window either side of the seam: between
 *   the two separate videos, over 5,632 boundary pairs, 1.8% reach 6 and 0.2%
 *   reach 10; within a single video 61% reach 6 and 33% reach 10. Hence the
 *   thresholds below.
 */

export type ClipTranscriptWord = { w: string; s: number; e: number };
export type ClipTranscriptSegment = {
  start: number;
  end: number;
  text: string;
  words?: ClipTranscriptWord[];
};
/** exactly what tools/transcribe.py writes: a list of segments */
export type ClipTranscript = ClipTranscriptSegment[];

export type ClipForGrouping = {
  probe: ClipProbe;
  /** null when it has not been transcribed, which is not the same as silent */
  transcript: ClipTranscript | null;
};

export type SeamVerdict = "same" | "separate" | "unsure";

export type SeamSignals = {
  /** seconds between one clip stopping and the next starting; null when
   *  either clip carries no usable capture stamp */
  gapSec: number | null;
  /** longest run of identical words across the seam, or null when the gap
   *  already decided and the transcripts were never opened */
  restartRun: number | null;
  /** the earlier clip's last word is a function word -- "...is because" */
  endsDangling: boolean | null;
  endsPunctuated: boolean | null;
  /** silence after the last word of the earlier clip. Reported, not scored --
   *  see the header. */
  tailSilenceSec: number | null;
};

export type Seam = {
  from: string;
  to: string;
  verdict: SeamVerdict;
  /** -1 (certainly two videos) .. +1 (certainly one). Shown as words. */
  score: number;
  /** whether the verdict is strong enough to act on without asking */
  confident: boolean;
  /** plain English, for the tray. Every seam has at least one. */
  reasons: string[];
  /**
   * The strongest reason that pushed TOWARD this verdict -- or, for `unsure`,
   * a statement that the rule did not reach one.
   *
   * "Whichever way it pushed" is what this used to say and used to do, and it
   * was wrong for eight of the nine `unsure` combinations: the loudest signal
   * there argues SAME while the group is proposed as a break, so the split
   * line explained itself with a pro-join sentence.
   *
   * Named rather than left as `reasons[0]` because the tray used to render
   * `reasons[0]` and `reasons[0]` was always the continuity sentence: the
   * SAME words above a `same` verdict and above a `separate` one, with the
   * deciding reason sitting at `reasons[1]` both times (ledger C37). A line
   * that is constant across the outcomes it explains carries no information
   * about the decision. `reasons` is now ordered strongest-first as well, but
   * the tray reads this field, so a later re-sort cannot quietly undo it.
   */
  decidedBy: string;
  signals: SeamSignals;
};

export type ProposedGroup = {
  clips: ClipProbe[];
  /** what the import would call it -- the first clip's name, kebab-cased */
  projectName: string;
  /** sum of the parts, which is what the joined file will measure; null if
   *  any part's duration could not be read */
  totalDurationSec: number | null;
  /** the seams that put this group together, in order. Empty for a lone clip */
  joinedBy: Seam[];
  /** true when this group skips over a clip belonging to another one -- part
   *  one of A, then all of B, then part two of A */
  interleaved: boolean;
};

export type GroupingProposal = {
  groups: ProposedGroup[];
  /** how the batch was put in order, from lib/stitch */
  basis: OrderBasis;
  /** every seam between clips that ended up next to each other in time */
  seams: Seam[];
  /** the seams the rule would not call. Proposed as a break, and flagged --
   *  this is the list the tray puts in front of him */
  needsYourEye: Seam[];
};

/* ---- thresholds, every one of them measured. See the header. ---- */

/** Longer than this between one clip stopping and the next starting and he was
 *  away, not interrupted. His real separate pair is 6h 8m; two hours is the
 *  most generous reading of "the kid came in" and still three times short of
 *  the real thing. */
export const HOURS_APART_MS = 2 * 60 * 60 * 1000;

/** Words either side of the seam that are compared. The noise floor below was
 *  measured with exactly this window. */
const SEAM_WINDOW = 20;

/** 0.2% of pairs from two different videos reach this; 33% of seams inside one
 *  video do. */
const RUN_CONCLUSIVE = 10;
/** 1.0% against 61%. */
const RUN_STRONG = 6;
/**
 * Worth saying out loud and worth nothing as evidence, which is why it scores
 * zero rather than a little.
 *
 * A run of four is BELOW the median run inside a single video (5), so it does
 * not distinguish the two cases at all -- and every one of his videos ends its
 * hook on the same four words, "...like this, you need EGF", so four carries
 * over between clips that have nothing to do with each other. Giving it even
 * +0.15 was enough to cancel a finished ending and turn a plain "two separate
 * videos" into "unsure"; the test named for his real closing lines caught it.
 */
const RUN_WEAK = 4;

const GAP_MINUTES_MS = 3 * 60_000;
const GAP_A_WHILE_MS = 20 * 60_000;

const SAME_AT = 0.55;
const SEPARATE_AT = -0.1;
const CONFIDENT_AT = 0.5;

/** What an `unsure` seam says instead of asserting a conclusion. */
const UNSURE_REASON = "not clear enough to call — worth a look";

/**
 * Words a sentence cannot end on.
 *
 * Deliberately conjunctions, articles, prepositions, auxiliaries and pronouns
 * only -- things that promise another word. "...for five months" ends a
 * thought; "...is because" does not.
 *
 * The contractions on the last two lines are the ones that CANNOT close a
 * sentence: a pronoun glued to `be`/`have` still needs its complement, and
 * "gonna" still needs its verb. `don't`, `can't` and `won't` are deliberately
 * left out, because "...but I don't." is a real ending. They were added after
 * this missed a line lifted verbatim from img-9817 -- "and there's" -- and
 * they cost almost nothing: they take the share of his segments ending on a
 * dangling word from 25% to 26-27%, and neither of his two real finished
 * endings ("...in the next day or two") is caught by either set.
 */
const DANGLING = new Set(
  `a an and as at because before but by for from if in into like my of on onto or our so than that
   the their there these this those to until upon we what when where which while who why will with
   without you your his her its it he she they i am are be been being can could did do does had has
   have is may might must shall should was were would just really very
   there's it's that's what's here's he's she's who's i'm you're we're they're
   i've you've we've they've i'll you'll he'll she'll we'll they'll it'll
   i'd you'd he'd she'd we'd they'd gonna wanna gotta kinda sorta`.split(/\s+/)
);

/* ---- reading a transcript ---- */

function tokens(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9' ]+/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

function allTokens(t: ClipTranscript): string[] {
  const out: string[] = [];
  for (const s of t) out.push(...tokens(s.text ?? ""));
  return out;
}

/** Longest run of identical words shared by two windows. Both are capped at
 *  SEAM_WINDOW, so this is at most 400 comparisons. */
export function longestCommonRun(a: string[], b: string[]): number {
  let best = 0;
  for (let i = 0; i < a.length; i++) {
    for (let j = 0; j < b.length; j++) {
      let k = 0;
      while (i + k < a.length && j + k < b.length && a[i + k] === b[j + k]) k++;
      if (k > best) best = k;
    }
  }
  return best;
}

function lastSegmentWithText(t: ClipTranscript): ClipTranscriptSegment | null {
  for (let i = t.length - 1; i >= 0; i--) {
    if ((t[i].text ?? "").trim()) return t[i];
  }
  return null;
}

function lastSpokenSec(t: ClipTranscript): number | null {
  for (let i = t.length - 1; i >= 0; i--) {
    const w = t[i].words;
    if (w && w.length) return w[w.length - 1].e;
    if (Number.isFinite(t[i].end)) return t[i].end;
  }
  return null;
}

/** When recording stopped, in epoch ms. null if either fact is missing. */
export function recordingStoppedMs(p: ClipProbe): number | null {
  if (p.creationTimeMs === null || p.durationSec === null) return null;
  return p.creationTimeMs + p.durationSec * 1000;
}

/**
 * Seconds he was away between two clips, or null when it cannot be known.
 *
 * A negative gap means the two clips overlap in time, which a single camera
 * cannot do -- the usual cause is a muxer that stamps `creation_time` when the
 * file was CLOSED rather than opened. Rather than reading that as "no gap at
 * all" and joining on it, the gap is reported as unknown and the transcripts
 * decide. Anything up to one frame of overlap is rounding, not that.
 */
export function gapSecBetween(a: ClipProbe, b: ClipProbe): number | null {
  const stopped = recordingStoppedMs(a);
  if (stopped === null || b.creationTimeMs === null) return null;
  const sec = (b.creationTimeMs - stopped) / 1000;
  if (sec < -(1 / (a.video?.fps || 30))) return null;
  return Math.max(0, sec);
}

export function humanGap(sec: number): string {
  const s = Math.round(sec);
  if (s < 60) return `${s}s`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const rem = m % 60;
  return rem ? `${h}h ${rem}m` : `${h}h`;
}

/* ---- the seam ---- */

/**
 * Should these two clips be in the same project?
 *
 * `a` is the earlier clip. The two need not be adjacent: interleaving means a
 * clip has to be matched against every candidate in the batch, not only the
 * one next to it, so this is called for every ordered pair.
 */
export function evaluateSeam(a: ClipForGrouping, b: ClipForGrouping): Seam {
  const gapSec = gapSecBetween(a.probe, b.probe);
  const base = {
    from: a.probe.name,
    to: b.probe.name,
  };

  /* 1. Hours apart, and nothing else is consulted. This is the early exit the
        design asked for: it costs two numbers already on hand, and when it
        fires the transcripts are not opened. */
  if (gapSec !== null && gapSec * 1000 >= HOURS_APART_MS) {
    return {
      ...base,
      verdict: "separate",
      score: -1,
      confident: true,
      reasons: [
        `${humanGap(gapSec)} between ${a.probe.name} ending and ${b.probe.name} starting — he was away, not interrupted`,
      ],
      decidedBy: `${humanGap(gapSec)} between ${a.probe.name} ending and ${b.probe.name} starting — he was away, not interrupted`,
      signals: {
        gapSec,
        restartRun: null,
        endsDangling: null,
        endsPunctuated: null,
        tailSilenceSec: null,
      },
    };
  }

  const reasons: string[] = [];

  /* 2. The transcripts. Without them there is nothing to ask, and guessing
        from the gap alone is the heuristic the design explicitly dropped. */
  if (!a.transcript || !b.transcript) {
    const which = !a.transcript && !b.transcript
      ? `Neither ${a.probe.name} nor ${b.probe.name} has been transcribed`
      : `${(!a.transcript ? a : b).probe.name} has not been transcribed`;
    reasons.push(`${which} yet, so there is nothing to compare across the seam`);
    if (gapSec !== null) reasons.push(`${humanGap(gapSec)} between them, which could be either`);
    return {
      ...base,
      verdict: "unsure",
      score: 0,
      confident: false,
      reasons,
      // nothing was weighed, so the first thing said is the whole of it
      decidedBy: reasons[0],
      signals: { gapSec, restartRun: null, endsDangling: null, endsPunctuated: null, tailSilenceSec: null },
    };
  }

  const aTokens = allTokens(a.transcript);
  const bTokens = allTokens(b.transcript);
  const tail = aTokens.slice(-SEAM_WINDOW);
  const head = bTokens.slice(0, SEAM_WINDOW);
  const restartRun = longestCommonRun(tail, head);

  const lastSeg = lastSegmentWithText(a.transcript);
  const lastText = (lastSeg?.text ?? "").trim();
  const lastWord = tail.length ? tail[tail.length - 1] : "";
  const endsDangling = lastWord !== "" && DANGLING.has(lastWord);
  const endsPunctuated = /[.!?]["')\]]?$/.test(lastText);
  const spokenTo = lastSpokenSec(a.transcript);
  const tailSilenceSec =
    spokenTo !== null && a.probe.durationSec !== null
      ? Number(Math.max(0, a.probe.durationSec - spokenTo).toFixed(2))
      : null;

  let score = 0;

  /* Each reason is recorded with the weight it contributed, so the one that
     DECIDED the verdict can be named instead of guessed at by position. The
     weights themselves are untouched -- this only remembers them. (C37) */
  const weighed: { text: string; weight: number }[] = [];
  const say = (weight: number, text: string) => { weighed.push({ text, weight }); };

  /* does clip N+1 open by re-saying or carrying on clip N's last line? */
  if (restartRun >= RUN_CONCLUSIVE) {
    score += 0.85;
    say(0.85,
      `${b.probe.name} opens by re-saying ${restartRun} words ${a.probe.name} had just said — that is him restarting the line he was cut off in`
    );
  } else if (restartRun >= RUN_STRONG) {
    score += 0.55;
    say(0.55, `${b.probe.name} picks up ${restartRun} words that ${a.probe.name} ended on`);
  } else if (restartRun >= RUN_WEAK) {
    say(0,
      `${restartRun} words carry over the seam, which counts for nothing — his hook ends on the same four words every time`
    );
  } else {
    say(0, `${b.probe.name} does not pick up where ${a.probe.name} left off`);
  }

  /* Did clip N end on a complete sentence? This is the design's discriminator,
     and it carries enough weight on its own to reach `same` -- a clip that
     stops on a function word is not a finished TikTok, so it should not become
     a project of its own while there is a later clip it could belong to.

     It has to carry that much because the gap cannot help: he batch-films, so
     four minutes means either "the kid came in" or "on to the next product",
     and the design says so in as many words. Weighting this at 0.4 left the
     common case -- cut off mid-thought, carries on four minutes later without
     re-saying the line -- sitting at `unsure`, which would put a question in
     front of him on the seam the rule exists to answer. The gap still pulls it
     back to `unsure` when he was away twenty minutes or more. */
  if (endsDangling) {
    score += 0.55;
    say(0.55, `${a.probe.name} stops on "${lastWord}", mid-sentence — that is not how a finished video ends`);
  } else if (endsPunctuated) {
    score -= 0.25;
    say(-0.25, `${a.probe.name} ends on a finished sentence: "${shorten(lastText)}"`);
  } else {
    score -= 0.15;
    say(-0.15, `${a.probe.name} ends on a complete thought: "${shorten(lastText)}"`);
  }

  /* the gap, as a tiebreaker only -- he batch-films, so minutes mean nothing
     on their own */
  if (gapSec === null) {
    say(0, `no usable capture time on one of them, so how long he was away is unknown`);
  } else if (gapSec * 1000 <= GAP_MINUTES_MS) {
    score += 0.15;
    say(0.15, `only ${humanGap(gapSec)} between them`);
  } else if (gapSec * 1000 >= GAP_A_WHILE_MS) {
    score -= 0.25;
    say(-0.25, `${humanGap(gapSec)} between them, which is a while to be interrupted for`);
  } else {
    say(0, `${humanGap(gapSec)} between them, which could be either`);
  }

  score = Number(Math.max(-1, Math.min(1, score)).toFixed(3));
  const verdict: SeamVerdict = score >= SAME_AT ? "same" : score <= SEPARATE_AT ? "separate" : "unsure";

  /* Strongest first, so `reasons.join(". ")` reads as an argument rather than
     as whatever order the checks happen to run in. A stable sort keeps the
     original order among equal weights -- the zero-weight ones, which are
     said because they were checked and not because they decided anything. */
  const ordered = weighed
    .map((r, i) => ({ ...r, i }))
    .sort((x, y) => Math.abs(y.weight) - Math.abs(x.weight) || x.i - y.i);

  for (const r of ordered) reasons.push(r.text);
  if (verdict === "unsure") reasons.push(UNSURE_REASON);

  /* Direction matters, and dropping it regenerated C37.
     
     The sort above is magnitude only, and `decidedBy` used to be
     `ordered[0].text` -- so it named the LOUDEST signal whether or not that
     signal pushed the way the verdict went. Of the nine weight combinations
     that come out `unsure` -- every one of which `proposeGroups` proposes as
     a break -- eight had a positive-weight `decidedBy`: a sentence arguing
     SAME, printed under the split divider as the reason the clips were kept
     apart. Reachable on a retake (restartRun >= 10, endsPunctuated, gap >=
     20min, score 0.35): the split line read "X opens by re-saying 12 words Y
     had just said -- that is him restarting the line he was cut off in",
     which he would read, agree with, and then click Import. C37 was a bug
     about a misleading sentence and its own fix printed a contradicting one.
     
     So the reason named is the strongest one that pushed TOWARD the verdict.
     And an `unsure` verdict asserts nothing, because that is where a
     confident-sounding sentence does the most damage: the rule has not
     concluded anything for a sentence to be the explanation of. */
  const towards = verdict === "same" ? 1 : verdict === "separate" ? -1 : 0;
  const agreeing = towards === 0
    ? undefined
    : ordered.find((r) => Math.sign(r.weight) === towards);
  /* `?? ordered[0]` is unreachable for `same` and `separate` -- a verdict
     needs a same-signed contribution to have been reached at all -- and the
     27-combination table in S38's test proves it over every reachable state
     rather than leaving it as an argument. */
  const decidedBy = towards === 0 ? UNSURE_REASON : (agreeing ?? ordered[0]).text;

  return {
    ...base,
    verdict,
    score,
    confident: verdict !== "unsure" && Math.abs(score) >= CONFIDENT_AT,
    reasons,
    decidedBy,
    signals: { gapSec, restartRun, endsDangling, endsPunctuated, tailSilenceSec },
  };
}

/**
 * The tail of a sentence, cut at a word boundary.
 *
 * `t.slice(-45)` is a CHARACTER slice, so it beheaded his own speech inside
 * quotation marks: *"…traight up a supplement powerhouse for women."* The
 * word is "straight". Quoting someone is the one place a string may not be
 * cut wherever the arithmetic lands. (ledger C37)
 */
function shorten(s: string): string {
  const t = s.replace(/\s+/g, " ").trim();
  if (t.length <= 48) return t;
  const tail = t.slice(-45);
  /* Drop the first partial word. There is always a space to find unless the
     last 45 characters are one unbroken token, in which case the raw slice is
     the best available answer. */
  const cut = tail.indexOf(" ");
  return `…${cut === -1 ? tail : tail.slice(cut + 1)}`;
}

/* ---- the batch ---- */

/**
 * Propose which clips are one video.
 *
 * Ordering comes from `lib/stitch.ts` and is by `creation_time`, so drop order
 * is never consulted -- the proposal for a batch is the same whichever way he
 * dropped it, which one of the tests asserts directly.
 *
 * **Interleaving.** Part one of A, then all of B, then part two of A is
 * reachable because he batch-films, and chronological adjacency alone would
 * pair A-part-one with B. So every ordered pair is scored, not just the
 * neighbours, and the links are then chosen as a one-to-one matching: each
 * clip may continue at most one clip and be continued by at most one, best
 * score first, nearest candidate breaking a tie. The chains that fall out are
 * the groups. Because a link always runs forwards in time, a cycle is not
 * expressible.
 *
 * **An unsure seam is proposed as a break.** It costs him one click to merge
 * two groups that should have been one; the alternative is a silent join whose
 * first visible symptom is a garbage cut. Those seams are collected in
 * `needsYourEye` so the tray can put them in front of him rather than leaving
 * him to notice.
 */
export function proposeGroups(clips: ClipForGrouping[]): GroupingProposal {
  /* Keyed on the probe object rather than its path: orderProbes sorts a copy
     and hands back the same objects, so identity is exact, and two clips that
     happened to share a path could not collapse into one. */
  const { ordered, basis } = orderProbes(clips.map((c) => c.probe));
  const byProbe = new Map(clips.map((c) => [c.probe, c]));
  const seq = ordered.map((p) => byProbe.get(p)!);

  if (seq.length === 0) return { groups: [], basis, seams: [], needsYourEye: [] };

  /* every ordered pair, because a continuation can skip over another video */
  type Link = { i: number; j: number; seam: Seam };
  const links: Link[] = [];
  for (let i = 0; i < seq.length; i++) {
    for (let j = i + 1; j < seq.length; j++) {
      links.push({ i, j, seam: evaluateSeam(seq[i], seq[j]) });
    }
  }

  /* what the tray shows as the batch's seams: the ones between clips that
     ended up next to each other in time, which is the order he sees them in */
  const adjacent = links.filter((l) => l.j === l.i + 1).map((l) => l.seam);

  const succ = new Array<number | null>(seq.length).fill(null);
  const pred = new Array<number | null>(seq.length).fill(null);
  const usedSeam = new Map<number, Seam>();

  const candidates = links
    .filter((l) => l.seam.verdict === "same")
    .sort(
      (x, y) =>
        y.seam.score - x.seam.score ||
        x.j - x.i - (y.j - y.i) || // the nearer candidate, on a tie
        x.i - y.i ||
        x.j - y.j
    );

  for (const l of candidates) {
    if (succ[l.i] !== null || pred[l.j] !== null) continue;
    succ[l.i] = l.j;
    pred[l.j] = l.i;
    usedSeam.set(l.i, l.seam);
  }

  const groups: ProposedGroup[] = [];
  for (let i = 0; i < seq.length; i++) {
    if (pred[i] !== null) continue; // not the head of a chain
    const idx: number[] = [i];
    const joinedBy: Seam[] = [];
    for (let at = i; succ[at] !== null; at = succ[at]!) {
      joinedBy.push(usedSeam.get(at)!);
      idx.push(succ[at]!);
    }
    const members = idx.map((n) => seq[n].probe);
    /* Every part or nothing: a total that quietly counts a missing duration as
       zero would tell him the joined file is shorter than it is. */
    const durations = members.map((p) => p.durationSec);
    const totalDurationSec = durations.every((d): d is number => d !== null)
      ? Number(durations.reduce((n, d) => n + d, 0).toFixed(2))
      : null;
    groups.push({
      clips: members,
      projectName: projectNameFor(members[0].name),
      totalDurationSec,
      joinedBy,
      /* a chain that skips an index belongs to a batch that was interleaved */
      interleaved: idx.some((n, k) => k > 0 && n !== idx[k - 1] + 1),
    });
  }

  return {
    groups,
    basis,
    seams: adjacent,
    /* S38. Ask when the rule is not sure. **Kayer's ruling, 2026-09-11:**
       asked whether a weak-but-correct split should be questioned, he said
       *"sure ask me"* — he would rather be asked.
       
       That resolves a trade only he could price, and it resolves it against
       the cheaper-looking option. The measurement put in front of him:
       `!confident` flags the **-0.1** seam that wrongly split his three-clip
       video AND the **-0.15** seam that correctly separates two different
       products. Those are 0.05 apart, same verdict, same confidence, opposite
       correctness, and no predicate over score/verdict/confident tells them
       apart — so being asked about the wrong one is the price of being asked
       about the right one.
       
       WHAT THIS COSTS HIM, because it is the honest consequence of his own
       decision. The thresholds are asymmetric: `SAME_AT = 0.55` already
       clears `CONFIDENT_AT = 0.5`, so **every `same` verdict is confident by
       construction**, while `SEPARATE_AT = -0.1` only clears 0.5 at
       `score <= -0.5`, so **every separate call in (-0.5, -0.1] is
       `confident: false` by construction.** So until S37 sharpens the rule,
       nearly every SPLIT is a question: one on tonight's three clips, four of
       five seams on the six-clip batch. S37 is what brings that number down.
       
       WHAT IT IS NOT. "Ask about everything" is not what he chose. He chose
       "ask when you are not sure", and the shape that delivers is **silence
       on joins, a question on weak splits** — `0060->0061` scored 0.55 with
       `confident: true` and stays silent in the same run that asks about
       `0061->0062`. That asymmetry is the anti-abdication half of Mara's
       two-sided exit and it is asserted both ways. */
    needsYourEye: adjacent.filter((s) => s.verdict === "unsure" || !s.confident),
  };
}
