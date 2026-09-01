/**
 * Deterministic PRNG for reproducible battles.
 *
 * Every random decision in the rules engine goes through this so a match can be
 * replayed exactly from its seed — which is what makes the engine testable
 * independently of the renderer (see docs/TESTING.md).
 */
export class Rng {
  private s: number;

  constructor(seed = 0x9e3779b9) {
    // Avoid the degenerate 0 state of mulberry32.
    this.s = seed >>> 0 || 0x9e3779b9;
  }

  /** Raw state, so a game can be snapshotted and resumed bit-for-bit. */
  get state(): number {
    return this.s;
  }

  set state(v: number) {
    this.s = v >>> 0;
  }

  /** mulberry32 — small, fast, and good enough for shuffles and coin flips. */
  next(): number {
    this.s = (this.s + 0x6d2b79f5) >>> 0;
    let t = this.s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Integer in [0, n). Returns 0 for n <= 0 so callers never get NaN. */
  int(n: number): number {
    if (n <= 0) return 0;
    return Math.floor(this.next() * n);
  }

  /** Uniform pick. Returns undefined for an empty array — callers must handle it. */
  pick<T>(arr: readonly T[]): T | undefined {
    if (arr.length === 0) return undefined;
    return arr[this.int(arr.length)];
  }

  /**
   * `n` distinct elements, uniformly chosen. Used for "choose N at random"
   * effects, which in Shadowverse never pick the same entity twice.
   */
  sample<T>(arr: readonly T[], n: number): T[] {
    if (n >= arr.length) return arr.slice();
    const pool = arr.slice();
    const out: T[] = [];
    for (let i = 0; i < n; i++) {
      const j = this.int(pool.length);
      out.push(pool[j]);
      pool.splice(j, 1);
    }
    return out;
  }

  /** In-place Fisher-Yates. */
  shuffle<T>(arr: T[]): T[] {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = this.int(i + 1);
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }
}
