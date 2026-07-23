/*
 * core/cluster/segregation.ts — primordial mass segregation, ported from
 * progenax's `correlated_mass_assignment` (McLuster Eq. A1, Küpper et al. 2011).
 *
 * Positions stay fixed; a strength λ ∈ [0,1] only re-pairs which mass lands at
 * which position, correlated with local density. For a Plummer sphere the
 * density decreases monotonically with radius, so the density rank IS the radius
 * rank — the densest (smallest-r) sites take the most massive stars. λ=1 is
 * perfect segregation (most massive star in the densest cell); λ=0 is random.
 *
 * This is the same knob the standalone /explore/mass-segregation engine exposes
 * on real gravoturb data; here it acts on the sampled Plummer cluster.
 */

/** Fenwick tree over ranks 0..n-1: "take the j-th still-available rank". O(log n). */
class AvailableRanks {
  private n: number;
  private tree: Int32Array;
  private log: number;
  constructor(n: number) {
    this.n = n;
    this.tree = new Int32Array(n + 1);
    this.log = Math.floor(Math.log2(n || 1));
    for (let i = 1; i <= n; i++) this.add(i, 1);
  }
  private add(i: number, d: number): void {
    for (; i <= this.n; i += i & -i) this.tree[i] += d;
  }
  /** 0-indexed j-th smallest still-available rank; removes it. */
  takeJth(j: number): number {
    let pos = 0;
    let k = j + 1;
    for (let pw = 1 << this.log; pw > 0; pw >>= 1) {
      if (pos + pw <= this.n && this.tree[pos + pw] < k) {
        pos += pw;
        k -= this.tree[pos];
      }
    }
    this.add(pos + 1, -1);
    return pos; // 1-indexed slot pos+1 → 0-indexed rank pos
  }
}

/**
 * McLuster Eq. A1 partial shuffle: perm[i] is the rank assigned to slot i.
 * strength=1 → identity; strength=0 → uniform random permutation.
 * j = floor((n−i)·(1 − X^{1−strength})) over the remaining available ranks.
 */
function partialShuffle(n: number, strength: number, rng: () => number): number[] {
  const avail = new AvailableRanks(n);
  const perm = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    const nAvail = n - i;
    const j = Math.min(nAvail - 1, Math.max(0, Math.floor(nAvail * (1 - Math.pow(rng(), 1 - strength)))));
    perm[i] = avail.takeJth(j);
  }
  return perm;
}

/**
 * Reorder `masses` so massive stars sit at small radii with strength `lambda`.
 * Returns a new mass array aligned to the ORIGINAL position order (position i
 * keeps its coordinates, gets a possibly-different mass).
 */
export function segregateMasses(
  masses: number[],
  radii: number[],
  lambda: number,
  rng: () => number,
): number[] {
  const n = masses.length;
  const lam = Math.min(1, Math.max(0, lambda));
  // Density rank: densest first = smallest radius first (Plummer).
  const densityRank = [...Array(n).keys()].sort((a, b) => radii[a] - radii[b]);
  const massDesc = [...masses].sort((a, b) => b - a);
  const perm = partialShuffle(n, lam, rng);
  const out = new Array<number>(n);
  for (let i = 0; i < n; i++) out[densityRank[i]] = massDesc[perm[i]];
  return out;
}
