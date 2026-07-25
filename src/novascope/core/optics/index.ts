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
 * Default aureole: ~1% of the core peak, broad and fast-falling.
 * Dim and wide is the whole point — see `aureole`.
 *
 * These are the values chosen by rendering the real cluster to a PNG and looking
 * at it, and they are the ONLY home for them: the shader imports this object
 * rather than restating the numbers, because for a while it did restate them and
 * the two disagreed. `amp: 0.06` lived here while the shader used `0.012`, so the
 * CPU reference renderer and the GPU were computing different instruments — which
 * makes "does the GPU match the reference?" unanswerable by construction. At 0.06
 * the aureole stops being a wing and merges with the core into one soft ball.
 */
export const DEFAULT_AUREOLE: AureoleParams = { amp: 0.012, scale: 2.0, p: 3.0 };

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

/** Geometry of a telescope's diffraction spikes. */
export interface DiffractionParams {
  /**
   * Number of spikes. A spider with N straight vanes at equal angles diffracts
   * into N spikes, so 4 is the familiar Newtonian/Hubble cross and 6 is a
   * three-vane spider (each vane spiking both ways).
   */
  spikes: number;
  /** Peak amplitude, as a fraction of the incident flux. */
  amp: number;
  /** Angular sharpness. Larger is a tighter, cleaner spike. */
  sharpness: number;
  /** Radial scale [PSF widths] — how far the spike reaches before falling off. */
  scale: number;
  /** Radial falloff exponent. */
  p: number;
  /** Rotation of the spike pattern [radians]. A property of the mount, not the sky. */
  angle: number;
}

/**
 * Default spider: a four-vane cross, faint and long.
 *
 * `amp` is an order of magnitude below the aureole's on purpose. Diffraction is the
 * most recognisable instrument signature there is, which makes it the easiest thing
 * in this renderer to overdo — a bright cross reads as a lens-flare sticker rather
 * than as optics, and it is the artifact most likely to be mistaken for a claim
 * about the star. It earns its place only on sources bright enough to show it.
 */
export const DEFAULT_DIFFRACTION: DiffractionParams = {
  spikes: 4,
  amp: 1.5e-3,
  sharpness: 24,
  scale: 6,
  p: 1.6,
  angle: 0,
};

/**
 * Diffraction spikes from a straight-vane spider:
 *
 *     spike(rho, theta) = amp * max(0, cos(n (theta - angle)))^sharpness
 *                              / (1 + rho/scale)^p
 *
 * The angular term has exactly `spikes` maxima around the circle, because
 * cos(n phi) peaks wherever n phi is a multiple of 2 pi. Raising it to a high power
 * narrows each lobe into a spike while keeping the whole thing smooth and cheap —
 * which matters because this is evaluated per fragment and the alternative,
 * distance-to-the-nearest-of-N-angles, needs a branch.
 *
 * The radial falloff is SHALLOWER than the aureole's (p ~ 1.6 against 3), which is
 * what makes a spike a spike: it must still be visible where the halo has already
 * faded, or it is just a lumpy halo.
 *
 * `theta` is measured in the image plane, and the pattern is fixed to the
 * INSTRUMENT — the spikes must not rotate when the object does, because a spider is
 * bolted to the telescope. A consumer that rotates the view must therefore leave
 * `angle` alone.
 */
export function diffraction(rho: number, theta: number, d: DiffractionParams): number {
  const lobe = Math.max(0, Math.cos(d.spikes * (theta - d.angle)));
  if (lobe <= 0) return 0;
  return (d.amp * lobe ** d.sharpness) / (1 + Math.max(0, rho) / d.scale) ** d.p;
}
