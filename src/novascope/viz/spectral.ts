/*
 * spectral.ts — star colour for the 2D/canvas renderers, as 0-255 sRGB.
 *
 * The COLOUR SCIENCE lives in `core/colorimetry` (a spectrum integrated against
 * the CIE 1931 observer, in linear light). This module is the viz-side
 * convenience on top of it: a chroma stretch and the 0-255 encoding those
 * renderers want.
 *
 * It used to carry its own copy of the Kim et al. Planckian-locus fit, its own
 * XYZ->sRGB matrix and its own gamma curve — a third copy of colour maths that
 * already existed in core. The chromaticity is now INTEGRATED rather than fitted,
 * which agrees with the old locus values to <0.001 in CIE (x,y) — below what a
 * star on screen resolves — and, unlike a locus fit, can express a reddened star
 * once extinction lands.
 *
 * ── "ONE HOME NOW" WAS TOO STRONG, AND THIS IS THE CORRECTION ──
 *
 * This header used to claim "one home now: change the colour model in core/colorimetry and every
 * renderer follows." That is FALSE, found while auditing on 2026-07-26. There are still TWO live
 * blackbody colour models:
 *
 *   core/colorimetry.blackbodyLinearRGB  — a Planck spectrum integrated against the CIE 1931
 *                                          observer. What THIS module uses.
 *   core/stellar.teffToRGB               — a Tanner Helland piecewise fit. What `star().color`
 *                                          uses, and therefore what `state/render` hands to the
 *                                          canvas renderers and the HR diagram.
 *
 * So changing core/colorimetry does NOT reach every renderer; it reaches this one. They agree
 * closely enough that nothing looks wrong, which is exactly why the claim survived.
 *
 * Left as two deliberately, for now: switching `star().color` to the integrated model would
 * change the colour of every star on every canvas page at once, which is a visual decision rather
 * than a cleanup. Recorded here so the next person finds the fact rather than the claim.
 *
 * A star's continuum colour is close to its blackbody colour at Teff; line
 * blanketing shifts it slightly, below what this viz resolves.
 */

import { blackbodyLinearRGB, linearToSrgb } from "../core/colorimetry/index.ts";

/**
 * Chroma stretch toward the cool-red / hot-blue look of a Hubble RGB composite.
 * The HUE stays the physical blackbody hue; only the chroma is boosted, exactly
 * as multi-band cluster images are stretched. 1 = true colour; ~2 reads vivid.
 */
const SATURATION = 2.4;

/** Rec. 601 luma — the axis the chroma stretch pushes away from. */
const luma = (c: readonly [number, number, number]): number =>
  0.3 * c[0] + 0.59 * c[1] + 0.11 * c[2];

/**
 * RGB (0-255) for the blackbody colour of a star at effective temperature
 * `teff` [K].
 *
 * Brightness is carried elsewhere (marker size, alpha), so the colour is
 * normalized to constant luminance: pure chromaticity. Cool stars read amber,
 * ~5800 K near-white, hot stars blue-white.
 */
export function spectralRGB(teff: number): [number, number, number] {
  const linear = blackbodyLinearRGB(teff);
  const lum = luma(linear);
  const stretch = (v: number): number =>
    linearToSrgb(Math.min(1, Math.max(0, lum + (v - lum) * SATURATION))) * 255;
  return [stretch(linear[0]), stretch(linear[1]), stretch(linear[2])];
}
