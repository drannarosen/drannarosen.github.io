/*
 * volumeLayer.ts — the gas cloud as a raymarched box, on three.js / WebGPU (Layer 2).
 *
 * ── WHAT THIS REPLACES ──
 *
 * The port of `viz/webgl`'s `VOLUME_FS` onto TSL, so the gas and the stars can live in ONE scene,
 * under one camera and one projection
 * (docs/plans/2026-08-09-feedback-volumetric-renderer-design.md). NOT so a depth buffer can
 * occlude a star — see the section below for why that was never the mechanism.
 *
 * The arithmetic is the same arithmetic; `core/transfer/volume.ts` is the reference it is checked
 * against, per ADR 0015's condition that an equation written twice must have its divergence
 * DETECTED.
 *
 * ── STARS ARE NOT OCCLUDED BY THE GAS, AND A DEPTH BUFFER WAS NEVER GOING TO DO IT ──
 *
 * Read this before believing any comment that says otherwise. Several said otherwise.
 *
 * Today every star's light is ADDED on top of the gas, wherever it sits in the cloud. Three
 * independent things would each have to change for that not to be true, and all three are absent:
 *
 *   depth test        the stars set `depthTest: false`; this box sets `depthWrite: false`.
 *                     Nothing writes depth and nothing tests it.
 *   the raymarch      its uniforms are gas-only. The shader has no star input, so it cannot
 *                     attenuate something it has never been told about.
 *   the blend         the star material is premultiplied (One, One). Additive blending adds; there
 *                     is no configuration of it that dims a source by what lies beneath.
 *
 * `mesh.renderOrder = -1` below is the whole of the current interleaving: gas first, stars added
 * over it. That line has always said so.
 *
 * AND THE MECHANISM THOSE COMMENTS NAMED COULD NOT HAVE WORKED. A depth buffer answers "is this
 * fragment behind that surface", which is a binary test against a SURFACE. Gas is not a surface —
 * a star half a cloud deep should be dimmed by the column of gas in front of it, not switched off
 * by a wall. Worse, this box draws `BackSide`, so the only depth it could write is its FAR face,
 * behind everything inside it. Enabling both flags would occlude nothing and would break the
 * additive star pass on the way.
 *
 * The design document had this right and the ported headers garbled it. Step 9 of
 * docs/plans/2026-08-09-feedback-volumetric-renderer-design.md: "Stars composite into the raymarch
 * by depth, NOT by z-buffer. Stars are emitters, not opaque geometry. The star pass renders
 * emission and depth into a target; the raymarch adds each star's contribution at the sample where
 * the ray crosses its depth, attenuated by the transmittance." That is a second pass and a render
 * target, it is step 9 of a plan whose step 1 was this port, and it is not built.
 *
 * ── SO WHY A BOX MESH, NOT A FULLSCREEN TRIANGLE ──
 *
 * Not for the depth test, which is the reason this section used to give. Real geometry carries a
 * `matrixWorld`, and the ray direction falls out of inverting it (see below) instead of being
 * reconstructed from `cameraViewMatrix` — a derivation with two plausible readings, where the
 * wrong one is exactly right at yaw 0 and wrong everywhere else. The mesh also hangs off the same
 * pivot as the stars, so the pivot's rotation reaches the gas without this file knowing the pivot
 * exists. Both survive the correction above; the depth argument does not.
 *
 * ── ORTHOGRAPHIC, AND WHY THE RAY DIRECTION IS A UNIFORM ──
 *
 * The shared camera is orthographic (see `sceneHost`), so every ray is parallel and the direction
 * is one vector per frame rather than a per-fragment reconstruction.
 *
 * It is computed in JS and passed in, deliberately, rather than derived in TSL from
 * `cameraViewMatrix`. Deriving it means knowing whether a `mat4` index yields a row or a column
 * and whether the upper 3x3 is the camera basis or its transpose — a question with two plausible
 * answers, where the wrong one is a rotation's INVERSE and therefore exactly right at yaw = 0 and
 * wrong everywhere else. `viz/webgl/camera.ts` records that precise bug being shipped: the
 * rotation was written reading GLSL's `mat3(c,0.,s, ...)` as rows when it is columns, the node
 * test agreed because it carried the same misreading, and the error was zero at yaw = pitch = 0
 * and grew to 13.4 px at yaw 0.6.
 *
 * `Object3D.matrixWorld` inverted by three itself has no such ambiguity, and the mesh hangs off
 * the same pivot as the stars, so the pivot's rotation is accounted for without this file knowing
 * the pivot exists.
 */
import * as THREE from "three";
import { MeshBasicNodeMaterial } from "three/webgpu";
import {
  Fn,
  If,
  Loop,
  Break,
  float,
  vec3,
  vec4,
  uniform,
  texture3D,
  positionLocal,
  max,
  min,
  clamp,
  exp,
  pow,
  mix,
  smoothstep,
} from "three/tsl";
import {
  RAMP_DEEP,
  RAMP_PALE,
  RAMP_WARM,
  expansionShift,
  massLossShift,
} from "../core/transfer/volume.ts";

/** Samples per ray. Matches the shipped shader, so a parity run compares like with like. */
export const VOLUME_STEPS = 112;
/** Front-to-back accumulation stops here, as `compositeRay` does. */
const ALPHA_CUTOFF = 0.99;

export interface VolumeData {
  /** ngrid^3 bytes, C-order, uint8 log10(rho) rescaled over [logMin, logMax]. */
  volume: Uint8Array;
  ngrid: number;
  /** logMax - logMin [dex] — the axis the expulsion shifts are expressed against. */
  logRange: number;
}

export interface VolumeLayerOptions {
  /** Normalized position of rho_0 in the texture's log range: the display floor. */
  floor?: number;
  /** 1 = a faithful log colorbar. Presentation; asserts nothing about the cloud. */
  gamma?: number;
  emit?: number;
  absorb?: number;
  /**
   * Zero the per-ray jitter.
   *
   * The march dithers its start offset so 112 steps do not band. Two implementations will not
   * agree on a hash, so a parity comparison against a jittered reference would be comparing noise.
   * This is the switch that makes the comparison meaningful — not a quality setting.
   */
  parityMode?: boolean;
  /**
   * Output a raw intermediate instead of the picture, as a grey level.
   *
   * Instrumentation at the boundaries, so a disagreement with the reference can be attributed
   * instead of guessed at. Each answers one question with one number:
   *
   *   "sample"     what `texture3D` actually returns, before any windowing. A cube filled with
   *                byte 200 must read back 200.
   *   "pathLength" t1 - t0 for this ray. Axis-aligned through a unit box, it must be 1.0 -> 255.
   *   "alpha"      the accumulated opacity, isolating the transfer from the colour ramp.
   */
  debug?: "sample" | "pathLength" | "alpha" | "s" | "ramp";
  /**
   * Pre-linearise the composite so the renderer's sRGB encode returns the AUTHORED colour.
   *
   * The shipped WebGL 2 engine wrote raw values to an untagged canvas — no colour management at
   * all — and the cloud's exposure and ramp were tuned against exactly that. three's renderer
   * encodes linear to sRGB on output, which lifts midtones hard (0.3 becomes 0.58) and turns the
   * teal filaments into a pale haze. Measured on the page: the port looked washed out beside a
   * picture nobody had asked to change.
   *
   * Decoding here and letting the renderer re-encode reproduces the authored image exactly. It is
   * a compatibility transform, not a look: the alternative was making the shared host linear, which
   * `clusterPoints` has never been and which would silently restyle /explore/dynamics.
   *
   * Set FALSE where the renderer is already linear — the parity harness does, since decoding
   * without a matching encode would compare a transform rather than the arithmetic.
   */
  displayEncoded?: boolean;
}

export interface VolumeLayer {
  readonly mesh: THREE.Mesh;
  /** [0,1] homologous expansion phase, as the shipped engine's `setExpel`. */
  setExpel(v: number): void;
  /** [0,1] gas mass remaining, at FIXED radial shape. A different mode from expel. */
  setGasFraction(v: number): void;
  setFloor(v: number): void;
  setGamma(v: number): void;
  setEmit(v: number): void;
  setAbsorb(v: number): void;
  dispose(): void;
}

/** The expansion factor the shipped shader uses: S = 1 + expel * 3.5. */
export function expansionFactor(expel: number): number {
  return 1 + Math.max(0, Math.min(1, expel)) * 3.5;
}

export function createVolumeLayer(data: VolumeData, opts: VolumeLayerOptions = {}): VolumeLayer {
  const { volume, ngrid, logRange } = data;

  const tex = new THREE.Data3DTexture(volume, ngrid, ngrid, ngrid);
  tex.format = THREE.RedFormat;
  tex.type = THREE.UnsignedByteType;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.wrapR = THREE.ClampToEdgeWrapping;
  tex.unpackAlignment = 1;
  tex.needsUpdate = true;

  const uFloor = uniform(opts.floor ?? 0);
  const uGamma = uniform(opts.gamma ?? 1);
  const uEmit = uniform(opts.emit ?? 1);
  const uAbsorb = uniform(opts.absorb ?? 1);
  /** S, the homologous expansion factor. */
  const uS = uniform(1);
  /** The two log-space offsets, computed on the CPU by the SAME functions the reference uses. */
  const uDilute = uniform(0);
  const uMassDilute = uniform(0);
  const uJitter = uniform(opts.parityMode ? 0 : 1);
  /** Object-space ray direction. One vector per frame; see the header for why it is not derived. */
  const uRayDir = uniform(new THREE.Vector3(0, 0, -1));

  const material = new MeshBasicNodeMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.BackSide, // the far face always exists, even with the camera inside the box
  });
  /*
   * PREMULTIPLIED, and this is not a detail.
   *
   * `acc += (1-alpha)*a*col` accumulates colour ALREADY scaled by coverage, so the correct blend
   * is (One, OneMinusSrcAlpha) — which is exactly what the shipped WebGL 2 engine sets, alongside
   * `premultipliedAlpha: true` on its context. three's default NormalBlending is
   * (SrcAlpha, OneMinusSrcAlpha) and multiplies rgb by alpha a SECOND time.
   *
   * Measured: the port rendered a cloud of the right shape and extent at a small fraction of the
   * right brightness, which reads as "the transfer function is wrong" and is not. `clusterPoints`
   * carries the same warning from the same mistake in the other direction, where an additive blend
   * applied its falloff twice and halved the size-versus-luminosity exponent.
   */
  material.premultipliedAlpha = true;

  const deep = vec3(...RAMP_DEEP);
  const pale = vec3(...RAMP_PALE);
  const warm = vec3(...RAMP_WARM);

  const debugMode = opts.debug ?? null;

  material.colorNode = Fn(() => {
    const rd = uRayDir.normalize().toVar();
    /* Start outside the unit box and slab-test in, rather than marching from the back face
       backwards. The box spans [-0.5, 0.5], so 2 units is unconditionally outside it. */
    const ro = positionLocal.sub(rd.mul(2)).toVar();

    const inv = vec3(1).div(rd).toVar();
    const ta = vec3(-0.5).sub(ro).mul(inv).toVar();
    const tb = vec3(0.5).sub(ro).mul(inv).toVar();
    const lo = min(ta, tb).toVar();
    const hi = max(ta, tb).toVar();
    const t0 = max(max(lo.x, lo.y), lo.z).toVar();
    const t1 = min(min(hi.x, hi.y), hi.z).toVar();

    const acc = vec3(0).toVar();
    const alpha = float(0).toVar();

    /* The raw sample, taken once at the ray's midpoint through the box — before windowing, gamma,
       the ramp or any accumulation. If this disagrees with the byte that was uploaded, nothing
       downstream can be trusted and nothing downstream is at fault. */
    const probe = float(0).toVar();

    If(t1.greaterThan(max(t0, float(0))), () => {
      const tm = t0.add(t1).mul(0.5);
      const spm = ro.add(rd.mul(tm)).add(0.5);
      probe.assign(texture3D(tex, vec3(0.5).add(spm.sub(0.5).div(uS))).r);
      const dt = t1.sub(t0).div(float(VOLUME_STEPS)).toVar();
      /* A hash of the fragment position, so neighbouring rays start at different offsets and the
         112 steps do not band. Zeroed in parity mode — see VolumeLayerOptions. */
      const seed = positionLocal.xy
        .dot(vec3(12.9898, 78.233, 0).xy)
        .sin()
        .mul(43758.5453)
        .fract()
        .mul(uJitter);
      const t = t0.add(dt.mul(seed)).toVar();

      Loop(VOLUME_STEPS, () => {
        const sp = ro.add(rd.mul(t)).add(0.5);
        /* Sample the ORIGINAL cube at a CONTRACTED coordinate: the cloud balloons outward while
           the stars stay put, so a bare cluster emerges. The 1/S^3 mass loss that must accompany
           it is the uDilute offset, computed by core/transfer's expansionShift. */
        const src = vec3(0.5).add(sp.sub(0.5).div(uS));
        const d = texture3D(tex, src).r.sub(uDilute).sub(uMassDilute);

        const s = clamp(d.sub(uFloor).div(float(1).sub(uFloor)), 0, 1).toVar();
        const sg = pow(s, uGamma).toVar();
        const a = float(1).sub(exp(sg.mul(uAbsorb).mul(dt).negate())).toVar();
        const base = mix(mix(deep, pale, pow(s, 0.7)), warm, smoothstep(0.72, 1, s).mul(0.5));
        const col = base.mul(sg).mul(uEmit);

        const tr = float(1).sub(alpha).toVar();
        acc.addAssign(tr.mul(a).mul(col));
        alpha.addAssign(tr.mul(a));
        If(alpha.greaterThan(ALPHA_CUTOFF), () => {
          Break();
        });
        t.addAssign(dt);
      });
    });

    if (debugMode === "sample") return vec4(probe, probe, probe, 1);
    if (debugMode === "s") {
      const dd = probe.sub(uDilute).sub(uMassDilute);
      const ss = clamp(dd.sub(uFloor).div(float(1).sub(uFloor)), 0, 1);
      return vec4(ss, ss, ss, 1);
    }
    if (debugMode === "ramp") {
      const dd = probe.sub(uDilute).sub(uMassDilute);
      const ss = clamp(dd.sub(uFloor).div(float(1).sub(uFloor)), 0, 1);
      return vec4(mix(mix(deep, pale, pow(ss, 0.7)), warm, smoothstep(0.72, 1, ss).mul(0.5)), 1);
    }
    if (debugMode === "pathLength") {
      const len = max(t1.sub(max(t0, float(0))), float(0));
      return vec4(len, len, len, 1);
    }
    if (debugMode === "alpha") return vec4(alpha, alpha, alpha, 1);
    if (opts.displayEncoded === false) return vec4(acc, alpha);
    /* sRGB -> linear on the composite. See `displayEncoded`. */
    const lin = acc
      .lessThanEqual(vec3(0.04045))
      .select(acc.div(12.92), pow(acc.add(0.055).div(1.055).max(0), 2.4));
    return vec4(lin, alpha);
  })();

  const geometry = new THREE.BoxGeometry(1, 1, 1);
  const mesh = new THREE.Mesh(geometry, material);
  /* The box's extent is the whole frame's business, not the volume's: a caller scales this mesh to
     `box_pc` so the cloud sits in the same parsec coordinates the stars do. */
  mesh.frustumCulled = false;
  mesh.renderOrder = -1; // gas behind the additive stars, which do not write depth

  const dirWorld = new THREE.Vector3();
  const invWorld = new THREE.Matrix4();
  /*
   * three calls this immediately before the draw, so `matrixWorld` is current — including the
   * pivot's rotation, which this file never has to know about.
   */
  mesh.onBeforeRender = (_r, _s, camera) => {
    dirWorld.set(0, 0, -1).applyQuaternion(camera.quaternion);
    invWorld.copy(mesh.matrixWorld).invert();
    uRayDir.value.copy(dirWorld).transformDirection(invWorld).normalize();
  };

  return {
    mesh,
    setExpel(v) {
      const S = expansionFactor(v);
      uS.value = S;
      /* The SAME function the node reference uses, called once on the CPU. The shader receives an
         offset, not a formula, so the two cannot drift into different algebra. */
      uDilute.value = expansionShift(S, logRange);
    },
    setGasFraction(v) {
      uMassDilute.value = massLossShift(v, logRange);
    },
    setFloor(v) {
      uFloor.value = v;
    },
    setGamma(v) {
      uGamma.value = v;
    },
    setEmit(v) {
      uEmit.value = v;
    },
    setAbsorb(v) {
      uAbsorb.value = v;
    },
    dispose() {
      geometry.dispose();
      material.dispose();
      tex.dispose();
    },
  };
}
