/*
 * core/imf — stellar initial mass functions, filed by law.
 *
 * PURE MATHEMATICS. This module knows how many stars of each mass a law predicts and how to draw
 * one. It does not know where they sit, what colour they are, or how large they render. Sampling a
 * cluster is `core/cluster`; a star's state is `core/stellar.star()`; turning either into
 * something drawable is `state/render`.
 *
 * ── THAT BOUNDARY WAS NOT ALWAYS HELD ──
 *
 * This module used to export a SECOND `sampleCluster` that returned `sizePx`, `baseOpacity` and
 * `twinkles` — canvas pixels, in Layer 0 — derived Teff through its own clamped wrappers instead
 * of the `star(M, Z, t)` contract that ADR 0012 says nothing may bypass, and collided by name with
 * `core/cluster.sampleCluster`, so `@novascope/core` exported two different functions called the
 * same thing. Its only consumers were the homepage hero and the /model-path stage; both now use
 * `src/lib/hero/sampler.ts`, which is site code and keeps its pixels there.
 *
 * `check:imf-surface` pins the export list below so that cannot come back. A new export here must
 * be a property of a mass function — not a position, a colour, or a pixel.
 */
export type { Segment } from "./kroupa.ts";
export { buildKroupaSegments, sampleKroupaMass, kroupaMassFraction } from "./kroupa.ts";
export type { MaschbergerParams } from "./maschberger.ts";
export {
  MASCHBERGER_MU,
  MASCHBERGER_BETA,
  maschbergerMass,
  maschbergerMassFraction,
} from "./maschberger.ts";
export { alpha3FromEnvironment } from "./environment.ts";
