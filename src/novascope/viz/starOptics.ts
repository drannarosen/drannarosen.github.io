/*
 * starOptics.ts — the pure physics→pixel MATH for the photographic star
 * renderer (novascope/viz).
 *
 * This is the durable, extractable asset: apparent flux, robust asinh exposure,
 * Moffat PSF, faint aureole, flux tiers, and linear blackbody chromaticity. It
 * is DEPENDENCY-FREE — no `three`, no DOM — so:
 *   - the node build gate (scripts/check-star-optics.mjs) can type-strip and run
 *     it and assert its behaviour,
 *   - the Three.js lab harness (src/lib/starlab/) consumes it through the
 *     @novascope/viz/* alias and mirrors it in GLSL, and
 *   - it later ports unchanged into the raw-WebGL2 production renderer
 *     (novascope/viz/webgl) and eventually to TSL/WebGPU.
 *
 * NOT the same as the schematic physics→render-model in
 * src/novascope/state/render.ts (toRenderModel): that maps stars to the shipped
 * explorables' size/alpha; this is a SEPARATE, photographic observed-image
 * pipeline. Keep the two distinct — do not merge or cross-import.
 *
 * Units follow the site convention: solar / log quantities (M☉, R☉, L☉, K),
 * never SI.
 */

import { luminosity } from "../core/stellar/index.ts";

/* ────────────────────────── luminosity → apparent flux ─────────────────────── */

/**
 * Distance to the cluster [pc]. The cluster is rendered as if observed from a
 * single common distance, so every star's apparent flux is set by its own
 * luminosity alone — which is the whole point: size and brightness must be
 * per-star physical quantities, never a population rank.
 *
 * The value only sets an overall scale (exposure is calibrated against a robust
 * percentile of the resulting fluxes, so a different D0 rescales every flux
 * identically and cancels). 400 pc is the order of the Orion Nebula Cluster's
 * distance, which is the honest visual reference for this realization.
 */
export const D0_PC = 400;

/**
 * log10 of a star's bolometric luminosity [Lsun] from its own Teff [K] and
 * radius [Rsun].
 *
 * Delegates to the core Stefan-Boltzmann relation rather than restating
 * L = (Teff/Teff_sun)^4 R^2 — core's `luminosity()` is the ONE definition (it
 * says so beside its inverse), and a second copy here is exactly the kind of
 * duplicated fact that drifts. Three copies of the solar Teff already exist in
 * this repo; this module adds none.
 */
export function deriveLogL(teffK: number, radiusRsun: number): number {
  return Math.log10(luminosity(teffK, radiusRsun));
}

/**
 * Apparent bolometric flux from log10(L/Lsun) and distance [pc].
 *
 * F = L / (4 pi d^2). Constant factors are folded away: only RATIOS of flux
 * matter downstream (the exposure normalizes by a percentile of these values),
 * so carrying 4 pi and the solar luminosity in CGS would buy nothing but a risk
 * of the units drifting from the rest of the pipeline.
 *
 * Chromaticity is deliberately NOT part of this: colour comes from
 * `blackbodyLinearRGB(Teff)` and is multiplied by flux at the last moment, so a
 * star's hue never depends on how bright it is.
 */
export function apparentFlux(logL: number, distancePc: number): number {
  return 10 ** logL / (distancePc * distancePc);
}

/* ─────────────────────────────── chromaticity ──────────────────────────────── */

/**
 * Blackbody chromaticity at temperature `teffK`, as **linear-light** sRGB
 * primaries normalized so the largest channel is 1.
 *
 * Planckian locus in CIE 1931 xy (Kim et al. 2002 cubic-spline approximation,
 * valid 1667–25000 K), converted xy → XYZ → linear sRGB (IEC 61966-2-1 matrix).
 * Inputs outside the fit range are clamped to its endpoints; the colour of a
 * 40 kK star is essentially the 25 kK limit, so extrapolating the cubic — which
 * diverges — would buy nothing but artefacts.
 *
 * WHY NOT `core/stellar`'s `teffToRGB`: that is a Tanner Helland fit producing
 * DISPLAY (gamma-encoded, sRGB) values, which is correct for the canvas UI it
 * serves. This pipeline composites in linear HDR, and multiplying gamma-encoded
 * values by a radiance is the classic colour-management error — it distorts
 * every overlap and every tone-mapped highlight. These are two different
 * quantities (display colour vs linear radiometric chromaticity), not one fact
 * stated twice.
 *
 * Normalizing the max channel to 1 is what SEPARATES chromaticity from flux: the
 * caller multiplies by `apparentFlux`, so a star's hue is fixed by its
 * temperature alone and cannot shift as it brightens. Bright cores then approach
 * white through exposure and tone mapping — the physical route — rather than by
 * desaturating the colour itself.
 */
export function blackbodyLinearRGB(teffK: number): [number, number, number] {
  const T = Math.min(25000, Math.max(1667, teffK));
  const t = 1 / T;

  // CIE 1931 x along the Planckian locus (Kim et al. 2002), two temperature branches.
  const x =
    T < 4000
      ? -0.2661239e9 * t ** 3 - 0.2343589e6 * t ** 2 + 0.8776956e3 * t + 0.17991
      : -3.0258469e9 * t ** 3 + 2.1070379e6 * t ** 2 + 0.2226347e3 * t + 0.24039;
  // y as a cubic in x, three branches.
  const y =
    T < 2222
      ? -1.1063814 * x ** 3 - 1.3481102 * x ** 2 + 2.18555832 * x - 0.20219683
      : T < 4000
        ? -0.9549476 * x ** 3 - 1.37418593 * x ** 2 + 2.09137015 * x - 0.16748867
        : 3.081758 * x ** 3 - 5.8733867 * x ** 2 + 3.75112997 * x - 0.37001483;

  // xyY (at unit luminance) → XYZ → linear sRGB.
  const X = x / y;
  const Z = (1 - x - y) / y;
  const r = 3.2406 * X - 1.5372 - 0.4986 * Z;
  const g = -0.9689 * X + 1.8758 + 0.0415 * Z;
  const b = 0.0557 * X - 0.204 + 1.057 * Z;

  // Clamp negatives (locus colours outside the sRGB gamut) and normalize the peak.
  const rgb: [number, number, number] = [Math.max(0, r), Math.max(0, g), Math.max(0, b)];
  const peak = Math.max(rgb[0], rgb[1], rgb[2]) || 1;
  return [rgb[0] / peak, rgb[1] / peak, rgb[2] / peak];
}

/* ──────────────────────────── exposure & dynamic range ─────────────────────── */

/** Fallback white point for an empty population, so exposure is never 0 or NaN. */
const WHITE_FLUX_FALLBACK = 1;

/**
 * The flux that maps to display white: a robust high percentile of the
 * population's apparent fluxes.
 *
 * **Never the maximum.** A young cluster's luminosity function spans ~6 dex, so
 * normalizing by the single brightest star hands the entire scale to one O star:
 * its core saturates and all 10,000 others collapse toward black. That — not
 * bloom — is the mechanism behind the giant central blob in the legacy renderer.
 * A percentile lets the brightest few clip (which is what a real exposure does)
 * while the bulk of the population keeps the range.
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
 * Default softening `k` — how many dex of faint structure the stretch reveals.
 *
 * Measured on the real gravoturb cluster (10,301 stars spanning 9.6 dex of
 * luminosity): k = 1e4 renders ~14% of the population above a visible threshold,
 * versus 2.8% at k = 8 and 0.5% when normalizing by the brightest star. Raising
 * it reveals more of the faint field (k = 1e5 → ~34%) WITHOUT changing what
 * clips — clipping is set by the exposure percentile alone.
 */
export const DEFAULT_SOFTENING = 1e4;

/**
 * Photographic (asinh) transfer from apparent flux to display signal:
 *
 *     signal = asinh(k · exposure · F/whiteFlux) / asinh(k)
 *
 * asinh is linear near zero and logarithmic far from it, which is exactly the
 * behaviour wanted here: faint stars keep their relative differences (so cluster
 * structure stays legible) while the luminous tail compresses instead of blowing
 * out. Same reason Lupton et al. (1999) adopted asinh magnitudes for SDSS — and
 * unlike a log stretch it is well-defined at F = 0, so empty sky needs no epsilon.
 *
 * **Flux is normalized by `whiteFlux` INSIDE the asinh**, which makes `k`
 * dimensionless and the whole response scale-invariant. Writing it the obvious
 * way — `asinh(k·F)/asinh(k·white)` — gives `k` units of 1/flux, so its meaning
 * silently depends on `D0_PC` and the luminosity units. Measured against the real
 * cluster that form put the linear-regime threshold (F < 1/k) ABOVE white, making
 * the response effectively linear and leaving 98% of stars invisible: the faint
 * end was crushed even though the exposure percentile was correct. In this form
 * `D0_PC` cancels exactly (it scales F and whiteFlux alike), and `k` means one
 * thing only: roughly `log10(k)` dex of faint detail lifted into view.
 *
 * `signal = 1` is display white by construction. Values above 1 are genuine HDR
 * overflow and are what should feed bloom — glare is then earned by flux rather
 * than applied to everything.
 *
 * Note the denominator omits `exposure`: raising exposure must brighten the
 * image, so it may not appear on both sides and cancel.
 */
export function asinhResponse(flux: number, exposure: number, k: number, whiteFlux: number): number {
  const white = whiteFlux > 0 ? whiteFlux : WHITE_FLUX_FALLBACK;
  const denom = Math.asinh(k);
  if (denom <= 0) return 0;
  return Math.asinh((k * exposure * Math.max(0, flux)) / white) / denom;
}
