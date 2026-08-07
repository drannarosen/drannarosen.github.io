/*
 * viz/clusterPoints.ts — the cluster AS A DIAGRAM, on three.js / WebGPU (Layer 2).
 *
 * ── WHY THIS EXISTS ALONGSIDE `viz/starfield` ──
 *
 * The two draw different KINDS of picture, and neither is a worse version of the
 * other:
 *
 *   viz/starfield   a PHOTOGRAPH — real Moffat PSF, aureole, diffraction spikes,
 *                   robust percentile exposure, asinh. Apparent size is not a
 *                   choice, it is the quad that contains the PSF. Built for
 *                   /star-render-lab, whose subject is representation itself.
 *
 *   viz/clusterPoints  a DIAGRAM — apparent size is log-luminosity compressed
 *                   into a few pixels, and alpha is FLOORED so the faint majority
 *                   is always visible. Built for the explorables, whose subject
 *                   is where the stars ARE.
 *
 * That distinction was learned the expensive way on /explore/dynamics: no
 * exposure setting makes the photographic renderer look like the diagram one,
 * because the diagram's law is not an exposure. Measured on that cluster, the
 * photographic path drew the heaviest 10% at 19.4x the typical star (a handful of
 * flares over an empty frame) and the unit-luminance path at 1.7x (a flat haze
 * with no segregation visible). The census law lands between the two by
 * construction, and it was already written and already shipped.
 *
 * ── THE LAW IS NOT DEFINED HERE ──
 *
 * This module consumes a `RenderModel` from `state/render.ts` — the same object
 * `renderClusterField` consumes — and draws exactly the `sizePx`, `alpha` and
 * `color` it is given. It decides nothing about how a star looks.
 *
 * That is deliberate and it is what keeps /explore/census safe: census's
 * appearance comes from `toRenderModel`, this renderer never touches that
 * function, and so adding this file cannot change census by any path. It also
 * means the two renderers cannot drift into two different-looking clusters —
 * "the ONE physics→pixel mapping" (render.ts) stays one.
 *
 * The look it reproduces is `renderClusterField`'s, term for term:
 *   halo   a linear ramp from 0.5*alpha at the centre to 0 at 3.2*sizePx
 *   core   a solid disc of `alpha` within sizePx
 *   both additive, because stars are emitters
 *
 * One deliberate difference: `renderClusterField` draws stars under 1.6 px as
 * square dots. That is a canvas-2D performance hack — "the faint many get a cheap
 * square dot; only the bright few get the expensive radial-gradient glow" — not a
 * decision about how a star looks. On the GPU every instance costs the same, so
 * every star gets the disc.
 */
import * as THREE from "three";
import { MeshBasicNodeMaterial, WebGPURenderer } from "three/webgpu";
import {
  Fn,
  instancedBufferAttribute,
  cameraProjectionMatrix,
  modelViewMatrix,
  positionLocal,
  uniform,
  uv,
  vec4,
  float,
  screenSize,
} from "three/tsl";
import type { RenderModel } from "../state/render.ts";

/** Half-width of the glow, in core radii — `renderClusterField`'s `r * 3.2`. */
const HALO_RADII = 3.2;

/*
 * Narrow three's base `Backend` to the WebGPU one. `WebGPUBackend` declares
 * `isWebGPUBackend: true` but `renderer.backend` is typed as the base class, so
 * the property is not reachable without this. Same guard as `starfield/scene.ts`
 * — deliberately restated rather than shared, because it is a TypeScript
 * narrowing detail, not a fact about the renderer that could drift.
 */
function isWebGPUBackend(b: unknown): b is { isWebGPUBackend: true } {
  return typeof b === "object" && b !== null && "isWebGPUBackend" in b;
}

/**
 * How much of the half-frame the p90 radius fills.
 *
 * `renderClusterField` uses `((min(w,h)/2) * 0.92) / maxR` pixels per parsec, so
 * the 90th-percentile star sits at 92% of the way out and the sparse tail beyond
 * it renders toward the edges. Same number here so the two frame identically.
 */
const FRAME_FILL = 0.92;

export interface ClusterPointsOptions {
  /** Force the WebGL 2 backend. Development only — exercises the fallback. */
  forceWebGL?: boolean;
  /** Start with the view drifting. Defaults to false: on an explorable the
   *  motion should be the physics, not the camera. */
  drifting?: boolean;
}

export interface ClusterPoints {
  /** Replace the whole model — new sizes, colours, alphas and framing. */
  setModel(model: RenderModel): void;
  /** Move the stars only: `count * 3` floats of xyz [pc]. The per-frame path. */
  setPositions(xyz: Float32Array): void;
  /** True when honouring prefers-reduced-motion: no drift, no render loop. */
  readonly reducedMotion: boolean;
  readonly drifting: boolean;
  setDrifting(on: boolean): void;
  /** Frames actually presented — the only reliable way to confirm a pause. */
  readonly frames: number;
  readonly backend: "webgpu" | "webgl2";
  /** Parsecs per unit of the framing, for a scale bar. */
  readonly maxRPc: number;
  redraw(): void;
  dispose(): void;
}

interface Buffers {
  pos: THREE.InstancedBufferAttribute;
  color: THREE.InstancedBufferAttribute;
  size: THREE.InstancedBufferAttribute;
  alpha: THREE.InstancedBufferAttribute;
}

function packModel(model: RenderModel, dpr: number): {
  buffers: Buffers;
  count: number;
} {
  const n = model.stars.length;
  const pos = new Float32Array(n * 3);
  const color = new Float32Array(n * 3);
  const size = new Float32Array(n);
  const alpha = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const s = model.stars[i]!;
    pos[i * 3] = s.x;
    pos[i * 3 + 1] = s.y;
    pos[i * 3 + 2] = s.z;
    /* `RenderStar.color` is intrinsic sRGB in [0,1] — `core/stellar` says so, and
       `viz/lifecycle.rgb()` is what multiplies it up to 0-255 for a CSS colour
       string. Dividing by 255 here (assuming the CSS convention) made every star
       ~0.002 and the whole cluster rendered as dark dots. */
    color[i * 3] = s.color[0];
    color[i * 3 + 1] = s.color[1];
    color[i * 3 + 2] = s.color[2];
    /* `sizePx` is authored in CSS px (census draws through a dpr-scaled 2-D
       transform); the GPU works in device px. */
    size[i] = s.sizePx * dpr;
    alpha[i] = s.alpha;
  }
  return {
    count: n,
    buffers: {
      pos: new THREE.InstancedBufferAttribute(pos, 3),
      color: new THREE.InstancedBufferAttribute(color, 3),
      size: new THREE.InstancedBufferAttribute(size, 1),
      alpha: new THREE.InstancedBufferAttribute(alpha, 1),
    },
  };
}

export function createClusterPoints(
  canvas: HTMLCanvasElement,
  model: RenderModel,
  opts: ClusterPointsOptions = {},
): ClusterPoints {
  const motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
  const reducedMotion = motionQuery.matches;

  const renderer = new WebGPURenderer({
    canvas,
    antialias: true,
    alpha: true,
    forceWebGL: opts.forceWebGL ?? false,
  });
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  renderer.setPixelRatio(dpr);

  const scene = new THREE.Scene();
  /*
   * ORTHOGRAPHIC, not perspective. `renderClusterField`'s 2-D mode is an
   * orthographic projection scaled by `maxR`, and its 3-D mode adds only a mild
   * depth CUE, not a vanishing point. A perspective camera would make a star's
   * apparent size depend on its depth, which would fight the one thing this
   * renderer is for: apparent size carries luminosity and nothing else.
   */
  let maxR = model.maxR || 1e-6;
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.01, 1000);
  camera.position.set(0, 0, 100);
  camera.lookAt(0, 0, 0);

  let mesh: THREE.Mesh | null = null;
  let geometry: THREE.InstancedBufferGeometry | null = null;
  let material: MeshBasicNodeMaterial | null = null;
  let plane: THREE.PlaneGeometry | null = null;
  let buffers: Buffers | null = null;
  let count = 0;

  const uHalo = uniform(HALO_RADII);

  function build(m: RenderModel): void {
    disposeMesh();
    maxR = m.maxR || 1e-6;
    const packed = packModel(m, dpr);
    buffers = packed.buffers;
    count = packed.count;

    plane = new THREE.PlaneGeometry(1, 1);
    geometry = new THREE.InstancedBufferGeometry();
    geometry.setIndex(plane.getIndex());
    geometry.setAttribute("position", plane.getAttribute("position"));
    geometry.setAttribute("uv", plane.getAttribute("uv"));
    geometry.instanceCount = count;
    /* Registered on the geometry AND bound in TSL. Without an instanced attribute
       three derives an instance count of zero and issues no draw call; and the
       TSL side must be `instancedBufferAttribute`, because `attribute(name)`
       resolves PER-VERTEX and silently yields zero — every quad then lands on the
       origin. Both halves are load-bearing (see starGraph.ts). */
    geometry.setAttribute("iPos", buffers.pos);
    geometry.setAttribute("iColor", buffers.color);
    geometry.setAttribute("iSizePx", buffers.size);
    geometry.setAttribute("iAlpha", buffers.alpha);

    const iPos = instancedBufferAttribute<"vec3">(buffers.pos, "vec3");
    const iColor = instancedBufferAttribute<"vec3">(buffers.color, "vec3");
    const iSizePx = instancedBufferAttribute<"float">(buffers.size, "float");
    const iAlpha = instancedBufferAttribute<"float">(buffers.alpha, "float");

    material = new MeshBasicNodeMaterial({
      transparent: true,
      depthWrite: false,
      depthTest: false,
    });
    /*
     * PREMULTIPLIED additive, not `THREE.AdditiveBlending`, because this canvas
     * is TRANSPARENT and composites over the panel.
     *
     * `AdditiveBlending` resolves to (SrcAlpha, One) — it multiplies rgb by alpha
     * and leaves the destination alpha alone. starGraph.ts therefore returns
     * alpha = 1 and puts the profile in rgb, which is correct for its OPAQUE
     * canvas (`alpha: false`). Doing the same here painted every star as an
     * opaque black SQUARE: alpha 1 across the whole quad told the compositor the
     * quad was solid, and where the profile was zero the solid thing was black.
     *
     * With (One, One) on both channels the source rgb is added as given, so rgb
     * carries `colour * profile` and alpha carries `profile` — the quad stays
     * transparent at its edges, the falloff is applied exactly ONCE, and stars
     * still add where they overlap, which is what `globalCompositeOperation =
     * "lighter"` does in the canvas renderer and why no depth sort is needed.
     */
    material.blending = THREE.CustomBlending;
    material.blendSrc = THREE.OneFactor;
    material.blendDst = THREE.OneFactor;
    material.blendSrcAlpha = THREE.OneFactor;
    material.blendDstAlpha = THREE.OneFactor;
    material.premultipliedAlpha = true;

    // ── vertex: project the centre, then offset the corner by pixels ──
    material.vertexNode = Fn(() => {
      const clip = cameraProjectionMatrix.mul(modelViewMatrix.mul(vec4(iPos, 1)));
      /* The quad has to contain the HALO, not just the core, or the glow is
         clipped to a square — the same coupling starfield's quad sizing solves. */
      const halfPx = iSizePx.mul(uHalo);
      const offset = positionLocal.xy.mul(2).mul(halfPx).mul(2).div(screenSize).mul(clip.w);
      return vec4(clip.xy.add(offset), clip.z, clip.w);
    })();

    // ── fragment: renderClusterField's two terms, in the same units ──
    material.colorNode = Fn(() => {
      /* Distance from the quad centre, back in PIXELS. uv spans 0..1, so
         (uv-0.5)*2 spans -1..1 and multiplying by the half-extent recovers px. */
      const d = uv().sub(0.5).mul(2).length().mul(iSizePx).mul(uHalo);
      /* Halo: the canvas gradient ramps LINEARLY from 0.5*alpha at the centre to
         zero at 3.2r, so this is a linear ramp, not a Gaussian. */
      const halo = float(1).sub(d.div(iSizePx.mul(uHalo))).max(0).mul(iAlpha).mul(0.5);
      /* Core: a solid disc of `alpha` inside sizePx, with one pixel of feather so
         the smallest stars do not alias into squares. */
      const core = iSizePx.sub(d).clamp(0, 1).mul(iAlpha);
      const profile = halo.add(core).clamp(0, 1);
      /*
       * Premultiplied: rgb is ALREADY scaled by the profile and alpha carries the
       * profile itself. Safe only because the blend above is (One, One) — under
       * three's `AdditiveBlending` (SrcAlpha, One) this exact line would apply the
       * falloff twice and square it, which starGraph.ts records measuring, where
       * it halved the size-vs-luminosity exponent.
       */
      return vec4(iColor.mul(profile), profile);
    })();

    mesh = new THREE.Mesh(geometry, material);
    mesh.frustumCulled = false; // centres can sit outside a frame whose glow is inside
    scene.add(mesh);
  }

  function disposeMesh(): void {
    if (mesh) scene.remove(mesh);
    geometry?.dispose();
    plane?.dispose();
    material?.dispose();
    mesh = null;
    geometry = null;
    plane = null;
    material = null;
  }

  let bufW = 0;
  let bufH = 0;
  function syncSize(): void {
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (w === 0 || h === 0) return; // before layout; guessing mis-sizes every star
    if (w === bufW && h === bufH) return;
    bufW = w;
    bufH = h;
    renderer.setSize(w, h, false);
    /*
     * Frame on the SHORT edge, as `renderClusterField` does (`min(w, h)/2`), so a
     * non-square panel crops nothing and the cluster keeps its aspect.
     */
    const half = maxR / FRAME_FILL;
    const aspect = w / h;
    const halfW = aspect >= 1 ? half * aspect : half;
    const halfH = aspect >= 1 ? half : half / aspect;
    camera.left = -halfW;
    camera.right = halfW;
    camera.top = halfH;
    camera.bottom = -halfH;
    camera.updateProjectionMatrix();
    dirty = true;
  }

  let disposed = false;
  let drifting = (opts.drifting ?? false) && !reducedMotion;
  let yaw = 0;
  let dirty = true;
  let frames = 0;
  let raf = 0;
  let onScreen = true;
  let lastNow: number | null = null;
  const DRIFT_PERIOD_SEC = 110;

  /*
   * A WebGPU device is acquired ASYNCHRONOUSLY, and `render()` before that throws
   * "called before the backend is initialized".
   *
   * `initStarLab` solves this by being an async factory. This one stays
   * SYNCHRONOUS and gates painting instead, which is what its callers need: an
   * explorable rebuilds its cluster from a slider, a reset and a reseed, and an
   * async mount means several builds can be in flight at once — the previous
   * version of this page carried a mount-token guard for exactly that race. A
   * sync factory that simply does not paint until the device is ready has no
   * race to guard.
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
  canvas.addEventListener("pointerdown", onDown);
  canvas.addEventListener("pointermove", onMove);
  canvas.addEventListener("pointerup", onUp);
  canvas.addEventListener("pointercancel", onUp);

  build(model);
  io.observe(canvas);
  window.addEventListener("resize", onResize, { passive: true });
  document.addEventListener("visibilitychange", onVisibility);
  /* Everything above is device-independent: the scene graph, the geometry and the
     listeners all exist before the GPU does. Only painting waits. */
  void renderer.init().then(() => {
    if (disposed) return; // disposed while awaiting the device
    ready = true;
    syncSize();
    dirty = true;
    draw();
    play();
  });

  return {
    setModel(next) {
      build(next);
      syncSize();
      dirty = true;
      if (!raf) draw(); // a rebuilt model must reach the screen even while paused
    },
    setPositions(xyz) {
      if (!buffers) return;
      const arr = buffers.pos.array as Float32Array;
      arr.set(xyz.subarray(0, Math.min(arr.length, xyz.length)));
      buffers.pos.needsUpdate = true;
      dirty = true;
      if (!raf) draw();
    },
    reducedMotion,
    get drifting() {
      return drifting;
    },
    setDrifting(on) {
      drifting = on && !reducedMotion;
      lastNow = null;
      dirty = true;
    },
    get frames() {
      return frames;
    },
    get backend() {
      return isWebGPUBackend(renderer.backend) ? "webgpu" : "webgl2";
    },
    get maxRPc() {
      return maxR;
    },
    redraw() {
      dirty = true;
      if (!raf) draw();
    },
    dispose() {
      disposed = true;
      stop();
      io.disconnect();
      window.removeEventListener("resize", onResize);
      document.removeEventListener("visibilitychange", onVisibility);
      canvas.removeEventListener("pointerdown", onDown);
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerup", onUp);
      canvas.removeEventListener("pointercancel", onUp);
      disposeMesh();
      void renderer.dispose();
    },
  };
}
