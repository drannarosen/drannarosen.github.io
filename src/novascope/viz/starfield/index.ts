/*
 * starfield — screen-space policy for the photographic star renderer (Layer 2).
 *
 * Only pixels and performance live here. The physics it consumes is in Layer 0:
 * core/photometry (apparent flux), core/colorimetry (blackbody chromaticity),
 * core/optics (PSF, aureole) and core/imaging (white point, asinh stretch).
 */
export type { CoreParams, TierBoundaries, TierAssignment } from "./sizing.ts";
export { DEFAULT_CORE, coreRadiusPx, computeTiers } from "./sizing.ts";
