/*
 * sizing.ts — screen-space policy for a rendered star field (Layer 2).
 *
 * Everything here is measured in PIXELS or is a performance decision, which is
 * exactly why it lives in viz and the physics does not. The maths this consumes
 * — flux, PSF, exposure — is renderer-agnostic and lives in Layer 0
 * (core/photometry, core/optics, core/imaging).
 */

import { robustWhiteFlux } from "../../core/imaging/index.ts";

/** Parameters of the bounded unresolved core, in screen pixels. */
export interface CoreParams {
  /** Radius of a zero-flux star [px]. */
  r0: number;
  /** Growth per e-fold of flux [px]. */
  a: number;
  /** Defensive floor [px]. */
  coreMin: number;
  /** Hard ceiling [px] — the brightest core is still only a few pixels. */
  coreMax: number;
  /** Flux scale for the log1p, in units of the white point. */
  F0: number;
}

/**
 * Defaults sized to the target look: ordinary stars land near 0.7-1.6 px radius
 * and the very brightest core never exceeds 3 px. `F0` is in units of the white
 * flux, so callers pass `F/whiteFlux` and these stay meaningful for any cluster.
 */
export const DEFAULT_CORE: CoreParams = { r0: 0.75, a: 0.35, coreMin: 0.7, coreMax: 3.0, F0: 0.05 };

/**
 * Screen radius of a star's unresolved core [px]:
 *
 *     r = clamp(r0 + a*log1p(F/F0), coreMin, coreMax)
 *
 * Deliberately a WEAK, BOUNDED function of flux, and the single most important
 * property of this renderer. Mapping luminosity onto billboard diameter makes
 * the brightest stars the largest quads precisely where a cluster is densest, so
 * their footprints overlap and sum into one saturated blob — the failure this
 * design replaces. Luminosity belongs on RADIANCE (see `core/imaging`), and
 * should barely touch size: across 6 dex of flux the core here grows by well
 * under a factor of 4 and then stops.
 *
 * It is also the honest shape. These stars are unresolved point sources, so
 * their apparent size is set by the instrument's PSF, not by the star; a
 * brighter star merely looks bigger because more of its PSF wing clears the
 * noise floor, which is a saturating, logarithmic effect.
 */
export function coreRadiusPx(flux: number, p: CoreParams): number {
  const r = p.r0 + p.a * Math.log1p(Math.max(0, flux) / p.F0);
  return Math.min(p.coreMax, Math.max(p.coreMin, r));
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
