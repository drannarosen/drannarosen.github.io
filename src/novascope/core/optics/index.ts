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

/*
 * ── AREA INTEGRALS ──
 *
 * Each term below sits directly beside the function it integrates, and that placement is
 * the point rather than a convenience.
 *
 * The renderer needs both: the VALUE per fragment, to shade a pixel, and the INTEGRAL over
 * a star's billboard, to know how much light the whole frame receives — which is what
 * calibrates the per-pixel display transfer (see viz/starfield/calibrate). Those are the
 * same physics asked two ways, so a formula changed in one has to change in the other.
 *
 * They were briefly not together. The integrals were written where they were needed, in
 * Layer 2, which put the aureole's algebra in a THIRD place: once here, once restated
 * inside the profile composition, once more in the integral. That is precisely the
 * arrangement that let `amp: 0.06` sit in this file while the shader used `0.012` — the
 * bug recorded on `DEFAULT_AUREOLE` above. One term, one home, value and integral together.
 *
 * All are integrals over a disc of radius `edge` in units of rho, so a consumer working in
 * pixels multiplies by the PSF width squared:
 *
 *     integral over [0, edge] of f(rho) * 2 pi rho drho
 */

/**
 * Area integral of `moffat`.
 *
 *     pi alpha^2 / (beta - 1) * [1 - (1 + (edge/alpha)^2)^(1 - beta)]
 *
 * Exact. Substituting x = rho/alpha turns the integrand into (1 + x^2)^-beta * 2 pi
 * alpha^2 x dx, whose antiderivative is elementary. `beta > 1` is required for the
 * integral to converge at all, which is also what makes a Moffat wing physical — every
 * seeing-limited value is 2.5 to 4.5.
 */
export function moffatIntegral(edge: number, alpha: number, beta: number): number {
  if (!(edge > 0) || !(alpha > 0) || !(beta > 1)) return 0;
  const x2 = (edge / alpha) ** 2;
  return ((Math.PI * alpha * alpha) / (beta - 1)) * (1 - (1 + x2) ** (1 - beta));
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

/**
 * Area integral of `aureole`.
 *
 *     amp * 2 pi scale^2 * [ (U^(2-p) - 1)/(2-p) - (U^(1-p) - 1)/(1-p) ],  U = 1 + edge/scale
 *
 * Exact, by substituting u = 1 + rho/scale so that 2 pi rho drho = 2 pi scale^2 (u - 1) du
 * and the integrand becomes u^(1-p) - u^(-p).
 *
 * `p === 1` and `p === 2` make one of those antiderivative terms logarithmic instead, and
 * are REJECTED rather than special-cased. The shipped aureole uses p = 3 and nothing in
 * this repository comes near either, so a branch for them would be untested code guarding
 * an input that cannot arrive — while the failure it would hide is severe: this integral
 * feeds a display white point, so a silent NaN blanks the entire frame and a silently
 * dropped term dims it. Throwing puts the error at the one place that can produce it.
 */
export function aureoleIntegral(edge: number, p: AureoleParams): number {
  if (!(edge > 0) || !(p.scale > 0) || !(p.p > 0)) return 0;
  if (p.p === 1 || p.p === 2) {
    throw new Error(`aureole exponent p = ${p.p} is singular in the area integral`);
  }
  const U = 1 + edge / p.scale;
  return (
    p.amp *
    2 *
    Math.PI *
    p.scale *
    p.scale *
    ((U ** (2 - p.p) - 1) / (2 - p.p) - (U ** (1 - p.p) - 1) / (1 - p.p))
  );
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

/**
 * Azimuthal mean of the spike's angular term, `max(0, cos(n (theta - angle)))^sharpness`.
 *
 * INDEPENDENT OF BOTH `spikes` AND `angle`, which is not obvious and is the reason this is
 * a function of sharpness alone. Substituting u = n (theta - angle) rescales the integral by
 * 1/n while bringing n periods into range, so the two cancel exactly:
 *
 *     mean = (1 / 2 pi) integral over one lobe of cos(u)^sharpness du
 *          = (1 / 2 pi) integral from -pi/2 to pi/2 of cos(u)^sharpness du
 *
 * A four-vane spider and a six-vane one therefore put the same TOTAL fraction of their
 * light into spikes; only its distribution differs. `check:star-optics` asserts that
 * independence, because it is a property a future "optimisation" could easily break.
 *
 * Computed by quadrature rather than through the closed form
 * `Gamma((s+1)/2) / (2 sqrt(pi) Gamma(s/2 + 1))`, because that needs a log-gamma this
 * package has no other use for. The integrand is smooth and vanishes to all orders at both
 * endpoints for any sharpness above 1, so midpoint sampling converges very fast: 2048
 * points agree with 65536 to better than 1e-14. The gate checks it against the gamma form
 * evaluated independently.
 *
 * At the shipped sharpness of 24 this is 0.0806 — so a spike's peak brightness overstates
 * its contribution to the total light by 12.4x, which is exactly the error an earlier
 * calibration made by integrating the lobe at theta = 0.
 */
export function diffractionAzimuthalMean(sharpness: number): number {
  if (!(sharpness > 0)) return 1;
  const n = 2048;
  let sum = 0;
  for (let i = 0; i < n; i++) {
    // Midpoint over (-pi/2, pi/2), where max(0, cos u) = cos u.
    const u = -Math.PI / 2 + (Math.PI * (i + 0.5)) / n;
    sum += Math.cos(u) ** sharpness;
  }
  return (sum * (Math.PI / n)) / (2 * Math.PI);
}

/**
 * `diffraction` at one radius, averaged over angle.
 *
 * The companion to `diffractionAzimuthalMean` for consumers that need a VALUE rather than an
 * integral — specifically the profile's pedestal, which the shader subtracts at each
 * fragment's own angle. Over a whole disc that subtraction removes the angle-averaged value,
 * not the on-axis one, so a caller integrating the profile needs this and not
 * `diffraction(rho, 0, d)`.
 */
export function diffractionAngleAveraged(rho: number, d: DiffractionParams): number {
  return (
    (d.amp * diffractionAzimuthalMean(d.sharpness)) /
    (1 + Math.max(0, rho) / d.scale) ** d.p
  );
}

/**
 * Area integral of `diffraction`, averaged over angle — the total light a star's spikes
 * put into its billboard.
 *
 * The radial part has the same form as the aureole's, so it is solved the same way; the
 * angular part contributes `diffractionAzimuthalMean` as a scalar factor.
 *
 * That factor is the whole reason this function exists rather than callers reusing
 * `aureoleIntegral` with the spike's numbers. A calibration that omitted it — by evaluating
 * the lobe at its peak and treating that as uniform — overcounted every spike by 12.4x and
 * biased a display white point by a third.
 */
export function diffractionIntegral(edge: number, d: DiffractionParams): number {
  if (!(edge > 0) || !(d.scale > 0) || !(d.p > 0)) return 0;
  if (d.p === 1 || d.p === 2) {
    throw new Error(`diffraction exponent p = ${d.p} is singular in the area integral`);
  }
  const U = 1 + edge / d.scale;
  const radial =
    2 *
    Math.PI *
    d.scale *
    d.scale *
    ((U ** (2 - d.p) - 1) / (2 - d.p) - (U ** (1 - d.p) - 1) / (1 - d.p));
  return d.amp * diffractionAzimuthalMean(d.sharpness) * radial;
}
