/*
 * starGraph.ts — the TSL shader graph for the star field (lab harness).
 *
 * This is the ONLY place the star maths is restated for the GPU, and it is
 * deliberately small. Flux, exposure, colour, core size and tier are all
 * constant per star, so `viz/starfield/prepare` computes them on the CPU in
 * tested TypeScript and hands them over as instance attributes. What is left
 * here is the one thing that genuinely varies across a billboard: the profile.
 *
 * So the mirrored surface is the Moffat PSF and the aureole — two functions,
 * both gated in `core/optics` — rather than the whole pipeline (ADR 0015).
 */
import * as THREE from "three";
import { MeshBasicNodeMaterial } from "three/webgpu";
import {
  Fn,
  instancedBufferAttribute,
  cameraProjectionMatrix,
  modelViewMatrix,
  positionLocal,
  uniform,
  uv,
  vec2,
  vec3,
  vec4,
  float,
  screenSize,
} from "three/tsl";
import { DEFAULT_AUREOLE } from "@novascope/core/optics";
import type { StarField } from "@novascope/viz/starfield/prepare";

/**
 * How far the quad extends past the core radius, in core radii.
 *
 * The Moffat wings and the aureole reach well beyond the core, so the billboard
 * has to be bigger than the core or the profile is cropped into a visible
 * square. 8 puts the quad edge where the profile has fallen to a few times
 * 1e-3 of its peak.
 */
const QUAD_RADII = 8;

/**
 * Quad extent for Tier 1, in core radii. The faint majority has no visible wing,
 * so giving it the full 8-radius quad costs fill rate on 90% of the population
 * for pixels that round to nothing.
 */
const QUAD_RADII_FAINT = 3;

export interface StarGraphUniforms {
  beta: { value: number };
  aureoleAmp: { value: number };
  aureoleScale: { value: number };
  aureoleP: { value: number };
  gain: { value: number };
}

export interface StarGraph {
  mesh: THREE.Mesh;
  uniforms: StarGraphUniforms;
  dispose(): void;
}

/**
 * Build the instanced billboard mesh for a prepared star field.
 *
 * One draw call for every star. Camera-facing is achieved by offsetting in CLIP
 * space rather than by orienting geometry: the instance centre is projected, then
 * the quad corner is added as a pixel offset scaled by the clip w, which keeps
 * the billboard exactly `sizePx` pixels across at any depth and any device pixel
 * ratio — the property star sizing depends on.
 */
export function createStarGraph(field: StarField): StarGraph {
  const plane = new THREE.PlaneGeometry(1, 1);
  const geometry = new THREE.InstancedBufferGeometry();
  geometry.setIndex(plane.getIndex());
  geometry.setAttribute("position", plane.getAttribute("position"));
  geometry.setAttribute("uv", plane.getAttribute("uv"));
  geometry.instanceCount = field.count;

  /*
   * Per-instance data is registered on the geometry AND bound in TSL, and both
   * halves are load-bearing.
   *
   * The geometry registration is what tells three there are instances at all —
   * with no instanced attribute it derives an instance count of zero and issues
   * no draw call. The TSL binding must use `instancedBufferAttribute`, NOT
   * `attribute(name)`: the latter resolves PER-VERTEX attributes, so reading an
   * instanced buffer through it silently yields zero and every one of the 10,301
   * quads lands on the origin, stacking into a single small square. Instancing
   * was working the whole time (20,603 triangles drew); only the per-instance
   * values were missing — a failure that looks like a maths bug and is not.
   *
   * The same BufferAttribute objects are handed to both, so the data is uploaded
   * once.
   */
  const aPos = new THREE.InstancedBufferAttribute(field.position, 3);
  const aColor = new THREE.InstancedBufferAttribute(field.color, 3);
  const aSignal = new THREE.InstancedBufferAttribute(field.signal, 1);
  const aSizePx = new THREE.InstancedBufferAttribute(field.sizePx, 1);
  const aTier = new THREE.InstancedBufferAttribute(Float32Array.from(field.tier), 1);
  geometry.setAttribute("iPos", aPos);
  geometry.setAttribute("iColor", aColor);
  geometry.setAttribute("iSignal", aSignal);
  geometry.setAttribute("iSizePx", aSizePx);
  geometry.setAttribute("iTier", aTier);

  const iPos = instancedBufferAttribute<"vec3">(aPos, "vec3");
  const iColor = instancedBufferAttribute<"vec3">(aColor, "vec3");
  const iSignal = instancedBufferAttribute<"float">(aSignal, "float");
  const iSizePx = instancedBufferAttribute<"float">(aSizePx, "float");
  const iTier = instancedBufferAttribute<"float">(aTier, "float");

  const uniforms: StarGraphUniforms = {
    beta: { value: 3.2 },
    aureoleAmp: { value: DEFAULT_AUREOLE.amp },
    aureoleScale: { value: DEFAULT_AUREOLE.scale },
    aureoleP: { value: DEFAULT_AUREOLE.p },
    gain: { value: 1 },
  };
  const uBeta = uniform(uniforms.beta.value);
  const uAurAmp = uniform(uniforms.aureoleAmp.value);
  const uAurScale = uniform(uniforms.aureoleScale.value);
  const uAurP = uniform(uniforms.aureoleP.value);
  const uGain = uniform(uniforms.gain.value);

  const material = new MeshBasicNodeMaterial({
    transparent: true,
    depthWrite: false,
    depthTest: true,
  });
  // Additive in LINEAR HDR: stars are emitters, so their radiances add. Order
  // independent, which is why no per-frame sort is needed for 10k billboards.
  material.blending = THREE.AdditiveBlending;

  // ── vertex: project the instance centre, then offset by the quad corner in px
  material.vertexNode = Fn(() => {
    const sizePx = iSizePx;
    const clip = cameraProjectionMatrix.mul(modelViewMatrix.mul(vec4(iPos, 1)));
    const extent = iTier.greaterThan(float(1.5)).select(float(QUAD_RADII), float(QUAD_RADII_FAINT));
    const halfPx = sizePx.mul(extent);
    // positionLocal.xy spans -0.5..0.5 for a unit plane; x2 gives -1..1.
    // A pixel is 2/screenSize in NDC (which spans -1..1), and clip = NDC * w.
    const offset = positionLocal.xy.mul(2).mul(halfPx).mul(2).div(screenSize).mul(clip.w);
    return vec4(clip.xy.add(offset), clip.z, clip.w);
  })();

  // ── fragment: the analytic profile, in core-radius units
  material.colorNode = Fn(() => {
    // rho: 0 at the centre, QUAD_RADII at the quad edge.
    const rho = uv().sub(vec2(0.5)).length().mul(2).mul(QUAD_RADII);

    // Moffat PSF, mirroring core/optics.moffat with alpha = 1 core radius.
    const psf = float(1).add(rho.mul(rho)).pow(uBeta.negate());

    // Broad faint aureole, mirroring core/optics.aureole. Tier 1 (the faint
    // majority) skips it: it is invisible there and costs fill rate on 90% of
    // the population.
    const tier = iTier;
    const wing = uAurAmp.div(float(1).add(rho.div(uAurScale)).pow(uAurP));
    const aureole = wing.mul(tier.greaterThan(float(1.5)).select(float(1), float(0)));

    const profile = psf.add(aureole);
    const color = iColor;
    const signal = iSignal;

    // Linear HDR radiance: chromaticity x display signal x profile. Nothing is
    // clamped here — values above 1 are real overflow and are what a bloom pass
    // should key on.
    const radiance = color.mul(signal).mul(profile).mul(uGain);
    return vec4(radiance, profile);
  })();

  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;

  return {
    mesh,
    uniforms: {
      get beta() {
        return uBeta;
      },
      get aureoleAmp() {
        return uAurAmp;
      },
      get aureoleScale() {
        return uAurScale;
      },
      get aureoleP() {
        return uAurP;
      },
      get gain() {
        return uGain;
      },
    } as unknown as StarGraphUniforms,
    dispose() {
      geometry.dispose();
      plane.dispose();
      material.dispose();
    },
  };
}

export { QUAD_RADII };
