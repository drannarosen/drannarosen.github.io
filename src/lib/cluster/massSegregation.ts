/*
 * massSegregation.ts — live primordial mass segregation.
 *
 * Faithful port of progenax's `correlated_mass_assignment` (McLuster Eq. A1,
 * Küpper et al. 2011): star POSITIONS are fixed; lambda_corr only permutes which
 * mass (and thus Teff/radius) lands where. lambda=1 puts the most massive star in
 * the densest cell; lambda=0 is random. The heavy sorts are precomputed once, so
 * each slider value costs O(n log n) — real-time at n = 10^4.
 */

/** Deterministic PRNG so the permutation depends only on lambda (mulberry32). */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Fenwick tree over ranks 0..n-1 for "find & remove the j-th still-available rank". */
class AvailableRanks {
  private tree: Int32Array;
  private log: number;
  constructor(private n: number) {
    this.tree = new Int32Array(n + 1);
    this.log = Math.floor(Math.log2(n || 1));
    for (let i = 1; i <= n; i++) this.add(i, 1);
  }
  private add(i: number, d: number): void {
    for (; i <= this.n; i += i & -i) this.tree[i] += d;
  }
  /** 0-indexed j-th smallest available rank; removes it. */
  takeJth(j: number): number {
    let pos = 0, k = j + 1;
    for (let pw = 1 << this.log; pw > 0; pw >>= 1) {
      if (pos + pw <= this.n && this.tree[pos + pw] < k) { pos += pw; k -= this.tree[pos]; }
    }
    const rank = pos; // 1-indexed slot pos+1 -> 0-indexed rank pos
    this.add(pos + 1, -1);
    return rank;
  }
}

export interface Segregator {
  /** Star buffer (n*6: x,y,z,mass,teff,radius) for a given lambda_corr in [0,1]. */
  at(lambda: number): Float32Array;
  n: number;
}

/**
 * Build a reusable segregator from the exported star pool + per-position density.
 * @param stars  n*6 (x,y,z,mass,teff,radius) — positions fixed; mass/teff/radius are a re-pairable pool.
 * @param localDensity  n gas densities at each position (the coupling key).
 */
export function makeSegregator(stars: Float32Array, localDensity: Float32Array, seed = 1): Segregator {
  const n = localDensity.length;
  // Stellar props (mass,teff,radius) as a pool, sorted by mass DESCENDING.
  const order = Array.from({ length: n }, (_, i) => i).sort(
    (a, b) => stars[b * 6 + 3] - stars[a * 6 + 3],
  );
  const propsDesc = new Float32Array(n * 3); // [mass,teff,radius] most-massive first
  for (let r = 0; r < n; r++) {
    const s = order[r] * 6;
    propsDesc[r * 3] = stars[s + 3];
    propsDesc[r * 3 + 1] = stars[s + 4];
    propsDesc[r * 3 + 2] = stars[s + 5];
  }
  // Positions ranked by density DESCENDING: densityRank[k] = position index at density-rank k.
  const densityRank = Array.from({ length: n }, (_, i) => i).sort(
    (a, b) => localDensity[b] - localDensity[a],
  );
  // Fixed uniforms so the permutation morphs smoothly as lambda varies.
  const rand = mulberry32(seed);
  const X = new Float32Array(n);
  for (let i = 0; i < n; i++) X[i] = rand();

  const at = (lambda: number): Float32Array => {
    const s = Math.min(1, Math.max(0, lambda));
    const avail = new AvailableRanks(n);
    const out = new Float32Array(n * 6);
    for (let i = 0; i < n; i++) {
      const nAvail = n - i;
      let j = Math.floor(nAvail * (1 - Math.pow(X[i], 1 - s)));
      j = Math.min(nAvail - 1, Math.max(0, j));
      const massRank = avail.takeJth(j); // mass-rank assigned to density-slot i
      const pos = densityRank[i]; // position at density-rank i
      const o = pos * 6, p = massRank * 3;
      out[o] = stars[pos * 6];       // x (fixed)
      out[o + 1] = stars[pos * 6 + 1]; // y
      out[o + 2] = stars[pos * 6 + 2]; // z
      out[o + 3] = propsDesc[p];       // mass
      out[o + 4] = propsDesc[p + 1];   // teff
      out[o + 5] = propsDesc[p + 2];   // radius
    }
    return out;
  };

  return { at, n };
}
