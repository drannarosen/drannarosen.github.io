/*
 * starfield — screen-space policy for the photographic star renderer (Layer 2).
 *
 * Only pixels and performance live here. The physics it consumes is in Layer 0:
 * core/photometry (apparent flux), core/colorimetry (blackbody chromaticity),
 * core/optics (PSF, aureole) and core/imaging (white point, asinh stretch).
 *
 * THIS BARREL STAYS `three`-FREE, and deliberately so. `scene.ts` and
 * `starGraph.ts` are part of this directory but are NOT re-exported here,
 * because the node gates (`check:star-optics`, 151 assertions) import the pure
 * modules and would break the moment a barrel import dragged in `three/webgpu`
 * — which does not load outside a browser. A consumer that wants the renderer
 * asks for it by name: `@novascope/viz/starfield/scene`.
 */
export type { TierBoundaries, TierAssignment } from "./sizing.ts";
export {
  PSF_WIDTH_PX,
  PSF_BETA,
  quadExtentPx,
  subpixelGain,
  computeTiers,
} from "./sizing.ts";
