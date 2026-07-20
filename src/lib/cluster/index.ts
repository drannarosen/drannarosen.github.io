/*
 * cluster — shared engine for the /explore cluster explorables.
 *
 * Public surface: load a Scene, create the WebGL engine, optionally attach
 * direct-manipulation controls. Every /explore piece composes these.
 */

export type { Scene, View } from "./scene";
export { loadScene, sceneFromParts } from "./scene";
export type { ClusterEngine, EngineOptions } from "./engine";
export { createEngine, DEFAULT_ZOOM, ZOOM_MIN, ZOOM_MAX } from "./engine";
export { attachInteraction } from "./interaction";
export { spectralRGB } from "./spectral";
export type { Segregator } from "./massSegregation";
export { makeSegregator } from "./massSegregation";
export type { Dynamics, DynamicsInit, DynamicsParams, Diagnostics, Phase } from "./dynamics";
export { createDynamics, RELAX_TCROSS } from "./dynamics";
