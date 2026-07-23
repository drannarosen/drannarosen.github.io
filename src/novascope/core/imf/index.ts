/*
 * imf.ts — physically-motivated star-cluster sampling for the hero visual.
 *
 * This is deliberately real, not decorative: masses are drawn from a stellar
 * initial mass function, positions from a Plummer sphere, and each star's
 * color and size follow simplified main-sequence relations. The visual payoff
 * (a few rare bright-blue massive stars among many faint red ones) is a direct
 * consequence of the IMF slope — which is the point.
 *
 * Stellar properties (L, Teff) come from the shared physics core in stellar.ts
 * (Tout et al. 1996, ported from and validated against startrax), so the hero,
 * the story, and the /explore inspector all draw from one grounded source.
 */

import { zamsLuminosity, zamsTeff, teffToRGB } from "../stellar/index.ts";
import { mulberry32 } from "../random/index.ts";

// teffToRGB is an intrinsic stellar property (core/stellar); re-exported here so
// existing callers (the hero story) keep importing it from @novascope/core/imf.
export { teffToRGB };

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

/* ── Maschberger (2013) IMF ───────────────────────────────────────────
 * A single smooth formula bridging the low-mass turnover and the high-mass
 * power-law tail — no piecewise break, and an EXACT analytic quantile, so
 * sampling is one closed-form evaluation. Ported from progenax's
 * `progenax.imf.smooth.Maschberger` (verified against a progenax fixture by
 * scripts/check-imf.mjs). The high-mass slope is α; canonically α = 2.3 — the
 * Kroupa/Chabrier value, NOT Salpeter's 2.35.
 *
 *   pdf(m) ∝ (m/μ)^(-α) · [1 + (m/μ)^(1-α)]^(-β)
 *   primitive P(m) = μ / [(1-β)(1-α)] · [1 + (m/μ)^(1-α)]^(1-β)
 *
 * Source: Maschberger, T. (2013), MNRAS 429, 1725, Eq. (5); Table 1 canonical
 * single-star parameters μ = 0.2 M☉, β = 1.4. */
export const MASCHBERGER_MU = 0.2; // scale parameter [M☉] (Maschberger 2013 Table 1)
export const MASCHBERGER_BETA = 1.4; // low-mass turnover (Maschberger 2013 Table 1)

export interface MaschbergerParams {
  mMin: number;
  mMax: number;
  alpha: number; // high-mass slope
  mu?: number;
  beta?: number;
}

function maschbergerPrimitive(m: number, alpha: number, mu: number, beta: number): number {
  const u = (m / mu) ** (1 - alpha);
  const coeff = mu / ((1 - beta) * (1 - alpha));
  return coeff * (1 + u) ** (1 - beta);
}

/** Inverse-CDF sample a mass (M☉) from the Maschberger IMF — exact, analytic. */
export function maschbergerMass(uUniform: number, p: MaschbergerParams): number {
  const mu = p.mu ?? MASCHBERGER_MU;
  const beta = p.beta ?? MASCHBERGER_BETA;
  const { alpha, mMin, mMax } = p;
  const pMin = maschbergerPrimitive(mMin, alpha, mu, beta);
  const pMax = maschbergerPrimitive(mMax, alpha, mu, beta);
  const pTarget = pMin + uUniform * (pMax - pMin);
  const coeff = mu / ((1 - beta) * (1 - alpha));
  const onePlusU = (pTarget / coeff) ** (1 / (1 - beta));
  const m = mu * (onePlusU - 1) ** (1 / (1 - alpha));
  return Math.min(mMax, Math.max(mMin, m));
}

/** Fraction of stars in [mLo, mHi] under the normalized Maschberger law
 *  (exact, via the analytic primitive) — the histogram's overlay. */
export function maschbergerMassFraction(mLo: number, mHi: number, p: MaschbergerParams): number {
  const mu = p.mu ?? MASCHBERGER_MU;
  const beta = p.beta ?? MASCHBERGER_BETA;
  const { alpha, mMin, mMax } = p;
  const a = Math.max(mLo, mMin);
  const b = Math.min(mHi, mMax);
  if (b <= a) return 0;
  const norm = maschbergerPrimitive(mMax, alpha, mu, beta) - maschbergerPrimitive(mMin, alpha, mu, beta);
  return (maschbergerPrimitive(b, alpha, mu, beta) - maschbergerPrimitive(a, alpha, mu, beta)) / norm;
}

/* ── Main-sequence relations ──────────────────────────────────────────
 * Physics-grounded ZAMS properties come from the shared stellar core
 * (src/lib/stellar.ts): Tout et al. (1996), ported from startrax and validated
 * against it (scripts/check-stellar.mjs). Mass is clamped to Tout's valid domain
 * [0.1, 100] M☉ since callers may pass values outside a given cluster's range. */

/** Mass → ZAMS effective temperature (K). */
export function massToTeff(m: number): number {
  return zamsTeff(Math.min(100, Math.max(0.1, m)));
}

/** Mass → ZAMS luminosity (L☉). */
export function massToLuminosity(m: number): number {
  return zamsLuminosity(Math.min(100, Math.max(0.1, m)));
}

/* ── Plummer sphere positions ────────────────────────────────────────
 * Isotropic 3D sample of a Plummer (1911) density profile. Enclosed-mass
 * inversion: for u = M(<r)/M_tot, r = a / sqrt(u^{-2/3} − 1). We keep z for
 * subtle depth (parallax + brightness falloff) when projecting to 2D. */
function samplePlummer(u: number, rng: () => number, a: number): [number, number, number] {
  const r = a / Math.sqrt(Math.pow(Math.max(u, 1e-6), -2 / 3) - 1);
  const cosTheta = 2 * rng() - 1;
  const sinTheta = Math.sqrt(Math.max(0, 1 - cosTheta * cosTheta));
  const phi = 2 * Math.PI * rng();
  return [r * sinTheta * Math.cos(phi), r * sinTheta * Math.sin(phi), r * cosTheta];
}

/* ── Public cluster sampler ──────────────────────────────────────────── */

export interface Star {
  /** Projected position in units of the Plummer scale radius (centered at 0). */
  x: number;
  y: number;
  /** Line-of-sight depth (units of scale radius); used for parallax/brightness. */
  z: number;
  mass: number; // M☉
  teff: number; // K
  color: [number, number, number]; // linear RGB 0..1
  /** Base render radius in logical px, ∝ log luminosity. */
  sizePx: number;
  baseOpacity: number;
  /** Whether this star twinkles (only the brighter ones do). */
  twinkles: boolean;
}

export interface ClusterOptions {
  count: number;
  mMin?: number; // M☉, default 0.1
  mMax?: number; // M☉, default 60
  seed?: number;
  minSizePx?: number;
  maxSizePx?: number;
}

/** Sample a full cluster: masses (Kroupa) → positions (Plummer) → color/size
 * (MS relations). Deterministic for a given seed. */
export function sampleCluster(opts: ClusterOptions): Star[] {
  const { count } = opts;
  const mMin = opts.mMin ?? 0.1;
  const mMax = opts.mMax ?? 60;
  const minSize = opts.minSizePx ?? 0.5;
  const maxSize = opts.maxSizePx ?? 4;
  const rng = mulberry32(opts.seed ?? 20260718);
  const segs = buildKroupaSegments(mMin, mMax);

  const logLmin = Math.log10(massToLuminosity(mMin));
  const logLmax = Math.log10(massToLuminosity(mMax));

  const stars: Star[] = [];
  for (let i = 0; i < count; i++) {
    const mass = sampleKroupaMass(rng(), segs);
    const [x, y, z] = samplePlummer(rng(), rng, 1);
    const teff = massToTeff(mass);
    const color = teffToRGB(teff);

    const logL = Math.log10(massToLuminosity(mass));
    const sizeFrac = (logL - logLmin) / (logLmax - logLmin); // 0..1
    const sizePx = minSize + (maxSize - minSize) * Math.pow(sizeFrac, 0.8);

    stars.push({
      x,
      y,
      z,
      mass,
      teff,
      color,
      sizePx,
      baseOpacity: 0.55 + 0.45 * sizeFrac,
      twinkles: sizeFrac > 0.18,
    });
  }
  // Painter's order: faint/back stars first, bright/front last.
  stars.sort((s1, s2) => s1.sizePx - s2.sizePx);
  return stars;
}
