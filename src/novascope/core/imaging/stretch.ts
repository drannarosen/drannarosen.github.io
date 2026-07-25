/*
 * stretch.ts — display transfer curves (Layer 0, pure).
 *
 * Five of them, mirroring `astropy.visualization`'s stretch classes, and `check:stretch`
 * cross-validates every one against astropy itself rather than against my reading of its source.
 *
 * WHY A FAMILY RATHER THAN THE ONE THE RENDERER USES. "Why do astronomers use asinh?" is a
 * question with a visual answer, and this site exists partly to give visual answers. Linear shows
 * only the brightest handful of stars; log blows up near zero and eats the bright end; sqrt is the
 * classical photographic compromise; asinh is linear at the toe and logarithmic at the top, which
 * is the whole reason Lupton chose it. Seeing them side by side is the explanation.
 *
 * DELIBERATELY NOT ASTROPY PARITY. Histogram equalisation, `PowerDist` and `ContrastBias` are
 * absent: they are rarely right for point sources, and each additional curve is another invariant
 * to keep true. This repository's stated failure mode to design against is over-engineering.
 *
 * EVERY CURVE TAKES AND RETURNS [0, 1]. Astropy's stretches are defined on normalized values —
 * the interval is applied first, separately — so a caller divides by its white point before
 * calling and the curves themselves carry no exposure information. That separation is what lets
 * one interval be compared across five curves.
 *
 * `luptonRGB` in `./lupton` is NOT one of these and cannot be. It is a three-channel operation:
 * it computes an intensity from all three bands, stretches THAT, and scales the channels in common
 * mode to preserve hue. These are scalar curves applied per value. Mixing the two into one
 * interface would hide the property that makes Lupton worth having.
 */

/** The scalar stretches available, in the order a UI should offer them. */
export const STRETCH_IDS = ["linear", "sqrt", "asinh", "log", "sinh"] as const;
export type StretchId = (typeof STRETCH_IDS)[number];

/**
 * Softening for `asinh` and `sinh`, matching astropy's `AsinhStretch(a=0.1)` and
 * `SinhStretch(a=0.333)` defaults.
 *
 * These are astropy's, not chosen here, because the point of the module is to agree with it. `a`
 * is where the curve turns over: smaller means a harder toe lift and more faint detail.
 */
export const ASINH_A = 0.1;
/*
 * ONE THIRD, not 0.333. astropy's default is `1/3` and writing the decimal put this curve 3.4e-4
 * off — small enough to look like float noise and 12 orders of magnitude above it. Caught by the
 * cross-validation, which is the entire reason that gate compares against the reference
 * implementation instead of against a plausible transcription.
 */
export const SINH_A = 1 / 3;

/**
 * Apply a stretch to a normalized value.
 *
 * Clamped to [0, 1] on the way in, which is astropy's behaviour with `clip=True` and the only
 * sane one here: a negative value has no display meaning, and above 1 is already white.
 *
 * The formulae are astropy's exactly:
 *
 *     linear  x
 *     sqrt    sqrt(x)
 *     asinh   asinh(x/a) / asinh(1/a)
 *     log     log(a x + 1) / log(a + 1)          with a = 1000
 *     sinh    sinh(x/a) / sinh(1/a)
 *
 * Note `log` uses astropy's `LogStretch(a=1000)` form, which is finite at x = 0 — unlike a naive
 * `log(x)`, which diverges and is what makes hand-rolled log stretches produce black holes where
 * the sky should be.
 */
export function stretch(x: number, id: StretchId): number {
  const v = Math.min(1, Math.max(0, x));
  switch (id) {
    case "linear":
      return v;
    case "sqrt":
      return Math.sqrt(v);
    case "asinh":
      return Math.asinh(v / ASINH_A) / Math.asinh(1 / ASINH_A);
    case "log":
      return Math.log(1000 * v + 1) / Math.log(1001);
    case "sinh":
      return Math.sinh(v / SINH_A) / Math.sinh(1 / SINH_A);
  }
}

/** One-line description of what each curve does to a star field, for a UI to show. */
export const STRETCH_NOTES: Record<StretchId, string> = {
  linear: "No compression. Only the brightest handful of stars show at all — which is the honest baseline, and why astronomers do not use it for clusters.",
  sqrt: "Mild compression, the classical photographic response. Lifts the faint end MORE than asinh does, and the bright end less — the two curves cross at x = 0.131.",
  asinh: "Linear at the faint end, logarithmic at the bright end — so it leaves the faintest values undistorted while still compressing the bright cores. That split is why Lupton chose it. Note it lifts LESS than sqrt below x = 0.131 and more above: the two cross.",
  log: "Aggressive. Reveals the faintest members but compresses the bright stars into a narrow range, so the massive stars stop looking massive.",
  sinh: "The inverse of asinh — it SUPPRESSES faint detail and expands the bright end. Included because seeing the wrong choice is part of understanding the right one.",
};

/**
 * Monotonicity is a property every one of these must have, since a display transfer that is not
 * monotonic would reorder brightnesses — a star could look fainter than a fainter star.
 *
 * Exported rather than asserted only in the gate because a caller adding a curve should be able to
 * check it, and because it documents the requirement in the place a new curve would be written.
 */
export function isMonotonic(id: StretchId, samples = 1000): boolean {
  let prev = -Infinity;
  for (let i = 0; i <= samples; i++) {
    const v = stretch(i / samples, id);
    if (!(v >= prev)) return false;
    prev = v;
  }
  return true;
}

/**
 * Inverse of `stretch` — the normalized input that produces output `y`.
 *
 * All five invert analytically, so this is closed form rather than a search:
 *
 *     linear  y
 *     sqrt    y^2
 *     asinh   a sinh(y asinh(1/a))
 *     log     ((a+1)^y - 1) / a
 *     sinh    a asinh(y sinh(1/a))
 *
 * WHAT IT IS FOR. A renderer has to know the faintest input a curve can still show, because that
 * is what decides how far a star's billboard must reach — the same job `luptonIntensityForOutput`
 * does for the Lupton path. Pass one display level, `1/255`.
 *
 * Closed form matters here for the reason recorded on `softeningForLimit` in `./index`: that
 * function is the same shape, its first version was INVERTED, and it answered a 10-magnitude
 * request with 30.6 magnitudes while looking entirely plausible. A closed form removes the class
 * of bug; `check:stretch` still round-trips it, because algebra can be wrong too.
 */
export function stretchInverse(y: number, id: StretchId): number {
  const v = Math.min(1, Math.max(0, y));
  switch (id) {
    case "linear":
      return v;
    case "sqrt":
      return v * v;
    case "asinh":
      return ASINH_A * Math.sinh(v * Math.asinh(1 / ASINH_A));
    case "log":
      return (1001 ** v - 1) / 1000;
    case "sinh":
      return SINH_A * Math.asinh(v * Math.sinh(1 / SINH_A));
  }
}
