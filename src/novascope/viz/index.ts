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
export type { HistogramColors } from "./histogram.ts";
export { renderHistogram } from "./histogram.ts";
