/**
 * Stretches cut out of the middle of a line.
 *
 * Deleting a highlight used to split the beat in two and drop the middle,
 * which left two rows saying the same line with a seam between them. It is
 * one line with a piece taken out, so it stays one beat and carries the
 * holes -- build_cut.py removes them the same way it removes an internal
 * pause, and the picture either side butts together.
 *
 * The validation lives here rather than in the route because it is the only
 * thing standing between a highlight and footage disappearing: it has to be
 * readable on its own, and testable without a running server.
 */

export type Hole = [number, number];

export type HoleResult =
  | { ok: true; holes: Hole[]; kept: number }
  | { ok: false; error: string };

/** Nothing shorter than this is a cut anyone meant to make. */
const MIN_HOLE = 0.02;
/** What must survive, matching the minimum a beat is allowed to be. */
const MIN_KEPT = 0.15;

const ms = (n: number) => Math.round(n * 1000) / 1000;

/**
 * Clean a proposed set of holes against the line they sit in.
 *
 * Clamps to the beat, drops slivers, merges overlaps (which would otherwise
 * double-count what is removed and under-report what survives), and refuses
 * the two cases that destroy a line: a hole that swallows the whole thing,
 * and a set that leaves less behind than a beat is allowed to be.
 */
export function normaliseHoles(
  raw: unknown,
  beat: { start: number; end: number }
): HoleResult {
  if (!Array.isArray(raw)) return { ok: false, error: "holes must be a list of [from, to] pairs" };

  const clamped: Hole[] = [];
  for (const h of raw) {
    if (!Array.isArray(h) || h.length !== 2) {
      return { ok: false, error: "each hole must be [from, to]" };
    }
    const [f, t] = h as [unknown, unknown];
    if (typeof f !== "number" || typeof t !== "number" ||
        !Number.isFinite(f) || !Number.isFinite(t)) {
      return { ok: false, error: "hole bounds must be numbers" };
    }
    if (t - f < MIN_HOLE) continue;                    // a sliver removes nothing
    const from = Math.max(beat.start, f);
    const to = Math.min(beat.end, t);
    if (to - from < MIN_HOLE) continue;                // entirely outside the line
    if (from <= beat.start + MIN_HOLE && to >= beat.end - MIN_HOLE) {
      return { ok: false, error: "that hole is the whole line — delete the line instead" };
    }
    clamped.push([ms(from), ms(to)]);
  }

  const merged = mergeTouching(clamped);

  const kept = ms((beat.end - beat.start) - merged.reduce((n, h) => n + (h[1] - h[0]), 0));
  if (kept < MIN_KEPT) {
    return { ok: false, error: `that would leave less than ${MIN_KEPT}s of the line` };
  }
  return { ok: true, holes: merged, kept };
}

/** Two holes that touch are one hole. Merging matters for the arithmetic as
 *  much as for the list: overlapping holes counted separately double-count
 *  what is removed and under-report what survives. */
function mergeTouching(holes: Hole[]): Hole[] {
  const sorted = [...holes].sort((a, b) => a[0] - b[0]);
  const merged: Hole[] = [];
  for (const h of sorted) {
    const last = merged[merged.length - 1];
    if (last && h[0] <= last[1] + 0.005) last[1] = Math.max(last[1], h[1]);
    else merged.push([h[0], h[1]]);
  }
  return merged;
}

export type TrimCheck =
  | { ok: true; kept: number }
  | { ok: false; error: string };

/**
 * What would survive of a line if its edges moved to `start`/`end`.
 *
 * The other direction of the same question normaliseHoles asks. That one
 * holds the edges still and moves the holes; this one holds the holes still
 * and moves the edges -- and until it existed, only one of the two was ever
 * checked. A line already carrying a hole could be trimmed down INTO that
 * hole: 10-20 with a hole at 12-18, trimmed to 12.5-15.0, passes every test
 * the trim path ran (2.5s long, edges inside the source, 0.15s minimum met)
 * and has nothing left in it at all. build_cut.py's walk_pieces emits zero
 * pieces for it, so the line is simply absent from the finished video while
 * beats.json still shows it and the timeline draws it 0px wide.
 *
 * Note what this does NOT do: it does not rewrite the holes. build_cut clamps
 * them to the beat as it reads them, so a hole hanging off a trimmed edge is
 * already handled there -- and persisting the clamped version would throw the
 * hole's real edges away the moment a line was trimmed in and back out again,
 * quietly resurrecting footage that was deleted on purpose. The holes are
 * what the editor drew. This only answers whether anything is left.
 */
export function keptAfterTrim(
  beat: { holes?: Hole[] },
  start: number,
  end: number
): TrimCheck {
  const inRange: Hole[] = [];
  for (const h of beat.holes ?? []) {
    if (!Array.isArray(h) || h.length !== 2) continue;
    const [f, t] = h;
    if (typeof f !== "number" || typeof t !== "number" ||
        !Number.isFinite(f) || !Number.isFinite(t)) continue;
    const from = Math.max(start, f);
    const to = Math.min(end, t);
    // Matches build_cut's own `hy > s + 0.02 and hx < e - 0.02`: an overlap
    // this small removes nothing there, so it must not count as removing
    // something here.
    if (to - from < MIN_HOLE) continue;
    inRange.push([from, to]);
  }

  const removed = mergeTouching(inRange).reduce((n, h) => n + (h[1] - h[0]), 0);
  const kept = ms((end - start) - removed);
  if (kept >= MIN_KEPT) return { ok: true, kept };

  // Two different things go wrong here and they want different sentences,
  // because the second one is recoverable by nudging and the first is not.
  if (kept < MIN_HOLE) {
    return {
      ok: false,
      error: "everything between those edges is already cut out of this line — " +
             "put back the cut inside it first, or delete the line",
    };
  }
  return {
    ok: false,
    error: `that would leave only ${kept}s of this line once the cuts already ` +
           `inside it come out — a line has to keep at least ${MIN_KEPT}s`,
  };
}
