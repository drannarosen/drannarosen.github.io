/*
 * spectral.ts — physical blackbody star colour (single source of truth).
 *
 * Maps effective temperature to the RGB colour a BLACKBODY of that temperature
 * actually appears — the physically-consistent star colour, not a stylized
 * palette. The chromaticity follows the Planckian locus (Kim et al. 2002, the
 * standard CCT -> CIE 1931 xy fit), converted xyY -> XYZ -> linear sRGB (D65)
 * -> gamma. Brightness is carried elsewhere (marker size = bolometric
 * magnitude), so the colour is normalized to constant luminance (max channel =
 * 1): pure chromaticity. Cool stars read amber, ~5800 K near-white, hot stars
 * blue-white — the real, subtle stellar colours rather than saturated ones.
 *
 * Shared by the WebGL star renderer and any 2D star/HR viz so colours never
 * drift. A star's continuum colour is close to its blackbody colour at Teff;
 * line blanketing shifts it slightly, below what this viz resolves.
 */

/** Planckian-locus chromaticity x for a blackbody at T [K] (Kim et al. 2002). */
function planckX(T: number): number {
  const t = 1 / T;
  return T < 4000
    ? -0.2661239e9 * t ** 3 - 0.2343589e6 * t ** 2 + 0.8776956e3 * t + 0.17991
    : -3.0258469e9 * t ** 3 + 2.1070379e6 * t ** 2 + 0.2226347e3 * t + 0.24039;
}

/** Planckian-locus chromaticity y from x, three temperature ranges (Kim et al. 2002). */
function planckY(x: number, T: number): number {
  if (T < 2222) return -1.1063814 * x ** 3 - 1.3481102 * x ** 2 + 2.18555832 * x - 0.20219683;
  if (T < 4000) return -0.9549476 * x ** 3 - 1.37418593 * x ** 2 + 2.09137015 * x - 0.16748867;
  return 3.081758 * x ** 3 - 5.8733867 * x ** 2 + 3.75112997 * x - 0.37001483;
}

const srgbGamma = (c: number): number =>
  c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;

/**
 * Saturation stretch toward the cool-red / hot-blue look of a Hubble RGB
 * composite. The HUE stays the physical blackbody hue (cool stars red, hot
 * stars blue); only the chroma is boosted, exactly as multi-band cluster images
 * are stretched. 1 = true blackbody colour; ~2 reads as the vivid image.
 */
const SATURATION = 2.4;
const saturate = (c: number, lum: number): number =>
  Math.min(1, Math.max(0, lum + (c - lum) * SATURATION));

/**
 * RGB (0–255) for the blackbody colour of a star at effective temperature
 * `teff` [K]. Temperature is clamped to the Planckian-locus fit's validity
 * (1667–25000 K); hotter O/B stars converge to blue-white, so the clamp is
 * imperceptible.
 */
export function spectralRGB(teff: number): [number, number, number] {
  const T = Math.min(25000, Math.max(1667, teff));
  const x = planckX(T);
  const y = planckY(x, T);
  // xyY (Y = 1) -> XYZ
  const X = x / y;
  const Z = (1 - x - y) / y;
  // XYZ -> linear sRGB (D65), then clip negatives (out-of-gamut) to zero
  let r = Math.max(0, 3.2406 * X - 1.5372 - 0.4986 * Z);
  let g = Math.max(0, -0.9689 * X + 1.8758 + 0.0415 * Z);
  let b = Math.max(0, 0.0557 * X - 0.204 + 1.057 * Z);
  // constant-luminance normalize (brightness is encoded by marker size)
  const m = Math.max(r, g, b) || 1;
  r /= m;
  g /= m;
  b /= m;
  // stretch chroma toward the Hubble red/blue look; hue is unchanged
  const lum = 0.3 * r + 0.59 * g + 0.11 * b;
  r = saturate(r, lum);
  g = saturate(g, lum);
  b = saturate(b, lum);
  return [srgbGamma(r) * 255, srgbGamma(g) * 255, srgbGamma(b) * 255];
}
