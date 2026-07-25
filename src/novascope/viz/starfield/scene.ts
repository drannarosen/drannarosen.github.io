/*
 * scene.ts — Observed-mode renderer (the Three.js LAB HARNESS).
 *
 * All physics lives in the pure, three-free novascope CORE, filed by domain:
 * core/photometry (flux, passbands), core/colorimetry (colour schemes),
 * core/optics (PSF, aureole), core/imaging (white point, asinh stretch), with
 * viz/starfield holding the pixel-space policy and the CPU preparation. This
 * file is only the Three.js glue (ADR 0015).
 *
 * It is glue that belongs to the PACKAGE, though, not to the site — a renderer
 * is what novascope is for. So `three` is a Layer 2 dependency and the purity
 * claim is scoped to core, which is where the node gates run.
 *
 * Verified through BOTH backends: native WebGPU, and the WebGL 2 fallback via
 * `forceWebGL` — ~5% of visitors take the latter and it is a younger code path
 * than the mature WebGLRenderer, so it is exercised rather than assumed.
 */
import * as THREE from "three";
import { WebGPURenderer } from "three/webgpu";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { prepareStarField, STAR_STRIDE, type PrepareOptions, type StarField } from "./prepare.ts";
import { clusterStarTable } from "./source.ts";
import { createStarGraph, type StarGraph } from "./starGraph.ts";

export type RenderBackend = "webgpu" | "webgl2";

/**
 * Narrow three's base `Backend` to the WebGPU one. `WebGPUBackend` declares
 * `isWebGPUBackend: true`, but `renderer.backend` is typed as the base class, so
 * a type guard is needed — no `as` assertion asserting what the compiler cannot
 * see.
 */
function isWebGPUBackend(b: unknown): b is { isWebGPUBackend: true } {
  return typeof b === "object" && b !== null && "isWebGPUBackend" in b;
}

/**
 * The prepared field's own diagnostics, passed through unchanged.
 *
 * DERIVED from `StarField` rather than re-declared: this used to be a hand-written
 * subset (visible, clipping, tierCounts), so every new statistic had to be added
 * in two places and a consumer could only read what someone had remembered to
 * copy. Aliasing the source type means the readout cannot lag the physics.
 */
export type StarLabStats = StarField["stats"];

export interface StarLab {
  info: { calls: number; tris: number };
  dispose(): void;
  starCount: number;
  backend: RenderBackend;
  stats: StarLabStats;
  /** Rebuild the field with new physics options (scheme, band, exposure…). */
  update(opts: PrepareOptions): StarLabStats;
}

export interface StarLabOptions extends PrepareOptions {
  /** Force the WebGL 2 backend. Development only — exercises the fallback. */
  forceWebGL?: boolean;
  /** How many stars to sample. */
  count?: number;
  /** Cluster seed — the same seed always gives the same cluster. */
  seed?: number;
}

export async function initStarLab(
  canvas: HTMLCanvasElement,
  opts: StarLabOptions = {},
): Promise<StarLab> {
  /*
   * The population is SAMPLED, not fetched (see ./source for why the gravoturb
   * export's positions cannot be imaged). No network, and deterministic in the
   * seed, so a reload shows the identical cluster.
   */
  const stars = clusterStarTable({
    ...(opts.seed !== undefined ? { seed: opts.seed } : {}),
    sampling: { mode: "count", target: opts.count ?? 10_000 },
  });
  const count = Math.floor(stars.length / STAR_STRIDE);
  /*
   * Frame on the cluster's own half-mass radius, measured from the stars that
   * were actually drawn rather than declared: a sampled population's r_half is a
   * property of the draw, so deriving it here means the framing cannot disagree
   * with what is on screen.
   */
  const radii: number[] = [];
  for (let i = 0; i < count; i++) {
    const o = i * STAR_STRIDE;
    radii.push(Math.hypot(stars[o] ?? 0, stars[o + 1] ?? 0, stars[o + 2] ?? 0));
  }
  radii.sort((a, b) => a - b);
  const rHalfPc = radii[Math.floor(count / 2)] ?? 1;
  const framePc = rHalfPc * 6;

  const renderer = new WebGPURenderer({
    canvas,
    antialias: true,
    alpha: false,
    forceWebGL: opts.forceWebGL ?? false,
    // outputBufferType defaults to HalfFloatType — the linear HDR buffer this
    // pipeline needs, so it is left alone rather than restated.
  });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  renderer.toneMapping = THREE.AgXToneMapping;
  await renderer.init();
  const backend: RenderBackend = isWebGPUBackend(renderer.backend) ? "webgpu" : "webgl2";

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(45, 1, 0.01, 1000);
  camera.position.set(0, 0, framePc);

  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.autoRotate = !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  controls.autoRotateSpeed = 0.3;

  let graph: StarGraph | null = null;
  /*
   * Seeded by an actual preparation of an empty field rather than a hand-written
   * zero literal, so this initializer cannot drift as `StarField["stats"]` gains
   * members — which is the same reason `StarLabStats` aliases that type.
   */
  let stats: StarLabStats = prepareStarField(new Float32Array(0)).stats;

  const build = (o: PrepareOptions): StarLabStats => {
    if (graph) {
      scene.remove(graph.mesh);
      graph.dispose();
    }
    // Core sizes are authored in CSS px; the GPU works in device px.
    const field = prepareStarField(stars, { pixelRatio: renderer.getPixelRatio(), ...o });
    graph = createStarGraph(field);
    scene.add(graph.mesh);
    stats = field.stats;
    return stats;
  };
  build(opts);

  /*
   * Reconcile the drawing buffer with the canvas's layout box inside the render
   * tick, plus once at init and on the next macrotask.
   *
   * ResizeObserver looks like the right answer and is not: its callbacks are
   * delivered BEFORE PAINT, so in a non-painting context it never fires at all —
   * measured firing zero times while the canvas genuinely resized 1342 -> 1131
   * CSS px. rAF is paint-dependent too, so a purely per-frame reconciliation
   * leaves the buffer at the renderer's default there. Star sizes are specified
   * in PIXELS, so a stale buffer mis-sizes every star.
   */
  let bufW = 0;
  let bufH = 0;
  const syncSize = () => {
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (w === 0 || h === 0) return; // before layout; guessing a size mis-sizes stars
    if (w === bufW && h === bufH) return;
    bufW = w;
    bufH = h;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  };
  syncSize();
  const settle = setTimeout(syncSize, 0);

  let raf = 0;
  const tick = () => {
    raf = requestAnimationFrame(tick);
    syncSize();
    controls.update();
    renderer.render(scene, camera);
  };
  raf = requestAnimationFrame(tick);

  return {
    /** Draw-call diagnostics — ground truth for "is anything rendering". */
    get info() {
      return { calls: renderer.info.render.drawCalls, tris: renderer.info.render.triangles };
    },
    starCount: count,
    backend,
    get stats() {
      return stats;
    },
    update(next) {
      return build(next);
    },
    dispose() {
      cancelAnimationFrame(raf);
      clearTimeout(settle);
      controls.dispose();
      if (graph) {
        scene.remove(graph.mesh);
        graph.dispose();
      }
      void renderer.dispose();
    },
  };
}
