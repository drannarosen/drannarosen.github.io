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
import { PSF_BETA, PSF_WIDTH_PX } from "./sizing.ts";
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
  /** Linear RGB radiance, 3 floats per pixel. NOT tone-mapped, NOT encoded. */
  rgb: Float32Array;
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
