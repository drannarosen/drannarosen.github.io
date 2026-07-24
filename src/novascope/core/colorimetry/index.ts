/*
 * colorimetry/index.ts — temperature to colour, done in the right colour space
 * (Layer 0, pure).
 *
 * Colour science, not rendering: a spectra explorable, an HR diagram, a teaching
 * figure and a GPU star renderer all want a blackbody's chromaticity, and all of
 * them want to know whether they are holding LINEAR light or DISPLAY-encoded
 * values. Conflating those two is the classic colour-management bug, so this
 * module names which is which in every export.
 *
 * Note `core/stellar` also has `teffToRGB`. That is a Tanner Helland fit
 * producing DISPLAY-encoded values, correct for the canvas UI it serves. This
 * module is for linear-light work: an HDR pipeline multiplies radiance by
 * chromaticity, and multiplying gamma-encoded values by a radiance distorts
 * every overlap and every tone-mapped highlight. Two different quantities, not
 * one fact stated twice.
 */

/**
 * Blackbody chromaticity at `teffK`, as **linear-light** sRGB primaries
 * normalized so the largest channel is 1.
 *
 * Planckian locus in CIE 1931 xy (Kim et al. 2002 cubic-spline approximation,
 * valid 1667-25000 K), converted xy -> XYZ -> linear sRGB (IEC 61966-2-1).
 * Inputs outside the fit range are clamped to its endpoints: a 40 kK star is
 * essentially the 25 kK limit, and extrapolating the cubic (which diverges)
 * would buy only artefacts.
 *
 * Max-normalizing is what SEPARATES chromaticity from flux. The caller
 * multiplies by an apparent flux, so hue is fixed by temperature alone and
 * cannot shift as a source brightens; bright cores then approach white through
 * exposure and tone mapping — the physical route — instead of by desaturating
 * the colour itself.
 */
export function blackbodyLinearRGB(teffK: number): [number, number, number] {
  const T = Math.min(25000, Math.max(1667, teffK));
  const t = 1 / T;

  // CIE 1931 x along the Planckian locus (Kim et al. 2002), two branches.
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

  // xyY at unit luminance -> XYZ -> linear sRGB.
  const X = x / y;
  const Z = (1 - x - y) / y;
  const r = 3.2406 * X - 1.5372 - 0.4986 * Z;
  const g = -0.9689 * X + 1.8758 + 0.0415 * Z;
  const b = 0.0557 * X - 0.204 + 1.057 * Z;

  // Clamp out-of-gamut negatives, then normalize the peak to 1.
  const rgb: [number, number, number] = [Math.max(0, r), Math.max(0, g), Math.max(0, b)];
  const peak = Math.max(rgb[0], rgb[1], rgb[2]) || 1;
  return [rgb[0] / peak, rgb[1] / peak, rgb[2] / peak];
}

/**
 * sRGB opto-electronic transfer function: LINEAR light -> DISPLAY-encoded
 * value, both in [0,1]. IEC 61966-2-1.
 *
 * Exported because questions about how a colour LOOKS can only be answered in
 * display space. A 30 kK star is linear red 0.377 — which sounds dim — but
 * encodes to 0.648, a pale blue-white on screen. Asserting "looks white-ish" on
 * linear values would condemn a correct colour, and that misreading is how a
 * linear pipeline gets "fixed" into a gamma-encoded one.
 */
export function linearToSrgb(v: number): number {
  return v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055;
}

/** `linearToSrgb` applied per channel. */
export function linearToSrgbRGB(c: readonly [number, number, number]): [number, number, number] {
  return [linearToSrgb(c[0]), linearToSrgb(c[1]), linearToSrgb(c[2])];
}
