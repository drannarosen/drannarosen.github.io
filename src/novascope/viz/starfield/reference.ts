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
export function renderReferenceLupton(
  field: StarField,
  camera: ReferenceCamera,
  opts: ReferenceOptions & { depthMag?: number; whitePercentile?: number } = {},
): ReferenceImage {
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
  const provisionalStretch = luptonStretchForWhite(q);
  const floor = luptonIntensityForOutput(ONE_DISPLAY_LEVEL, provisionalStretch, q);

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

  /*
   * CALIBRATE on the pixel intensities that were actually produced, then compress once.
   *
   * The percentile is taken over LIT pixels only. Including the empty sky would put the
   * percentile in the background — most of a star field is sky, so a 99.5th percentile
   * over every pixel is still measuring nothing much — and the quantity worth mapping to
   * white is the bright end of the light that is there.
   */
  const lit: number[] = [];
  for (let p = 0; p < W * H; p++) {
    const o = p * 3;
    const I = ((accum[o] ?? 0) + (accum[o + 1] ?? 0) + (accum[o + 2] ?? 0)) / 3;
    if (I > 0) lit.push(I);
  }
  lit.sort((a, b) => a - b);
  const whitePixel =
    lit.length > 0 ? (lit[Math.floor((opts.whitePercentile ?? 0.995) * (lit.length - 1))] ?? 1) : 1;
  // f(I) depends on I/stretch, so mapping intensity `whitePixel` to display white is just
  // the unit-white stretch scaled by it.
  const stretch = Math.max(Number.MIN_VALUE, whitePixel) * luptonStretchForWhite(q);

  const rgb = new Float32Array(W * H * 3);
  for (let p = 0; p < W * H; p++) {
    const o = p * 3;
    const [r, g, b] = luptonRGB(accum[o] ?? 0, accum[o + 1] ?? 0, accum[o + 2] ?? 0, {
      stretch,
      q,
    });
    rgb[o] = r;
    rgb[o + 1] = g;
    rgb[o + 2] = b;
  }
  return { width: W, height: H, rgb, stretch, whitePixel };
}

/*
 * ── HOW TO RUN THE PARITY CHECK, AND THE TWO TRAPS IN IT ─────────────────────
 *
 * The GPU half needs a browser, so this cannot be a node gate; what IS gated in
 * node is `starProfile` and this rasteriser (see check:star-optics). The GPU
 * comparison is run against a dev server through Playwright:
 *
 *   1. render the SAME prepared field with `renderer.toneMapping = NoToneMapping`
 *      into a `RenderTarget` of `type: FloatType`, `colorSpace: LinearSRGBColorSpace`
 *      — tone mapping and sRGB would hide a numerical disagreement inside a curve;
 *   2. `await renderer.readRenderTargetPixelsAsync(rt, 0, 0, W, H)`;
 *   3. call `renderReference` with `distancePc` = the camera's z and the same fov;
 *   4. compare linear radiance per channel.
 *
 * Measured on 2026-07-24, r185, native WebGPU — 3k and 10k stars, 256/320/400 px,
 * V/K/bolometric, depth 13 mag, a 0.5 Msun mass cut, and a D=2 close-up:
 *
 *     total energy ratio      1.000000 +- 2e-6
 *     mean |error| / energy    3e-4 to 5e-4
 *     worst relative error     0.35%   (on pixels above 0.02 radiance)
 *
 * The residual is float32 against float64 plus WGSL's `pow` differing from JS's in
 * the last bits. Anything structural shows up far above that floor: the profile
 * being applied twice (the bug this apparatus was built to catch) is a factor of
 * the profile itself, not 0.35%.
 *
 * TRAP 1 — ROW ORDER. `readRenderTargetPixelsAsync` returns TOP-DOWN on the WebGPU
 * backend, the same order as this rasteriser. Reading it bottom-up (the WebGL
 * habit) reported an 83% energy error and a 36x worst-case discrepancy while the
 * PEAK VALUES still agreed to 0.02% — which is the signature of a misaligned
 * comparison rather than a physics disagreement, since a flip moves light without
 * changing how much there is. Diagnose it with ONE off-centre star: compute the
 * expected pixel from focal/depth and check which row order lands on it.
 *
 * TRAP 2 — ROW ALIGNMENT. WebGPU requires a readback's `bytesPerRow` to be a
 * multiple of 256, so a width whose `W * 16` bytes (RGBA float32) is not aligned
 * comes back with padded rows and a SHEARED image. 300 px gives 4800 bytes and
 * fails; 256, 320 and 400 give 4096, 5120 and 6400 and pass. Same signature again:
 * total energy matched to 3e-4 while the worst-case error was 155x. Choose widths
 * with `(W * 16) % 256 === 0`.
 *
 * Both traps produce a large spatial error with correct total energy. If a parity
 * run ever shows that pattern, suspect the harness before the renderer.
 */
