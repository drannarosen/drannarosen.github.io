/*
 * core/imf/maschberger.ts — the Maschberger (2013) smooth IMF.
 *
 * novascope's default law, and the one `check-imf` pins to a progenax fixture. Split out of one
 * `imf.ts`; the code below is unchanged from that file.
 */

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
