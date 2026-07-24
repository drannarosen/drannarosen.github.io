/*
 * optics/index.ts — the instrument's point-spread function and scattered light
 * (Layer 0, pure).
 *
 * How a POINT source is smeared by the atmosphere and the telescope. This is
 * instrument physics, not renderer code: a seeing demonstration, a synthetic
 * observation, a future `observe()` ladder (ADR 0012 §4) and a GPU star field
 * all want the same profiles. Radii are normalized (dimensionless rho), so
 * nothing here commits to pixels.
 */

/**
 * Moffat (1969) PSF, normalized to 1 on axis:
 *
 *     psf(rho) = (1 + (rho/alpha)^2)^(-beta)
 *
 * Preferred over a Gaussian because real seeing and optics put far more light
 * into the wings than a Gaussian permits — a Gaussian falls off so fast that the
 * faint halo around a bright star has to be faked with post-processing glare.
 * Here the halo comes from the PROFILE, which is why the stars stay convincing
 * with bloom switched off.
 *
 * `alpha` sets the core width, `beta` the wing weight: smaller beta = heavier
 * wings, and beta -> infinity approaches a Gaussian. Typical seeing-limited
 * values are beta ~ 2.5-4.5.
 */
export function moffat(rho: number, alpha: number, beta: number): number {
  const x = rho / alpha;
  return (1 + x * x) ** -beta;
}

/** Parameters of the broad, faint scattered-light aureole. */
export interface AureoleParams {
  /** Peak amplitude, as a fraction of the core's on-axis 1. */
  amp: number;
  /** Angular scale — large, so the wing is broad. */
  scale: number;
  /** Falloff exponent. */
  p: number;
}

/**
 * Default aureole: 6% of the core peak, broad and slow.
 * Dim and wide is the whole point — see `aureole`.
 */
export const DEFAULT_AUREOLE: AureoleParams = { amp: 0.06, scale: 2.5, p: 2.5 };

/**
 * Broad faint aureole — scattered light in the atmosphere and optics:
 *
 *     aureole(rho) = amp / (1 + rho/scale)^p
 *
 * Falls off far more slowly than the PSF by construction, which is what makes it
 * a WING rather than a second core. It must stay dim and wide: too much
 * amplitude or too small a scale turns it into an opaque coloured disk, and many
 * overlapping disks are what build a bright pedestal under a dense cluster core
 * instead of a field of distinct stars.
 */
export function aureole(rho: number, p: AureoleParams): number {
  return p.amp / (1 + Math.max(0, rho) / p.scale) ** p.p;
}
