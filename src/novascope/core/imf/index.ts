/*
 * core/imf — stellar initial mass functions, filed by law.
 *
 * PURE MATHEMATICS. This module knows how many stars of each mass a law predicts and how to draw
 * one; it does not know where they sit, what colour they are, or how large they render. Sampling a
 * cluster is `core/cluster`; a star's state is `core/stellar.star()`.
 *
 * That boundary is not yet fully held — see the retired block at the bottom, which still exports a
 * second `sampleCluster` returning `sizePx`, `baseOpacity` and `twinkles`. It is kept only until
 * its two consumers (the homepage hero and the /model-path stage) move off it, and is deleted in
 * Task 7 of docs/plans/2026-07-26-novascope-core-consolidation.md. Do not add callers.
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

/* ────────────────────────────────────────────────────────────────────────────
 * RETIRED — everything below this line is deleted in Task 7. It is the legacy
 * cluster sampler: it bypasses the star(M, Z, t) contract, collides by name with
 * `core/cluster.sampleCluster`, and returns canvas pixels from Layer 0.
 * ──────────────────────────────────────────────────────────────────────────── */

import { zamsLuminosity, zamsTeff, teffToRGB } from "../stellar/index.ts";
import { mulberry32 } from "../random/index.ts";
import { buildKroupaSegments, sampleKroupaMass } from "./kroupa.ts";

// teffToRGB is an intrinsic stellar property (core/stellar); re-exported here so
// existing callers (the hero story) keep importing it from @novascope/core/imf.
export { teffToRGB };

/* ── Main-sequence relations ──────────────────────────────────────────
 * Physics-grounded ZAMS properties come from the shared stellar core
 * (src/lib/stellar.ts): Tout et al. (1996), ported from startrax and validated
 * against it (scripts/check-stellar.mjs). Mass is clamped to Tout's valid domain
 * [0.1, 100] M☉ since callers may pass values outside a given cluster's range. */

/** Mass → ZAMS effective temperature (K). */
export function massToTeff(m: number): number {
  return zamsTeff(Math.min(100, Math.max(0.1, m)));
}

/** Mass → ZAMS luminosity (L☉). */
export function massToLuminosity(m: number): number {
  return zamsLuminosity(Math.min(100, Math.max(0.1, m)));
}

/* ── Plummer sphere positions ────────────────────────────────────────
 * Isotropic 3D sample of a Plummer (1911) density profile. Enclosed-mass
 * inversion: for u = M(<r)/M_tot, r = a / sqrt(u^{-2/3} − 1). We keep z for
 * subtle depth (parallax + brightness falloff) when projecting to 2D. */
function samplePlummer(u: number, rng: () => number, a: number): [number, number, number] {
  const r = a / Math.sqrt(Math.pow(Math.max(u, 1e-6), -2 / 3) - 1);
  const cosTheta = 2 * rng() - 1;
  const sinTheta = Math.sqrt(Math.max(0, 1 - cosTheta * cosTheta));
  const phi = 2 * Math.PI * rng();
  return [r * sinTheta * Math.cos(phi), r * sinTheta * Math.sin(phi), r * cosTheta];
}

/* ── Public cluster sampler ──────────────────────────────────────────── */

export interface Star {
  /** Projected position in units of the Plummer scale radius (centered at 0). */
  x: number;
  y: number;
  /** Line-of-sight depth (units of scale radius); used for parallax/brightness. */
  z: number;
  mass: number; // M☉
  teff: number; // K
  color: [number, number, number]; // linear RGB 0..1
  /** Base render radius in logical px, ∝ log luminosity. */
  sizePx: number;
  baseOpacity: number;
  /** Whether this star twinkles (only the brighter ones do). */
  twinkles: boolean;
}

export interface ClusterOptions {
  count: number;
  mMin?: number; // M☉, default 0.1
  mMax?: number; // M☉, default 60
  seed?: number;
  minSizePx?: number;
  maxSizePx?: number;
}

/** Sample a full cluster: masses (Kroupa) → positions (Plummer) → color/size
 * (MS relations). Deterministic for a given seed. */
export function sampleCluster(opts: ClusterOptions): Star[] {
  const { count } = opts;
  const mMin = opts.mMin ?? 0.1;
  const mMax = opts.mMax ?? 60;
  const minSize = opts.minSizePx ?? 0.5;
  const maxSize = opts.maxSizePx ?? 4;
  const rng = mulberry32(opts.seed ?? 20260718);
  const segs = buildKroupaSegments(mMin, mMax);

  const logLmin = Math.log10(massToLuminosity(mMin));
  const logLmax = Math.log10(massToLuminosity(mMax));

  const stars: Star[] = [];
  for (let i = 0; i < count; i++) {
    const mass = sampleKroupaMass(rng(), segs);
    const [x, y, z] = samplePlummer(rng(), rng, 1);
    const teff = massToTeff(mass);
    const color = teffToRGB(teff);

    const logL = Math.log10(massToLuminosity(mass));
    const sizeFrac = (logL - logLmin) / (logLmax - logLmin); // 0..1
    const sizePx = minSize + (maxSize - minSize) * Math.pow(sizeFrac, 0.8);

    stars.push({
      x,
      y,
      z,
      mass,
      teff,
      color,
      sizePx,
      baseOpacity: 0.55 + 0.45 * sizeFrac,
      twinkles: sizeFrac > 0.18,
    });
  }
  // Painter's order: faint/back stars first, bright/front last.
  stars.sort((s1, s2) => s1.sizePx - s2.sizePx);
  return stars;
}
