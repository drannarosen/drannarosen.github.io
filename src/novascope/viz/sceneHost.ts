/*
 * sceneHost.ts — the three.js renderer, scene, camera and lifecycle, owned once (Layer 2).
 *
 * ── WHY THIS EXISTS ──
 *
 * `/explore/feedback-budget` is moving onto three.js so the raymarched gas volume and the star
 * points can share ONE scene, which is what makes a star genuinely occluded by the cloud in front
 * of it rather than composited over it and hoped about
 * (docs/plans/2026-08-09-feedback-volumetric-renderer-design.md).
 *
 * Sharing a scene means sharing a renderer, a camera, a resize path and a draw loop. Every
 * renderer in this package had been writing its own copy of that — `clusterPoints` and
 * `viz/webgl/engine` each carried a DPR cap, a resize observer, a reduced-motion check, a
 * pause-when-hidden rule and a `cleanup()`, with different bugs available to each. This is the one
 * copy.
 *
 * ── WHAT IT DOES NOT DO ──
 *
 * It knows nothing about stars, gas, luminosity or physics. It owns a `pivot` group; a layer adds
 * geometry to it and calls `invalidate()`. That boundary is what lets the star layer's appearance
 * stay the single physics→pixel mapping in `state/render.ts` — the host cannot change how a star
 * looks because it never sees one.
 *
 * ── THE CAMERA IS ORTHOGRAPHIC, AND BOTH LAYERS LIVE WITH IT ──
 *
 * A perspective camera makes apparent size depend on depth, which would fight the one thing the
 * star layer exists for: apparent size carries luminosity and nothing else. The volume raymarch was
 * written perspective (`ro = (0,0,eyeZ)`, rays diverging from an eye point), so ONE of them had to
 * move, and it is the volume — parallel rays into the box, agreed 2026-08-09.
 *
 * That is not merely a concession to the star layer. Under a parallel projection a length on
 * screen denotes the same physical length everywhere in the frame, which a figure about where
 * feedback acts should want.
 *
 * ── START IS EXPLICIT ──
 *
 * `createSceneHost` does NOT begin painting. A layer builds its geometry and then calls `start()`,
 * which acquires the device and only then reports ready.
 *
 * The alternative — init on construction — happens to work, because a layer's `build()` is
 * synchronous and a promise callback cannot interleave with it. Relying on that would make the
 * ordering a property of JavaScript's event loop rather than of this file, and the first thing to
 * break it would be a layer that builds asynchronously.
 */
import * as THREE from "three";
import { WebGPURenderer } from "three/webgpu";

/**
 * How much of the short edge the framing radius fills. Below 1 so a star sitting exactly at the
 * framing radius keeps its glow inside the frame.
 */
const FRAME_FILL = 0.92;
/** Seconds for one full turn of the idle drift. Slow, and off by default. */
const DRIFT_PERIOD_SEC = 110;

/**
 * `renderer.backend` is typed as the base class, so the WebGPU-ness has to be sniffed. Reported
 * rather than asserted: both backends are legitimate, and what must never happen is not knowing
 * which one ran — see `check-cluster-points`, where a baseline captured on the wrong rasteriser
 * moved the image further than switching backend did.
 */
function isWebGPUBackend(b: unknown): b is { isWebGPUBackend: true } {
  return typeof b === "object" && b !== null && "isWebGPUBackend" in b;
}

export interface SceneHostOptions {
  /** Force the WebGL 2 backend. Development only — exercises the fallback. */
  forceWebGL?: boolean;
  /** Start with the view drifting. Defaults to false: on an explorable the motion should be the
   *  physics, not the camera. */
  drifting?: boolean;
  /** Reuse an existing renderer instead of creating one. NOT disposed by this host. */
  renderer?: WebGPURenderer;
  /**
   * Called once the GPU device is up and the first frame has been sized.
   *
   * A WebGPU device is acquired asynchronously, so `pxPerPc` is meaningless until then — it reads
   * as its placeholder 1. A consumer that draws a scale bar from it on construction gets a bar off
   * by whatever the real scale turns out to be (measured: "200 pc" on a 0.65 pc cluster).
   */
  onReady?: () => void;
}

export interface SceneHost {
  /** Add geometry here, never to `scene` — the pivot carries the centring and the orbit. */
  readonly pivot: THREE.Group;
  readonly scene: THREE.Scene;
  readonly camera: THREE.OrthographicCamera;
  readonly renderer: WebGPURenderer;
  /** Capped device pixel ratio. A layer authoring sizes in CSS px must scale by this. */
  readonly dpr: number;
  readonly backend: "webgpu" | "webgl2";
  /**
   * True when honouring prefers-reduced-motion. It suppresses the idle DRIFT, and nothing else.
   *
   * This said "no drift, no render loop", which was never what the code did — `play()` gates on
   * `raf`, `document.hidden` and `onScreen`, and has never consulted this. Stopping the loop would
   * also be wrong for an explorable: the motion here is the physics, started by the reader pressing
   * run and stopped by a visible pause control, which is what the preference asks for. What it must
   * not do is move the CAMERA on its own, and that is exactly what this suppresses.
   */
  readonly reducedMotion: boolean;
  readonly drifting: boolean;
  /** Frames actually presented — the only reliable way to confirm a pause. */
  readonly frames: number;
  /** Pixels per parsec along the short edge, for a scale bar that survives zoom. */
  readonly pxPerPc: number;
  readonly zoom: number;
  /** Half-width of the framing before user zoom [pc]. */
  readonly maxRPc: number;
  setDrifting(on: boolean): void;
  /**
   * Frame on a physically-derived centre and radius.
   *
   * The CALLER owns this because the caller owns the physics: a dissolving cluster recoils and
   * expands, and the honest frame follows the BOUND remnant rather than the coordinate origin it
   * started at. Without it the camera stays where the cluster was born — measured on
   * /explore/dynamics, 372 of 400 stars in frame at t=0 falling to ONE by 700 crossing times,
   * while five readouts went on describing a panel that was empty.
   */
  setFraming(opts: { centre?: readonly number[]; radiusPc?: number }): void;
  setZoom(z: number): void;
  /** Mark the frame stale. Cheap; coalesced by the loop. */
  invalidate(): void;
  /** Mark stale AND paint now if the loop is not running — a paused page must still update. */
  redraw(): void;
  /** Begin: listeners, device acquisition, first paint. Call after the layers have built. */
  start(): void;
  dispose(): void;
}

export function createSceneHost(canvas: HTMLCanvasElement, opts: SceneHostOptions = {}): SceneHost {
  const motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
  const reducedMotion = motionQuery.matches;

  const ownsRenderer = !opts.renderer;
  const renderer =
    opts.renderer ??
    new WebGPURenderer({
      canvas,
      antialias: true,
      alpha: true,
      forceWebGL: opts.forceWebGL ?? false,
    });
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  renderer.setPixelRatio(dpr);

  const scene = new THREE.Scene();
  let maxR = 1e-6;
  let zoom = 1;
  const centre = new THREE.Vector3(0, 0, 0);
  const pivot = new THREE.Group();
  /*
   * ORTHOGRAPHIC, not perspective. `renderClusterField`'s 2-D mode is an orthographic projection
   * scaled by `maxR`, and its 3-D mode adds only a mild depth CUE, not a vanishing point.
   */
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.01, 1000);
  camera.position.set(0, 0, 100);
  camera.lookAt(0, 0, 0);
  scene.add(pivot);

  let bufW = 0;
  let bufH = 0;
  let pxPerPc = 1;
  /** Set when the framing (maxR, zoom, centre) changes, so syncSize re-projects. */
  let reframe = false;

  function syncSize(): void {
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (w === 0 || h === 0) return; // before layout; guessing mis-sizes every star
    const resized = w !== bufW || h !== bufH;
    if (!resized && !reframe) return;
    reframe = false;
    /*
     * A REFRAME MUST NOT RESIZE THE CANVAS.
     *
     * `renderer.setSize` assigns `canvas.width`/`canvas.height` unconditionally, and assigning
     * either RESETS the backing store even when the value is unchanged. That is a clear, not a
     * resize, and it lands wherever it is called from.
     *
     * `redraw()` calls this from `setPositions`/`setAlpha`, which run AFTER the loop has already
     * painted the frame, and it only repaints itself when the loop is stopped (`if (!raf) draw()`).
     * So a `setSize` on that path wiped the finished frame and nothing redrew it before it was
     * presented. Measured on /explore/dynamics with gravity on, where the page reframes on the
     * bound centre EVERY frame: 292 setSize calls against 291 draws — one clear per paint — and a
     * panel that was black while `frames` climbed, positions were finite and every alpha was
     * non-zero. Gravity off never reframes, so the same code rendered fine, which is what made it
     * look like a physics bug.
     *
     * Only the backing store is conditional. The projection below is recomputed for both cases,
     * because a reframe is exactly a change to it.
     */
    if (resized) {
      bufW = w;
      bufH = h;
      renderer.setSize(w, h, false);
    }
    /*
     * Frame on the SHORT edge, as `renderClusterField` does (`min(w, h)/2`), so a non-square panel
     * crops nothing and the content keeps its aspect.
     */
    const half = maxR / FRAME_FILL / zoom;
    const aspect = w / h;
    const halfW = aspect >= 1 ? half * aspect : half;
    const halfH = aspect >= 1 ? half : half / aspect;
    camera.left = -halfW;
    camera.right = halfW;
    camera.top = halfH;
    camera.bottom = -halfH;
    camera.updateProjectionMatrix();
    pxPerPc = Math.min(w, h) / (2 * half);
    dirty = true;
  }

  let disposed = false;
  let started = false;
  let drifting = (opts.drifting ?? false) && !reducedMotion;
  let yaw = 0;
  let dirty = true;
  let frames = 0;
  let raf = 0;
  let onScreen = true;
  let lastNow: number | null = null;
  /*
   * A WebGPU device is acquired ASYNCHRONOUSLY, and `render()` before that throws "called before
   * the backend is initialized". This host stays SYNCHRONOUS and gates painting instead, which is
   * what explorables need: one rebuilds its cluster from a slider, a reset and a reseed, and an
   * async mount means several builds can be in flight at once. A sync factory that simply does not
   * paint until the device is ready has no race to guard.
   */
  let ready = false;

  function draw(): void {
    if (!ready) return;
    frames++;
    renderer.render(scene, camera);
  }

  function tick(now: number): void {
    raf = requestAnimationFrame(tick);
    syncSize();
    if (drifting && lastNow !== null) {
      yaw += ((2 * Math.PI) / DRIFT_PERIOD_SEC) * ((now - lastNow) / 1000);
      scene.rotation.y = yaw;
      dirty = true;
    }
    lastNow = now;
    if (!dirty) return;
    dirty = false;
    draw();
  }

  function play(): void {
    if (raf || document.hidden || !onScreen) return;
    lastNow = null;
    raf = requestAnimationFrame(tick);
  }
  function stop(): void {
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
  }

  const io = new IntersectionObserver(
    (e) => {
      onScreen = e[0]?.isIntersecting ?? true;
      if (onScreen) play();
      else stop();
    },
    { threshold: 0 },
  );
  function onVisibility(): void {
    if (document.hidden) stop();
    else play();
  }
  function onResize(): void {
    syncSize();
  }

  // ── drag to orbit, matching census's `attachOrbit` affordance ──
  let dragging = false;
  let lastX = 0;
  let lastY = 0;
  let pitch = 0;
  const onDown = (e: PointerEvent): void => {
    dragging = true;
    lastX = e.clientX;
    lastY = e.clientY;
    canvas.setPointerCapture(e.pointerId);
  };
  const onMove = (e: PointerEvent): void => {
    if (!dragging) return;
    yaw += (e.clientX - lastX) * 0.01;
    pitch = Math.max(-1.45, Math.min(1.45, pitch + (e.clientY - lastY) * 0.01));
    lastX = e.clientX;
    lastY = e.clientY;
    scene.rotation.y = yaw;
    scene.rotation.x = pitch;
    dirty = true;
  };
  const onUp = (e: PointerEvent): void => {
    dragging = false;
    if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
  };
  /* Wheel zooms about the frame centre, as census's `attachOrbit` does. Passive false because a
     zoomable canvas that also scrolls the page is unusable. */
  const onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    zoom = Math.min(40, Math.max(0.15, zoom * Math.exp(-e.deltaY * 0.0015)));
    reframe = true;
    dirty = true;
  };
  canvas.addEventListener("wheel", onWheel, { passive: false });
  canvas.addEventListener("pointerdown", onDown);
  canvas.addEventListener("pointermove", onMove);
  canvas.addEventListener("pointerup", onUp);
  canvas.addEventListener("pointercancel", onUp);

  return {
    pivot,
    scene,
    camera,
    renderer,
    dpr,
    reducedMotion,
    get backend() {
      return isWebGPUBackend(renderer.backend) ? "webgpu" : "webgl2";
    },
    get drifting() {
      return drifting;
    },
    get frames() {
      return frames;
    },
    get pxPerPc() {
      return pxPerPc;
    },
    get zoom() {
      return zoom;
    },
    get maxRPc() {
      return maxR;
    },
    setDrifting(on) {
      drifting = on && !reducedMotion;
      lastNow = null;
      dirty = true;
    },
    setFraming(next) {
      if (next.centre) {
        centre.set(next.centre[0] ?? 0, next.centre[1] ?? 0, next.centre[2] ?? 0);
        pivot.position.copy(centre).multiplyScalar(-1);
      }
      if (next.radiusPc !== undefined && next.radiusPc > 0) maxR = next.radiusPc;
      reframe = true;
      dirty = true;
    },
    setZoom(z) {
      zoom = Math.min(40, Math.max(0.15, z));
      reframe = true;
      dirty = true;
    },
    invalidate() {
      dirty = true;
    },
    redraw() {
      /* syncSize FIRST. A paused page still has to honour a reframe: `setModel` changes the
         framing radius and then paints immediately, and painting before re-projecting would draw
         the new cluster through the old camera. Cheap — it early-returns unless something moved. */
      syncSize();
      dirty = true;
      if (!raf) draw();
    },
    start() {
      if (started || disposed) return;
      started = true;
      io.observe(canvas);
      window.addEventListener("resize", onResize, { passive: true });
      document.addEventListener("visibilitychange", onVisibility);
      /* Everything before this is device-independent: the scene graph, the geometry and the
         listeners all exist before the GPU does. Only painting waits. */
      void renderer.init().then(() => {
        if (disposed) return; // disposed while awaiting the device
        ready = true;
        syncSize();
        dirty = true;
        draw();
        play();
        opts.onReady?.();
      });
    },
    dispose() {
      disposed = true;
      stop();
      io.disconnect();
      window.removeEventListener("resize", onResize);
      document.removeEventListener("visibilitychange", onVisibility);
      canvas.removeEventListener("wheel", onWheel);
      canvas.removeEventListener("pointerdown", onDown);
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerup", onUp);
      canvas.removeEventListener("pointercancel", onUp);
      /* Only what this host created. A shared renderer outlives any one layer, and disposing a
         caller's device here would take the gas down with the stars. */
      if (ownsRenderer) void renderer.dispose();
    },
  };
}
