/*
 * colorimetry/index.ts — spectrum to colour, done in the right colour space
 * (Layer 0, pure).
 *
 * Colour science, not rendering: a spectra explorable, an HR diagram, a teaching
 * figure and a GPU star renderer all want a spectrum's colour, and all of them
 * need to know whether they hold LINEAR light or DISPLAY-encoded values.
 * Conflating those is the classic colour-management bug, so every export names
 * which it is.
 *
 * Colour comes from INTEGRATING a spectrum against the CIE observer, not from a
 * temperature-to-locus fit. That matters beyond accuracy: a Planckian-locus fit
 * can only describe a bare blackbody, whereas a dust-reddened star is no longer
 * on the locus at all. Integration colours whatever spectrum it is handed, which
 * is what makes wavelength-dependent extinction expressible later.
 *
 * Note `core/stellar` also has `teffToRGB`. That is a Tanner Helland fit
 * producing DISPLAY-encoded values, correct for the canvas UI it serves. This
 * module is the linear-light path.
 */

import { planckNm } from "../blackbody/index.ts";

/* ─────────────────────── the CIE 1931 2-degree observer ────────────────────── */

/**
 * Piecewise-Gaussian lobe: a Gaussian with a different width either side of its
 * peak. The building block of the colour-matching fits below.
 */
function lobe(x: number, mu: number, sigmaLo: number, sigmaHi: number): number {
  const sigma = x < mu ? sigmaLo : sigmaHi;
  const t = (x - mu) / sigma;
  return Math.exp(-0.5 * t * t);
}

/**
 * CIE 1931 2-degree colour-matching functions at `lambdaNm`, as the multi-lobe
 * analytic fit of Wyman, Sloan & Shirley (2013), JCGT 2(2), "Simple Analytic
 * Approximations to the CIE XYZ Color Matching Functions".
 *
 * The published fit is used rather than the tabulated 5 nm data on purpose: the
 * table is 243 numbers, and a single mistyped digit would shift every colour the
 * site renders while still looking entirely plausible. This is ~10 lines that
 * can be checked against its source, and `check-star-optics` validates it two
 * independent ways — an equal-energy spectrum must land on the white point
 * x = y = 1/3 by definition, and the blackbody colours it produces must agree
 * with the Kim et al. (2002) Planckian locus, which was derived from the real
 * table by a different route.
 *
 * Accurate to a few percent of the tabulated functions, which is far below what
 * a star colour on screen resolves.
 */
export function cieXYZBar(lambdaNm: number): [number, number, number] {
  const x =
    1.056 * lobe(lambdaNm, 599.8, 37.9, 31.0) +
    0.362 * lobe(lambdaNm, 442.0, 16.0, 26.7) -
    0.065 * lobe(lambdaNm, 501.1, 20.4, 26.2);
  const y = 0.821 * lobe(lambdaNm, 568.8, 46.9, 40.5) + 0.286 * lobe(lambdaNm, 530.9, 16.3, 31.1);
  const z = 1.217 * lobe(lambdaNm, 437.0, 11.8, 36.0) + 0.681 * lobe(lambdaNm, 459.0, 26.0, 13.8);
  return [x, y, z];
}

/** Integration bounds and step for spectral integrals [nm]. */
export const VISIBLE_MIN_NM = 360;
export const VISIBLE_MAX_NM = 830;
const STEP_NM = 2;

/**
 * Integrate a spectral radiance function against the CIE observer to get XYZ.
 *
 * `spectralRadiance(lambdaNm)` may be in any units; XYZ comes back in those same
 * units, and callers that only want chromaticity normalize afterwards. A plain
 * midpoint sum at 2 nm is used — the colour-matching functions are smooth on
 * that scale, and the result is verified against the analytic white point rather
 * than assumed.
 */
export function spectrumToXYZ(spectralRadiance: (lambdaNm: number) => number): [number, number, number] {
  let X = 0;
  let Y = 0;
  let Z = 0;
  for (let l = VISIBLE_MIN_NM + STEP_NM / 2; l < VISIBLE_MAX_NM; l += STEP_NM) {
    const s = spectralRadiance(l);
    if (!(s > 0)) continue;
    const [xb, yb, zb] = cieXYZBar(l);
    X += s * xb;
    Y += s * yb;
    Z += s * zb;
  }
  return [X * STEP_NM, Y * STEP_NM, Z * STEP_NM];
}

/* ───────────────────────────── XYZ to display space ────────────────────────── */

/** CIE XYZ (D65) to LINEAR sRGB primaries. IEC 61966-2-1 matrix. */
export function xyzToLinearSRGB(X: number, Y: number, Z: number): [number, number, number] {
  return [
    3.2406 * X - 1.5372 * Y - 0.4986 * Z,
    -0.9689 * X + 1.8758 * Y + 0.0415 * Z,
    0.0557 * X - 0.204 * Y + 1.057 * Z,
  ];
}

/**
 * Clamp out-of-gamut negatives and normalize the largest channel to 1.
 *
 * This is what SEPARATES chromaticity from flux: the caller multiplies by an
 * apparent flux, so hue is fixed by the spectrum alone and cannot shift as a
 * source brightens. Bright cores then approach white through exposure and tone
 * mapping — the physical route — instead of by desaturating the colour itself.
 */
export function normalizeChroma(c: readonly [number, number, number]): [number, number, number] {
  const r = Math.max(0, c[0]);
  const g = Math.max(0, c[1]);
  const b = Math.max(0, c[2]);
  const peak = Math.max(r, g, b) || 1;
  return [r / peak, g / peak, b / peak];
}

/**
 * Chromaticity of an arbitrary spectrum, as linear-light sRGB normalized to a
 * peak of 1.
 *
 * The general entry point: hand it a reddened spectrum, a passband-filtered one,
 * or anything else, and it colours it correctly. `blackbodyLinearRGB` is the
 * special case for an unreddened star.
 */
export function spectrumLinearRGB(
  spectralRadiance: (lambdaNm: number) => number,
): [number, number, number] {
  const [X, Y, Z] = spectrumToXYZ(spectralRadiance);
  return normalizeChroma(xyzToLinearSRGB(X, Y, Z));
}

/**
 * Blackbody chromaticity at `teffK`, as linear-light sRGB with a peak of 1.
 *
 * Computed by integrating the Planck function against the CIE observer, so it is
 * the same code path a reddened or filtered spectrum takes — there is no
 * separate "bare star" formula to drift from the general one.
 */
export function blackbodyLinearRGB(teffK: number): [number, number, number] {
  return spectrumLinearRGB((lambdaNm) => planckNm(lambdaNm, teffK));
}

/* ──────────────────────────── display encoding ─────────────────────────────── */

/**
 * sRGB opto-electronic transfer function: LINEAR light -> DISPLAY-encoded value,
 * both in [0,1]. IEC 61966-2-1.
 *
 * Exported because questions about how a colour LOOKS can only be answered in
 * display space. A 30 kK star is linear red ~0.38 — which sounds dim — but
 * encodes to ~0.65, a pale blue-white on screen. Asserting "looks white-ish" on
 * linear values would condemn a correct colour, and that misreading is how a
 * linear pipeline gets "fixed" into a gamma-encoded one.
 */
export function linearToSrgb(v: number): number {
  return v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055;
}

/** `linearToSrgb` applied per channel. */
export function linearToSrgbRGB(c: readonly [number, number, number]): [number, number, number] {
  return [linearToSrgb(c[0]), linearToSrgb(c[1]), linearToSrgb(c[2])];
}
