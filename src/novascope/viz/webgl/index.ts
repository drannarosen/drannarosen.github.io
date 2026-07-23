/*
 * viz/webgl — WebGL volumetric cluster engine: raymarched gas + embedded stars,
 * scene/volume loader, direct-manipulation controls, and relaxation dynamics
 * (ADR 0013). The one rendering backend that can show 3-D turbulent gas
 * structure; the canvas-2D renderers live one level up in viz/.
 */
export type { Scene, View } from "./scene.ts";
export { loadScene, sceneFromParts } from "./scene.ts";
export type { ClusterEngine, EngineOptions } from "./engine.ts";
export { createEngine, DEFAULT_ZOOM, ZOOM_MIN, ZOOM_MAX } from "./engine.ts";
export { attachInteraction } from "./interaction.ts";
export { spectralRGB } from "../spectral.ts";
export type { Segregator } from "./massSegregation.ts";
export { makeSegregator } from "./massSegregation.ts";
export type { Dynamics, DynamicsInit, DynamicsParams, Diagnostics, Phase } from "./dynamics.ts";
export { createDynamics, RELAX_TCROSS } from "./dynamics.ts";
