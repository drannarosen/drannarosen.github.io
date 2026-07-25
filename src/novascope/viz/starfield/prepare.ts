/*
 * prepare.ts — turn a raw star export into GPU-ready arrays (Layer 2).
 *
 * The whole physics→pixel path runs HERE, on the CPU, in plain TypeScript: flux,
 * exposure, colour, core size and tier are all constant per star, so none of
 * them needs to be a shader. That is deliberate. It leaves the GPU with only the
 * one thing that genuinely varies across a billboard — the PSF profile — so the
 * un-unit-testable surface is two small functions rather than the entire
 * pipeline, and every colour scheme (including the band composites) works
 * without being ported to TSL.
 *
 * The maths itself lives in Layer 0 and is imported, never restated.
 */

import { deriveLogL, apparentFlux, D0_PC } from "../../core/photometry/index.ts";
import { PASSBANDS, bandFlux, type Passband } from "../../core/photometry/passbands.ts";
import { robustWhiteFlux, asinhResponse, DEFAULT_SOFTENING } from "../../core/imaging/index.ts";
import { getScheme } from "../../core/colorimetry/schemes.ts";
import { computeTiers, quadExtentPx, PSF_WIDTH_PX, type TierBoundaries } from "./sizing.ts";

/**
 * Floats per star in the packed table this module reads, in the order
 * `[x, y, z, mass, teff, radius]`.
 *
 * A neutral struct-of-floats sized for a GPU upload — NOT a file format. Where
 * the rows come from is a scientific choice and lives in `./source`, which is
 * also where the record of why one particular producer is unusable is kept.
 */
export const STAR_STRIDE = 6;

export interface PrepareOptions {
  /** Colour scheme id (see core/colorimetry/schemes). */
  scheme?: string;
  /**
   * Photometric band that sets APPARENT BRIGHTNESS. Omit for bolometric.
   *
   * Using a band is the physically correct choice for an image: a camera records
   * what passes its filter, and only ~16% of a 3200 K star's light reaches the
   * visible band against ~53% of the Sun's. Bolometric is kept selectable
   * because it is the honest "total energy" view, not because it looks right.
   */
  band?: string;
  /** Percentile mapped to display white. */
  whitePercentile?: number;
  /** asinh softening: roughly log10(k) dex of faint detail revealed. */
  softening?: number;
  /** Exposure multiplier. */
  exposure?: number;
  /** Tier percentile boundaries. */
  tiers?: TierBoundaries;
  /** Device pixel ratio — core sizes are authored in CSS px and scaled by it. */
  pixelRatio?: number;
}

export interface StarField {
  count: number;
  /** xyz per star [pc]. */
  position: Float32Array;
  /** Linear RGB per star, peak-normalized. */
  color: Float32Array;
  /** Display signal per star; 1 is white, above 1 is HDR overflow. */
  signal: Float32Array;
  /** Billboard half-extent per star [device px]; the PSF width is fixed. */
  sizePx: Float32Array;
  /** Render tier per star (1, 2 or 3). */
  tier: Uint8Array;
  /** Diagnostics worth showing in a lab readout. */
  stats: {
    whiteFlux: number;
    visible: number;
    clipping: number;
    tierCounts: [number, number, number];
    maxSizePx: number;
    psfWidthPx: number;
  };
}

const DEFAULT_TIERS: TierBoundaries = { t2: 0.9, t3: 0.995 };

/** Resolve a band id, falling back to bolometric when unknown or absent. */
function resolveBand(id: string | undefined): Passband | null {
  if (!id || id === "bolometric") return null;
  return PASSBANDS[id] ?? null;
}

/**
 * Build the GPU arrays for a star field.
 *
 * `stars` is the packed table: `count * STAR_STRIDE` floats of
 * `[x, y, z, mass, teff, radius]` in `(pc, pc, pc, Msun, K, Rsun)`. Build one
 * with `./source`.
 */
export function prepareStarField(stars: Float32Array, opts: PrepareOptions = {}): StarField {
  const count = Math.floor(stars.length / STAR_STRIDE);
  const band = resolveBand(opts.band);
  const scheme = getScheme(opts.scheme ?? "true");
  const softening = opts.softening ?? DEFAULT_SOFTENING;
  const exposure = opts.exposure ?? 1;
  const percentile = opts.whitePercentile ?? 0.995;
  const dpr = opts.pixelRatio ?? 1;

  const position = new Float32Array(count * 3);
  const color = new Float32Array(count * 3);
  const signal = new Float32Array(count);
  const sizePx = new Float32Array(count);
  const flux = new Float64Array(count);

  for (let i = 0; i < count; i++) {
    const o = i * STAR_STRIDE;
    position[i * 3] = stars[o] ?? 0;
    position[i * 3 + 1] = stars[o + 1] ?? 0;
    position[i * 3 + 2] = stars[o + 2] ?? 0;

    const teff = stars[o + 4] ?? 0;
    const radius = stars[o + 5] ?? 0;

    // Brightness: through a filter when one is chosen, else bolometric.
    flux[i] = band
      ? bandFlux(teff, radius, D0_PC, band)
      : apparentFlux(deriveLogL(teff, radius), D0_PC);

    const [r, g, b] = scheme.color(teff);
    color[i * 3] = r;
    color[i * 3 + 1] = g;
    color[i * 3 + 2] = b;
  }

  // Exposure is calibrated ONCE against the population and then held fixed, so
  // the image cannot pump as the camera moves.
  const whiteFlux = robustWhiteFlux(flux, percentile);
  const { tier } = computeTiers(flux, opts.tiers ?? DEFAULT_TIERS);

  let visible = 0;
  let clipping = 0;
  let maxSizePx = 0;
  const tierCounts: [number, number, number] = [0, 0, 0];
  for (let i = 0; i < count; i++) {
    const s = asinhResponse(flux[i] ?? 0, exposure, softening, whiteFlux);
    signal[i] = s;
    if (s > 0.02) visible++;
    if (s > 1) clipping++;
    // Only the BILLBOARD grows with brightness; the PSF inside it is fixed.
    const px = quadExtentPx(s, (tier[i] ?? 1) > 1) * dpr;
    sizePx[i] = px;
    if (px > maxSizePx) maxSizePx = px;
    const t = tier[i] ?? 1;
    tierCounts[t - 1] = (tierCounts[t - 1] ?? 0) + 1;
  }

  return {
    count,
    position,
    color,
    signal,
    sizePx,
    tier,
    stats: { whiteFlux, visible, clipping, tierCounts, maxSizePx, psfWidthPx: PSF_WIDTH_PX * dpr },
  };
}
