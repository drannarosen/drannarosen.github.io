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
// Canvas-2D hero (Plummer sphere) and gravoturb art renderers (ADR 0013).
export type { ClusterFieldConfig } from "./clusterHero.ts";
export { initClusterField } from "./clusterHero.ts";
export type { ClusterMeta, ClusterData, ClusterArtOptions } from "./clusterArt.ts";
export { loadClusterData, initClusterArt } from "./clusterArt.ts";
