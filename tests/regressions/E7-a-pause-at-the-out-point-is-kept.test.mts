import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";

/**
 * LEDGER E7 — ugc-edit-system/tools/build_cut.py, walk_pieces
 *
 * A detected pause sitting between his last word and the beat's out-point is
 * kept, whole, in the finished cut. On his 122.24s closing run that is 3.77s
 * across two beats — 63% of the 5.99s of interior dead air the row pins, and
 * the largest single thing standing between the app's 4.9% and his 0.00%.
 *
 * The mechanism, measured rather than read:
 *
 *   walk_pieces rejects the trim at `if co <= cur + 0.18: continue`, whose own
 *   comment says "too near the first word". But `cur` is the PLAYHEAD, not the
 *   first word — after an earlier removal it is a resume point mid-line. In
 *   both failing beats the span between the playhead and the pause is 0.12s
 *   covered by a single Whisper "word" 2.68s and 3.00s long: exactly the case
 *   LONG_WORD exists for, where the file says "its stated end means nothing".
 *
 *   So the guard protects nothing and costs 1.73s and 2.04s of dead air.
 *
 * And the reason it is safe to take is that the out-point is in the same
 * condition. Both beats end at the STATED END of the folded word, and the next
 * real word begins after the beat, not inside it:
 *
 *   im-telling-ladies-3   ends 1122.650 = end of "I'm" (1119.65-1122.65, 3.00s)
 *                         next word "telling" starts at 1122.650
 *   theyre-theyre-running ends 1006.210 = end of "but" (1003.53-1006.21, 2.68s)
 *                         next word "I" starts at 1006.210
 *
 * The 0.18-0.29s of audio after each pause is therefore the leading edge of a
 * word delivered in full by the FOLLOWING beat. Keeping it does not preserve
 * anything he said — it plays the front of a word and then cuts away, and the
 * next beat says the same word again. That is the stutter CLAUDE.md forbids,
 * on top of the dead air.
 *
 * Inputs below are the real ones, lifted from
 * ~/Movies/SnipAi/qa-exit-0912/projects/img-0060 (beats.json, work/silence.txt,
 * work/transcript.json) so this file is self-contained and does not read his
 * library. walk_pieces is pure arithmetic over numbers: no ffmpeg, no video.
 *
 * The build calls it with the CLI's defaults, trim_min=0.22 and keep=0.07 —
 * NOT the 0.35/0.30 in the function signature, which only apply to direct
 * callers. Getting that wrong makes every number here disagree with the run.
 */

const ROOT = path.dirname(path.dirname(path.dirname(new URL(import.meta.url).pathname)));
const TOOLS = path.join(ROOT, "ugc-edit-system", "tools");

type Span = [number, number];
type Case = {
  label: string;
  s: number;
  e: number;
  sil: Span[];
  words: Span[];
  holes?: Span[];
  trim_min?: number;
  keep?: number;
};
type Piece = [string, number, number];
type Result = { pieces: Piece[]; removed: number; splits: number };

/** Ask build_cut.py itself what each beat renders as. */
function walk(cases: Case[]): Result[] {
  const script = `
import sys, json
sys.path.insert(0, ${JSON.stringify(TOOLS)})
import build_cut as bc
out = []
for c in json.load(sys.stdin):
    pieces, removed, splits = bc.walk_pieces(
        c["label"], c["s"], c["e"],
        [tuple(x) for x in c["sil"]],
        [tuple(x) for x in c.get("holes") or []],
        trim_min=c.get("trim_min", 0.22),
        keep=c.get("keep", 0.07),
        words=[tuple(x) for x in c["words"]])
    out.append({"pieces": pieces, "removed": removed, "splits": splits})
json.dump(out, sys.stdout)
`;
  const r = spawnSync("python3", ["-c", script], {
    input: JSON.stringify(cases), encoding: "utf8",
  });
  assert.equal(r.status, 0, `walk_pieces could not be called: ${r.stderr}`);
  return JSON.parse(r.stdout) as Result[];
}

/** Seconds of `span` still inside any returned piece. */
function survives(pieces: Piece[], [a, b]: Span): number {
  return pieces.reduce((n, [, px, py]) => {
    const lo = Math.max(px, a), hi = Math.min(py, b);
    return n + Math.max(0, hi - lo);
  }, 0);
}

/* ------------------------------------------------------------------ */
/* The two real beats. These are the row's first assertion.            */
/* ------------------------------------------------------------------ */

/** The cut's final beat, verbatim. */
const finalBeat: Case = {
  label: "im-telling-ladies-3",
  s: 1117.49,
  e: 1122.65,
  sil: [
    [1117.277, 1117.492],
    [1119.327, 1120.610],
    [1120.660, 1122.393],
  ],
  words: [
    [1117.49, 1117.73], [1117.73, 1117.95], [1117.95, 1118.17],
    [1118.25, 1118.27], [1118.33, 1118.49], [1118.49, 1118.69],
    [1118.69, 1118.95], [1118.95, 1119.09], [1119.09, 1119.23],
    [1119.23, 1119.29], [1119.29, 1119.65],
    [1119.65, 1122.65],   // "I'm" — 3.00s, a word with a pause folded in
    [1122.65, 1122.93],   // "telling" — starts AFTER the out-point
  ],
};

/** The other one, same shape: beat ends at the stated end of "but" (2.68s). */
const runningBeat: Case = {
  label: "theyre-theyre-running",
  s: 1003.94,
  e: 1006.21,
  sil: [
    [1003.476, 1003.950],
    [1004.023, 1006.064],
  ],
  words: [
    [1003.37, 1003.53],
    [1003.53, 1006.21],   // "but" — 2.68s, folded
    [1006.21, 1006.31],   // "I" — starts AT the out-point
  ],
};

test("E7: the 1.73s pause before the cut's last word is not in the finished cut", () => {
  const [got] = walk([finalBeat]);
  const kept = survives(got.pieces, [1120.660, 1122.393]);
  assert.ok(kept < 0.10,
    `${kept.toFixed(3)}s of a 1.733s pause is still in the cut. ` +
    `Pieces: ${JSON.stringify(got.pieces)}`);
});

test("E7: and the 2.04s one in theyre-theyre-running is not either", () => {
  const [got] = walk([runningBeat]);
  const kept = survives(got.pieces, [1004.023, 1006.064]);
  assert.ok(kept < 0.10,
    `${kept.toFixed(3)}s of a 2.041s pause is still in the cut. ` +
    `Pieces: ${JSON.stringify(got.pieces)}`);
});

/* ------------------------------------------------------------------ */
/* What must NOT change. Every one of these is a way the fix could be  */
/* wrong that would cost him something rather than save him something. */
/* ------------------------------------------------------------------ */

test("E7: his words are still there — nothing before the pause is lost", () => {
  const [got] = walk([finalBeat]);
  // "using this. and you'd be like" runs to 1119.65 stated; the -28dB map has
  // speech stopping at 1119.327, and the existing trim already places the
  // out-point of the content at 1119.362. The fix may not pull that in.
  assert.ok(got.pieces.length >= 1, "the beat rendered as nothing at all");
  const [, first0, first1] = got.pieces[0];
  assert.ok(first0 <= 1117.50,
    `the beat's in-point moved to ${first0}; his first word starts at 1117.49`);
  assert.ok(first1 >= 1119.36,
    `the content now ends at ${first1}, before his last word at 1119.362`);
  const speech = survives(got.pieces, [1117.49, 1119.327]);
  assert.ok(speech > 1.80,
    `only ${speech.toFixed(3)}s of the 1.837s he actually said survived`);
});

test("E7: a pause with a real word after it is trimmed, not cut to the out-point", () => {
  /* The same shape as the failing beat, except a short, reliable word begins
   * after the pause. That word is content: the pause must be SHORTENED and
   * everything after it kept. If the fix reads this as "nothing follows", it
   * silently deletes a line — the dangerous direction. */
  const [got] = walk([{
    label: "healthy",
    s: 100.0,
    e: 106.0,
    sil: [[101.5, 104.0]],
    words: [
      [100.0, 100.4], [100.4, 101.5],
      [104.0, 104.6], [104.6, 105.3], [105.3, 106.0],   // real words after
    ],
  }]);
  assert.equal(got.splits, 1, "the pause should have been trimmed to a split");
  const after = survives(got.pieces, [104.0, 106.0]);
  assert.ok(after > 1.90,
    `${after.toFixed(3)}s of the 2.0s spoken after the pause survived; ` +
    `the rest was deleted`);
});

test("E7: with no word data at all, a pause is trimmed and nothing is cut to the out-point", () => {
  /* words defaults to () and other tools call walk_pieces that way. A rule
   * phrased as "no word begins after the pause" is vacuously true with no
   * words, which would turn every pause in every beat into an out-point move
   * and throw away the end of every line. */
  const [got] = walk([{
    label: "wordless",
    s: 200.0,
    e: 206.0,
    sil: [[201.5, 204.0]],
    words: [],
  }]);
  assert.equal(got.splits, 1, "the pause should still have been trimmed");
  const after = survives(got.pieces, [204.0, 206.0]);
  assert.ok(after > 1.90,
    `${after.toFixed(3)}s of 2.0s after the pause survived with no word data`);
});

test("E7: a pause whose out-point is a reliable word is left to the existing rule", () => {
  /* The permission to move the out-point comes from the out-point sitting at
   * the stated edge of a FOLDED word. When the last word is an ordinary one,
   * its end means what it says and the old behaviour must stand. */
  const [got] = walk([{
    label: "reliable-tail",
    s: 300.0,
    e: 306.0,
    sil: [[303.0, 305.6]],
    words: [
      [300.0, 300.5], [300.5, 301.2], [301.2, 303.0],
      [305.6, 306.0],   // 0.40s, an ordinary word, ending exactly at the tail
    ],
  }]);
  const after = survives(got.pieces, [305.6, 306.0]);
  assert.ok(after > 0.35,
    `the last 0.40s word was cut away (${after.toFixed(3)}s left)`);
});
