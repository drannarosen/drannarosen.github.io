/*
 * photometry/index.ts — how bright a source APPEARS (Layer 0, pure).
 *
 * The inverse-square law and its companions: nothing here knows about pixels,
 * GPUs or renderers. A magnitude-limited sample, an HR diagram, a synthetic
 * observation and a star renderer all want the same functions, which is why they
 * are filed by physics domain rather than under the first thing that used them.
 *
 * Units: solar/log for stellar quantities (L/Lsun, log10), pc for distance.
 */

import { luminosity } from "../stellar/index.ts";

/**
 * Reference distance [pc] for rendering a cluster as if observed from one place.
 *
 * A cluster's depth is tiny next to its distance, so treating every member as
 * equidistant makes apparent brightness a function of each star's OWN
 * luminosity — never of its rank within the population, which is the property
 * the star renderer depends on.
 *
 * The value sets an overall scale only: display transfer functions normalize by
 * a percentile of the resulting fluxes, so a different D0 rescales every flux
 * identically and cancels. 400 pc is the order of the Orion Nebula Cluster's
 * distance, the honest visual reference for the shipped realization.
 */
export const D0_PC = 400;

/**
 * log10 of a star's bolometric luminosity [Lsun] from its own Teff [K] and
 * radius [Rsun].
 *
 * Delegates to `core/stellar`'s Stefan-Boltzmann relation rather than restating
 * L = (Teff/Teff_sun)^4 R^2. That relation is defined once, beside its inverse,
 * and a second copy here is exactly the duplicated fact that drifts.
 */
export function deriveLogL(teffK: number, radiusRsun: number): number {
  return Math.log10(luminosity(teffK, radiusRsun));
}

/**
 * Apparent bolometric flux from log10(L/Lsun) and distance [pc]: F = L/(4 pi d^2).
 *
 * Constant factors are folded away — only RATIOS of flux matter downstream, so
 * carrying 4 pi and Lsun in CGS would buy nothing but a chance for the units to
 * drift from the rest of the pipeline. Use `apparentFluxCgs` if an absolute
 * value is ever needed.
 *
 * Chromaticity is deliberately not part of this: colour comes from
 * `core/colorimetry` and is multiplied by flux at the last moment, so a source's
 * hue never depends on how bright it is.
 */
export function apparentFlux(logL: number, distancePc: number): number {
  return 10 ** logL / (distancePc * distancePc);
}

/**
 * Distance modulus m - M = 5 log10(d/10 pc).
 *
 * Not used by the renderer; here because it is the other half of "how bright
 * does this appear", and a photometry module without it is a surprise.
 */
export function distanceModulus(distancePc: number): number {
  return 5 * Math.log10(distancePc / 10);
}

/** Apparent magnitude from absolute magnitude and distance [pc]. */
export function apparentMagnitude(absMag: number, distancePc: number): number {
  return absMag + distanceModulus(distancePc);
}

/** Absolute magnitude from apparent magnitude and distance [pc]. */
export function absoluteMagnitude(appMag: number, distancePc: number): number {
  return appMag - distanceModulus(distancePc);
}
