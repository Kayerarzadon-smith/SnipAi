/**
 * Cutting one beat in two.
 *
 * The split used to be `{ ...b, end: at }` and `{ ...b, start: at }`, which
 * copies everything the beat carries onto BOTH halves. The route's local Beat
 * type declared four fields, so the spread looked safe and the type checker
 * had nothing to say. Each duplicated field is wrong in its own way:
 *
 *   holes            a stretch removed from the first half was also removed
 *                    from the second, where it does not exist -- and a hole
 *                    lying outside a half's range is ignored by build_cut, so
 *                    half the cuts quietly came back
 *   audioStart/End   both halves claimed the SAME range of speech, so
 *                    build_cut laid it down twice and the line was spoken
 *                    twice in the render. This is the expensive one: nothing
 *                    on screen shows it until you watch the export
 *   fadeIn/fadeOut   a fade appeared in the middle of what had been one
 *                    continuous line
 *
 * So the head keeps the fade-in, the tail keeps the fade-out, each hole goes
 * to the half that contains it, and detached audio is divided at the same
 * distance in that the picture is cut -- the two halves together still cover
 * exactly what the one line covered, and no more.
 */

export type SplittableBeat = {
  label: string; start: number; end: number; text?: string;
  holes?: [number, number][];
  audioStart?: number; audioEnd?: number;
  fadeIn?: number; fadeOut?: number;
  [key: string]: unknown;
};

const round = (n: number) => Math.round(n * 1000) / 1000;

export function splitBeat(
  b: SplittableBeat,
  at: number,
  rightLabel: string
): { left: SplittableBeat; right: SplittableBeat } {
  const cutAt = round(at);
  const left: SplittableBeat = { ...b, end: cutAt };
  const right: SplittableBeat = { ...b, label: rightLabel, start: cutAt };

  /* holes: keep the part of each that falls inside the half it lands in */
  const clip = (from: number, to: number) =>
    (b.holes ?? []).reduce<[number, number][]>((acc, h) => {
      const f = Math.max(h[0], from), t = Math.min(h[1], to);
      if (t - f > 0.001) acc.push([round(f), round(t)]);
      return acc;
    }, []);
  const lh = clip(b.start, cutAt);
  const rh = clip(cutAt, b.end);
  if (lh.length) left.holes = lh; else delete left.holes;
  if (rh.length) right.holes = rh; else delete right.holes;

  /* detached audio: one range, divided -- never the same range twice */
  if (typeof b.audioStart === "number" && typeof b.audioEnd === "number" &&
      Number.isFinite(b.audioStart) && Number.isFinite(b.audioEnd)) {
    const offset = cutAt - b.start;
    const cut = Math.min(b.audioEnd, Math.max(b.audioStart, b.audioStart + offset));
    left.audioEnd = round(cut);
    right.audioStart = round(cut);
  }

  /* a fade belongs to the edge it was drawn on; neither edge is the seam */
  delete left.fadeOut;
  delete right.fadeIn;

  return { left, right };
}
