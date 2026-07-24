/*
 * scene.ts — Observed-mode renderer (the Three.js LAB HARNESS).
 *
 * All physics lives in the pure, three-free novascope core, filed by domain:
 * @novascope/core/photometry (apparent flux), /colorimetry (blackbody colour),
 * /optics (PSF, aureole), /imaging (white point, asinh stretch), with
 * @novascope/viz/starfield holding the pixel-space policy. This file is only the
 * Three.js glue, and its TSL graph mirrors that maths (ADR 0015).
 *
 * STAGE 4 TASK ZERO: prove the whole chain compiles and renders through BOTH
 * backends before any star graph is built on top. WebGPURenderer's WebGL 2
 * backend is a younger code path than the mature WebGLRenderer, so a TSL graph
 * that works natively is not evidence it works in fallback — and ~5% of visitors
 * get the fallback. Cheap to check now, expensive to discover after the star
 * shader exists.
 */
import * as THREE from "three";
import { WebGPURenderer, MeshBasicNodeMaterial } from "three/webgpu";
import { Fn, vec3, vec4, float, uv, instanceIndex } from "three/tsl";
import { D0_PC } from "@novascope/core/photometry";

export type RenderBackend = "webgpu" | "webgl2";

/**
 * Narrow three's base `Backend` to the WebGPU one.
 *
 * `WebGPUBackend` declares `isWebGPUBackend: true`, but `renderer.backend` is
 * typed as the base class, so the flag is not reachable without narrowing. A
 * type guard keeps this strict-TS clean — no `as` assertion asserting something
 * the compiler cannot see.
 */
function isWebGPUBackend(b: unknown): b is { isWebGPUBackend: true } {
  return typeof b === "object" && b !== null && "isWebGPUBackend" in b;
}

export interface StarLab {
  dispose(): void;
  starCount: number;
  /** Which backend actually initialised — reported, never assumed. */
  backend: RenderBackend;
}

export interface StarLabOptions {
  /**
   * Force the WebGL 2 backend even where WebGPU is available. Development only:
   * this is how the fallback path gets exercised on a machine that would
   * otherwise always take the native path.
   */
  forceWebGL?: boolean;
}

export async function initStarLab(
  canvas: HTMLCanvasElement,
  opts: StarLabOptions = {},
): Promise<StarLab> {
  // Prove the seam: the harness can reach the pure novascope physics.
  if (!(D0_PC > 0)) throw new Error("novascope physics not reachable through the @novascope alias");

  const renderer = new WebGPURenderer({
    canvas,
    antialias: true,
    alpha: false,
    forceWebGL: opts.forceWebGL ?? false,
    // outputBufferType defaults to HalfFloatType — the linear HDR buffer the
    // pipeline needs, so it is left alone rather than restated.
  });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));

  // init() is async on WebGPURenderer (device request); it also performs the
  // automatic WebGL 2 fallback internally if the WebGPU device cannot be had.
  await renderer.init();
  const backend: RenderBackend = isWebGPUBackend(renderer.backend) ? "webgpu" : "webgl2";

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
  camera.position.z = 6;

  /*
   * A small instanced field of camera-facing quads with a TSL colour graph.
   * Deliberately exercises the three things the star renderer depends on —
   * instancing, a per-instance value, and an analytic radial profile — so a
   * backend that cannot compile the graph fails HERE, with nothing else to
   * blame.
   */
  const COUNT = 12;
  const geometry = new THREE.PlaneGeometry(1, 1);
  const material = new MeshBasicNodeMaterial({ transparent: true, depthWrite: false });
  material.blending = THREE.AdditiveBlending;

  material.colorNode = Fn(() => {
    // Radial falloff across the quad: the placeholder for the PSF.
    const r = uv().sub(0.5).length().mul(2);
    const profile = float(1).sub(r).max(0).pow(2);
    // Per-instance hue so instancing is visibly working, not just compiling.
    const t = float(instanceIndex).div(float(COUNT - 1));
    return vec4(vec3(t, float(0.6), float(1).sub(t)).mul(profile), profile);
  })();

  const mesh = new THREE.InstancedMesh(geometry, material, COUNT);
  const m = new THREE.Matrix4();
  for (let i = 0; i < COUNT; i++) {
    const a = (i / COUNT) * Math.PI * 2;
    m.makeTranslation(Math.cos(a) * 2, Math.sin(a) * 2, 0);
    mesh.setMatrixAt(i, m);
  }
  mesh.frustumCulled = false;
  scene.add(mesh);

  /*
   * Reconcile the drawing buffer with the canvas's layout box INSIDE the render
   * tick, rather than from a resize event or a ResizeObserver.
   *
   * Both of those were tried and are unreliable here. A `window.resize` listener
   * misses layout changes the window did not cause (a pane resize, a container
   * or CSS change, fullscreen). ResizeObserver looks like the correct answer, but
   * its callbacks are delivered BEFORE PAINT — so in a backgrounded or
   * non-painting context it never fires at all, not even the initial callback
   * that the spec otherwise guarantees. Measured in the preview pane: zero
   * callbacks while the element genuinely resized from 1342 to 1131 CSS px, so
   * the buffer stayed at the size init happened to see.
   *
   * Reconciling per frame cannot desync from what is actually being drawn: no
   * frame means no render, which means a stale buffer cannot be observed. It
   * costs two property reads per frame.
   *
   * Star sizes are specified in PIXELS, so a stale buffer would mis-size every
   * star — this has to be right before the star graph is built on it.
   */
  let bufW = 0;
  let bufH = 0;
  const syncSize = () => {
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    // Before first layout the canvas has no box. Guessing a size here is what
    // produced a 1600px buffer under a 1342 CSS px stage; wait for real layout.
    if (w === 0 || h === 0) return;
    if (w === bufW && h === bufH) return;
    bufW = w;
    bufH = h;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  };

  /*
   * Size once up front, and again on the next macrotask. Layout often is not
   * resolved when init() returns, and rAF is ALSO paint-dependent: in a
   * backgrounded or non-painting context (measured here in the preview pane) no
   * frame ever runs, so a purely per-frame reconciliation would leave the buffer
   * at the renderer's 300x150 default. A painting browser corrects itself on
   * frame 1 regardless; this makes the non-painting case right too.
   */
  syncSize();
  const settle = setTimeout(syncSize, 0);

  let raf = 0;
  const tick = () => {
    raf = requestAnimationFrame(tick);
    syncSize();
    // render(), not renderAsync() — the latter was deprecated in r181 in favour
    // of render() plus an awaited init(), which this already does.
    renderer.render(scene, camera);
  };
  raf = requestAnimationFrame(tick);

  return {
    starCount: COUNT,
    backend,
    dispose() {
      cancelAnimationFrame(raf);
      clearTimeout(settle);
      geometry.dispose();
      material.dispose();
      void renderer.dispose();
    },
  };
}
