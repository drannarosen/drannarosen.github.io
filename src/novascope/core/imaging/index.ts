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
 * Measured on the shipped realization (10,301 stars, 9.6 dex): k = 1e4 renders
 * ~14% of the population above a visible threshold, against 2.8% at k = 8 and
 * 0.5% when normalizing by the brightest star. Raising it reveals more faint
 * field (k = 1e5 -> ~34%) WITHOUT changing what clips.
 */
export const DEFAULT_SOFTENING = 1e4;

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
