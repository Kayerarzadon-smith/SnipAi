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

  clamped.sort((a, b) => a[0] - b[0]);
  const merged: Hole[] = [];
  for (const h of clamped) {
    const last = merged[merged.length - 1];
    // touching counts as overlapping: two adjacent holes are one hole
    if (last && h[0] <= last[1] + 0.005) last[1] = Math.max(last[1], h[1]);
    else merged.push([h[0], h[1]]);
  }

  const kept = ms((beat.end - beat.start) - merged.reduce((n, h) => n + (h[1] - h[0]), 0));
  if (kept < MIN_KEPT) {
    return { ok: false, error: `that would leave less than ${MIN_KEPT}s of the line` };
  }
  return { ok: true, holes: merged, kept };
}
