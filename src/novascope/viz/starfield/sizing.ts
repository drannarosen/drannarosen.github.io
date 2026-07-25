/*
 * sizing.ts — screen-space policy for a rendered star field (Layer 2).
 *
 * Everything here is measured in PIXELS or is a performance decision, which is
 * exactly why it lives in viz and the physics does not. The maths this consumes
 * — flux, PSF, exposure — is renderer-agnostic and lives in Layer 0
 * (core/photometry, core/optics, core/imaging).
 */

import { robustWhiteFlux } from "../../core/imaging/index.ts";

/**
 * The instrument's point-spread function width, in CSS pixels.
 *
 * THE SAME FOR EVERY STAR. This is the single most important correction in the
 * renderer: a PSF is a property of the atmosphere and optics, not of the source,
 * so brightness must change a star's PEAK INTENSITY and nothing else. A bright
 * star then looks larger only because more of its wing rises above the display
 * threshold — which is what actually happens in an image.
 *
 * Scaling the profile width with flux instead (an earlier version did) turns
 * bright stars into soft inflated balls with no crisp core, and leaves faint ones
 * as 1-2 px blocks. Verified by rendering the real cluster to a PNG rather than
 * by inspecting percentiles: at 1.3 px a typical star reads as a square block, at
 * 2.2 px it reads as a round point.
 */
export const PSF_WIDTH_PX = 2.2;

/** Moffat beta — wing weight. Lower puts more light in the wings. */
export const PSF_BETA = 3.2;

/**
 * Half-extent of a star's billboard, in CSS pixels.
 *
 * Only the QUAD grows with brightness, so a bright star's wings have somewhere to
 * live. The profile inside it is identical for every star.
 */
export function quadExtentPx(signal: number, hasAureole: boolean): number {
  const s = Math.min(1, Math.max(0, signal));
  return PSF_WIDTH_PX * (3 + 14 * s + (hasAureole ? 10 : 0));
}

/**
 * Smallest core, in device pixels, a rasteriser can render without aliasing it
 * away. A profile narrower than a pixel is sampled wherever the pixel centre
 * happens to fall, so most stars land far out on the wing and vanish.
 */
export const MIN_RENDERABLE_PX = 1.0;

/**
 * Brightness compensation for a profile narrower than a pixel: energy goes as
 * area, so keeping the integral means scaling the peak by (r/r_min)^2. Returns 1
 * at or above a pixel — nothing is brightened, only correctly dimmed.
 */
export function subpixelGain(widthPx: number): number {
  if (!(widthPx > 0) || widthPx >= MIN_RENDERABLE_PX) return 1;
  const ratio = widthPx / MIN_RENDERABLE_PX;
  return ratio * ratio;
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
