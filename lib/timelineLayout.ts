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
  /**
   * Are this beat's rendered pieces still a true picture of it?
   *
   * The EDL is written at build time. Trim the beat or cut a stretch out of it
   * afterwards and those pieces describe a video that no longer matches the
   * edit -- so laying the beat out from them reports the length of the last
   * render, which is how a cut could remove ten seconds and leave the header
   * saying exactly what it said before. That reads as "my edit did not save".
   *
   * Pieces are trusted only while they sit inside the beat and clear of every
   * hole in it. Otherwise the beat is laid out from itself, and the timeline
   * tells the truth immediately rather than at the next build.
   */
  const edlStillFits = (c: Clip, mine: EdlPiece[]) => {
    for (const e of mine) {
      // A piece that cannot describe any real footage -- a negative or
      // non-finite duration, an inverted range -- is not a picture of this
      // beat, whatever it claims. Trusting it laid the beat out at a negative
      // length, and since every position downstream is a running sum, one bad
      // piece ran the whole timeline backwards: negative totals, a playhead
      // that maps outside the cut, filmstrip offsets in the wrong direction.
      // Falling through to the beat's own extent is what already happens for
      // every other kind of stale EDL.
      if (!Number.isFinite(e.dur) || e.dur < 0) return false;
      if (!Number.isFinite(e.src_start) || !Number.isFinite(e.src_end)) return false;
      if (e.src_end < e.src_start) return false;
      if (e.src_start < c.start - 0.05 || e.src_end > c.end + 0.05) return false;
      for (const [hf, ht] of c.holes ?? []) {
        if (e.src_start < ht - 0.02 && e.src_end > hf + 0.02) return false;
      }
    }
    return true;
  };

  const pieces: Piece[] = [];
  const placed: Placed[] = [];
  let at = 0;
  clips.forEach((c, index) => {
    const found = byBeat.get(c.label);
    const mine = found && found.length && edlStillFits(c, found) ? found : undefined;
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


/**
 * The order after dragging one clip into a gap.
 *
 * `dropAt` is the index the clip would land BEFORE, counted in the CURRENT
 * order -- which is the fiddly part: once the clip is lifted out, every gap
 * after it shifts down by one. Dropping a clip into either gap touching where
 * it already sits is a no-op, and has to be, or a stray six-pixel wobble
 * rewrites the beat list and burns a snapshot.
 *
 * Returns null when nothing would change.
 */
export function reorderTo(
  order: string[],
  label: string,
  dropAt: number
): string[] | null {
  const from = order.indexOf(label);
  if (from < 0) return null;
  if (dropAt < 0 || dropAt > order.length) return null;
  const to = dropAt > from ? dropAt - 1 : dropAt;
  if (to === from) return null;
  const next = order.slice();
  next.splice(from, 1);
  next.splice(to, 0, label);
  return next;
}


/* ---- cutting a span out of the timeline --------------------------------- */

/** What removing a stretch of the cut does to one beat. */
export type SpanEdit =
  | { label: string; drop: true }
  | { label: string; holes: [number, number][] };

const clamp01 = (n: number) => Math.max(0, Math.min(1, n));

/**
 * Turn "delete from 12.4s to 15.1s of the cut" into edits to the beat list.
 *
 * A span on the timeline is in CUT time and pays no attention to where clips
 * begin and end, so one drag can clip the tail of one line, swallow the next
 * whole, and bite the head off a third. Resolving it here, against the pieces
 * the cut is actually made of, means the messy part is arithmetic that can be
 * tested rather than something a mouse handler does by feel.
 *
 * The mapping has to go through PIECES, not clips: a beat with a pause trimmed
 * out of it is two runs of film, and cut time does not run linearly across the
 * gap between them.
 *
 * Everything comes back as holes, because a hole that reaches a beat's edge is
 * already a trim of that edge (see walk_pieces), and a beat the span swallows
 * entirely is the one case that needs saying separately.
 */
export function resolveSpanDelete(
  pieces: Piece[],
  clips: Clip[],
  from: number,
  to: number
): SpanEdit[] {
  if (!(to > from)) return [];
  const byLabel = new Map(clips.map((c) => [c.label, c]));
  const removed = new Map<string, [number, number][]>();

  for (const p of pieces) {
    const lo = Math.max(from, p.at);
    const hi = Math.min(to, p.at + p.dur);
    if (hi - lo <= 0.001) continue;                 // this piece is untouched
    if (p.dur <= 0) continue;
    // cut time runs linearly inside a single piece, so a fraction of the piece
    // is the same fraction of the source it came from
    const span = p.srcEnd - p.srcStart;
    const s = p.srcStart + clamp01((lo - p.at) / p.dur) * span;
    const e = p.srcStart + clamp01((hi - p.at) / p.dur) * span;
    if (e - s <= 0.001) continue;
    const list = removed.get(p.beatLabel) ?? [];
    list.push([ms(s), ms(e)]);
    removed.set(p.beatLabel, list);
  }

  const out: SpanEdit[] = [];
  for (const [label, ranges] of removed) {
    const clip = byLabel.get(label);
    if (!clip) continue;
    ranges.sort((a, b) => a[0] - b[0]);
    // merge, or overlapping ranges double-count what survives
    const merged: [number, number][] = [];
    for (const r of ranges) {
      const last = merged[merged.length - 1];
      if (last && r[0] <= last[1] + 0.005) last[1] = Math.max(last[1], r[1]);
      else merged.push([r[0], r[1]]);
    }
    /* Is there anything left of this line?
     *
     * Measured against what actually survives, which means counting the holes
     * ALREADY in it. Judging by the beat's full length instead said "plenty
     * left" for a line that was mostly gone, sent holes where it should have
     * sent a deletion, and the server refused them -- and because a span is
     * applied atomically, refusing one line threw away the whole cut. That is
     * a drag across the timeline doing nothing at all, with the reason buried
     * in a toast. */
    const all = [...(clip.holes ?? []), ...merged].sort((a, b) => a[0] - b[0]);
    const union: [number, number][] = [];
    for (const h of all) {
      const last = union[union.length - 1];
      if (last && h[0] <= last[1] + 0.005) last[1] = Math.max(last[1], h[1]);
      else union.push([h[0], h[1]]);
    }
    const removed = union.reduce(
      (n, [f, t]) => n + Math.max(0, Math.min(t, clip.end) - Math.max(f, clip.start)), 0);
    const kept = Math.max(0, clip.end - clip.start) - removed;
    if (kept < 0.15) out.push({ label, drop: true });
    else out.push({ label, holes: union });
  }
  return out;
}
