/*
 * core/imf/environment.ts — the environment-dependent high-mass slope.
 *
 * Not a law in itself: it supplies alpha3 to whichever law takes a high-mass slope. Split out of
 * one `imf.ts`; the code below is unchanged from that file.
 */

/* ── Environment-dependent high-mass slope ────────────────────────────
 * The IMF is not universal: in dense, metal-poor clusters the high-mass slope
 * flattens (top-heavy). Ported from progenax's environment module
 * (`alpha3_jerabkova_mecl`): Jerabkova+2018 Eq. 6 with the 8π half-mass-density
 * convention (Marks+2012), assuming ε = 0.33.
 *
 *   x   = -0.14·[Fe/H] + 0.6039·log₁₀(M_ecl/10⁶) + 0.2161
 *   α₃  = 2.3                (x < -0.87, canonical)
 *       = -0.41·x + 1.94     (x ≥ -0.87, top-heavy),  clipped to [0.5, 2.3]
 *
 * Source: Jerabkova et al. (2018), A&A 620, A39; Marks et al. (2012), MNRAS 422,
 * 2246 (+ 2014 erratum). Validated against progenax by scripts/check-imf.mjs. */
export function alpha3FromEnvironment(feh: number, mEcl: number): number {
  const x = -0.14 * feh + 0.6039 * Math.log10(mEcl / 1e6) + 0.2161;
  const a3 = x < -0.87 ? 2.3 : -0.41 * x + 1.94;
  return Math.min(2.3, Math.max(0.5, a3));
}
