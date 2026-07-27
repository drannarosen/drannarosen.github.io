/*
 * ccm89.ts — Cardelli, Clayton & Mathis (1989) extinction curve (Layer 0, pure).
 *
 *   Cardelli, J. A., Clayton, G. C. & Mathis, J. S. 1989, ApJ, 345, 245
 *
 * PROVENANCE. Ported from fluxax's `photometry/extinction/laws.py` (Apache 2.0), whose
 * coefficients come from a primary-source-verified equation digest — confirmed digit-for-digit
 * against the paper's printed p.249 Eqs 1, 2a, 2b, 3a, 3b by an independent verifier, and
 * cross-checked by evaluating the polynomials at the band x-values in the paper's own Tables 2
 * and 3 (agreeing to <= 1e-3). Nothing here was recalled or re-derived.
 *
 * THE MODEL. A one-parameter family: the whole curve is set by R_V = A_V / E(B-V), the
 * total-to-selective extinction ratio, which is a proxy for grain size. Larger grains scatter
 * more greyly, so a larger R_V means a flatter curve.
 *
 *     A(lambda)/A_V = a(x) + b(x)/R_V ,   x = 1/lambda[um]
 *
 * ── THE DOMAIN IS PART OF THE MODEL, AND IT IS NARROWER THAN THIS REPO'S BANDS ──
 *
 * Two branches are implemented, because two branches are what the digest verifies:
 *
 *     IR           0.3 <= x <= 1.1     (909 - 3333 nm)
 *     optical/NIR  1.1 <= x <= 3.3     (303 -  909 nm)
 *
 * CCM89 also has a UV branch (Eqs 4a/4b, 3.3 <= x <= 8). It is NOT implemented here, because
 * it is not in the verified digest, and writing coefficients from memory is exactly the
 * fabrication the site-claims rule forbids. Three of this repo's thirty passbands fall outside
 * the implemented domain:
 *
 *     HST F275W    270.8 nm   x = 3.69   above the optical branch (UV, unported)
 *     JWST F444W   4416 nm    x = 0.23   below the IR branch
 *     JWST F770W   7663 nm    x = 0.13   below the IR branch
 *
 * `aOverAv` returns NaN there rather than extrapolating, and that choice is deliberate: the
 * polynomial does not fail gracefully outside its range. Evaluated at F275W it returns 0.978 —
 * a number that looks entirely reasonable, and is wrong, because extinction rises steeply into
 * the near-UV and must EXCEED the 1.80 the curve reaches at its own valid edge. By x = 4 it
 * has gone negative, which would mean dust brightening a star.
 *
 * Use `./g23.ts` for those bands: Gordon+2023 is valid from 912 A to 32 um and covers all
 * thirty. CCM89 is here because it is closed-form, classic, and lets a reader see two
 * published laws disagree — which is an honest statement about model uncertainty.
 */

/** Wavelength range [nm] over which the implemented branches are published as valid. */
export const CCM89_RANGE_NM = { min: 1000 / 3.3, max: 1000 / 0.3 } as const;

/* Optical/NIR 7-term polynomials in y = x - 1.82 (Eqs 3a/3b). Index 0 is the constant term. */
// Digits as printed in Cardelli+1989 Eq 3a/3b (trailing zeros kept, so a reader can compare
// this line against the paper character by character).
const A_OPT = [1.0, 0.17699, -0.50447, -0.02427, 0.72085, 0.01979, -0.77530, 0.32999];
const B_OPT = [0.0, 1.41338, 2.28305, 1.07233, -5.38434, -0.62251, 5.30260, -2.09002];

const horner = (c: readonly number[], y: number): number => {
  let v = 0;
  for (let i = c.length - 1; i >= 0; i--) v = v * y + c[i];
  return v;
};

/** Is this wavelength inside the implemented, verified domain? */
export function ccm89Covers(lambdaNm: number): boolean {
  const x = 1000 / lambdaNm;
  return x >= 0.3 && x <= 3.3;
}

/**
 * A(lambda)/A_V from CCM89. Returns **NaN** outside the implemented domain — see the header;
 * the polynomial produces plausible, wrong values there rather than obviously broken ones.
 *
 * Normalization is EXACT at y = 0, i.e. x = 1.82 um^-1 (549.45 nm): a(0) = 1 and b(0) = 0, so
 * A/A_V = 1 for every R_V. That is a property of the fit, not a coincidence, and it is what
 * `extinction.test.ts` asserts rather than checking the value at some band's effective
 * wavelength — this repo's V band sits at 552.4 nm and therefore returns 0.9937, which is a
 * convention difference and not an error.
 */
export function ccm89AOverAv(lambdaNm: number, rv: number): number {
  const x = 1000 / lambdaNm; // um^-1
  if (!(x >= 0.3 && x <= 3.3)) return NaN;

  if (x <= 1.1) {
    // IR, Eqs 2a/2b.
    const p = x ** 1.61;
    return 0.574 * p + (-0.527 * p) / rv;
  }
  // Optical/NIR, Eqs 3a/3b.
  const y = x - 1.82;
  return horner(A_OPT, y) + horner(B_OPT, y) / rv;
}
