/*
 * core/imf/maschberger.ts — the Maschberger (2013) smooth IMF.
 *
 * novascope's default law, and the one `check-imf` pins to a progenax fixture. Split out of one
 * `imf.ts`; the code below is unchanged from that file.
 */
import { M_HYDROGEN_BURNING_MSUN } from "../constants/index.ts";

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
/**
 * THE MASS RANGE, in one place — the site's and the data export's.
 *
 * Two IMF implementations is defensible: this one and progenax's sit either side of a language
 * boundary, and `check-imf` pins the shape against a progenax fixture so the port cannot drift.
 * Two sets of BOUNDS is not, and that is what actually broke.
 *
 * The gravoturb export inherited `Maschberger()` from a validation figure and sampled from
 * 0.01 M☉, while `params.ts` said 0.1 and this file said nothing. Nobody could see the
 * disagreement because no gate covered the bounds and `meta.json` did not record them — measured
 * 2026-08-09, 44% of every shipped catalogue was sub-stellar and a 131 M☉ star sat in a
 * catalogue whose consumer could not have drawn one.
 *
 * Agreed with Anna: the floor is the hydrogen-burning limit, and the ceiling is Maschberger's own
 * fiducial rather than progenax's wider convention. Both are citable numbers rather than taste.
 */
export const IMF_M_MIN_MSUN = M_HYDROGEN_BURNING_MSUN;
/**
 * Maschberger (2013) Table 1's fiducial upper limit, m_u = 150 M☉.
 *
 * The limits "are only needed for the normalization" (Table 1 caption), so this is a convention
 * choice and not a change to the IMF's shape — but it is the paper's own convention, which is why
 * it wins over progenax's 300 (chosen there to admit very massive stars) and over the 100 that
 * `params.ts` used to carry.
 */
export const IMF_M_MAX_MSUN = 150;

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
