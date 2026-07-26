/*
 * imaging/index.ts — turning a huge range of fluxes into a viewable image
 * (Layer 0, pure).
 *
 * Display science rather than physics, but it belongs in Layer 0 for the same
 * reason `random` does: the layer's real invariant is "pure, deterministic,
 * dependency-free", and these functions are reusable well beyond any one
 * renderer — any astronomical image, a FITS viewer, a teaching figure about
 * image stretch.
 *
 * Astronomical sources span many decades of brightness, so the choice of
 * stretch and white point IS the image. Both functions here are deliberately
 * independent: the white point decides what CLIPS, the stretch decides how much
 * of the faint end is revealed, and neither should move when the other is tuned.
 */

/** Fallback white point for an empty population, so exposure is never 0 or NaN. */
const WHITE_FLUX_FALLBACK = 1;

/**
 * The flux that maps to display white: a robust high percentile of the
 * population's fluxes.
 *
 * **Never the maximum.** A young cluster spans ~6 dex of luminosity, so
 * normalizing by the single brightest source hands the whole scale to one star:
 * its core saturates and everything else collapses toward black. Measured on the
 * shipped 10,301-star realization, normalizing by the max left 48 stars visible.
 * A percentile lets the brightest few clip — which is what a real exposure does
 * — and returns the range to the population.
 *
 * `p` is a fraction in [0,1]; 0.995 means "the top 0.5% may clip".
 */
export function robustWhiteFlux(fluxes: ArrayLike<number>, p: number): number {
  const n = fluxes.length;
  if (n === 0) return WHITE_FLUX_FALLBACK;
  const sorted = Array.from(fluxes).sort((a, b) => a - b);
  const frac = Math.min(1, Math.max(0, p));
  const idx = Math.min(n - 1, Math.max(0, Math.round(frac * (n - 1))));
  const value = sorted[idx] ?? WHITE_FLUX_FALLBACK;
  return value > 0 ? value : WHITE_FLUX_FALLBACK;
}

/**
 * Default softening `k` — roughly how many dex of faint structure the stretch
 * lifts into view (log10(k) of them).
 *
 * Must be matched to the population's DYNAMIC RANGE, which is the mistake worth
 * recording: at k = 1e4 the median star came out at a display signal of 3.6e-4 —
 * black — leaving 81% of the cluster invisible. k has to reach roughly the flux
 * ratio being compressed. Raising it reveals more of the faint field WITHOUT
 * changing what clips, which stays set by the exposure percentile alone.
 *
 * The value is chosen by looking at renders, not by a formula, because the target
 * is contrast rather than coverage — and past the point where everything is
 * visible, more k only flattens the image. Measured on a 10,000-star sampled
 * cluster in V: every star is already above threshold by k = 3e6, and the display
 * signal then spreads (p10, p50, p90) as
 *
 *     k = 3e7   0.145  0.284  0.611     <- this default: midtones with contrast
 *     k = 1e8   0.198  0.329  0.636     <- faint end lifted, range compressed
 *
 * so raising it further trades separation for brightness. Anything that wants a
 * different default must import THIS constant and not restate a number: the lab
 * page derives its slider position from it for exactly that reason.
 */
export const DEFAULT_SOFTENING = 3e7;

/**
 * Photographic (asinh) transfer from flux to display signal:
 *
 *     signal = asinh(k * exposure * F/whiteFlux) / asinh(k)
 *
 * asinh is linear near zero and logarithmic far from it: faint sources keep
 * their relative differences, so structure stays legible, while the bright tail
 * compresses instead of blowing out. Same reason Lupton et al. (1999) adopted
 * asinh magnitudes for SDSS — and unlike a log stretch it is defined at F = 0,
 * so empty sky needs no epsilon.
 *
 * **Flux is normalized by `whiteFlux` INSIDE the asinh**, which makes `k`
 * dimensionless and the response scale-invariant. The obvious form,
 * `asinh(k*F)/asinh(k*white)`, gives `k` units of 1/flux, so its meaning depends
 * silently on the distance and luminosity units in play. Measured against the
 * real cluster, that form put the linear-regime threshold (F < 1/k) ABOVE the
 * white point, making the stretch effectively linear and leaving 98% of stars
 * invisible even with a correct percentile. In this form the distance scale
 * cancels exactly and `k` means one thing only.
 *
 * `signal = 1` is display white by construction; above 1 is genuine HDR overflow
 * and is what should feed any glare pass, so bloom is earned by flux rather than
 * applied to everything. The denominator omits `exposure` on purpose — raising
 * exposure must brighten the image, so it may not cancel.
 */
export function asinhResponse(flux: number, exposure: number, k: number, whiteFlux: number): number {
  const white = whiteFlux > 0 ? whiteFlux : WHITE_FLUX_FALLBACK;
  const denom = Math.asinh(k);
  if (denom <= 0) return 0;
  return Math.asinh((k * exposure * Math.max(0, flux)) / white) / denom;
}

/**
 * Display signal below which a star is not showing.
 *
 * One home for it. This lived as a bare `0.02` inside the field preparation, which
 * made the image's DEPTH — the single most consequential property of an exposure —
 * a magic number in a loop that nothing could report or invert.
 */
export const VISIBILITY_THRESHOLD = 0.02;

/**
 * The flux (relative to white) that lands exactly on the visibility threshold:
 * the faintest thing this transfer shows.
 *
 * Closed form, by inverting `asinhResponse` at signal = t:
 *
 *     asinh(k x) / asinh(k) = t   =>   x = sinh(t asinh(k)) / k
 *
 * This is what turns `k` from a tuning number into a statement. Feed it through
 * `magnitudeDifference` and the exposure reports how many magnitudes below its
 * white point it reaches, which is checkable; `k = 3e7` is not.
 */
export function limitingFluxRatio(k: number, threshold = VISIBILITY_THRESHOLD): number {
  if (!(k > 0)) return 0;
  return Math.sinh(threshold * Math.asinh(k)) / k;
}

/**
 * How much background a subtraction may remove, as a fraction of the white point.
 *
 * ONE HOME for the bound, because it had two: the schema said `numberField(0, 0.05, …)` and the
 * slider said `max="0.05"`, and nothing compared them. Two copies of a range are two claims that
 * can disagree — the shape of bug this repo has been bitten by repeatedly (see the figure
 * captions, the search page list). Both now import this.
 *
 * ── WHY 20% AND NOT 5% ──
 *
 * The old 5% could not reach the value the frame actually needs. Measured on the shipped
 * population in photometric mode at maximum star reach: the sampled background's 25th percentile
 * sits at 0.20% of white and its MEAN at 6.43% of white — already above the old maximum. A
 * control whose top end is below the measured quantity cannot be used to test the measurement,
 * which is the one thing this page exists for.
 *
 * 20% is roughly three times that mean. Past the mean a subtraction is deliberately
 * over-subtracting — clipping the majority of the frame to black — which is worth being able to
 * demonstrate, and worth not being able to reach by accident.
 */
export const SKY_FRACTION_RANGE = { min: 0, max: 0.2 } as const;

/** Bracket for the softening search: 10 to 1e12 covers every sane exposure. */
const K_MIN = 10;
const K_MAX = 1e12;

/**
 * The softening that makes the exposure reach exactly `target` (a flux ratio
 * relative to white) — the inverse of `limitingFluxRatio`.
 *
 * Bisected rather than solved, because the relation is transcendental in k. It is
 * monotonic (larger k reaches fainter), so bisection is exact to the bracket and
 * has no starting-guess sensitivity. Pure and deterministic, so it is gated in
 * node like everything else here.
 *
 * Clamped to the bracket rather than throwing: a depth request outside what any
 * softening can deliver should saturate at the deepest available exposure, not
 * fail the render.
 */
export function softeningForLimit(target: number, threshold = VISIBILITY_THRESHOLD): number {
  if (!(target > 0)) return K_MAX;
  if (limitingFluxRatio(K_MIN, threshold) <= target) return K_MIN;
  if (limitingFluxRatio(K_MAX, threshold) >= target) return K_MAX;
  let lo = K_MIN;
  let hi = K_MAX;
  /*
   * NOTE THE DIRECTION: `limitingFluxRatio` DECREASES in k — a larger softening
   * reaches fainter, so it returns a smaller ratio. A ratio above the target
   * therefore means this k is too SHALLOW and the answer lies at larger k. Writing
   * the comparison the intuitive way round inverts the search, and it fails
   * silently by returning a bracket end: a 10-mag request came back as k = 1e12
   * (30.6 mag) and a 20-mag request as k = 10 (5.6 mag). Caught by round-tripping
   * depth -> k -> depth, which is now a gate.
   */
  for (let i = 0; i < 100; i++) {
    const mid = Math.sqrt(lo * hi); // geometric — k spans decades
    if (limitingFluxRatio(mid, threshold) > target) lo = mid;
    else hi = mid;
  }
  return Math.sqrt(lo * hi);
}
