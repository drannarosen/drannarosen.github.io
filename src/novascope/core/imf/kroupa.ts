/*
 * core/imf/kroupa.ts — the Kroupa (2001) broken power law.
 *
 * Split out of one `imf.ts` so each law is findable by name. The code below is unchanged from
 * that file; only its home moved.
 */

/* ── Kroupa (2001) IMF ───────────────────────────────────────────────
 * Broken power law  dN/dm ∝ m^-α  (Kroupa 2001, MNRAS 322, 231):
 *   α = 1.3 for 0.08 ≤ m/M☉ < 0.5
 *   α = 2.3 for 0.5  ≤ m/M☉        (Kroupa canonical high-mass slope, not Salpeter 2.35)
 * We sample over [mMin, mMax] via inverse-CDF of the piecewise law with
 * amplitudes chosen for continuity at the 0.5 M☉ break. */
export interface Segment {
  lo: number;
  hi: number;
  alpha: number;
  amp: number; // continuity amplitude A_i in ξ = A_i m^-α
  weight: number; // ∫ ξ dm over [lo, hi]
  cum: number; // cumulative weight up to and including this segment
}

const KROUPA_BREAK = 0.5;
const KROUPA_ALPHA_LOW = 1.3;
const KROUPA_ALPHA_HIGH = 2.3;

function segmentIntegral(alpha: number, amp: number, a: number, b: number): number {
  if (Math.abs(1 - alpha) < 1e-9) return amp * Math.log(b / a);
  const p = 1 - alpha;
  return (amp * (Math.pow(b, p) - Math.pow(a, p))) / p;
}

/**
 * Build the piecewise Kroupa CDF over [mMin, mMax]. `alphaHigh` is the high-mass
 * slope (default 2.3, Kroupa canonical) — the knob the IMF chapter varies to make a
 * cluster top- or bottom-heavy. The low-mass slope stays Kroupa's 1.3.
 */
export function buildKroupaSegments(
  mMin: number,
  mMax: number,
  alphaHigh: number = KROUPA_ALPHA_HIGH,
): Segment[] {
  const segs: Segment[] = [];
  // Amplitudes: fix low segment at 1, match high segment at the break.
  const ampLow = 1;
  const ampHigh = ampLow * Math.pow(KROUPA_BREAK, alphaHigh - KROUPA_ALPHA_LOW);

  const raw: Array<Omit<Segment, "weight" | "cum">> = [];
  if (mMin < KROUPA_BREAK) {
    raw.push({ lo: mMin, hi: Math.min(KROUPA_BREAK, mMax), alpha: KROUPA_ALPHA_LOW, amp: ampLow });
  }
  if (mMax > KROUPA_BREAK) {
    raw.push({ lo: Math.max(KROUPA_BREAK, mMin), hi: mMax, alpha: alphaHigh, amp: ampHigh });
  }

  let cum = 0;
  for (const s of raw) {
    const weight = segmentIntegral(s.alpha, s.amp, s.lo, s.hi);
    cum += weight;
    segs.push({ ...s, weight, cum });
  }
  // Normalize cumulative to [0, 1].
  const total = cum;
  for (const s of segs) s.cum /= total;
  return segs;
}

/** Inverse-CDF sample a single mass (M☉) from the Kroupa IMF. */
export function sampleKroupaMass(u: number, segs: Segment[]): number {
  let prevCum = 0;
  for (const s of segs) {
    if (u <= s.cum || s === segs[segs.length - 1]) {
      const segU = (u - prevCum) / (s.cum - prevCum); // 0..1 within segment
      const target = segU * s.weight;
      const p = 1 - s.alpha;
      if (Math.abs(p) < 1e-9) {
        return s.lo * Math.exp(target / s.amp);
      }
      const base = Math.pow(s.lo, p) + (target * p) / s.amp;
      return Math.pow(base, 1 / p);
    }
    prevCum = s.cum;
  }
  return segs[segs.length - 1].hi;
}

/**
 * Fraction of stars expected in [mLo, mHi] under the normalized Kroupa law —
 * the analytic curve the histogram overlays on the sampled counts. Integrates
 * ξ over the requested range, clipped to each segment, ÷ the total.
 */
export function kroupaMassFraction(mLo: number, mHi: number, segs: Segment[]): number {
  let acc = 0;
  let total = 0;
  for (const s of segs) {
    total += s.weight;
    const a = Math.max(mLo, s.lo);
    const b = Math.min(mHi, s.hi);
    if (b > a) acc += segmentIntegral(s.alpha, s.amp, a, b);
  }
  return total > 0 ? acc / total : 0;
}
