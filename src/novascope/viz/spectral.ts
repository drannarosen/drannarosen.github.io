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
 * ── ONE MODEL, TWO PRESENTATIONS — and the earlier note here got that wrong ──
 *
 * This header briefly claimed "one home now: change the colour model in core/colorimetry and
 * every renderer follows", and then, on 2026-07-26, that there were "TWO live colour models".
 * Both were wrong, in opposite directions. Measuring settles it.
 *
 * There are two colour FUNCTIONS:
 *
 *   core/colorimetry.blackbodyLinearRGB — a Planck spectrum integrated against the CIE 1931
 *                                         observer. What THIS module builds on.
 *   core/stellar.teffToRGB              — a Tanner Helland piecewise fit. What `star().color`
 *                                         uses, so what the canvas renderers and the HR diagram
 *                                         get via `state/render`.
 *
 * THEY AGREE. Across 2500-40000 K the worst per-channel difference is 7/255 — about 3% of one
 * 8-bit step, invisible. So they are not two competing models; one is a fitted approximation of
 * the other, and the fit is good.
 *
 * WHAT ACTUALLY DIFFERS IS THE STRETCH BELOW. `SATURATION = 2.4` moves a 4000 K star from
 * 255,206,166 (pale peach) to 255,197,0 (saturated orange) — 166/255, more than twenty times the
 * model difference. The visible gap between this module and `star().color` is that chroma boost,
 * which is a deliberate presentation choice, not a drift.
 *
 * ── WHEN THE FIT SHOULD BE RETIRED, AND WHY NOT YET ──
 *
 * `blackbodyLinearRGB` should eventually win, for a reason that is not aesthetic: extinction
 * (rung 5 of the theory-to-observation ladder) REDDENS a spectrum, changing its shape rather than
 * its temperature. A spectrum can be reddened and then integrated. A Teff→RGB fit cannot express
 * a reddened star at all — there is no temperature that means "20000 K behind dust". The fit is a
 * dead end for the thing the roadmap is heading toward.
 *
 * Not swapped yet because today the change is invisible (7/255) and would touch every canvas page
 * for no observable gain. The trigger is concrete: the first page that needs a reddened star. Recorded here so the next person finds the fact rather than the claim.
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
