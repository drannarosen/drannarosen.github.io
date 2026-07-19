/*
 * spectral.ts — Anna's ZAMS spectral palette (single source of truth).
 *
 * Maps effective temperature to an RGB colour, interpolated in log-Teff across
 * the canonical spectral sequence M→O (cool dark-red → white → hot blue-violet).
 * Shared by the WebGL star renderer and any 2D star/HR viz so colours never drift.
 */

const SPEC_LOGT = [2980, 4386, 5586, 6708, 8660, 17320, 40620].map(Math.log10);
const SPEC_RGB: [number, number, number][] = [
  [194, 74, 40], [232, 121, 31], [243, 201, 90], [247, 243, 226],
  [205, 217, 255], [154, 184, 255], [129, 114, 255],
];

/** RGB (0–255) for a ZAMS star of effective temperature `teff` [K]. */
export function spectralRGB(teff: number): [number, number, number] {
  const t = Math.log10(Math.min(55000, Math.max(2400, teff)));
  if (t <= SPEC_LOGT[0]) return SPEC_RGB[0];
  const last = SPEC_LOGT.length - 1;
  if (t >= SPEC_LOGT[last]) return SPEC_RGB[last];
  let i = 0;
  while (i < last && t > SPEC_LOGT[i + 1]) i++;
  const f = (t - SPEC_LOGT[i]) / (SPEC_LOGT[i + 1] - SPEC_LOGT[i]);
  const a = SPEC_RGB[i], b = SPEC_RGB[i + 1];
  return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
}
