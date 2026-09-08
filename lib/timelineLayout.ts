/**
 * How the edit is laid out in time.
 *
 * Pure arithmetic over the beat list and the EDL, with no React in it: this
 * is the maths the whole timeline, the playhead and every duration readout
 * depend on, so it lives on its own where it can be tested directly rather
 * than driven through a rendered component.
 */

export type Clip = { label: string; start: number; end: number; text?: string;
                     audioStart?: number; audioEnd?: number;
                     fadeIn?: number; fadeOut?: number;
                     holes?: [number, number][] };
export type EdlPiece = { label: string; src_start: number; src_end: number; dur: number };

/** A run of rendered film: where it sits in the cut, and where it came from. */
export type Piece = {
  beatLabel: string;
  at: number;
  dur: number;
  srcStart: number;
  srcEnd: number;
};
/** A beat's full extent on the timeline, across however many pieces it became. */
export type Placed = Clip & { at: number; dur: number; index: number };

/** build_cut labels a beat's pieces "<label>-0", "<label>-1", … when it trims
 *  an internal pause; a beat rendered in one piece keeps its bare label. */
export function baseLabel(pieceLabel: string, known: Set<string>) {
  if (known.has(pieceLabel)) return pieceLabel;
  const m = pieceLabel.match(/^(.*)-\d+$/);
  return m && known.has(m[1]) ? m[1] : pieceLabel;
}

/**
 * Lay the edit out in time.
 *
 * Where a beat has been rendered, its EDL pieces give the REAL length --
 * build_cut snaps every edge inward against the silence map, so the beats add
 * up to 2:17 where the file is 1:58. Using those is what keeps the filmstrip
 * lined up with the clips instead of drifting across the cut.
 *
 * Beats the EDL doesn't know about -- just split, or trimmed since the last
 * build -- fall back to their own duration, and deleted ones drop out
 * entirely. So the timeline stays truthful through structural edits rather
 * than going stale until the next render.
 */
/** Milliseconds are the finest unit anything here means -- the EDL is written
 *  to 3dp and ffmpeg is seeked to 3dp -- so positions are rounded at every
 *  step. Accumulating raw binary fractions across a few dozen clips leaves
 *  the tail of the timeline microseconds out, and every duration readout,
 *  playhead position and filmstrip offset inherits the drift. */
const ms = (n: number) => Math.round(n * 1000) / 1000;

export function layout(
  clips: Clip[],
  edl?: EdlPiece[]
): { placed: Placed[]; pieces: Piece[]; total: number } {
  const known = new Set(clips.map((c) => c.label));

  // Group the EDL by the beat it came from, so a beat rendered as several
  // pieces (an internal pause trimmed out) stays one clip.
  const byBeat = new Map<string, EdlPiece[]>();
  for (const e of edl ?? []) {
    const base = baseLabel(e.label, known);
    if (!known.has(base)) continue;          // a beat that has since been deleted
    (byBeat.get(base) ?? byBeat.set(base, []).get(base)!).push(e);
  }

  // Walk the CURRENT beat list, in its current order. Anything the EDL knows
  // about is placed at its real rendered length; anything new (a fresh split,
  // or a beat trimmed since the last build) falls back to its own duration.
  // That keeps the timeline honest through structural edits instead of
  // drifting until the next render.
  const pieces: Piece[] = [];
  const placed: Placed[] = [];
  let at = 0;
  clips.forEach((c, index) => {
    const mine = byBeat.get(c.label);
    const start = at;
    if (mine && mine.length) {
      for (const e of mine) {
        pieces.push({ beatLabel: c.label, at, dur: e.dur, srcStart: e.src_start, srcEnd: e.src_end });
        at = ms(at + e.dur);
      }
    } else if (c.holes?.length) {
      // Not yet rendered, but the editor has cut pieces out of the middle of
      // this line -- lay it out as the runs that survive, so the timeline
      // shows the closed gap straight away instead of at the next build.
      let cur = c.start;
      for (const [hf, ht] of c.holes) {
        const f = Math.max(c.start, hf);
        const t = Math.min(c.end, ht);
        if (t <= cur) continue;
        if (f > cur) {
          pieces.push({ beatLabel: c.label, at, dur: ms(f - cur), srcStart: cur, srcEnd: f });
          at = ms(at + (f - cur));
        }
        cur = t;
      }
      if (c.end > cur) {
        pieces.push({ beatLabel: c.label, at, dur: ms(c.end - cur), srcStart: cur, srcEnd: c.end });
        at = ms(at + (c.end - cur));
      }
    } else {
      const dur = ms(Math.max(0, c.end - c.start));
      pieces.push({ beatLabel: c.label, at, dur, srcStart: c.start, srcEnd: c.end });
      at = ms(at + dur);
    }
    placed.push({ ...c, at: start, dur: ms(at - start), index });
  });

  return { placed, pieces, total: at };
}
