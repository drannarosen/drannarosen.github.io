/*
 * scene.ts — Observed-mode renderer (the Three.js LAB HARNESS).
 *
 * All physics lives in the pure, three-free novascope core, filed by domain:
 * core/photometry (flux, passbands), core/colorimetry (colour schemes),
 * core/optics (PSF, aureole), core/imaging (white point, asinh stretch), with
 * viz/starfield holding the pixel-space policy and the CPU preparation. This
 * file is only the Three.js glue (ADR 0015).
 *
 * Verified through BOTH backends: native WebGPU, and the WebGL 2 fallback via
 * `forceWebGL` — ~5% of visitors take the latter and it is a younger code path
 * than the mature WebGLRenderer, so it is exercised rather than assumed.
 */
import * as THREE from "three";
import { WebGPURenderer } from "three/webgpu";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { prepareStarField, type PrepareOptions } from "@novascope/viz/starfield/prepare";
import { createStarGraph, type StarGraph } from "./starGraph";

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

export interface StarLabStats {
  visible: number;
  clipping: number;
  tierCounts: [number, number, number];
}

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
  /** Data directory for the realization. */
  base?: string;
}

export async function initStarLab(
  canvas: HTMLCanvasElement,
  opts: StarLabOptions = {},
): Promise<StarLab> {
  const base = opts.base ?? "/data/gravoturb";
  const [meta, starBuf] = await Promise.all([
    fetch(`${base}/meta.json`).then((r) => r.json() as Promise<Record<string, number>>),
    fetch(`${base}/stars.f32`).then((r) => r.arrayBuffer()),
  ]);
  const stars = new Float32Array(starBuf);
  const boxPc = (meta.box_pc as number) ?? 6;

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
  camera.position.set(0, 0, boxPc * 1.5);

  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.autoRotate = !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  controls.autoRotateSpeed = 0.3;

  let graph: StarGraph | null = null;
  let stats: StarLabStats = { visible: 0, clipping: 0, tierCounts: [0, 0, 0] };

  const build = (o: PrepareOptions): StarLabStats => {
    if (graph) {
      scene.remove(graph.mesh);
      graph.dispose();
    }
    const field = prepareStarField(stars, o);
    graph = createStarGraph(field);
    scene.add(graph.mesh);
    stats = {
      visible: field.stats.visible,
      clipping: field.stats.clipping,
      tierCounts: field.stats.tierCounts,
    };
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
    starCount: Math.floor(stars.length / 6),
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
