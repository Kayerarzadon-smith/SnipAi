/** A seeded PRNG, so every failure the gauntlet finds has a seed that
 *  reproduces it exactly. mulberry32: small, fast, good enough for fuzzing. */
export function rng(seed: number) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    int: (lo: number, hi: number) => lo + Math.floor(next() * (hi - lo + 1)),
    float: (lo: number, hi: number) => lo + next() * (hi - lo),
    pick: <T,>(xs: readonly T[]) => xs[Math.floor(next() * xs.length)],
    bool: (p = 0.5) => next() < p,
  };
}
