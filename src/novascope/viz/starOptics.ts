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

/** Sentinel so the gate can prove the module loads before any real export exists. */
export const STAROPTICS_OK = true;
