/*
 * cloudScene.ts — gas and stars in ONE three.js scene (Layer 2).
 *
 * ── WHAT THIS IS ──
 *
 * The composition the whole port exists for: `sceneHost` owns the renderer, the orthographic
 * camera and the loop; `volumeLayer` raymarches the cloud; `clusterPoints` draws the stars. One
 * scene, one camera, one depth buffer — so the stars are IN the cloud rather than over it.
 *
 * It replaces `viz/webgl`'s `createEngine` at the call site, and deliberately exposes only what
 * `/explore/feedback-budget` actually used of it: `setExpel`, `reducedMotion`, `cleanup`. The old
 * engine's other twelve methods were surface the page never touched.
 *
 * ── THE STARS COME FROM `toRenderModel`, WHICH IS THE POINT ──
 *
 * The old engine coloured and sized stars in its own shader from the export's `teff` and `radius`.
 * That made the feedback page's cluster a THIRD appearance, beside census's and dynamics'.
 *
 * These stars now go through `state/render.ts` like every other cluster on the site, so "the ONE
 * physics→pixel mapping" means what it says. A star of a given mass looks the same here as on
 * /explore/census, because it is the same function deciding.
 *
 * `t = 0`, matching what /explore/dynamics does and for its reason: this page's model does not
 * evolve the stars, so asking `toRenderModel` for an age would claim evolution nothing here
 * computes.
 */
import { toRenderModel, type RenderModel } from "../state/render.ts";
import { M_HYDROGEN_BURNING_MSUN } from "../core/constants/index.ts";
import type { LatentStar } from "../core/cluster/params.ts";
import { createVolumeLayer, type VolumeLayer } from "./volumeLayer.ts";
import { createClusterPoints, type ClusterPoints } from "./clusterPoints.ts";

/** Metallicity for the exported clusters. The gravoturb runs are solar. */
const CLOUD_Z = 0.02;

/**
 * The SHIPPED display settings, carried over verbatim from `viz/webgl/engine.ts`.
 *
 * These are the numbers the page has always rendered with. They are presentation, not physics —
 * a yt-style log colorbar's exposure — but they are the exposure Anna tuned, and the port has no
 * business changing what the cloud looks like while it changes what draws it. Picking my own
 * values instead is exactly how the first attempt shipped a cloud that was nearly invisible.
 */
const DISPLAY_DEFAULTS = { emit: 9.5, absorb: 9.0, gamma: 1.1 } as const;

export interface CloudSceneData {
  /** ngrid^3 uint8 log10(rho). */
  volume: Uint8Array;
  ngrid: number;
  /** n*6: x, y, z, mass, teff, radius (pc, Msun, K, Rsun). */
  stars: Float32Array;
  /** Box side [pc]. */
  box: number;
  /** The cloud's truncation radius [pc] — what the frame is sized on. */
  cloudRadiusPc: number;
  /** Normalized position of rho_0: the display floor. */
  densityFloor: number;
  logRange: number;
}

export interface CloudSceneOptions {
  emit?: number;
  absorb?: number;
  gamma?: number;
  onReady?: () => void;
  forceWebGL?: boolean;
}

export interface CloudScene {
  /** How many objects are actually stars — what the page should count. See starsToRenderModel. */
  readonly starCount: number;
  /** [0,1] scrubs the homologous gas expulsion. */
  setExpel(v: number): void;
  /** [0,1] gas mass remaining, at fixed radial shape. A different mode from expel. */
  setGasFraction(v: number): void;
  readonly reducedMotion: boolean;
  readonly backend: "webgpu" | "webgl2";
  cleanup(): void;
}

/**
 * Build the render model from the export's raw star array.
 *
 * The export carries `teff` and `radius` and they are DELIBERATELY not used: `toRenderModel`
 * derives appearance from mass through `star()`, which is what keeps this cluster looking like
 * every other cluster on the site rather than like whatever this page's shader once did.
 */
export function starsToRenderModel(stars: Float32Array): RenderModel {
  const n = Math.floor(stars.length / 6);
  const latent: LatentStar[] = [];
  for (let i = 0; i < n; i++) {
    /*
     * SUB-STELLAR OBJECTS ARE NOT DRAWN, and this is a data problem showing through.
     *
     * The export samples the IMF down to 0.010 Msun — an order of magnitude under the
     * hydrogen-burning limit — so 44% of its objects are brown dwarfs (measured across all six
     * realizations, 2026-08-09; filed for re-export). They carry ~4% of the mass and none of the
     * feedback.
     *
     * Drawing them is not merely wasteful, it distorts everything else: `toRenderModel` normalizes
     * apparent size across the population's log L, so a floor ten times too low compresses the real
     * stars toward the minimum. Measured before this filter: 5,187 of 10,301 objects pinned at
     * 0.6 px with the median alpha exactly on its 0.55 floor, against 5 of 1,200 on
     * /explore/census. The cluster rendered as a field of specks because half of it was not stars.
     *
     * This is a stopgap over a defect in the data, and it is deliberately narrow: it changes what
     * is DRAWN and COUNTED, never what the budget integrates. The ledger keeps summing the export
     * as shipped.
     */
    if (stars[i * 6 + 3]! < M_HYDROGEN_BURNING_MSUN) continue;
    latent.push({
      id: i,
      mass: stars[i * 6 + 3]!,
      Z: CLOUD_Z,
      x: stars[i * 6]!,
      y: stars[i * 6 + 1]!,
      z: stars[i * 6 + 2]!,
      /* Velocities are in the export but this page never integrates, so they are zero here rather
         than plumbed through to be ignored. */
      vx: 0,
      vy: 0,
      vz: 0,
    });
  }
  return toRenderModel(latent, { t: 0, selectedId: null, toggles: {} });
}

export function createCloudScene(
  canvas: HTMLCanvasElement,
  data: CloudSceneData,
  opts: CloudSceneOptions = {},
): CloudScene {
  const model = starsToRenderModel(data.stars);

  /*
   * The STAR layer creates the host, and the volume joins it.
   *
   * `clusterPoints` still owns a host today, so this composes rather than fights that: the stars
   * are built first, then the gas mesh is added to the same pivot. Both therefore share the
   * camera, the framing and the draw loop without either knowing about the other.
   */
  const stars: ClusterPoints = createClusterPoints(canvas, model, {
    forceWebGL: opts.forceWebGL ?? false,
    drifting: false,
    onReady: opts.onReady,
  });

  const volume: VolumeLayer = createVolumeLayer(
    { volume: data.volume, ngrid: data.ngrid, logRange: data.logRange },
    {
      floor: data.densityFloor,
      gamma: opts.gamma ?? DISPLAY_DEFAULTS.gamma,
      emit: opts.emit ?? DISPLAY_DEFAULTS.emit,
      absorb: opts.absorb ?? DISPLAY_DEFAULTS.absorb,
    },
  );
  /* The box is authored as a unit cube, so scaling by `box` puts the gas in the same parsec
     coordinates the stars already use. */
  volume.mesh.scale.setScalar(data.box);
  stars.attach(volume.mesh);

  /*
   * Frame on the CLOUD's truncation radius.
   *
   * Not on the stars: `maxR` is a 90th-percentile radius of a concentrated cluster, and framing
   * there would crop away the gas this page is about. Not on the box either — it is 2.4x the
   * truncation radius in every realization, so half of it is vacuum, and framing on box/2 leaves
   * the cluster a small blob in an empty square. Census frames on its cluster and looks better for
   * it; this is the same instinct applied to the object this page is actually about.
   */
  stars.setFraming({ centre: [0, 0, 0], radiusPc: data.cloudRadiusPc });

  /*
   * Advertise the stack on the canvas, as DynamicsEngine does with `data-engine`.
   *
   * "Am I looking at the new renderer or a cached old one?" cost a round of confusion that no
   * amount of curling the dev server could settle from the outside. One attribute answers it in
   * the element inspector, and it reports the backend actually obtained rather than the one
   * requested.
   */
  canvas.dataset.engine = `three.js volume + points (${stars.backend})`;

  return {
    starCount: model.stars.length,
    setExpel(v) {
      volume.setExpel(v);
      stars.redraw();
    },
    setGasFraction(v) {
      volume.setGasFraction(v);
      stars.redraw();
    },
    get reducedMotion() {
      return stars.reducedMotion;
    },
    get backend() {
      return stars.backend;
    },
    cleanup() {
      volume.dispose();
      stars.dispose();
    },
  };
}
