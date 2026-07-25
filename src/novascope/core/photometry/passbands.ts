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
 * EVERY BAND IS A MEASURED CURVE (see `./passbandCurves`) — 30 of them, from Johnson
 * U at 362 nm to JWST/MIRI F770W at 7.7 um. There is no Gaussian fallback and no
 * `fwhmNm` field, which is a deliberate deletion rather than an omission.
 *
 * The Gaussians were defended on two grounds: a bell is a reasonable model of a
 * classical broadband filter, and there was no bulk data to ship for UBVRI or 2MASS.
 * The first was always weak — Gaia's G spans 330-1050 nm and is not bell-shaped at
 * all — and the second turned out to be false: `lsst/throughputs` carries measured
 * Johnson, Cousins, 2MASS and SDSS curves alongside the Rubin ones. Keeping both a
 * curve and a nominal FWHM would leave two descriptions of one filter, and the pair
 * that disagrees is the pair that drifts.
 *
 * The one thing lost is a small honesty gain, so it is stated: the Johnson-Cousins
 * curves here are FILTER transmission only, with no telescope, detector or atmosphere,
 * because that is the generic system a synthetic UBVRI colour is defined on. The
 * Rubin, Gaia, SDSS, HST and JWST curves are TOTAL system throughputs. Both are the
 * right choice for their own instrument, but they are not the same kind of number, so
 * a peak transmission is not comparable across the two groups.
 *
 * APPROXIMATION THAT REMAINS, for every band: the source spectrum is a BLACKBODY,
 * and a real star is not one. Line blanketing, the Balmer jump and the molecular
 * bands of cool stars all matter, and none is modelled. So fluxes and colours here
 * are blackbody-derived estimates suitable for RENDERING, not synthetic photometry
 * for science — a real filter curve does not change that, it only removes one of
 * the two approximations.
 *
 * ABSOLUTE MAGNITUDES ARE AVAILABLE, via `abMagnitude` / `absoluteAbMagnitude` on
 * the AB system's defining zero point. That is a change from an earlier state of this
 * module, when fluxes were ratios only — and the thing that had to be fixed to get
 * there was a missing factor of pi in the flux from a sphere (see `spectralFluxCgs`),
 * which cost exactly 1.19 mag and was invisible while nothing but ratios was used.
 *
 * Validated where a reader can check it: the Sun comes out at M_V = 4.86 against a
 * published ~4.83 AB, across the pi, the Jansky conversion, the CGS units and the band
 * average together. Gaia G comes out 4.82 against a real 4.67, and that 0.15 mag IS
 * the blackbody approximation — the discrepancy grows toward cool stars, which is what
 * `bolometricCorrection` quantifies.
 */

import { planckNm, NM_TO_CM } from "../blackbody/index.ts";
import { R_SUN_CM, PC_CM, C_CM_S, AB_ZERO_CGS } from "../constants/index.ts";
import { deriveLogL, bolometricMagnitude } from "./index.ts";
import { TABULATED_CURVES, type TabulatedCurve } from "./passbandCurves.ts";

export interface Passband {
  /** Short standard name. Also the key in `PASSBANDS`. */
  id: string;
  /**
   * Effective wavelength [nm] — the curve's OWN transmission-weighted mean, derived
   * in the importer rather than copied from a published table, so it cannot disagree
   * with the curve beside it.
   *
   * It therefore differs slightly from published values, which are variously photon-
   * or energy-weighted: Rubin u derives to 372.4 against a tabulated 367.0. That
   * ~1.5% gap is a convention difference, not an error, and having one derived
   * definition is worth more here than matching each survey's own convention.
   */
  lambdaEffNm: number;
  /** Which regime it samples — for grouping in a UI. `mir` is JWST/MIRI only. */
  regime: "uv" | "visible" | "nir" | "mir";
  /** The measured response curve. Every band has one. */
  curve: TabulatedCurve;
  /** Human label — "Johnson V", "Rubin r", "JWST F444W". */
  label: string;
}

/**
 * Every band, keyed by id: Johnson UBV, Cousins RI, 2MASS JHKs, SDSS ugriz,
 * Rubin ugrizy, Gaia G/BP/RP, HST F275W/F606W/F814W/F160W and JWST
 * F090W/F200W/F444W/F770W.
 *
 * Derived wholesale from `TABULATED_CURVES` — this module states no band's
 * wavelength, width or shape, because the generated curve module already does and a
 * second statement of the same fact is a second thing to keep true. The classical
 * bands keep their bare ids (`V`, not `Johnson_V`) because those ARE the names.
 */
export const PASSBANDS: Record<string, Passband> = Object.fromEntries(
  Object.values(TABULATED_CURVES).map((c) => [
    c.id,
    {
      id: c.id,
      label: c.label,
      lambdaEffNm: c.lambdaEffNm,
      regime: c.regime,
      curve: c,
    } satisfies Passband,
  ]),
);

/**
 * Filter response at `lambdaNm`, by linear interpolation into the band's curve;
 * 0 outside its grid.
 *
 * NOT normalized to a peak of 1. Most of these curves carry the instrument's own
 * throughput — Rubin's include atmosphere, optics and detector, so they peak near
 * 0.6, and SDSS z near 0.09 — and rescaling would discard real information about how
 * much light each band actually collects. Only ratios are used downstream, so the
 * absolute level is free, but it must be CONSISTENT within a band, which it is.
 */
export function bandResponse(lambdaNm: number, band: Passband): number {
  const c = band.curve;
  const x = (lambdaNm - c.startNm) / c.stepNm;
  if (x < 0 || x > c.values.length - 1) return 0;
  const i = Math.floor(x);
  const f = x - i;
  const a = c.values[i] ?? 0;
  const b = c.values[i + 1] ?? a;
  return a + f * (b - a);
}

/**
 * Integrate a spectral radiance against a band response, over the curve's OWN grid —
 * one term per stored sample.
 *
 * Using a fixed step count instead would undersample a wide band and oversample a
 * narrow one; using the curve's grid means the integration resolution IS the import
 * resolution, which is the thing `check:passbands` gates.
 *
 * Accuracy comes from the import, not from here: each stored value is a bin AVERAGE
 * of the sub-nm source curve, so this sum reproduces the true transmission integral
 * exactly and the flux integral to O(step^2). That is why a band needs only ~10
 * samples across its FWHM to give a good flux, and why the gate's criterion is the
 * integral rather than the shape.
 */
export function bandIntegral(
  spectralRadiance: (lambdaNm: number) => number,
  band: Passband,
): number {
  const c = band.curve;
  let sum = 0;
  for (let i = 0; i < c.values.length; i++) {
    sum += spectralRadiance(c.startNm + i * c.stepNm) * (c.values[i] ?? 0);
  }
  return sum * c.stepNm;
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
  return bandIntegral((l) => spectralFluxCgs(l, teffK, radiusRsun, distancePc), band);
}

/**
 * Spectral flux density at the observer from a blackbody sphere,
 * F_lambda [erg s^-1 cm^-2 cm^-1] — an ABSOLUTE value, not a ratio.
 *
 *     F_lambda = pi * B_lambda(Teff) * (R / d)^2
 *
 * NOTE THE pi. `planckNm` returns a RADIANCE, per steradian; integrating the
 * outward hemisphere of a Lambertian surface gives a factor of pi, and the
 * (R/d)^2 then converts surface flux to flux at the observer.
 *
 * That pi was previously missing. It was harmless while only ratios were used —
 * every flux carried the same factor, so the exposure's white point absorbed it and
 * the rendered image was identical — but it is NOT harmless the moment an absolute
 * magnitude is computed, where it is a fixed 1.19 mag error. It is fixed here rather
 * than at the call site so there is one definition of "the flux from a star".
 */
export function spectralFluxCgs(
  lambdaNm: number,
  teffK: number,
  radiusRsun: number,
  distancePc: number,
): number {
  const dilution = ((radiusRsun * R_SUN_CM) / (distancePc * PC_CM)) ** 2;
  return Math.PI * planckNm(lambdaNm, teffK) * dilution;
}

/**
 * Band-averaged flux density <f_nu> [erg s^-1 cm^-2 Hz^-1], on the PHOTON-COUNTING
 * convention:
 *
 *     <f_nu> = integral(F_lambda * lambda * T dlambda) / (c * integral(T dlambda/lambda))
 *
 * Photon-counting because that is what the detectors these curves describe actually
 * do — Rubin, Gaia, HST and JWST all count photons, and SVO labels the Gaia curves
 * as photon counters explicitly. The classical Bessell UBVRI curves are ENERGY
 * counters and strictly want a different weighting; that difference is small next to
 * the blackbody approximation already in play, and it is recorded here rather than
 * silently ignored.
 */
export function bandFluxDensityCgs(
  teffK: number,
  radiusRsun: number,
  distancePc: number,
  band: Passband,
): number {
  if (!(teffK > 0) || !(radiusRsun > 0) || !(distancePc > 0)) return 0;
  // Both integrals run over the same grid, in CM so the result is CGS.
  const numer = bandIntegral(
    (l) => spectralFluxCgs(l, teffK, radiusRsun, distancePc) * (l * NM_TO_CM),
    band,
  );
  const denom = bandIntegral((l) => 1 / (l * NM_TO_CM), band);
  if (!(denom > 0)) return 0;
  // bandIntegral returns its sum times the grid step in NM, and the same factor
  // appears in both integrals, so it cancels — no nm/cm conversion is needed on it.
  return numer / (C_CM_S * denom);
}

/**
 * Apparent AB magnitude through a band.
 *
 * m_AB = -2.5 log10(<f_nu> / 3631 Jy), the AB system's defining zero point
 * (Oke & Gunn 1983). Returns `Infinity` for a source with no flux, which is the
 * honest answer rather than a NaN.
 *
 * THIS IS A BLACKBODY MAGNITUDE. It is exact given the filter curve and the assumed
 * spectrum, and the spectrum is the weak link: no line blanketing, no Balmer jump, no
 * molecular bands. Expect real disagreement with published photometry for cool stars,
 * which is precisely what a bolometric correction table would quantify.
 */
export function abMagnitude(
  teffK: number,
  radiusRsun: number,
  distancePc: number,
  band: Passband,
): number {
  const f = bandFluxDensityCgs(teffK, radiusRsun, distancePc, band);
  if (!(f > 0)) return Infinity;
  return -2.5 * Math.log10(f / AB_ZERO_CGS);
}

/**
 * ABSOLUTE AB magnitude: the apparent magnitude the star would have at 10 pc.
 *
 * Distance-free by construction, so it is a property of the star alone — which is
 * what makes it the useful teaching quantity. The Sun in Johnson V should land near
 * 4.8; `check:passbands` asserts that, because it is the one number in this module
 * a reader can check from memory.
 */
export function absoluteAbMagnitude(
  teffK: number,
  radiusRsun: number,
  band: Passband,
): number {
  return abMagnitude(teffK, radiusRsun, ABSOLUTE_MAG_DISTANCE_PC, band);
}

/** The 10 pc at which an absolute magnitude is defined. */
export const ABSOLUTE_MAG_DISTANCE_PC = 10;

/**
 * Bolometric correction: BC_X = M_bol - M_X.
 *
 * How much of a star's total output the band MISSES. It is large and strongly
 * temperature-dependent, and it is the number that explains why rendering cool stars
 * at their bolometric luminosity over-brightens them: BC_V runs about -4 for a hot O
 * star (most of the light is in the ultraviolet) through ~-0.1 near the Sun's
 * temperature, to about -2 for an M dwarf (most of the light is in the infrared).
 * Both extremes are ultraviolet or infrared light the V filter never sees, which is
 * why the correction is negative on both sides of a shallow minimum.
 *
 * INDEPENDENT OF RADIUS AND DISTANCE, which is what makes it a property of the
 * spectrum rather than of the star. M_bol carries -5 log R and so does M_X, so both
 * cancel in the difference; the radius below is arbitrary and `check:passbands`
 * asserts the invariance rather than leaving it as a claim in a comment.
 *
 * BLACKBODY-DERIVED, so this is a model BC and not a tabulated empirical one. It
 * reproduces the published values at both ends of the mass range to a few tenths,
 * which is the useful accuracy here and the honest limit of the assumption. A real
 * BC table (Pecaut & Mamajek 2013) folds in line blanketing, the Balmer jump and
 * molecular bands, none of which a Planck function has.
 */
export function bolometricCorrection(teffK: number, band: Passband): number {
  const radiusRsun = 1;
  const mBol = bolometricMagnitude(deriveLogL(teffK, radiusRsun));
  return mBol - absoluteAbMagnitude(teffK, radiusRsun, band);
}

/**
 * Zero-point reference temperature for colour indices.
 *
 * The Vega system defines an A0V star to have zero colour in every index. Vega
 * is close to A0V at ~9550 K, so anchoring on a blackbody of that temperature
 * reproduces the convention: `colorIndex` returns ~0 for a 9550 K star by
 * construction.
 *
 * The Sun then lands at B-V = 0.46 against a real 0.65. That 0.19 mag gap is not a
 * band-placement error, it is LINE BLANKETING: the crowd of metal lines and the Balmer
 * discontinuity depress a real star's B flux, and a Planck function has neither.
 *
 * This docstring previously claimed the Sun landed "near its real B-V of ~0.65", cited
 * as evidence the bands were sanely placed. That was true of the Gaussian V model it
 * was written against, and it was an accident of where the bell sat — the measured V
 * curve gives the correct blackbody answer instead. `check:star-optics` now gates the
 * SIGN and SIZE of the deficit against real dwarf colours, which is a claim that
 * survives changing the filter.
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
