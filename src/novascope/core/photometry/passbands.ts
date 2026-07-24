/*
 * passbands.ts — flux in a photometric band, not bolometrically (Layer 0, pure).
 *
 * A camera does not record a star's total output; it records what falls inside a
 * filter. The difference is large and temperature-dependent: only ~2.5% of a
 * 2000 K star's light lands in the visible band against ~53% of the Sun's, so
 * rendering cool stars at their BOLOMETRIC luminosity over-brightens them by
 * more than an order of magnitude relative to what an optical image shows. That
 * is a physical error, not a stylistic one, and it is what this module fixes.
 *
 * It is also what makes an infrared view meaningful: the same M dwarfs that are
 * faint in V are dominant in K, because that is where their light actually is.
 *
 * APPROXIMATION, stated plainly: each filter is modelled as a Gaussian in
 * wavelength with the band's published effective wavelength and FWHM. Real
 * filter curves have shoulders and structure that this does not reproduce, and
 * the source spectrum here is a blackbody, which a real star is not (line
 * blanketing, the Balmer jump, and molecular bands in cool stars all matter).
 * Colours from this module are therefore blackbody-derived estimates suitable
 * for rendering, not synthetic photometry for science.
 */

import { planckNm } from "../blackbody/index.ts";
import { R_SUN_CM, PC_CM } from "../constants/index.ts";

export interface Passband {
  /** Short standard name. */
  id: string;
  /** Effective wavelength [nm]. */
  lambdaEffNm: number;
  /** Full width at half maximum [nm]. */
  fwhmNm: number;
  /** Which regime it samples — for grouping in a UI. */
  regime: "uv" | "visible" | "nir";
}

/**
 * Johnson-Cousins UBVRI and 2MASS JHKs.
 *
 * Effective wavelengths and widths are the standard published values (Bessell
 * 1990 for Johnson-Cousins; Cohen, Wheaton & Megeath 2003 for 2MASS), rounded to
 * the precision this use justifies.
 */
export const PASSBANDS: Record<string, Passband> = {
  U: { id: "U", lambdaEffNm: 365, fwhmNm: 66, regime: "uv" },
  B: { id: "B", lambdaEffNm: 445, fwhmNm: 94, regime: "visible" },
  V: { id: "V", lambdaEffNm: 551, fwhmNm: 88, regime: "visible" },
  R: { id: "R", lambdaEffNm: 658, fwhmNm: 138, regime: "visible" },
  I: { id: "I", lambdaEffNm: 806, fwhmNm: 149, regime: "nir" },
  J: { id: "J", lambdaEffNm: 1235, fwhmNm: 162, regime: "nir" },
  H: { id: "H", lambdaEffNm: 1662, fwhmNm: 251, regime: "nir" },
  K: { id: "K", lambdaEffNm: 2159, fwhmNm: 262, regime: "nir" },
};

const FWHM_TO_SIGMA = 1 / (2 * Math.sqrt(2 * Math.LN2));

/** Gaussian filter response at `lambdaNm`, peaking at 1. */
export function bandResponse(lambdaNm: number, band: Passband): number {
  const sigma = band.fwhmNm * FWHM_TO_SIGMA;
  const t = (lambdaNm - band.lambdaEffNm) / sigma;
  return Math.exp(-0.5 * t * t);
}

/**
 * Integrate a spectral radiance against a band response.
 *
 * Integration spans +/- 3.5 sigma, where the Gaussian has fallen below 2e-3 —
 * far enough that the tails cannot matter, near enough to stay cheap.
 */
export function bandIntegral(
  spectralRadiance: (lambdaNm: number) => number,
  band: Passband,
): number {
  const sigma = band.fwhmNm * FWHM_TO_SIGMA;
  const lo = Math.max(1, band.lambdaEffNm - 3.5 * sigma);
  const hi = band.lambdaEffNm + 3.5 * sigma;
  const steps = 64;
  const dl = (hi - lo) / steps;
  let sum = 0;
  for (let i = 0; i < steps; i++) {
    const l = lo + (i + 0.5) * dl;
    sum += spectralRadiance(l) * bandResponse(l, band);
  }
  return sum * dl;
}

/**
 * Apparent flux of a star in one band, in arbitrary but CONSISTENT units.
 *
 * The star is a blackbody sphere of radius `radiusRsun` at `distancePc`, so the
 * observed flux is B_lambda(Teff) * (R/d)^2 integrated over the filter. Only
 * ratios between stars and between bands are used downstream, so the geometric
 * constant is folded in but no zero-point calibration is applied.
 */
export function bandFlux(
  teffK: number,
  radiusRsun: number,
  distancePc: number,
  band: Passband,
): number {
  if (!(teffK > 0) || !(radiusRsun > 0) || !(distancePc > 0)) return 0;
  const solidAngle = ((radiusRsun * R_SUN_CM) / (distancePc * PC_CM)) ** 2;
  return bandIntegral((l) => planckNm(l, teffK), band) * solidAngle;
}

/**
 * Zero-point reference temperature for colour indices.
 *
 * The Vega system defines an A0V star to have zero colour in every index. Vega
 * is close to A0V at ~9550 K, so anchoring on a blackbody of that temperature
 * reproduces the convention: `colorIndex` returns ~0 for a 9550 K star by
 * construction, and the Sun then lands near its real B-V of ~0.65, which is the
 * check that the band placements are sane.
 */
export const VEGA_TEFF_K = 9550;

/**
 * Colour index (e.g. B-V) in magnitudes, on a Vega-like zero point.
 *
 * m1 - m2 = -2.5 log10(F1/F2) with the same quantity for a 9550 K blackbody
 * subtracted, so an A0V-like star sits at 0 in every index.
 */
export function colorIndex(teffK: number, band1: Passband, band2: Passband): number {
  const ratio = (T: number): number => {
    const f1 = bandIntegral((l) => planckNm(l, T), band1);
    const f2 = bandIntegral((l) => planckNm(l, T), band2);
    return f1 > 0 && f2 > 0 ? -2.5 * Math.log10(f1 / f2) : Number.NaN;
  };
  return ratio(teffK) - ratio(VEGA_TEFF_K);
}

/** A three-band mapping onto RGB — the recipe for a colour composite. */
export interface BandComposite {
  id: string;
  label: string;
  /** Bands assigned to red, green and blue. */
  bands: [red: Passband, green: Passband, blue: Passband];
  note: string;
}

/**
 * Standard composites. Visible is near-true colour; the others are FALSE colour
 * in the ordinary astronomical sense — a real and standard way to show light the
 * eye cannot see, but not what a person would see.
 */
export const BAND_COMPOSITES: BandComposite[] = [
  {
    id: "visible",
    label: "Visible (R/V/B)",
    bands: [PASSBANDS.R!, PASSBANDS.V!, PASSBANDS.B!],
    note: "Red, visual and blue filters mapped to RGB — close to what a colour camera records.",
  },
  {
    id: "nir",
    label: "Near-IR (K/H/J)",
    bands: [PASSBANDS.K!, PASSBANDS.H!, PASSBANDS.J!],
    note: "2MASS K, H and J mapped to RGB. False colour: cool stars dominate here because this is where their light actually is.",
  },
  {
    id: "wide",
    label: "Wide (K/V/U)",
    bands: [PASSBANDS.K!, PASSBANDS.V!, PASSBANDS.U!],
    note: "Near-IR to ultraviolet across the full baseline. False colour, and the most temperature-sensitive of the three.",
  },
];
