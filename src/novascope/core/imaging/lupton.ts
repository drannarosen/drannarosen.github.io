/*
 * lupton.ts — three band fluxes to a display pixel, the Lupton way (Layer 0, pure).
 *
 * Lupton et al. (2004) PASP 116, 133. Mirrors `astropy.visualization.make_lupton_rgb`,
 * and `check:lupton` cross-validates every value here against astropy 7.2 itself rather
 * than against my reading of its source.
 *
 * WHY THIS RATHER THAN WHAT WAS HERE. The renderer decided colour and brightness
 * SEPARATELY: hue came from a temperature ramp or a normalized band triple, brightness
 * came from an asinh stretch of ONE band's flux. Two unrelated decisions about the same
 * pixel, with two consequences.
 *
 *   - A saturated star washed out toward white, because the channels clipped
 *     independently. Real colour images of clusters do not do that, and the reason is
 *     this algorithm.
 *   - Choosing a filter changed the brightness but never the colour, so a mid-infrared
 *     view and a near-ultraviolet view of the same cluster came out the same hue.
 *
 * The fix is the whole point of Lupton's paper: compress the INTENSITY, then scale all
 * three channels by that one factor. Hue is then a property of the flux ratios and
 * survives both the stretch and the clip:
 *
 *     I      = (r + g + b) / 3
 *     f(I)   = asinh(I * Q / stretch) * slope,   slope = frac / asinh(frac * Q)
 *     scale  = f(I) / I
 *     rgb    = [r, g, b] * scale
 *     if max(rgb) > 1: rgb *= 1 / max(rgb)
 *
 * Both the stretch and the final clamp are COMMON-MODE. That is the entire trick, and
 * it is why an O star stays blue at the centre of a saturated core.
 *
 * `frac = 0.1` is astropy's, not a free parameter: it fixes the slope so f(I) has a
 * sensible gradient in the linear regime. Reproduced exactly because the point of this
 * module is to agree with the reference implementation, and a "tidier" normalization
 * would silently stop matching it.
 *
 * ONE HONEST DIFFERENCE FROM ASTROPY, stated because it is easy to miss: astropy maps
 * to uint8 [0, 255], this returns floats in [0, 1]. The arithmetic is identical up to
 * that factor; the gate divides astropy's output by 255 before comparing, and asserts
 * agreement to better than half a least-significant bit.
 */

/**
 * The asinh softening index, Q in the paper.
 *
 * Larger Q reveals more faint structure. 8 is astropy's default and Lupton's own
 * working value for SDSS colour images. Q = 0 would be a linear stretch, which astropy
 * silently converts to 0.1 rather than dividing by zero — mirrored in `luptonSlope`.
 */
export const LUPTON_Q = 8;

/** The gradient-anchoring fraction. Astropy's, and not a tuning knob — see the header. */
const LUPTON_FRAC = 0.1;

/** Astropy clamps Q into this range before use; reproduced so edge cases match. */
const Q_EPSILON = 1 / 2 ** 23;
const Q_MAX = 1e10;

/** Astropy's Q sanitization, verbatim in behaviour: tiny Q becomes 0.1, huge Q clamps. */
export function luptonQ(q: number): number {
  if (Math.abs(q) < Q_EPSILON) return 0.1;
  return q > Q_MAX ? Q_MAX : q;
}

/**
 * The stretch's slope coefficient, `frac / asinh(frac * Q)`.
 *
 * Separated out because both the scalar path here and the TSL mirror in the render
 * pipeline need it, and a second literal would be a second thing to keep equal to
 * astropy.
 */
export function luptonSlope(q = LUPTON_Q): number {
  const Q = luptonQ(q);
  return LUPTON_FRAC / Math.asinh(LUPTON_FRAC * Q);
}

/**
 * The stretched intensity f(I).
 *
 * Note `soften = Q / stretch`: `stretch` sets the intensity that lands in the middle of
 * the curve, so it is the exposure-like control, while Q sets how hard the toe lifts.
 * They are not interchangeable and the page must not present them as one slider.
 */
export function luptonStretchedIntensity(
  intensity: number,
  stretch: number,
  q = LUPTON_Q,
): number {
  const Q = luptonQ(q);
  return Math.asinh((intensity * Q) / stretch) * luptonSlope(q);
}

/** Lupton's naive intensity: the unweighted mean of the three channels. */
export function luptonIntensity(r: number, g: number, b: number): number {
  return (r + g + b) / 3;
}

/**
 * The intensity whose stretched output equals `target` — the exact inverse of
 * `luptonStretchedIntensity`.
 *
 *     f(I) = asinh(I Q / stretch) * slope = t   =>   I = (stretch / Q) sinh(t / slope)
 *
 * Closed form, so there is no bisection to get backwards. That matters: this replaces
 * `limitingFluxRatio`'s role for the Lupton path, and `softeningForLimit` — the same
 * shape of function — shipped INVERTED the first time and answered a 10-magnitude
 * request with 30.6. A closed form removes the class of bug rather than gating it.
 *
 * TWO THINGS THIS IS FOR, both of which the renderer previously derived from
 * `asinhResponse` and can no longer:
 *
 *   - The faintest flux a pixel can show, so a star's billboard can be sized to hold
 *     exactly the part of its PSF that will be visible. Pass one display level,
 *     `target = 1/255`.
 *   - The depth readout in magnitudes, which is `-2.5 log10` of the ratio between this
 *     and the intensity that reaches display white.
 *
 * Ignores the common-mode clamp, which only engages above 1 and so cannot affect a
 * threshold query. Gated both ways by `check:lupton`.
 */
export function luptonIntensityForOutput(
  target: number,
  stretch: number,
  q = LUPTON_Q,
): number {
  const Q = luptonQ(q);
  return (stretch / Q) * Math.sinh(target / luptonSlope(q));
}

/** One 8-bit display level — the faintest thing a pixel can show and still not be black. */
export const ONE_DISPLAY_LEVEL = 1 / 255;

/**
 * How many MAGNITUDES the display curve spans, from one 8-bit level up to white.
 *
 * The Lupton equivalent of the depth this renderer already reports for its asinh path,
 * kept in the same units so the two are comparable rather than being two unnameable
 * quantities. The current asinh default (k = 3e7) is 19.78 mag; Q = 8, astropy's
 * default, is only 11.06.
 *
 * INDEPENDENT OF `stretch`, which is not obvious and is worth stating: `stretch` is a
 * pure scale on intensity, so it moves both ends of the ratio equally and cancels. Depth
 * is set by Q alone. That makes them genuinely orthogonal controls — Q chooses how much
 * dynamic range the curve holds, `stretch` chooses which flux sits in the middle of it —
 * and a UI must not present them as one slider. Gated.
 */
export function luptonDepthMag(q = LUPTON_Q, stretch = 5): number {
  const faint = luptonIntensityForOutput(ONE_DISPLAY_LEVEL, stretch, q);
  const white = luptonIntensityForOutput(1, stretch, q);
  return -2.5 * Math.log10(faint / white);
}

/** Bisection bracket for the inverse below. Q outside this is not a useful display. */
const Q_SEARCH_MIN = 0.1;
const Q_SEARCH_MAX = 1e10;

/**
 * The softening Q that gives a requested depth in magnitudes — the inverse of
 * `luptonDepthMag`.
 *
 * Bisected rather than solved, because `slope = frac / asinh(frac Q)` appears inside a
 * `sinh` and the composition does not invert in closed form. Depth is strictly
 * increasing in Q over the whole bracket, which `check:lupton` verifies before relying
 * on it — the same precaution as `massForMagnitudeLimit`, and for the same reason: a
 * bisection on a non-monotonic function returns a confident wrong answer.
 *
 * This is what lets a page keep asking for "19.8 magnitudes of depth" after the display
 * transfer changes underneath it. The depth is the physical statement; Q is the
 * parameter that happens to deliver it, and the page should never have to name Q.
 */
export function luptonQForDepth(depthMag: number): number {
  if (!(depthMag > 0)) return Q_SEARCH_MIN;
  if (luptonDepthMag(Q_SEARCH_MIN) >= depthMag) return Q_SEARCH_MIN;
  if (luptonDepthMag(Q_SEARCH_MAX) <= depthMag) return Q_SEARCH_MAX;
  let lo = Math.log(Q_SEARCH_MIN);
  let hi = Math.log(Q_SEARCH_MAX);
  for (let i = 0; i < 80; i++) {
    const mid = 0.5 * (lo + hi);
    if (luptonDepthMag(Math.exp(mid)) < depthMag) lo = mid;
    else hi = mid;
  }
  return Math.exp(0.5 * (lo + hi));
}

export interface LuptonOptions {
  /** Intensity landing in the middle of the asinh curve. The exposure-like control. */
  stretch?: number;
  /** Softening index. Larger lifts faint structure harder. */
  q?: number;
  /** Per-channel value mapped to black, subtracted before anything else. */
  minimum?: readonly [number, number, number] | number;
}

/**
 * Map one pixel's three band fluxes to display RGB in [0, 1].
 *
 * Returns black for a non-positive intensity rather than a NaN — astropy takes the same
 * branch (`np.where(Int <= 0, 0, ...)`), and it matters here because the sky between
 * stars is exactly zero.
 *
 * Channels are clipped up to 0 INDIVIDUALLY after scaling, because a per-band minimum
 * subtraction can push one band negative while the mean intensity stays positive. Then
 * the over-range clamp is applied in COMMON MODE. Doing those two in the other order
 * would desaturate bright pixels, which is the bug this algorithm exists to avoid.
 */
export function luptonRGB(
  r: number,
  g: number,
  b: number,
  opts: LuptonOptions = {},
): [number, number, number] {
  const stretch = opts.stretch ?? 5;
  const q = opts.q ?? LUPTON_Q;
  const min = opts.minimum ?? 0;
  const [mr, mg, mb] = typeof min === "number" ? [min, min, min] : min;

  const cr = r - mr;
  const cg = g - mg;
  const cb = b - mb;

  const intensity = luptonIntensity(cr, cg, cb);
  if (!(intensity > 0)) return [0, 0, 0];

  const scale = luptonStretchedIntensity(intensity, stretch, q) / intensity;
  let or_ = Math.max(0, cr * scale);
  let og = Math.max(0, cg * scale);
  let ob = Math.max(0, cb * scale);

  const peak = Math.max(or_, og, ob);
  if (peak > 1) {
    or_ /= peak;
    og /= peak;
    ob /= peak;
  }
  return [or_, og, ob];
}
