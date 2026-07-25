/*
 * parity.ts — the GPU-versus-CPU parity harness, as code (Layer 2).
 *
 * `./reference` describes this procedure in prose and records what it measured. This makes it
 * RUNNABLE, which is the difference between a documented method and a repeatable one: the GPU
 * half needs a browser, so it cannot be a node gate, and a procedure that lives only in a
 * comment gets re-improvised every time — with the two traps below re-encountered each time.
 *
 * DEV-ONLY, and it stays out of the bundle by not being imported. Nothing in `./index` or the
 * lab page references it; it is loaded dynamically from a browser automation session
 * (`await import('/src/novascope/viz/starfield/parity.ts')`), so Vite serves it in dev and the
 * production build tree-shakes it away. Verified by checking the built page's chunk list.
 *
 * It exists here rather than under `scripts/` because it must be resolved by Vite: bare
 * specifiers like `three` do not resolve in a raw browser eval, and reproducing Vite's
 * dependency URLs by hand is exactly the kind of incidental detail that breaks silently.
 *
 * ── THE TWO TRAPS, both of which produce a LARGE spatial error with CORRECT total energy ──
 *
 * TRAP 1 — ROW ORDER. `readRenderTargetPixelsAsync` returns TOP-DOWN on the WebGPU backend,
 * the same order the CPU rasteriser writes. Reading it bottom-up (the WebGL habit) reported an
 * 83% energy error and a 36x worst case while the PEAK VALUES still agreed to 0.02%.
 *
 * TRAP 2 — ROW ALIGNMENT. WebGPU requires a readback's `bytesPerRow` to be a multiple of 256,
 * so a width whose `W * 16` bytes (RGBA float32) is unaligned comes back SHEARED. 300 px gives
 * 4800 and fails; 256, 320 and 400 give 4096, 5120 and 6400 and pass. `assertAligned` below
 * refuses an unaligned width rather than letting it produce a plausible disagreement.
 *
 * If a parity run ever shows a large spatial error with matching total energy, suspect this
 * harness before the renderer.
 */
import * as THREE from "three";
import { WebGPURenderer, RenderPipeline } from "three/webgpu";
import { pass, vec4 } from "three/tsl";
import { prepareStarField, type PrepareOptions, type StarField } from "./prepare.ts";
import { clusterStarTable } from "./source.ts";
import { createStarGraph } from "./starGraph.ts";
import { createLuptonNode, createStretchNode } from "./luptonNode.ts";
import { stretch, type StretchId } from "../../core/imaging/stretch.ts";
import { accumulateBandRadiance, renderReferenceLupton } from "./reference.ts";
import { whitePixelIntensity, floorForDepth } from "./calibrate.ts";
import { DEFAULT_LUPTON_DEPTH_MAG, luptonRGB, luptonQForDepth, luptonStretchForWhite } from "../../core/imaging/lupton.ts";

export interface ParityOptions {
  /** Frame size. `width * 16` must be a multiple of 256 — see TRAP 2. */
  width?: number;
  height?: number;
  fovDeg?: number;
  distancePc?: number;
  starCount?: number;
  depthMag?: number;
  prepare?: PrepareOptions;
  /** Apply the TSL Lupton node on the GPU, and compare display RGB instead of radiance. */
  lupton?: boolean;
  /**
   * Apply a SCALAR stretch on the GPU (`createStretchNode`) and the same curve per channel on the
   * CPU. Mutually exclusive with `lupton`.
   *
   * This mode was missing, and its absence was a real coverage hole rather than an omission of
   * convenience: `createStretchNode` shipped unverified while `createLuptonNode` was checked to
   * 0.05 display levels, and the symptom that exposed the gap — a blue wash on the live page —
   * lives in exactly the path that had no test.
   */
  scaling?: StretchId;
  /** White point for the scalar path. Population mode uses 1, since its signal is pre-normalised. */
  whitePoint?: number;
}

export interface ParityResult {
  backend: string;
  width: number;
  height: number;
  /** Ratio of GPU total energy to CPU total energy. 1 means the same amount of light. */
  energyRatio: number;
  /** Mean absolute difference, as a fraction of the CPU mean. */
  meanRelError: number;
  /** Worst relative error among pixels the CPU says are meaningfully lit. */
  worstRelError: number;
  /** Where that worst pixel is, which is what distinguishes a shear from a physics error. */
  worstAt: { x: number; y: number };
  /** Pixels compared (CPU value above the significance floor). */
  compared: number;
  /**
   * Percentiles of the relative error over the compared pixels.
   *
   * The single worst value is the least informative number here, and reporting only it is how a
   * healthy renderer gets called broken. A float32-versus-float64 floor plus WGSL's transcendentals
   * differing in the last bits puts a long thin tail on this distribution, and the tail lands
   * wherever the profile is nearly flat or an angular term is hypersensitive — a diffraction lobe
   * raised to the 24th power changes by percent for a change in theta of parts per million. So the
   * shape is what says whether a disagreement is structural: a real bug moves the MEDIAN.
   */
  percentiles: { p50: number; p90: number; p99: number; p999: number; max: number };
  /**
   * Mean blue fraction, b/(r+g+b), over lit pixels — on BOTH sides.
   *
   * Reported because it is the SYMPTOM, and an aggregate error metric can hide it completely: a
   * uniform hue shift leaves total energy and per-pixel magnitudes almost untouched while making
   * the whole frame the wrong colour. The Lupton path was verified to 0.05 display levels and that
   * number would have looked just as good with the channels swapped. Only a hue-specific measure
   * catches a colour-space mismatch or a swizzle.
   */
  blueFraction: { gpu: number; cpu: number } | null;
  /**
   * ABSOLUTE difference in 8-bit display levels, over EVERY pixel — display modes only.
   *
   * The right metric for a display image, and it is not interchangeable with the relative one.
   * Relative error is the meaningful measure in LINEAR radiance, where a value spans eight decades
   * and a fixed fraction means the same thing everywhere. After the transfer the output spans
   * [0, 1] and what a viewer can perceive is a QUANTISATION STEP, so a 40% relative error on a
   * pixel sitting at 2/255 is a fifth of one level — invisible, and reporting it as 40% invites
   * chasing a non-problem. Both are kept because each is the honest number for its own stage.
   */
  levels: { mean: number; p999: number; max: number } | null;
  peakGpu: number;
  peakCpu: number;
}

/* `renderer.backend` is typed as the base class, so the WebGPU marker needs a narrowing guard —
 * the same one `./scene` uses, and duplicated only because it is three lines and exporting a
 * type guard across a dev-only harness boundary is not worth the coupling. */
function isWebGPUBackend(b: unknown): b is { isWebGPUBackend: true } {
  return typeof b === "object" && b !== null && "isWebGPUBackend" in b;
}

function assertAligned(width: number): void {
  if ((width * 16) % 256 !== 0) {
    throw new Error(
      `parity width ${width} is unaligned: width * 16 = ${width * 16} bytes per row is not a ` +
        `multiple of 256, so the readback comes back sheared (TRAP 2). Use 256, 320 or 400.`,
    );
  }
}

/**
 * Render the same prepared field on the GPU and on the CPU, and compare.
 *
 * Two modes, and they catch different classes of error:
 *
 *   `lupton: false` — the GPU renders to a FloatType target with NO post-processing and the
 *     comparison is in LINEAR RADIANCE. This is the strong test: full float precision, and it
 *     isolates the fragment stage (the profile, the factorisation, the pedestal) from the
 *     display transfer. Tone mapping or an sRGB encode here would hide a numerical
 *     disagreement inside a curve, which is how a shader that squared the profile once
 *     survived beside a reference.
 *
 *   `lupton: true` — the full pipeline including the TSL Lupton node, compared against
 *     `renderReferenceLupton`. Weaker numerically (the transfer compresses, so a given
 *     relative error in radiance shrinks) but it is the only thing that tests the MIRROR of
 *     `luptonRGB` and, critically, that no extra sRGB transfer is being applied — a double
 *     encode is a gross error here and invisible in the linear mode.
 */
export async function runParity(opts: ParityOptions = {}): Promise<ParityResult> {
  const width = opts.width ?? 320;
  const height = opts.height ?? 320;
  assertAligned(width);
  const fovDeg = opts.fovDeg ?? 40;
  const distancePc = opts.distancePc ?? 12;
  const depthMag = opts.depthMag ?? DEFAULT_LUPTON_DEPTH_MAG;

  const stars = clusterStarTable({
    sampling: { mode: "count", target: opts.starCount ?? 10_000 },
  });
  const field: StarField = prepareStarField(stars, {
    bandTriple: ["R", "V", "B"],
    pixelRatio: 1,
    /*
     * The harness's `depthMag` is the LUPTON depth — this file compares the per-pixel transfer
     * against its CPU mirror, so that is the only depth it has ever meant. It also feeds the
     * per-star curve here, so the population path is exercised at a matching reach.
     */
    pixelDepthMag: depthMag,
    starDepthMag: depthMag,
    ...opts.prepare,
  });

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const renderer = new WebGPURenderer({ canvas, antialias: false, alpha: false });
  renderer.setPixelRatio(1);
  renderer.setSize(width, height, false);
  // NO tone mapping in either mode: in linear mode it would hide the disagreement, and in
  // Lupton mode the Lupton node IS the transfer, so a second one would double-encode.
  renderer.toneMapping = THREE.NoToneMapping;
  await renderer.init();

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(fovDeg, width / height, 0.01, 1000);
  camera.position.set(0, 0, distancePc);
  camera.lookAt(0, 0, 0);
  const graph = createStarGraph(field);
  scene.add(graph.mesh);

  const rt = new THREE.RenderTarget(width, height, {
    type: THREE.FloatType,
    colorSpace: THREE.LinearSRGBColorSpace,
    minFilter: THREE.NearestFilter,
    magFilter: THREE.NearestFilter,
  });

  const cam = { width, height, distancePc, fovDeg };
  /*
   * In Lupton mode the CPU reference is rendered FIRST, so the GPU can be given the reference's
   * OWN white point.
   *
   * Otherwise the two run at different exposures and the comparison measures the calibration
   * rather than the mirror: `whitePixelIntensity` is an analytic estimate accurate to 0.41 mag,
   * while `renderReferenceLupton` takes a true percentile of the pixels it just produced. Feeding
   * the GPU the analytic value gave a median error of 1.03% — a real difference, but a difference
   * in EXPOSURE, and `check:calibrate` is what bounds that. Isolating one variable at a time is
   * the whole reason this harness has two modes.
   */
  const cpuLupton = opts.lupton ? renderReferenceLupton(field, cam, { depthMag }) : null;

  let gpu: Float32Array;
  if (opts.scaling) {
    /*
     * SCALAR-STRETCH MODE. Same structure as the Lupton branch and, critically, still read back
     * from a FloatType target rather than from the canvas — so this isolates the TSL curve from
     * whatever the canvas does to the values on presentation. Those are two different suspects and
     * one measurement cannot separate them.
     */
    const scenePass = pass(scene, camera);
    const pipeline = new RenderPipeline(renderer);
    pipeline.outputColorTransform = false;
    const str = createStretchNode(scenePass.rgb, opts.scaling);
    str.setWhitePoint(opts.whitePoint ?? 1);
    pipeline.outputNode = vec4(str.node, 1);
    renderer.setRenderTarget(rt);
    renderer.setClearColor(0x000000, 1);
    await pipeline.renderAsync();
    gpu = (await renderer.readRenderTargetPixelsAsync(rt, 0, 0, width, height)) as Float32Array;
    renderer.setRenderTarget(null);
  } else if (opts.lupton) {
    /*
     * The full chain, with NO bloom. Bloom is a separate, deliberately non-physical pass; the
     * CPU reference does not model it, so including it here would measure the difference
     * between "with bloom" and "without" and report it as a parity failure.
     */
    const scenePass = pass(scene, camera);
    const pipeline = new RenderPipeline(renderer);
    pipeline.outputColorTransform = false;
    const lup = createLuptonNode(scenePass.rgb);
    lup.setDepth(depthMag, cpuLupton?.whitePixel ?? whitePixelIntensity(field, width, height, { floor: floorForDepth(depthMag) }));
    pipeline.outputNode = vec4(lup.node, 1);
    renderer.setRenderTarget(rt);
    renderer.setClearColor(0x000000, 1);
    await pipeline.renderAsync();
    gpu = (await renderer.readRenderTargetPixelsAsync(rt, 0, 0, width, height)) as Float32Array;
    renderer.setRenderTarget(null);
  } else {
    renderer.setRenderTarget(rt);
    renderer.setClearColor(0x000000, 1);
    renderer.clear();
    await renderer.renderAsync(scene, camera);
    gpu = (await renderer.readRenderTargetPixelsAsync(rt, 0, 0, width, height)) as Float32Array;
    renderer.setRenderTarget(null);
  }

  /*
   * The CPU half must mirror WHICHEVER GPU stage is being compared.
   *
   * The linear mode uses `accumulateBandRadiance`, NOT `renderReference`. That was the first
   * mistake this harness made: `renderReference` rasterises the OLD path — `color * profile(signal,
   * halo)` — so comparing it against the new `bandFlux * shape` fragment stage reported a 90% mean
   * error and a 6x peak disagreement while total energy matched to 1%. Two different images, not a
   * broken shader. It is also the exact signature the header warns about, so: suspect the harness.
   */
  let cpu: Float32Array | Float64Array;
  if (opts.scaling) {
    // The same curve, per channel, on the same accumulated radiance — the CPU mirror of the node.
    const acc = accumulateBandRadiance(field, cam, { depthMag }).radiance;
    const white = Math.max(Number.MIN_VALUE, opts.whitePoint ?? 1);
    const out = new Float32Array(acc.length);
    for (let i = 0; i < acc.length; i++) out[i] = stretch((acc[i] ?? 0) / white, opts.scaling);
    cpu = out;
  } else if (opts.lupton) {
    cpu = cpuLupton?.rgb ?? new Float32Array(0);
  } else {
    cpu = accumulateBandRadiance(field, cam, { depthMag }).radiance;
  }

  /*
   * Compared TOP-DOWN in both, which is TRAP 1. The GPU readback is RGBA (4 floats) and the CPU
   * reference is RGB (3), so the strides differ and the indices must not be conflated.
   */
  const isDisplay = opts.lupton === true || opts.scaling !== undefined;
  const floor = isDisplay ? 1 / 255 : 0.02;
  const blueGpu: number[] = [];
  const blueCpu: number[] = [];
  let energyGpu = 0;
  let energyCpu = 0;
  let sumAbs = 0;
  let compared = 0;
  let worst = 0;
  let worstAt = { x: 0, y: 0 };
  const rels: number[] = [];
  const levelDiffs: number[] = [];
  let peakGpu = 0;
  let peakCpu = 0;
  for (let p = 0; p < width * height; p++) {
    if (isDisplay) {
      const gr = gpu[p * 4] ?? 0, gg = gpu[p * 4 + 1] ?? 0, gb = gpu[p * 4 + 2] ?? 0;
      const cr = cpu[p * 3] ?? 0, cg = cpu[p * 3 + 1] ?? 0, cb = cpu[p * 3 + 2] ?? 0;
      if (Math.max(gr, gg, gb) > floor) blueGpu.push(gb / (gr + gg + gb));
      if (Math.max(cr, cg, cb) > floor) blueCpu.push(cb / (cr + cg + cb));
    }
    for (let k = 0; k < 3; k++) {
      const g = gpu[p * 4 + k] ?? 0;
      const c = cpu[p * 3 + k] ?? 0;
      energyGpu += g;
      energyCpu += c;
      sumAbs += Math.abs(g - c);
      if (g > peakGpu) peakGpu = g;
      if (c > peakCpu) peakCpu = c;
      if (opts.lupton) levelDiffs.push(Math.abs(g - c) * 255);
      if (c > floor) {
        compared++;
        const rel = Math.abs(g - c) / c;
        rels.push(rel);
        if (rel > worst) {
          worst = rel;
          worstAt = { x: p % width, y: Math.floor(p / width) };
        }
      }
    }
  }

  graph.dispose();
  rt.dispose();
  renderer.dispose();

  levelDiffs.sort((a, b) => a - b);
  const atLevel = (f: number): number =>
    levelDiffs.length ? (levelDiffs[Math.floor(f * (levelDiffs.length - 1))] ?? 0) : 0;
  rels.sort((a, b) => a - b);
  const at = (f: number): number => (rels.length ? (rels[Math.floor(f * (rels.length - 1))] ?? 0) : 0);

  return {
    percentiles: { p50: at(0.5), p90: at(0.9), p99: at(0.99), p999: at(0.999), max: worst },
    blueFraction: isDisplay
      ? {
          gpu: blueGpu.length ? blueGpu.reduce((a, b) => a + b, 0) / blueGpu.length : 0,
          cpu: blueCpu.length ? blueCpu.reduce((a, b) => a + b, 0) / blueCpu.length : 0,
        }
      : null,
    levels: isDisplay
      ? {
          mean: levelDiffs.reduce((a, b) => a + b, 0) / Math.max(1, levelDiffs.length),
          p999: atLevel(0.999),
          max: atLevel(1),
        }
      : null,
    backend: isWebGPUBackend(renderer.backend) ? "webgpu" : "webgl2",
    width,
    height,
    energyRatio: energyCpu > 0 ? energyGpu / energyCpu : Number.NaN,
    meanRelError: energyCpu > 0 ? sumAbs / energyCpu : Number.NaN,
    worstRelError: worst,
    worstAt,
    compared,
    peakGpu,
    peakCpu,
  };
}

/**
 * Check the TSL Lupton mirror against `luptonRGB` directly, with no rasterisation involved.
 *
 * A far tighter test of the mirror than a rendered frame: the inputs are chosen, so there is no
 * profile, no accumulation and no float32 rounding from a texture in the way. If this passes and
 * a rendered comparison fails, the disagreement is in the geometry, not the transfer.
 */
export function luptonMirrorCases(depthMag = DEFAULT_LUPTON_DEPTH_MAG, whitePixel = 1) {
  const q = luptonQForDepth(depthMag);
  const stretch = whitePixel * luptonStretchForWhite(q);
  const inputs: Array<[number, number, number]> = [
    [0, 0, 0],
    [1e-6, 1e-6, 1e-6],
    [0.01, 0.02, 0.04],
    [0.3, 0.2, 0.1],
    [1, 1, 1],
    [5, 2, 0.5],
    [100, 40, 10],
  ];
  return {
    q,
    stretch,
    cases: inputs.map((rgb) => ({ in: rgb, cpu: luptonRGB(rgb[0], rgb[1], rgb[2], { stretch, q }) })),
  };
}
