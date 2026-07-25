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
import { M_BOL_SUN } from "../constants/index.ts";

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
 * Bounds for a distance CONTROL, spanning the real range of young clusters.
 *
 * 50 pc is inside the nearest associations; 20 kpc reaches across the Galaxy to the far side of
 * the disc. Named clusters for scale: the Pleiades at 136 pc, the Orion Nebula Cluster at ~400
 * (this module's default), Westerlund 1 at ~4 kpc, NGC 3603 at ~7 kpc.
 *
 * WHAT MOVING IT DOES AND DOES NOT DO, because the honest answer is the teaching point. It does
 * NOT change the exposure or the look: the white point is a percentile of the resulting fluxes,
 * so a different distance rescales every flux identically and cancels — see `D0_PC` above. What
 * it changes is what the image MEANS. Apparent magnitude slides with distance while ABSOLUTE
 * magnitude does not move at all, because one is a property of this view and the other a property
 * of the stars. Having both on screen while the slider moves is the whole lesson.
 *
 * It also changes the depth contrast WITHIN the cluster, which is a genuine visual effect at the
 * near end: a star 5 pc in front of the centre is 20% brighter at 50 pc and 2.5% brighter at 400.
 */
export const DISTANCE_PC_RANGE = { min: 50, max: 20_000 } as const;

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

/**
 * Difference in magnitudes corresponding to a FLUX RATIO: -2.5 log10(ratio).
 *
 * Needs no zero point, which is what makes it the honest way to state how deep an
 * exposure reaches: "this shows stars down to 12 mag below the white point" is
 * exact, where an absolute V limit would require a calibration this package does
 * not have. Returns +Infinity for a ratio of 0.
 */
export function magnitudeDifference(fluxRatio: number): number {
  if (!(fluxRatio > 0)) return Infinity;
  return -2.5 * Math.log10(fluxRatio);
}

/** Inverse of `magnitudeDifference`: the flux ratio for a magnitude difference. */
export function fluxRatioForMagnitudes(deltaMag: number): number {
  return 10 ** (-0.4 * deltaMag);
}

/**
 * Bolometric ABSOLUTE magnitude from log10(L/Lsun).
 *
 * On the IAU 2015 B2 scale, whose zero point is exact by definition — see
 * `L_ZERO_BOL_ERG_S`. This is the one absolute magnitude the package can state
 * without inventing a calibration, so a page reporting "reaches M_bol = 12" is
 * making a checkable claim.
 */
export function bolometricMagnitude(logL: number): number {
  return M_BOL_SUN - 2.5 * logL;
}
