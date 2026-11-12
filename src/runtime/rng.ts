/** A source of pseudo-random numbers in [0, 1). */
export interface Random {
  next(): number;
  /** Uniform float in [min, max). */
  range(min: number, max: number): number;
  /** Uniform integer in [0, maxExclusive). */
  int(maxExclusive: number): number;
  /** Next 32-bit unsigned integer, useful for deriving child seeds. */
  nextUint32(): number;
}

/**
 * Deterministic, seedable RNG (mulberry32). The same seed always yields the same sequence
 * on every platform, which makes particle effects reproducible in tests.
 */
export function createRandom(seed: number): Random {
  let state = seed >>> 0;
  const nextUint32 = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return (t ^ (t >>> 14)) >>> 0;
  };
  const next = (): number => nextUint32() / 4294967296;
  return {
    next,
    nextUint32,
    range: (min, max) => min + (max - min) * next(),
    int: (maxExclusive) => Math.floor(next() * maxExclusive),
  };
}
