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
 * Defaults in CSS PIXELS — callers scale by devicePixelRatio (see
 * `prepareStarField`), because these are authored against what a reader sees,
 * not against the backing store.
 *
 * An earlier version used 0.7-1.6 px as DEVICE pixels, taken literally from a
 * "crisp unresolved core" brief. On a 1980 px buffer at DPR 2 that is half a
 * device pixel: the profile falls entirely between sample points and the field
 * renders essentially empty, even though the exposure correctly reports ~19% of
 * stars visible. A core has to span a few device pixels before a rasteriser can
 * show it at all, and real stars in real images do too — seeing and optics spread
 * a point source over several pixels.
 *
 * What matters for the original brief is preserved: size stays a WEAK, BOUNDED
 * function of flux (about 4x across 6 dex), so brightness still lives in
 * radiance and the dense core cannot bloom into one saturated blob.
 */
export const DEFAULT_CORE: CoreParams = { r0: 1.6, a: 0.85, coreMin: 1.4, coreMax: 7, F0: 0.05 };

/**
 * Smallest core, in pixels, that a rasteriser can render without aliasing away.
 *
 * A profile narrower than a pixel is sampled at whatever radius the pixel centre
 * happens to sit at, so most stars land far out on the Moffat wing and simply
 * vanish — the field looked nearly empty at a 0.75 px core even though the
 * exposure said 19% of stars were visible. Sub-pixel sources must instead be
 * WIDENED to about a pixel and DIMMED in proportion to the area they gained, so
 * their total energy is preserved rather than their peak.
 */
export const MIN_RENDERABLE_PX = 1.0;

/** Scale a core-parameter set from CSS pixels into device pixels. */
export function scaleCoreParams(p: CoreParams, pixelRatio: number): CoreParams {
  const k = pixelRatio > 0 ? pixelRatio : 1;
  return { r0: p.r0 * k, a: p.a * k, coreMin: p.coreMin * k, coreMax: p.coreMax * k, F0: p.F0 };
}

/**
 * Brightness compensation for a core that had to be widened to
 * `MIN_RENDERABLE_PX`: energy goes as area, so a core spread from r to r_min
 * keeps its integral by scaling its peak by (r/r_min)^2.
 *
 * Returns 1 for cores that are already at least a pixel — most of the field is
 * unaffected, and nothing is brightened, only correctly dimmed.
 */
export function subpixelGain(coreRadiusPx: number): number {
  if (!(coreRadiusPx > 0) || coreRadiusPx >= MIN_RENDERABLE_PX) return 1;
  const ratio = coreRadiusPx / MIN_RENDERABLE_PX;
  return ratio * ratio;
}

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
