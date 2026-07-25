/*
 * reference.ts — the CPU reference rasteriser (Layer 2).
 *
 * Renders a prepared star field to LINEAR radiance with no tone mapping and no
 * transfer encoding, using `starProfile` — the same function the TSL graph mirrors
 * — and the same per-star quantities the GPU receives as instance attributes.
 *
 * The point is comparability, so everything that could differ is deliberately the
 * same or deliberately absent:
 *   - the profile comes from `./profile`, not a second implementation;
 *   - `field.sizePx`, `field.signal`, `field.halo` and `field.color` are consumed
 *     as prepared, so the CPU path cannot pick different sizes or drives;
 *   - output is linear radiance, because tone mapping and sRGB are display
 *     decisions that would hide a numerical disagreement inside a curve.
 *
 * A reference that applies its own tone curve can only be compared by eye, which
 * is how a previous one sat next to a shader that squared the profile without the
 * discrepancy ever surfacing.
 */

import { starProfile } from "./profile.ts";
import {
  PSF_BETA,
  PSF_WIDTH_PX,
  MAX_QUAD_PX,
  coreExtentRadii,
  aureoleExtentRadii,
  diffractionExtentRadii,
} from "./sizing.ts";
import {
  luptonRGB,
  luptonQForDepth,
  luptonStretchForWhite,
  luptonIntensityForOutput,
  ONE_DISPLAY_LEVEL,
} from "../../core/imaging/lupton.ts";
import {
  DEFAULT_AUREOLE,
  DEFAULT_DIFFRACTION,
  type AureoleParams,
  type DiffractionParams,
} from "../../core/optics/index.ts";
import type { StarField } from "./prepare.ts";

export interface ReferenceCamera {
  /** Output size [px]. */
  width: number;
  height: number;
  /** Camera distance along +z, looking toward -z [pc]. */
  distancePc: number;
  /** Vertical field of view [degrees]. */
  fovDeg: number;
}

export interface ReferenceOptions {
  aureole?: AureoleParams;
  beta?: number;
  /** PSF width [px]. Defaults to the field's own, which already includes DPR. */
  psfWidthPx?: number;
  /** Diffraction geometry, applied to Tier 3 only. */
  diffraction?: DiffractionParams;
}

export interface ReferenceImage {
  width: number;
  height: number;
  /**
   * 3 floats per pixel. From `renderReference` this is LINEAR radiance, not tone-mapped
   * and not encoded. From `renderReferenceLupton` it is DISPLAY RGB in [0, 1].
   */
  rgb: Float32Array;
  /** Lupton only: the `stretch` calibrated from this image's own pixel distribution. */
  stretch?: number;
  /** Lupton only: the pixel intensity that was mapped to display white. */
  whitePixel?: number;
}

/**
 * Rasterise a prepared field to linear radiance.
 *
 * The projection mirrors a `PerspectiveCamera` at `(0, 0, distancePc)` looking down
 * -z: a star's screen position is its transverse offset scaled by focal/depth, and
 * its billboard is sized in PIXELS regardless of depth — which is correct for an
 * instrumental PSF and is what the vertex stage does by scaling its offset by
 * `clip.w`.
 */
export function renderReference(
  field: StarField,
  camera: ReferenceCamera,
  opts: ReferenceOptions = {},
): ReferenceImage {
  const { width: W, height: H } = camera;
  const aureole = opts.aureole ?? DEFAULT_AUREOLE;
  const beta = opts.beta ?? PSF_BETA;
  const spikeParams = opts.diffraction ?? DEFAULT_DIFFRACTION;
  const psfWidthPx = opts.psfWidthPx ?? field.stats.psfWidthPx;
  const rgb = new Float32Array(W * H * 3);

  const focal = H / 2 / Math.tan((camera.fovDeg * Math.PI) / 180 / 2);

  for (let i = 0; i < field.count; i++) {
    const signal = field.signal[i] ?? 0;
    const halo = field.halo[i] ?? 0;
    const halfPx = field.sizePx[i] ?? 0;
    // A star with no signal and no halo contributes nothing — skip it rather than
    // shading a quad of zeros. This is also what a `minMass` cut produces.
    if (halfPx <= 0 || (signal <= 0 && halo <= 0)) continue;

    const z = field.position[i * 3 + 2] ?? 0;
    const depth = camera.distancePc - z;
    if (depth <= 1e-6) continue; // behind or at the camera

    const sx = W / 2 + ((field.position[i * 3] ?? 0) * focal) / depth;
    const sy = H / 2 - ((field.position[i * 3 + 1] ?? 0) * focal) / depth;

    const cr = field.color[i * 3] ?? 0;
    const cg = field.color[i * 3 + 1] ?? 0;
    const cb = field.color[i * 3 + 2] ?? 0;

    // The quad's edge, in PSF widths — exactly the shader's `edge`.
    const edge = halfPx / psfWidthPx;
    // Tier 3 only, matching the shader's gate: diffraction is an instrument
    // artifact of genuinely bright sources.
    const spikes = (field.tier[i] ?? 1) >= 3 ? spikeParams : undefined;

    const x0 = Math.max(0, Math.floor(sx - halfPx));
    const x1 = Math.min(W - 1, Math.ceil(sx + halfPx));
    const y0 = Math.max(0, Math.floor(sy - halfPx));
    const y1 = Math.min(H - 1, Math.ceil(sy + halfPx));

    for (let py = y0; py <= y1; py++) {
      for (let px = x0; px <= x1; px++) {
        // Pixel CENTRE, matching where a rasteriser samples the fragment.
        const dx = px + 0.5 - sx;
        const dy = py + 0.5 - sy;
        const rho = Math.hypot(dx, dy) / psfWidthPx;
        const p = starProfile({
          rho,
          edge,
          signal,
          halo,
          aureole,
          beta,
          theta: Math.atan2(dy, dx),
          ...(spikes === undefined ? {} : { spikes }),
        });
        if (p <= 0) continue;
        const o = (py * W + px) * 3;
        // Stars are emitters: radiances ADD. Order-independent, like the GPU's
        // additive blending, so the two cannot disagree on overlap.
        rgb[o] = (rgb[o] ?? 0) + cr * p;
        rgb[o + 1] = (rgb[o + 1] ?? 0) + cg * p;
        rgb[o + 2] = (rgb[o + 2] ?? 0) + cb * p;
      }
    }
  }

  return { width: W, height: H, rgb };
}

/** The PSF width the reference uses when none is given, for callers that report it. */
export const REFERENCE_PSF_WIDTH_PX = PSF_WIDTH_PX;

/**
 * Rasterise the LUPTON path: accumulate three bands' linear radiance, then map once per
 * pixel.
 *
 * This is the target the TSL graph has to match, and it exists as a CPU reference first
 * for the same reason the linear one does — the GPU half cannot be gated in node, so the
 * only way to know the shader is right is to have something correct to compare it
 * against. That order is not optional here: the previous renderer shipped a shader that
 * squared the profile, and it survived because the reference beside it applied its own
 * tone curve and could only be compared by eye.
 *
 * THREE DIFFERENCES FROM `renderReference`, each deliberate:
 *
 *   - The per-star amplitude is `bandFlux`, which is LINEAR. So compression happens once,
 *     here, after the radiances have been summed — not per star before they are. Where
 *     two stars overlap the old path compressed twice and produced something that was not
 *     the transfer of the summed flux.
 *   - `starProfile` is evaluated once PER CHANNEL, with that channel's own flux as both
 *     the core amplitude and the aureole drive. Scattered light is a fixed fraction of the
 *     light that entered the instrument at that wavelength, so a red star's halo is red;
 *     driving all three channels from one scalar would make every halo grey.
 *   - Quads are sized by `coreExtentRadii` from the brightest channel, solved against the
 *     intensity one display level corresponds to, rather than by the interpolated
 *     allowance in `quadExtentPx`.
 *
 * Returns DISPLAY RGB in [0, 1] — unlike `renderReference`, which returns linear
 * radiance. That is the whole point of the pass, so it is named in the return type rather
 * than left for a caller to assume.
 */
export function accumulateBandRadiance(
  field: StarField,
  camera: ReferenceCamera,
  opts: ReferenceOptions & { depthMag?: number } = {},
): { width: number; height: number; radiance: Float64Array } {
  const { width: W, height: H } = camera;
  const aureole = opts.aureole ?? DEFAULT_AUREOLE;
  const beta = opts.beta ?? PSF_BETA;
  const spikeParams = opts.diffraction ?? DEFAULT_DIFFRACTION;
  const psfWidthPx = opts.psfWidthPx ?? field.stats.psfWidthPx;

  /*
   * Q carries the depth. `stretch` is calibrated LATER, from the rendered image's own
   * pixel distribution — not from the per-star white point, and this is the one thing
   * about the Lupton path that is not obvious.
   *
   * The per-star normalization in `prepare` is correct on its own terms: the 99.5th
   * percentile of per-star intensity is exactly 1 by construction. But a PIXEL sums the
   * wings of thousands of stars, and that sum has a completely different distribution —
   * measured on this cluster, the background sits at 3.3e-3 while a median star's own peak
   * contribution is 2.3e-6, so the background is 1400x brighter than the thing the white
   * point was calibrated against. Feeding per-star-normalized intensities to a 19.8 mag
   * stretch put the entire frame above 64/255.
   *
   * This is why astropy's API takes IMAGES rather than a source list, and it is the real
   * reason the deferred ZScale-style interval matters: once compression is per-pixel, the
   * interval has to be per-pixel too. A provisional `stretch` is used for the quad sizing
   * below, which only needs an order of magnitude to bound the geometry.
   */
  const q = luptonQForDepth(opts.depthMag ?? field.stats.depthMag);
  const floor = luptonIntensityForOutput(ONE_DISPLAY_LEVEL, luptonStretchForWhite(q), q);

  const accum = new Float64Array(W * H * 3);
  const focal = H / 2 / Math.tan((camera.fovDeg * Math.PI) / 180 / 2);

  for (let i = 0; i < field.count; i++) {
    const f0 = field.bandFlux[i * 3] ?? 0;
    const f1 = field.bandFlux[i * 3 + 1] ?? 0;
    const f2 = field.bandFlux[i * 3 + 2] ?? 0;
    const peak = Math.max(f0, f1, f2);
    if (!(peak > 0)) continue;

    const spikes = (field.tier[i] ?? 1) >= 3 ? spikeParams : undefined;
    const halfPx = Math.min(
      MAX_QUAD_PX,
      psfWidthPx *
        Math.max(
          coreExtentRadii(peak, floor, beta),
          aureoleExtentRadii(peak, aureole),
          spikes ? diffractionExtentRadii(peak, spikes) : 0,
        ),
    );
    if (!(halfPx > 0)) continue;

    const z = field.position[i * 3 + 2] ?? 0;
    const depth = camera.distancePc - z;
    if (depth <= 1e-6) continue;
    const sx = W / 2 + ((field.position[i * 3] ?? 0) * focal) / depth;
    const sy = H / 2 - ((field.position[i * 3 + 1] ?? 0) * focal) / depth;
    const edge = halfPx / psfWidthPx;

    const x0 = Math.max(0, Math.floor(sx - halfPx));
    const x1 = Math.min(W - 1, Math.ceil(sx + halfPx));
    const y0 = Math.max(0, Math.floor(sy - halfPx));
    const y1 = Math.min(H - 1, Math.ceil(sy + halfPx));

    for (let py = y0; py <= y1; py++) {
      for (let px = x0; px <= x1; px++) {
        const dx = px + 0.5 - sx;
        const dy = py + 0.5 - sy;
        const rho = Math.hypot(dx, dy) / psfWidthPx;
        const theta = Math.atan2(dy, dx);
        const o = (py * W + px) * 3;
        for (let k = 0; k < 3; k++) {
          const amp = field.bandFlux[i * 3 + k] ?? 0;
          if (amp <= 0) continue;
          const p = starProfile({
            rho,
            edge,
            signal: amp,
            halo: amp,
            aureole,
            beta,
            theta,
            ...(spikes === undefined ? {} : { spikes }),
          });
          if (p > 0) accum[o + k] = (accum[o + k] ?? 0) + p;
        }
      }
    }
  }

  return { width: W, height: H, radiance: accum };
}

/**
 * Rasterise the LUPTON path all the way to display RGB.
 *
 * `accumulateBandRadiance` does the geometry; this adds only the calibration and the transfer.
 * They are SEPARATE functions because the parity harness needs each half independently: the
 * linear accumulation is what the GPU's fragment stage must reproduce, at full float precision
 * and with no curve in the way to hide a disagreement, while the transfer is what the TSL
 * mirror of `luptonRGB` must reproduce. A single combined function can only report that
 * something differs somewhere.
 *
 * CALIBRATE on the pixel intensities that were actually produced, then compress once.
 *
 * The percentile is taken over LIT pixels only. Including the empty sky would put the percentile
 * in the background — most of a star field is sky — and the quantity worth mapping to white is
 * the bright end of the light that is there.
 */
export function renderReferenceLupton(
  field: StarField,
  camera: ReferenceCamera,
  opts: ReferenceOptions & { depthMag?: number; whitePercentile?: number } = {},
): ReferenceImage {
  const { width: W, height: H } = camera;
  const q = luptonQForDepth(opts.depthMag ?? field.stats.depthMag);
  const accum = accumulateBandRadiance(field, camera, opts).radiance;

  const lit: number[] = [];
  for (let p = 0; p < W * H; p++) {
    const o = p * 3;
    const I = ((accum[o] ?? 0) + (accum[o + 1] ?? 0) + (accum[o + 2] ?? 0)) / 3;
    if (I > 0) lit.push(I);
  }
  lit.sort((a, b) => a - b);
  const whitePixel =
    lit.length > 0 ? (lit[Math.floor((opts.whitePercentile ?? 0.995) * (lit.length - 1))] ?? 1) : 1;
  // f(I) depends on I/stretch, so mapping intensity `whitePixel` to display white is just the
  // unit-white stretch scaled by it.
  const stretch = Math.max(Number.MIN_VALUE, whitePixel) * luptonStretchForWhite(q);

  const rgb = new Float32Array(W * H * 3);
  for (let p = 0; p < W * H; p++) {
    const o = p * 3;
    const [r, g, b] = luptonRGB(accum[o] ?? 0, accum[o + 1] ?? 0, accum[o + 2] ?? 0, { stretch, q });
    rgb[o] = r;
    rgb[o + 1] = g;
    rgb[o + 2] = b;
  }
  return { width: W, height: H, rgb, stretch, whitePixel };
}

/*
 * ── THE PARITY CHECK ─────────────────────────────────────────────────────────
 *
 * The procedure and its two traps used to be described here, at length, in prose. It is now
 * CODE — `./parity` — because the GPU half needs a browser and so cannot be a node gate, and a
 * method that lives only in a comment gets re-improvised each time it is needed. Read that file
 * for the traps (readback row order, and the 256-byte row alignment that shears an unaligned
 * width); both are enforced or asserted there rather than remembered.
 *
 * Two modes, because there are two things to check and one number cannot say which failed:
 *
 *   LINEAR — `accumulateBandRadiance` against the GPU rendering to a FloatType target with no
 *     post-processing. The strong test: full float precision, no curve to hide a disagreement
 *     inside. Measured 2026-07-25, r185, native WebGPU, 10k stars at 256/320/400 px:
 *
 *         total energy ratio      1.00050
 *         median relative error   0.058%   (over pixels above 0.02 radiance)
 *         99th percentile         1.87%
 *         worst pixel             7.1%
 *         peak value              31.7356 GPU against 31.7261 CPU  (0.03%)
 *
 *     The MEDIAN is the number that matters; a structural error moves it. The thin tail is
 *     float32 against float64 plus WGSL's transcendentals differing in the last bits, and it
 *     lands where the profile is nearly flat or where an angular term is hypersensitive — a
 *     diffraction lobe raised to the 24th power moves percent for parts-per-million in theta.
 *
 *   LUPTON — `renderReferenceLupton` against the full pipeline including the TSL transfer. The
 *     only test of that mirror, and of the fact that no second sRGB encode is applied. Reported
 *     in 8-BIT DISPLAY LEVELS, because after the transfer the output spans [0, 1] and what
 *     matters is a quantisation step, not a fraction:
 *
 *         mean |difference|   0.03 to 0.15 levels   (composites, sizes, depths 6.5-12)
 *         99.9th percentile   0.9 to 1.6 levels
 *         worst pixel         1.8 to 4.4 levels
 *
 *     A double encode would shift this by tens of levels, so the small number is the evidence.
 *
 * Both halves must be given the SAME white point, or the comparison measures the exposure
 * calibration instead of the renderer — that mistake read as a 1.03% median until the reference's
 * own percentile was fed to the GPU.
 */
