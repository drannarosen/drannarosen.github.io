/*
 * starOptics.ts — the pure physics→pixel MATH for the photographic star
 * renderer (novascope/viz).
 *
 * This is the durable, extractable asset: apparent flux, robust asinh exposure,
 * Moffat PSF, faint aureole, flux tiers, and linear blackbody chromaticity. It
 * is DEPENDENCY-FREE — no `three`, no DOM — so:
 *   - the node build gate (scripts/check-star-optics.mjs) can type-strip and run
 *     it and assert its behaviour,
 *   - the Three.js lab harness (src/lib/starlab/) consumes it through the
 *     @novascope/viz/* alias and mirrors it in GLSL, and
 *   - it later ports unchanged into the raw-WebGL2 production renderer
 *     (novascope/viz/webgl) and eventually to TSL/WebGPU.
 *
 * NOT the same as the schematic physics→render-model in
 * src/novascope/state/render.ts (toRenderModel): that maps stars to the shipped
 * explorables' size/alpha; this is a SEPARATE, photographic observed-image
 * pipeline. Keep the two distinct — do not merge or cross-import.
 *
 * Units follow the site convention: solar / log quantities (M☉, R☉, L☉, K),
 * never SI.
 */

import { luminosity } from "../core/stellar/index.ts";

/* ────────────────────────── luminosity → apparent flux ─────────────────────── */

/**
 * Distance to the cluster [pc]. The cluster is rendered as if observed from a
 * single common distance, so every star's apparent flux is set by its own
 * luminosity alone — which is the whole point: size and brightness must be
 * per-star physical quantities, never a population rank.
 *
 * The value only sets an overall scale (exposure is calibrated against a robust
 * percentile of the resulting fluxes, so a different D0 rescales every flux
 * identically and cancels). 400 pc is the order of the Orion Nebula Cluster's
 * distance, which is the honest visual reference for this realization.
 */
export const D0_PC = 400;

/**
 * log10 of a star's bolometric luminosity [Lsun] from its own Teff [K] and
 * radius [Rsun].
 *
 * Delegates to the core Stefan-Boltzmann relation rather than restating
 * L = (Teff/Teff_sun)^4 R^2 — core's `luminosity()` is the ONE definition (it
 * says so beside its inverse), and a second copy here is exactly the kind of
 * duplicated fact that drifts. Three copies of the solar Teff already exist in
 * this repo; this module adds none.
 */
export function deriveLogL(teffK: number, radiusRsun: number): number {
  return Math.log10(luminosity(teffK, radiusRsun));
}

/**
 * Apparent bolometric flux from log10(L/Lsun) and distance [pc].
 *
 * F = L / (4 pi d^2). Constant factors are folded away: only RATIOS of flux
 * matter downstream (the exposure normalizes by a percentile of these values),
 * so carrying 4 pi and the solar luminosity in CGS would buy nothing but a risk
 * of the units drifting from the rest of the pipeline.
 *
 * Chromaticity is deliberately NOT part of this: colour comes from
 * `blackbodyLinearRGB(Teff)` and is multiplied by flux at the last moment, so a
 * star's hue never depends on how bright it is.
 */
export function apparentFlux(logL: number, distancePc: number): number {
  return 10 ** logL / (distancePc * distancePc);
}
