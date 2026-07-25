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
 * TWO KINDS OF FILTER LIVE HERE, and the difference is stated rather than blurred:
 *
 *   - Johnson-Cousins UBVRI and 2MASS JHKs are GAUSSIAN models, from each band's
 *     published effective wavelength and FWHM. A defensible approximation of a
 *     classical broadband filter, and no bulk data to ship.
 *   - Rubin/LSST ugrizy and Gaia DR3 G/BP/RP are REAL MEASURED CURVES (see
 *     `./passbandCurves`), because for those a Gaussian is not an approximation but
 *     a different filter — Gaia's G spans ~330-1050 nm and has no bell shape at all.
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
 * Validated where a reader can check it: the Sun comes out at M_V = 4.87 against a
 * published ~4.83 AB, a 0.04 mag agreement across the pi, the Jansky conversion, the
 * CGS units and the band average together. Gaia G comes out 4.82 against a real 4.67,
 * and that 0.15 mag IS the blackbody approximation — the discrepancy grows toward
 * cool stars, which is what a bolometric-correction table would quantify.
 */

import { planckNm, NM_TO_CM } from "../blackbody/index.ts";
import { R_SUN_CM, PC_CM, C_CM_S, AB_ZERO_CGS } from "../constants/index.ts";
import { TABULATED_CURVES, type TabulatedCurve } from "./passbandCurves.ts";

export interface Passband {
  /** Short standard name. */
  id: string;
  /** Effective wavelength [nm]. */
  lambdaEffNm: number;
  /** Full width at half maximum [nm]. Unused when `curve` is present. */
  fwhmNm: number;
  /** Which regime it samples — for grouping in a UI. */
  regime: "uv" | "visible" | "nir";
  /**
   * A REAL measured response curve, when one is available. Present for Rubin and
   * Gaia; absent for Johnson-Cousins and 2MASS, which stay Gaussian.
   *
   * The split is deliberate rather than half-finished. A Gaussian is a defensible
   * model of a classical broadband filter — the header's caveat covers it — but it
   * is not a model of Gaia's G band, which runs ~330-1050 nm and is nothing like a
   * bell. Where an instrument's real curve is available and its shape matters, the
   * curve wins; where a Gaussian is honest and the data would be bulk, it stays.
   */
  curve?: TabulatedCurve;
  /** Human label, when the id is not self-explanatory. */
  label?: string;
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
  /*
   * Rubin/LSST ugrizy and Gaia DR3 G/BP/RP, from REAL tabulated curves — see
   * `./passbandCurves`. `fwhmNm: 0` because these do not use it: the shape comes
   * from the data, and a nominal width here would be a second, disagreeing
   * description of the same filter.
   *
   * Effective wavelengths are the curves' own transmission-weighted means, which
   * reproduce the published values closely — Rubin r derives to 622.1 nm against a
   * published 622.0, Gaia G to 639.0 against ~639. Rubin u derives to 372.4 against
   * a tabulated 367.0; that ~1.5% gap is a convention difference (photon- vs
   * energy-weighted mean), not an error, and it is why the value is derived here
   * rather than copied.
   */
  ...Object.fromEntries(
    Object.values(TABULATED_CURVES).map((c) => [
      c.id,
      {
        id: c.id,
        label: c.label,
        lambdaEffNm: c.lambdaEffNm,
        fwhmNm: 0,
        regime: c.regime,
        curve: c,
      } satisfies Passband,
    ]),
  ),
};

const FWHM_TO_SIGMA = 1 / (2 * Math.sqrt(2 * Math.LN2));

/** Linear interpolation into a tabulated curve; 0 outside its grid. */
function curveResponse(lambdaNm: number, c: TabulatedCurve): number {
  const x = (lambdaNm - c.startNm) / c.stepNm;
  if (x < 0 || x > c.values.length - 1) return 0;
  const i = Math.floor(x);
  const f = x - i;
  const a = c.values[i] ?? 0;
  const b = c.values[i + 1] ?? a;
  return a + f * (b - a);
}

/**
 * Filter response at `lambdaNm`.
 *
 * Tabulated where a real curve exists, Gaussian otherwise. NOT normalized to a
 * peak of 1 in the tabulated case: those curves carry the instrument's own
 * throughput (Rubin's include atmosphere, optics and detector, so they peak well
 * below 1), and rescaling them would discard real information about how much light
 * each band actually collects. Only ratios are used downstream, so the absolute
 * level is free — but it must be CONSISTENT within a band, which it is.
 */
export function bandResponse(lambdaNm: number, band: Passband): number {
  if (band.curve) return curveResponse(lambdaNm, band.curve);
  const sigma = band.fwhmNm * FWHM_TO_SIGMA;
  const t = (lambdaNm - band.lambdaEffNm) / sigma;
  return Math.exp(-0.5 * t * t);
}

/**
 * Integrate a spectral radiance against a band response.
 *
 * The Gaussian path spans +/- 3.5 sigma, where the response has fallen below 2e-3 —
 * far enough that the tails cannot matter, near enough to stay cheap.
 *
 * The tabulated path integrates over the curve's OWN grid, one sample per stored
 * point. Using a fixed step count instead would undersample a wide band and
 * oversample a narrow one, and for Gaia G (147 points over 730 nm) a 64-step
 * integration would miss structure the curve was imported to capture.
 */
export function bandIntegral(
  spectralRadiance: (lambdaNm: number) => number,
  band: Passband,
): number {
  const c = band.curve;
  if (c) {
    let sum = 0;
    for (let i = 0; i < c.values.length; i++) {
      sum += spectralRadiance(c.startNm + i * c.stepNm) * (c.values[i] ?? 0);
    }
    return sum * c.stepNm;
  }
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
