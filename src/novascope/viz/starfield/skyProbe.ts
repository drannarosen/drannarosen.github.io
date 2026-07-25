/*
 * skyProbe.ts — measure the sky by reading the frame that was actually drawn (Layer 2).
 *
 * `skyLevel` has been a knob defaulting to 0 since it was added, with the honest note that the
 * right value "is a percentile of the RENDERED pixels" and is not derivable a priori — measured
 * 97x spread across configurations, against 1.45x for the white point. This measures it.
 *
 * WHY IT MATTERS ENOUGH TO RENDER AN EXTRA PASS. In photometric mode the background is not noise,
 * it is the summed PSF wings of every star — real signal at the same amplitude scale as the faint
 * stars. So a monotone transfer lifts stars and sky together, and raising the depth produces a
 * brighter fog rather than more stars: measured on the lab, going 8 -> 14 -> 20 magnitudes moves
 * the median pixel 1 -> 75 -> 130 of 255 while the count of stars standing clear of their
 * surroundings by 24 levels FALLS, 786 -> 706. Subtracting the background is the only lever that
 * acts differently on a smooth pedestal than on a compact peak.
 *
 * ── WHY IT SAMPLES THE WAY IT DOES, WHICH IS THE WHOLE DESIGN ──
 *
 * THE BACKGROUND IS RESOLUTION-DEPENDENT, and that rules out every cheap approach. The PSF width
 * is fixed in PIXELS, so at a lower resolution each star's wings cover a larger fraction of the
 * frame and overlap more, and the sky rises. Measured, `median / analyticMeanIntensity` drifts
 * 0.0358 -> 0.0228 from 96x60 to 320x200 — 1.57x, monotonic — while holding to 4% across
 * composite and depth (0.0300 / 0.0294 / 0.0306 for Rubin at depth 14, Rubin at depth 8, JWST at
 * depth 14). So it is frame size specifically, and two consequences follow:
 *
 *   - A CALIBRATION CONSTANT WOULD NOT DO. One would be up to 57% wrong depending on frame size.
 *     The white point tolerates its own 0.41 mag spread because it is an exposure; a SUBTRACTION
 *     operates near zero, where being 57% high crushes precisely the faint stars it exists to
 *     reveal.
 *   - A SMALL RENDER TARGET WOULD NOT DO EITHER, for the same reason — rendering the whole frame
 *     into 256x160 measures a different image.
 *
 * Hence `setViewOffset`: it renders a SUB-RECTANGLE of the full-resolution frame into a small
 * target, so every sampled pixel is at the true pixel scale while the readback stays tiny. Several
 * tiles are pooled because the background genuinely varies across a cluster — sampling only the
 * corners would read the darkest sky and under-subtract the core.
 *
 * The CPU reference cannot stand in for this: measured at 608 ms for a 64x40 frame and 4 s at
 * 320x200, against `prepareStarField`'s own 180-425 ms.
 */
import * as THREE from "three";
import type { WebGPURenderer, RenderPipeline } from "three/webgpu";

/**
 * Tile width in device pixels.
 *
 * 256 is not aesthetic. A WebGPU readback requires `bytesPerRow` to be a multiple of 256, and at
 * RGBA-float that is 16 bytes per pixel, so 256 x 16 = 4096 satisfies it exactly. A width of 300
 * does not, and the failure mode is the recorded one: a large SPATIAL error with the correct total
 * energy, which looks like a renderer bug and is a harness bug.
 */
const TILE_W = 256;
const TILE_H = 64;

/** Tile centres as fractions of the frame — a spread, not a corner sample. See the header. */
const TILE_SITES: ReadonlyArray<readonly [number, number]> = [
  [0.5, 0.5],
  [0.2, 0.25],
  [0.8, 0.25],
  [0.2, 0.75],
  [0.8, 0.75],
];

export interface SkyMeasurement {
  /** The measured background, in the same units as the scene radiance the transfer consumes. */
  level: number;
  /** Fraction of sampled pixels at or below `level` — a sanity handle on the percentile. */
  sampled: number;
  /** How many pixels the estimate is built from. Zero means the probe did not run. */
  pixels: number;
  /**
   * Raw spread of the sampled radiance — diagnostic, and load-bearing.
   *
   * A probe that silently reads black is indistinguishable from a genuinely dark sky in the
   * percentile alone, and both produce a confident zero. Carrying min/max/mean makes the two
   * separable at a glance: an all-zero max means the readback or the render target is wrong, not
   * the sky.
   */
  min: number;
  max: number;
  mean: number;
}

/**
 * The percentile taken as "the sky".
 *
 * A LOW percentile, not the median: in a cluster frame a large minority of pixels carry real star
 * light, and the median drags upward with it in the core. 0.25 is low enough to sit on the
 * pedestal and high enough not to be reading the darkest corner of an unevenly filled frame.
 *
 * Deliberately a named constant rather than an argument, because a percentile that can be tuned
 * per call is a second exposure control by another name — and this project already has one
 * control meaning two things.
 */
export const SKY_PERCENTILE = 0.25;

export interface SkyProbe {
  /** Measure the current scene. Safe to call on every rebuild; it renders extra tiles. */
  measure(bufW: number, bufH: number): Promise<SkyMeasurement>;
  dispose(): void;
}

/**
 * Build a probe against a live renderer and pipeline.
 *
 * `pipeline` must have its `outputNode` set to the LINEAR scene — bloom included, transfer NOT —
 * because the sky is subtracted before the transfer and after bloom, so that is the only stage at
 * which the measurement means anything. Measuring after the transfer would read a number already
 * shaped by the curve the subtraction is meant to feed.
 */
export function createSkyProbe(
  renderer: WebGPURenderer,
  pipeline: RenderPipeline,
  camera: THREE.PerspectiveCamera,
): SkyProbe {
  const target = new THREE.RenderTarget(TILE_W, TILE_H, {
    type: THREE.FloatType,
    colorSpace: THREE.LinearSRGBColorSpace,
    minFilter: THREE.NearestFilter,
    magFilter: THREE.NearestFilter,
  });

  return {
    async measure(bufW: number, bufH: number): Promise<SkyMeasurement> {
      if (!(bufW > 0) || !(bufH > 0)) return { level: 0, sampled: 0, pixels: 0, min: 0, max: 0, mean: 0 };
      const samples: number[] = [];
      /*
       * The camera's view offset is restored in a `finally`. If a readback rejects — a lost
       * device, a resize mid-flight — leaving the offset set would silently render every
       * subsequent frame as one tile of the scene, blown up. That failure looks like a broken
       * camera rather than a broken probe, which is the worst kind to debug.
       */
      try {
        /*
         * ONE DISCARDED WARM-UP RENDER, and it is not superstition.
         *
         * `litScene` includes the bloom pass, which carries internal render targets and mip
         * chains that are sized and populated lazily. The first render after a rebuild — or after
         * a `setViewOffset` changes the projection — can therefore sample a bloom texture that is
         * empty or stale, and the probe comes back reading a background of exactly zero. Measured:
         * consecutive probes at identical settings returned 5.9e-5 and then 0, which is the
         * signature of a first-render artefact rather than of a changing sky.
         *
         * A silently-zero sky is the worst possible failure here: it looks like "there is no
         * background to subtract", which is the opposite of the truth and is unfalsifiable from
         * the readout alone. So one frame is rendered and thrown away before anything is sampled.
         */
        const [wx, wy] = TILE_SITES[0] ?? [0.5, 0.5];
        if (bufW >= TILE_W && bufH >= TILE_H) {
          camera.setViewOffset(
            bufW,
            bufH,
            Math.max(0, Math.min(bufW - TILE_W, Math.round(wx * bufW - TILE_W / 2))),
            Math.max(0, Math.min(bufH - TILE_H, Math.round(wy * bufH - TILE_H / 2))),
            TILE_W,
            TILE_H,
          );
          camera.updateProjectionMatrix();
          renderer.setRenderTarget(target);
          await pipeline.renderAsync();
          renderer.setRenderTarget(null);
        }

        for (const [fx, fy] of TILE_SITES) {
          const x = Math.round(fx * bufW - TILE_W / 2);
          const y = Math.round(fy * bufH - TILE_H / 2);
          // Clamped so a small canvas cannot ask for a rectangle outside the frame.
          const cx = Math.max(0, Math.min(bufW - TILE_W, x));
          const cy = Math.max(0, Math.min(bufH - TILE_H, y));
          if (bufW < TILE_W || bufH < TILE_H) continue;

          camera.setViewOffset(bufW, bufH, cx, cy, TILE_W, TILE_H);
          camera.updateProjectionMatrix();
          renderer.setRenderTarget(target);
          await pipeline.renderAsync();
          const px = (await renderer.readRenderTargetPixelsAsync(
            target,
            0,
            0,
            TILE_W,
            TILE_H,
          )) as Float32Array;
          renderer.setRenderTarget(null);
          // Lupton's intensity is the MEAN of the three channels, so the sky is measured on the
          // same quantity the transfer compresses rather than on one channel or on a luminance.
          for (let i = 0; i < px.length; i += 4) {
            samples.push(((px[i] ?? 0) + (px[i + 1] ?? 0) + (px[i + 2] ?? 0)) / 3);
          }
        }
      } finally {
        camera.clearViewOffset();
        camera.updateProjectionMatrix();
        renderer.setRenderTarget(null);
      }

      if (samples.length === 0) return { level: 0, sampled: 0, pixels: 0, min: 0, max: 0, mean: 0 };
      samples.sort((a, b) => a - b);
      const idx = Math.min(
        samples.length - 1,
        Math.max(0, Math.round(SKY_PERCENTILE * (samples.length - 1))),
      );
      const level = samples[idx] ?? 0;
      let atOrBelow = 0;
      for (const v of samples) if (v <= level) atOrBelow++;
      let sum = 0;
      for (const v of samples) sum += v;
      return {
        level,
        sampled: atOrBelow / samples.length,
        pixels: samples.length,
        min: samples[0] ?? 0,
        max: samples[samples.length - 1] ?? 0,
        mean: sum / samples.length,
      };
    },
    dispose() {
      target.dispose();
    },
  };
}
