/*
 * viz (Layer 2) — dumb canvas renderers over the selectors' render models.
 * No physics; they import only render-model types (down into state).
 */
export type { CanvasHandle, DrawFn } from "./lifecycle.ts";
export { mountCanvas, rgb } from "./lifecycle.ts";
export type { Camera, Projected } from "./camera.ts";
export { makeCamera, project, attachOrbit } from "./camera.ts";
export type { ClusterFieldOpts } from "./clusterField.ts";
export { renderClusterField, pickStar } from "./clusterField.ts";
export type { HRColors, HROpts } from "./hrDiagram.ts";
export { renderHR, pickHRPoint } from "./hrDiagram.ts";
export type { HistogramColors, IMFForm } from "./histogram.ts";
export { renderHistogram } from "./histogram.ts";
// WebGL volumetric cluster engine (Layer-2 backend; ADR 0013).
export * from "./webgl/index.ts";
/*
 * The gravoturb art renderer (ADR 0013).
 *
 * The canvas-2D HERO renderer used to be exported here too. It moved to `src/lib/hero/` — it is a
 * specific composition for one homepage, not a general capability, and keeping it in the package
 * meant Layer 0 had to keep a sampler that returned canvas pixels.
 *
 * NOTE the name collision it left behind, because it has caught people out: `./clusterField.ts`
 * below exports `renderClusterField` and is a DIFFERENT module — a dumb renderer over a
 * `RenderModel`. The hero's `initClusterField` is the one that left.
 */
export type { ClusterMeta, ClusterData, ClusterArtOptions } from "./clusterArt.ts";
export { loadClusterData, initClusterArt } from "./clusterArt.ts";
