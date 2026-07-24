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
  attribute,
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

  geometry.setAttribute("iPos", new THREE.InstancedBufferAttribute(field.position, 3));
  geometry.setAttribute("iColor", new THREE.InstancedBufferAttribute(field.color, 3));
  geometry.setAttribute("iSignal", new THREE.InstancedBufferAttribute(field.signal, 1));
  geometry.setAttribute("iSizePx", new THREE.InstancedBufferAttribute(field.sizePx, 1));
  geometry.setAttribute(
    "iTier",
    new THREE.InstancedBufferAttribute(Float32Array.from(field.tier), 1),
  );

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
    const iPos = attribute<"vec3">("iPos", "vec3");
    const sizePx = attribute<"float">("iSizePx", "float");
    const clip = cameraProjectionMatrix.mul(modelViewMatrix.mul(vec4(iPos, 1)));
    const halfPx = sizePx.mul(QUAD_RADII);
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
    const tier = attribute<"float">("iTier", "float");
    const wing = uAurAmp.div(float(1).add(rho.div(uAurScale)).pow(uAurP));
    const aureole = wing.mul(tier.greaterThan(float(1.5)).select(float(1), float(0)));

    const profile = psf.add(aureole);
    const color = attribute<"vec3">("iColor", "vec3");
    const signal = attribute<"float">("iSignal", "float");

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
