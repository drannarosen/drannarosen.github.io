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
import { LineBasicNodeMaterial, MeshBasicNodeMaterial } from "three/webgpu";
import { createSceneHost } from "./sceneHost.ts";
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

export interface ClusterPointsOptions {
  /** Force the WebGL 2 backend. Development only — exercises the fallback. */
  forceWebGL?: boolean;
  /** Start with the view drifting. Defaults to false: on an explorable the
   *  motion should be the physics, not the camera. */
  drifting?: boolean;
  /**
   * Called once the GPU device is up and the first frame has been sized.
   *
   * A WebGPU device is acquired asynchronously, so `pxPerPc` is meaningless until
   * then — it reads as its placeholder 1. A consumer that draws a scale bar from
   * it on construction gets a bar off by whatever the real scale turns out to be
   * (measured: "200 pc" on a 0.65 pc cluster). This is the signal to read it.
   */
  onReady?: () => void;
}

export interface ClusterPoints {
  /** Replace the whole model — new sizes, colours, alphas and framing. */
  setModel(model: RenderModel): void;
  /** Move the stars only: `count * 3` floats of xyz [pc]. The per-frame path. */
  setPositions(xyz: Float32Array): void;
  /**
   * Per-instance alpha, in the SAME order as `setPositions` — i.e. the model's order, not
   * the caller's own indexing.
   *
   * Separate from `setModel` because alpha is the one channel that has a reason to change
   * every frame while sizes and colours do not: `/explore/dynamics` fades a star once it is
   * no longer bound, and rebuilding the whole model each frame to say so would repack every
   * buffer to change one. `iAlpha` is already an instanced attribute, so this is the same
   * cheap write `setPositions` makes.
   */
  setAlpha(alpha: Float32Array): void;
  /** True when honouring prefers-reduced-motion: no drift, no render loop. */
  readonly reducedMotion: boolean;
  readonly drifting: boolean;
  setDrifting(on: boolean): void;
  /** Frames actually presented — the only reliable way to confirm a pause. */
  readonly frames: number;
  readonly backend: "webgpu" | "webgl2";
  /** Half-width of the framing before user zoom [pc]. */
  readonly maxRPc: number;
  /**
   * Frame on a physically-derived centre and radius.
   *
   * The caller owns this because the caller owns the physics: a dissolving
   * cluster recoils and expands, and the honest frame follows the BOUND remnant
   * rather than the coordinate origin it started at. Without it the camera stays
   * where the cluster was born — measured on /explore/dynamics, 372 of 400 stars
   * in frame at t=0 falling to ONE by 700 crossing times, while five readouts
   * went on describing a panel that was empty.
   */
  setFraming(opts: { centre?: readonly number[]; radiusPc?: number }): void;
  /**
   * A world-space polyline through `xyz` (`count * 3` floats [pc]), or null to clear.
   *
   * IT LIVES IN THE RENDERER, and that is the point. The trail has to sit under the same
   * orthographic camera, the same pivot and the same yaw/pitch as the stars; drawing it on an
   * overlay canvas would mean a second copy of that whole transform, which is the drift hazard
   * this codebase keeps designing against — the trail would part company with the cluster the
   * first time either changed.
   *
   * Added to the PIVOT rather than the scene, like the stars, so it orbits about the cluster's
   * own centre rather than about a coordinate origin the cluster may have recoiled far from.
   */
  setTrail(xyz: Float32Array | null, colour?: readonly [number, number, number]): void;
  /** User zoom about the frame centre; >1 magnifies. Clamped to [0.15, 40]. */
  setZoom(z: number): void;
  readonly zoom: number;
  /**
   * Device pixels per parsec along the short edge, AFTER zoom.
   *
   * Published so a consumer can draw a scale bar that stays true both as the
   * reader zooms and as the cluster expands under its own physics — the two ways
   * a fixed bar would start lying.
   */
  readonly pxPerPc: number;
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
  /*
   * The renderer, scene, camera, framing and draw loop all belong to `sceneHost` now. This file is
   * the STAR LAYER: geometry, materials, the size/alpha law and the trail, and nothing else.
   *
   * The split is what lets the gas volume share this scene — one camera, one depth buffer, so a
   * star inside the cloud is occluded by the cloud rather than composited over it. It also means
   * this file can no longer accidentally change how the view behaves, and the host can no longer
   * change how a star looks, because it never sees one.
   */
  const host = createSceneHost(canvas, {
    forceWebGL: opts.forceWebGL ?? false,
    drifting: opts.drifting ?? false,
    onReady: opts.onReady,
  });

  let mesh: THREE.Mesh | null = null;
  let geometry: THREE.InstancedBufferGeometry | null = null;
  let material: MeshBasicNodeMaterial | null = null;
  let plane: THREE.PlaneGeometry | null = null;
  let buffers: Buffers | null = null;
  let count = 0;

  const uHalo = uniform(HALO_RADII);

  function build(m: RenderModel): void {
    disposeMesh();
    host.setFraming({ radiusPc: m.maxR || 1e-6 });
    const packed = packModel(m, host.dpr);
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
    /* The mesh hangs off a PIVOT whose position is minus the cluster centre, so
       the world origin sits on the cluster and `scene.rotation` orbits about it.
       Rotating the scene directly would swing a recoiled cluster around the
       coordinate origin instead — which by late times is somewhere off-frame. */
    host.pivot.add(mesh);
  }

  function disposeMesh(): void {
    if (mesh) host.pivot.remove(mesh);
    geometry?.dispose();
    plane?.dispose();
    material?.dispose();
    mesh = null;
    geometry = null;
    plane = null;
    material = null;
  }

  /*
   * THE TRAIL. Lazily built, capacity-preallocated, and hidden rather than destroyed when
   * cleared — a binary's orbit is sampled every step while "show me" is on, so this is
   * rebuilt at frame rate and churning a geometry per frame would be the expensive way to
   * draw a line.
   */
  const TRAIL_CAPACITY = 8192;
  let trailLine: THREE.Line | null = null;
  let trailGeom: THREE.BufferGeometry | null = null;
  let trailMat: LineBasicNodeMaterial | null = null;

  function ensureTrail(): void {
    if (trailLine) return;
    trailGeom = new THREE.BufferGeometry();
    trailGeom.setAttribute(
      "position",
      new THREE.BufferAttribute(new Float32Array(TRAIL_CAPACITY * 3), 3),
    );
    trailGeom.setDrawRange(0, 0);
    trailMat = new LineBasicNodeMaterial({
      transparent: true,
      opacity: 0.85,
      depthWrite: false,
      depthTest: false,
    });
    trailLine = new THREE.Line(trailGeom, trailMat);
    /* Same reason the star mesh sets it: a trail that leaves the frame must keep drawing the
       part that has not, and three culls on a bounding sphere it would have to be told about. */
    trailLine.frustumCulled = false;
    /* Under the PIVOT, so it shares the cluster-centred origin and the drag rotation. */
    host.pivot.add(trailLine);
  }

  build(model);
  /* AFTER the geometry exists, so the first painted frame is never an empty scene and `onReady`
     cannot fire on one. See sceneHost's "START IS EXPLICIT". */
  host.start();

  return {
    setModel(next) {
      build(next);          // build() re-frames through the host, which sets `reframe`
      host.redraw();        // redraw syncs size first, so the new framing is applied before paint
    },
    setPositions(xyz) {
      if (!buffers) return;
      const arr = buffers.pos.array as Float32Array;
      arr.set(xyz.subarray(0, Math.min(arr.length, xyz.length)));
      buffers.pos.needsUpdate = true;
      host.redraw();
    },
    setAlpha(alpha) {
      if (!buffers) return;
      const arr = buffers.alpha.array as Float32Array;
      arr.set(alpha.subarray(0, Math.min(arr.length, alpha.length)));
      buffers.alpha.needsUpdate = true;
      host.redraw();
    },
    reducedMotion: host.reducedMotion,
    get drifting() {
      return host.drifting;
    },
    setDrifting(on) {
      host.setDrifting(on);
    },
    get frames() {
      return host.frames;
    },
    get backend() {
      return host.backend;
    },
    get maxRPc() {
      return host.maxRPc;
    },
    setFraming(next) {
      host.setFraming(next);
    },
    setTrail(xyz, colour) {
      if (!xyz || xyz.length < 6) {
        if (trailLine) trailLine.visible = false;
        host.redraw();
        return;
      }
      ensureTrail();
      const arr = trailGeom!.getAttribute("position") as THREE.BufferAttribute;
      const target = arr.array as Float32Array;
      /* The TAIL is what matters — a trail longer than the buffer should drop its oldest
         points, not its newest, or the line would stop at the star's past position. */
      const floats = Math.min(xyz.length, TRAIL_CAPACITY * 3);
      target.set(xyz.subarray(xyz.length - floats));
      arr.needsUpdate = true;
      trailGeom!.setDrawRange(0, floats / 3);
      if (colour) trailMat!.color.setRGB(colour[0], colour[1], colour[2]);
      trailLine!.visible = true;
      host.redraw();
    },
    setZoom(z) {
      host.setZoom(z);
    },
    get zoom() {
      return host.zoom;
    },
    get pxPerPc() {
      return host.pxPerPc;
    },
    redraw() {
      host.redraw();
    },
    dispose() {
      if (trailLine) host.pivot.remove(trailLine);
      trailGeom?.dispose();
      trailMat?.dispose();
      trailLine = null;
      trailGeom = null;
      trailMat = null;
      disposeMesh();
      host.dispose();
    },
  };
}
