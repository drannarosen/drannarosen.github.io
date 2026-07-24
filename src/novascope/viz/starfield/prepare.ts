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
import { coreRadiusPx, computeTiers, DEFAULT_CORE, type TierBoundaries } from "./sizing.ts";

/** Fields of one star in the gravoturb export, in order. */
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
}

export interface StarField {
  count: number;
  /** xyz per star [pc]. */
  position: Float32Array;
  /** Linear RGB per star, peak-normalized. */
  color: Float32Array;
  /** Display signal per star; 1 is white, above 1 is HDR overflow. */
  signal: Float32Array;
  /** Core radius per star [px]. */
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
 * `stars` is the raw export: `count * 6` floats of
 * `[x, y, z, mass, teff, radius]` in `(pc, pc, pc, Msun, K, Rsun)`.
 */
export function prepareStarField(stars: Float32Array, opts: PrepareOptions = {}): StarField {
  const count = Math.floor(stars.length / STAR_STRIDE);
  const band = resolveBand(opts.band);
  const scheme = getScheme(opts.scheme ?? "true");
  const softening = opts.softening ?? DEFAULT_SOFTENING;
  const exposure = opts.exposure ?? 1;
  const percentile = opts.whitePercentile ?? 0.995;

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
    // Core size is driven by flux RELATIVE to white, so the pixel defaults stay
    // meaningful whatever the absolute flux scale is.
    const px = coreRadiusPx((flux[i] ?? 0) / whiteFlux, DEFAULT_CORE);
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
    stats: { whiteFlux, visible, clipping, tierCounts, maxSizePx },
  };
}
