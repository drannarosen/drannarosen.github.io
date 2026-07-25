/*
 * sizing.ts — screen-space policy for a rendered star field (Layer 2).
 *
 * Everything here is measured in PIXELS or is a performance decision, which is
 * exactly why it lives in viz and the physics does not. The maths this consumes
 * — flux, PSF, exposure — is renderer-agnostic and lives in Layer 0
 * (core/photometry, core/optics, core/imaging).
 */

import { robustWhiteFlux } from "../../core/imaging/index.ts";
import {
  DEFAULT_AUREOLE,
  type AureoleParams,
  type DiffractionParams,
} from "../../core/optics/index.ts";

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
 * How far the aureole must be allowed to run, in core radii, before it is dim
 * enough to cut off.
 *
 * Solves `amp / (1 + rho/scale)^p = floor` for rho. This is DERIVED rather than
 * chosen because the quad and the wing are coupled through the shader's pedestal
 * subtraction, and getting that wrong is silent: the profile has its value at the
 * quad edge subtracted everywhere, so a wing that is still bright at the edge is
 * not merely clipped — it is subtracted off the whole star, dimming the core and
 * truncating the halo. Widening the aureole while leaving the quad alone therefore
 * cancels most of the change instead of applying it.
 *
 * `floor` is a radiance, so it is compared against a display signal of order 1;
 * 1e-4 is far below one 8-bit step.
 */
export function aureoleExtentRadii(drive: number, a: AureoleParams, floor = 1e-4): number {
  const peak = a.amp * Math.max(0, drive);
  if (!(peak > floor) || !(a.p > 0) || !(a.scale > 0)) return 0;
  return a.scale * ((peak / floor) ** (1 / a.p) - 1);
}

/**
 * Cap on a billboard's half-extent, in CSS pixels.
 *
 * Purely a COST bound, not physics: a scattered-light halo really does run to
 * enormous radius on a very bright source, but the quad is where the shading cost
 * lives. At 240 px the widest star shades ~0.23 Mpx, which is one canvas-sized
 * pass for the handful of stars that reach it.
 */
export const MAX_QUAD_PX = 240;

/**
 * Half-extent of a star's billboard, in CSS pixels.
 *
 * Only the QUAD grows with brightness, so a bright star's wings have somewhere to
 * live. The profile inside it is identical for every star.
 *
 * `halo` is the star's LINEAR flux relative to the display white point — not its
 * compressed display signal — because that is what the aureole is driven by, and
 * the quad has to contain whatever the aureole reaches. It is also what makes the
 * quad cheap where it should be: a median star's halo term is ~1e-6, far below the
 * cutoff, so it gets no wing allowance at all, where the previous tier-gated
 * version handed a fixed +10 core radii to every star above a percentile.
 *
 * The CORE allowance saturates at signal 1 on purpose even though signal may now
 * exceed it: the Moffat's threshold radius grows only as signal^(1/2*beta), so a
 * 10x overflow widens the visible core ~1.4x and 17 core radii still contains it.
 */
export function quadExtentPx(
  signal: number,
  halo: number,
  aureoleParams: AureoleParams = DEFAULT_AUREOLE,
  diffractionParams?: DiffractionParams,
): number {
  const s = Math.min(1, Math.max(0, signal));
  const wing = aureoleExtentRadii(halo, aureoleParams);
  // Spikes reach FURTHER than the halo by construction (a shallower radial
  // exponent), so a quad sized for the halo alone would put the pedestal in the
  // middle of the cross and subtract most of it away. Same coupling, same fix.
  const spike = diffractionParams ? diffractionExtentRadii(halo, diffractionParams) : 0;
  return Math.min(MAX_QUAD_PX, PSF_WIDTH_PX * (3 + 14 * s + Math.max(wing, spike)));
}

/**
 * How far a diffraction spike must be allowed to run, in core radii.
 *
 * Solves `amp * drive / (1 + rho/scale)^p = floor` along a spike's axis, where the
 * angular term is 1. Derived for the same reason as the aureole's extent: the
 * shader subtracts the profile's value at the quad edge from the whole star, so a
 * spike still bright at the edge is cancelled rather than clipped — and a cancelled
 * spike takes a slice out of the core with it.
 */
export function diffractionExtentRadii(
  drive: number,
  d: DiffractionParams,
  floor = 1e-4,
): number {
  const peak = d.amp * Math.max(0, drive);
  if (!(peak > floor) || !(d.p > 0) || !(d.scale > 0)) return 0;
  return d.scale * ((peak / floor) ** (1 / d.p) - 1);
}

/**
 * Smallest core, in device pixels, a rasteriser can render without aliasing it
 * away. A profile narrower than a pixel is sampled wherever the pixel centre
 * happens to fall, so most stars land far out on the wing and vanish.
 *
 * UNREACHABLE AT PRESENT, and deliberately kept. Once the PSF became one fixed
 * width for every star, the only width in play is `PSF_WIDTH_PX` (2.2), which is
 * always above this floor — so `subpixelGain` below can no longer return anything
 * but 1, and nothing in the pipeline calls it. It is retained because it is the
 * correct guard the moment a per-star or resolution-dependent width returns
 * (a coarser device pixel ratio, or a physically resolved disc), and because
 * deleting a tested relation is easy while rediscovering it is not.
 *
 * Read the two assertions on it in `check:star-optics` accordingly: they verify a
 * relation that is currently dormant, not a live safeguard.
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
