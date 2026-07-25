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
import { unitLuminanceChroma } from "../../core/colorimetry/index.ts";
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
  /**
   * LINEAR flux relative to the display white point, times exposure. Unbounded.
   *
   * What drives the scattered-light halo, and the reason it is a separate channel
   * from `signal`. Scattered light is a fixed fraction of the flux that actually
   * entered the instrument, so the halo belongs to the physics, while `signal` has
   * already been through the asinh transfer for DISPLAY. Driving the halo off
   * `signal` — as it was — made the halo inherit the compression, and that is what
   * flattened apparent size: measured across this population, `signal` spans a
   * factor of 3.1 from median to brightest while this spans 9.6e6 (7.0 dex). The
   * halo's threshold radius goes as drive^(1/p), so 7 dex gives ~90x of extent to
   * work with where the compressed signal gave 1.5x.
   */
  halo: Float32Array;
  /** Billboard half-extent per star [device px]; the PSF width is fixed. */
  sizePx: Float32Array;
  /** Render tier per star (1, 2 or 3). */
  tier: Uint8Array;
  /** Diagnostics worth showing in a lab readout. */
  stats: {
    whiteFlux: number;
    /**
     * Stars whose display signal clears the visibility threshold.
     *
     * A property of the TRANSFER, not of the frame: a star far out in the
     * profile's tail counts here while being off-screen, so this is "above
     * threshold" and must not be reported as "visible on screen".
     */
    visible: number;
    clipping: number;
    tierCounts: [number, number, number];
    maxSizePx: number;
    psfWidthPx: number;
  };
}

const DEFAULT_TIERS: TierBoundaries = { t2: 0.9, t3: 0.995 };

/**
 * Closest a star may be placed to the observer [pc].
 *
 * Only a guard against a divide-by-zero from an unbounded profile tail — a
 * Plummer sphere formally reaches any radius — not a physical horizon. Far below
 * any real cluster depth, so it never binds on a sane population.
 */
const MIN_DISTANCE_PC = 1;

/**
 * Population fraction mapped to display white.
 *
 * Kept HIGH, against the intuition that letting more stars overflow would give the
 * bright end more range to vary size with. Measured on a 10,000-star cluster, the
 * ratio of the brightest signal to the median — which is what apparent size keys
 * on — moves the WRONG way as the percentile drops:
 *
 *     0.995   max/p50 = 3.1      0.95   max/p50 = 2.2
 *     0.99    max/p50 = 2.9      0.90   max/p50 = 1.9
 *
 * because lowering the white point raises every signal, and asinh compresses
 * harder the larger its argument. So a lower percentile brightens the image and
 * FLATTENS it. The bright-end range has to come from somewhere the transfer has
 * not already compressed — which is why the halo is driven by linear flux instead
 * (see `halo` in StarField).
 */
const DEFAULT_WHITE_PERCENTILE = 0.995;

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
  const percentile = opts.whitePercentile ?? DEFAULT_WHITE_PERCENTILE;
  const dpr = opts.pixelRatio ?? 1;

  const position = new Float32Array(count * 3);
  const color = new Float32Array(count * 3);
  const signal = new Float32Array(count);
  const halo = new Float32Array(count);
  const sizePx = new Float32Array(count);
  const flux = new Float64Array(count);

  for (let i = 0; i < count; i++) {
    const o = i * STAR_STRIDE;
    position[i * 3] = stars[o] ?? 0;
    position[i * 3 + 1] = stars[o + 1] ?? 0;
    position[i * 3 + 2] = stars[o + 2] ?? 0;

    const teff = stars[o + 4] ?? 0;
    const radius = stars[o + 5] ?? 0;

    /*
     * Each star at its OWN distance, so the inverse-square law applies within the
     * cluster and near stars really are brighter than far ones.
     *
     * The depth is the star's z in the CLUSTER's frame, not along the interactive
     * camera's axis, and that is the whole point. A cluster 400 pc away cannot be
     * orbited; the observer's line of sight is fixed at the moment of exposure.
     * Deriving depth from the live camera instead would make every star's
     * brightness change as the view rotates — the "pumping" the exposure
     * calibration exists to prevent. So orbiting turns the MODEL, not the
     * telescope, and the photometry stays put.
     *
     * Clamped away from the observer: a sampled profile has an unbounded tail, and
     * a star drawn past z = D0 would otherwise divide by a zero or negative
     * distance and return an infinite flux that captures the white point.
     */
    const dPc = Math.max(MIN_DISTANCE_PC, D0_PC - (stars[o + 2] ?? 0));

    // Brightness: through a filter when one is chosen, else bolometric.
    flux[i] = band
      ? bandFlux(teff, radius, dPc, band)
      : apparentFlux(deriveLogL(teff, radius), dPc);

    /*
     * Colour is rescaled to UNIT LUMINANCE, so the display signal alone sets how
     * bright a star reads. The scheme still owns the hue; only its scale changes.
     * Left peak-normalized, a star's luminance also depended on its temperature
     * (0.90 at 5772 K against 0.48 at 45000 K), which cancelled the brightness
     * ordering — see `unitLuminanceChroma`.
     */
    const [r, g, b] = unitLuminanceChroma(scheme.color(teff));
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
    /*
     * The halo drive: linear flux relative to white, uncompressed. Exposure
     * multiplies it for the same reason it multiplies the core — a longer exposure
     * collects more scattered light too.
     *
     * NOT gated by tier. The tier boundary was a percentile proxy for "bright
     * enough to show a wing", and this is the quantity it was standing in for, so
     * the halo now switches on continuously instead of stepping at a rank
     * threshold. Tiers keep their real job: the expensive optics (diffraction) that
     * genuinely should be rare.
     */
    halo[i] = (exposure * (flux[i] ?? 0)) / (whiteFlux > 0 ? whiteFlux : 1);
    // Only the BILLBOARD grows with brightness; the PSF inside it is fixed.
    const px = quadExtentPx(s, halo[i] ?? 0) * dpr;
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
    halo,
    sizePx,
    tier,
    stats: { whiteFlux, visible, clipping, tierCounts, maxSizePx, psfWidthPx: PSF_WIDTH_PX * dpr },
  };
}
