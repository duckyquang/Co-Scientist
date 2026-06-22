/** Deterministic, string-seeded PRNG for the in-browser session simulator.
 *
 * Mirrors the *role* of Python's `random.Random(seed)` in webapp/simulator.py:
 * given the same session id we always replay the exact same tournament. The
 * numbers themselves need not match Python — only be stable within the browser.
 *
 * xmur3 (seed hashing) + mulberry32 (generator): tiny, fast, well-distributed.
 */

export interface Rng {
  /** float in [0, 1) */
  random(): number;
  /** float in [lo, hi) */
  uniform(lo: number, hi: number): number;
  /** integer in [lo, hi] (inclusive, like Python randint) */
  randint(lo: number, hi: number): number;
  /** pick one element */
  choice<T>(arr: readonly T[]): T;
  /** new array, Fisher–Yates shuffled (does not mutate input) */
  shuffle<T>(arr: readonly T[]): T[];
  /** k distinct elements (like Python random.sample) */
  sample<T>(arr: readonly T[], k: number): T[];
}

export function makeRng(seedStr: string): Rng {
  // xmur3 — hash the seed string to a 32-bit state.
  let h = 1779033703 ^ seedStr.length;
  for (let i = 0; i < seedStr.length; i++) {
    h = Math.imul(h ^ seedStr.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  let a = (h ^= h >>> 16) >>> 0;

  const random = (): number => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  const uniform = (lo: number, hi: number) => lo + (hi - lo) * random();
  const randint = (lo: number, hi: number) => lo + Math.floor(random() * (hi - lo + 1));
  const choice = <T>(arr: readonly T[]): T => arr[Math.floor(random() * arr.length)];
  const shuffle = <T>(arr: readonly T[]): T[] => {
    const out = arr.slice();
    for (let i = out.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
  };
  const sample = <T>(arr: readonly T[], k: number): T[] => shuffle(arr).slice(0, k);

  return { random, uniform, randint, choice, shuffle, sample };
}
