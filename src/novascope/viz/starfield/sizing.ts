/*
 * sizing.ts — screen-space policy for a rendered star field (Layer 2).
 *
 * Everything here is measured in PIXELS or is a performance decision, which is
 * exactly why it lives in viz and the physics does not. The maths this consumes
 * — flux, PSF, exposure — is renderer-agnostic and lives in Layer 0
 * (core/photometry, core/optics, core/imaging).
 */

import { robustWhiteFlux } from "../../core/imaging/index.ts";

/** Parameters of the bounded unresolved core, in CSS pixels. */
export interface CoreParams {
  /** Radius of a just-visible star [px]. */
  coreMin: number;
  /** Radius of a star at display white and above [px]. */
  coreMax: number;
  /** Curve shape: <1 gives faint stars more of the size range. */
  gamma: number;
}

/**
 * Defaults in CSS PIXELS — scaled by devicePixelRatio at preparation, because
 * they are authored against what a reader sees, not the backing store.
 *
 * Sized from the real cluster rather than from a brief, and tuned against its
 * measured signal distribution: at DPR 2 this puts the faint majority near 1.9 px
 * radius (small, but comfortably above a pixel) and the brightest at 7 px —
 * prominent without becoming disks.
 *
 * Two earlier versions failed at opposite ends and are worth recording. Using
 * 0.7-1.6 DEVICE px took a "crisp core" brief literally; at DPR 2 that is under
 * one device pixel, so the profile falls between sample points and the field
 * renders empty. Driving size from log1p(F/F0) then collapsed 90% of stars onto
 * exactly the floor while the top 1% slammed into the ceiling — no gradation,
 * then a few unnatural blobs. `gamma` above 1 is what keeps the faint bulk small:
 * the population is overwhelmingly faint, so a linear ramp makes almost every
 * star mid-sized.
 */
export const DEFAULT_CORE: CoreParams = { coreMin: 0.8, coreMax: 3.5, gamma: 1.6 };

/** Scale a core-parameter set from CSS pixels into device pixels. */
export function scaleCoreParams(p: CoreParams, pixelRatio: number): CoreParams {
  const k = pixelRatio > 0 ? pixelRatio : 1;
  return { coreMin: p.coreMin * k, coreMax: p.coreMax * k, gamma: p.gamma };
}

/**
 * Smallest core, in device pixels, a rasteriser can render without aliasing it
 * away. A profile narrower than a pixel is sampled wherever the pixel centre
 * happens to fall, so most stars land far out on the wing and vanish.
 */
export const MIN_RENDERABLE_PX = 1.0;

/**
 * Brightness compensation for a core widened to `MIN_RENDERABLE_PX`: energy goes
 * as area, so a core spread from r to r_min keeps its integral by scaling its
 * peak by (r/r_min)^2. Returns 1 for cores already at least a pixel — nothing is
 * brightened, only correctly dimmed.
 */
export function subpixelGain(coreRadiusPx: number): number {
  if (!(coreRadiusPx > 0) || coreRadiusPx >= MIN_RENDERABLE_PX) return 1;
  const ratio = coreRadiusPx / MIN_RENDERABLE_PX;
  return ratio * ratio;
}

/**
 * Screen radius of a star's unresolved core [px], from its DISPLAY SIGNAL:
 *
 *     r = coreMin + (coreMax - coreMin) * clamp(signal, 0, 1)^gamma
 *
 * Driven by the signal rather than by raw flux, for a physical reason and a
 * practical one. Physically, an unresolved star's apparent size is set by how
 * far its PSF wing rises above the noise floor — which is exactly what the
 * display signal measures; the star itself is a point at any brightness.
 * Practically, raw flux spans ~9.6 dex in a real cluster, so any direct function
 * of it saturates: the faint 90% pile onto the floor and the bright tail slams
 * into the ceiling, giving a field of identical dots plus a few disks.
 *
 * The signal is already asinh-compressed, so this spreads the population smoothly
 * across the size range while staying BOUNDED and, crucially, still per-star: the
 * signal is a function of that star's own flux, never of its rank.
 *
 * `gamma` below 1 hands more of the range to faint stars, which is where the
 * population actually is.
 */
export function coreRadiusPx(signal: number, p: CoreParams): number {
  const t = Math.min(1, Math.max(0, signal)) ** p.gamma;
  return p.coreMin + (p.coreMax - p.coreMin) * t;
}

/** Percentile boundaries between render tiers. */
export interface TierBoundaries {
  /** Tier 1 -> 2 boundary, a fraction in [0,1]. */
  t2: number;
  /** Tier 2 -> 3 boundary, a fraction in [0,1]. */
  t3: number;
}

export interface TierAssignment {
  /** Per-star tier: 1 (faint field), 2 (bright), 3 (hero). */
  tier: Uint8Array;
  /** The flux values at the boundaries. */
  thresholds: { t2: number; t3: number };
}

/**
 * Split a population into three render tiers by flux percentile.
 *
 *   Tier 1 — the faint majority: compact PSF only, cheapest shader path.
 *   Tier 2 — bright stars: full PSF wing and aureole.
 *   Tier 3 — hero stars (~top 0.5%): diffraction and other expensive optics.
 *
 * The point is to keep the costly path rare. Evaluating diffraction for all
 * 10,301 stars is both slow AND wrong: diffraction is an instrument artifact
 * visible only on genuinely bright sources, so applying it everywhere turns
 * physics into decoration.
 *
 * Assignment is by each star's OWN flux against fixed thresholds, so it is
 * order-independent — a star does not change tier because the array was sorted
 * differently. The thresholds are population percentiles, which is a statement
 * about the exposure (which sources are bright enough to show artifacts) and not
 * a size law: rank must never drive apparent size.
 */
export function computeTiers(fluxes: ArrayLike<number>, b: TierBoundaries): TierAssignment {
  const n = fluxes.length;
  const tier = new Uint8Array(n);
  if (n === 0) return { tier, thresholds: { t2: 0, t3: 0 } };

  const t2 = robustWhiteFlux(fluxes, b.t2);
  const t3 = robustWhiteFlux(fluxes, b.t3);
  for (let i = 0; i < n; i++) {
    const f = fluxes[i] ?? 0;
    tier[i] = f >= t3 ? 3 : f >= t2 ? 2 : 1;
  }
  return { tier, thresholds: { t2, t3 } };
}
