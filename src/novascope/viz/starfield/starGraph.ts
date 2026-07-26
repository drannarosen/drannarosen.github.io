/*
 * starGraph.ts — the TSL shader graph for the star field (Layer 2).
 *
 * This is the ONLY place the star maths is restated for the GPU, and it is
 * deliberately small. Flux, exposure, colour, core size and tier are all
 * constant per star, so `./prepare` computes them on the CPU in tested
 * TypeScript and hands them over as instance attributes. What is left here is
 * the one thing that genuinely varies across a billboard: the profile.
 *
 * So the mirrored surface is the Moffat PSF and the aureole — two functions,
 * both gated in `core/optics` — rather than the whole pipeline (ADR 0015).
 *
 * Lives in the novascope package, not in `src/lib`: the renderer is part of the
 * portable engine, so `three` is a package dependency of Layer 2 (ADR 0015
 * Consequences). Layer 0 stays pure and node-testable — that is the boundary
 * that matters, and `check:novascope` enforces it.
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
  vec4,
  float,
  atan,
  screenSize,
} from "three/tsl";
import { DEFAULT_AUREOLE, DEFAULT_DIFFRACTION } from "../../core/optics/index.ts";
import { PSF_BETA } from "./sizing.ts";
import type { StarField } from "./prepare.ts";

/**
 * A live TSL uniform. Three stores a uniform's value ON the node (`InputNode`),
 * so assigning `.value` reaches the GPU next frame without rebuilding the graph
 * — which is what makes the optics adjustable while the CPU preparation, and
 * therefore the exposure calibration, stays put.
 */
type LiveUniform = ReturnType<typeof uniform>;

export interface StarGraphUniforms {
  beta: LiveUniform;
  aureoleAmp: LiveUniform;
  aureoleScale: LiveUniform;
  aureoleP: LiveUniform;
  gain: LiveUniform;
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
  /*
   * ONE ATTRIBUTE CARRIES BOTH COLOUR AND BRIGHTNESS, and that replaces three.
   *
   * The previous graph took `iColor` (a hue, unit luminance), `iSignal` (a compressed display
   * brightness) and `iHalo` (a linear flux driving scattered light). Colour and brightness were
   * separate decisions about the same pixel, so a saturated star drifted toward white and
   * choosing a filter never changed a hue.
   *
   * `iBandFlux` is three bands' LINEAR flux. Its ratios are the hue, its mean is the intensity,
   * and the display transfer runs once per pixel at the end of the pipeline rather than once
   * per star before the radiances are summed. Compressing per star meant two overlapping stars
   * were compressed twice, which is not the transfer of their summed flux.
   */
  const aBandFlux = new THREE.InstancedBufferAttribute(field.bandFlux, 3);
  const aSizePx = new THREE.InstancedBufferAttribute(field.sizePx, 1);
  // Tier is uploaded as a float because a vertex attribute feeding a float
  // comparison must be one; the CPU value is a small integer either way.
  const aTier = new THREE.InstancedBufferAttribute(Float32Array.from(field.tier), 1);
  geometry.setAttribute("iPos", aPos);
  geometry.setAttribute("iBandFlux", aBandFlux);
  geometry.setAttribute("iSizePx", aSizePx);
  geometry.setAttribute("iTier", aTier);

  const iPos = instancedBufferAttribute<"vec3">(aPos, "vec3");
  const iBandFlux = instancedBufferAttribute<"vec3">(aBandFlux, "vec3");
  const iSizePx = instancedBufferAttribute<"float">(aSizePx, "float");
  const iTier = instancedBufferAttribute<"float">(aTier, "float");

  /*
   * The instrument's parameters. Every number is imported, never restated: the
   * Moffat exponent from `./sizing`, the aureole from `core/optics`, the PSF width
   * from the field that was just prepared (already in DEVICE px, so the shader
   * does no unit conversion of its own).
   */
  /*
   * FROM THE FIELD, NOT FROM `core/optics`. These used to read the module defaults directly, which
   * meant the shader and the quad-sizing solved against two independently-sourced copies of the
   * same instrument — fine while both were constants, and wrong the moment either became a
   * control. `field.optics` is what `prepare` actually sized the quads with, so the profile
   * evaluated here cannot drift from the box it is evaluated in. `DEFAULT_DIFFRACTION` survives
   * below only as the shape to feed the graph when there is no spider; its amplitude is zeroed,
   * so the term compiles and contributes nothing.
   */
  const spider = field.optics.diffraction ?? { ...DEFAULT_DIFFRACTION, amp: 0 };
  const uBeta = uniform(PSF_BETA);
  const uAurAmp = uniform(field.optics.aureole.amp);
  const uAurScale = uniform(field.optics.aureole.scale);
  const uAurP = uniform(field.optics.aureole.p);
  const uGain = uniform(1);
  const uPsfWidth = uniform(field.stats.psfWidthPx);
  const uSpikeCount = uniform(spider.spikes);
  const uSpikeAmp = uniform(spider.amp);
  const uSpikeSharp = uniform(spider.sharpness);
  const uSpikeScale = uniform(spider.scale);
  const uSpikeP = uniform(spider.p);
  const uSpikeAngle = uniform(spider.angle);
  const uniforms: StarGraphUniforms = {
    beta: uBeta,
    aureoleAmp: uAurAmp,
    aureoleScale: uAurScale,
    aureoleP: uAurP,
    gain: uGain,
  };

  const material = new MeshBasicNodeMaterial({
    transparent: true,
    depthWrite: false,
    depthTest: true,
  });
  // Additive in LINEAR HDR: stars are emitters, so their radiances add. Order
  // independent, which is why no per-frame sort is needed for 10k billboards.
  material.blending = THREE.AdditiveBlending;
  /*
   * ALPHA IS 1, NOT THE PROFILE — see the fragment stage. This is load-bearing:
   * emitting the profile in alpha applied it TWICE.
   *
   * `AdditiveBlending` resolves to setBlend(SrcAlpha, One) in
   * WebGPUPipelineUtils, so the GPU computes `rgb * a + dst`. With
   * `rgb = colour * signal * profile` and `a = profile`, the result was
   * proportional to profile SQUARED — a Moffat of exponent 2*beta = 6.4 against
   * the 3.2 that `core/optics` defines and the CPU reference computes. Measured
   * on a single star, the linear falloff was 0.604, 0.0802, 0.00518, 0.000304,
   * matching the squared prediction (0.608, 0.0803, 0.00522) to under 1% and
   * nothing like the intended profile (0.821, 0.299, 0.0762).
   *
   * That is not a cosmetic error. Apparent size goes as signal^(1/2*beta), so
   * squaring halved the exponent to 0.078 and flattened the size-vs-luminosity
   * law this renderer exists to show; the PSF width and the aureole were then
   * tuned to compensate for a profile twice as steep as the model.
   *
   * `material.premultipliedAlpha = true` is NOT the fix, which is worth recording
   * because it looks like one. It makes three premultiply in the SHADER instead —
   * the generated WGSL gains `fn0(c) = vec4(c.xyz * c.w, c.w)` — and then blends
   * One/One, so the product is unchanged. The multiplication only moves.
   */

  // ── vertex: project the instance centre, then offset by the quad corner in px
  material.vertexNode = Fn(() => {
    const sizePx = iSizePx;
    const clip = cameraProjectionMatrix.mul(modelViewMatrix.mul(vec4(iPos, 1)));
    const halfPx = sizePx;
    // positionLocal.xy spans -0.5..0.5 for a unit plane; x2 gives -1..1.
    // A pixel is 2/screenSize in NDC (which spans -1..1), and clip = NDC * w.
    const offset = positionLocal.xy.mul(2).mul(halfPx).mul(2).div(screenSize).mul(clip.w);
    return vec4(clip.xy.add(offset), clip.z, clip.w);
  })();

  // ── fragment: one instrument PSF, identical for every star
  material.colorNode = Fn(() => {
    const halfPx = iSizePx; // billboard half-extent [device px]
    // Distance from centre in device px, then in PSF widths.
    const rPx = uv().sub(vec2(0.5)).length().mul(2).mul(halfPx);
    const rho = rPx.div(uPsfWidth);
    const edge = halfPx.div(uPsfWidth); // quad edge, in PSF widths

    /*
     * THE MIRROR OF `./profile`.`starProfile`. That function is the ONE piece of
     * maths restated for the GPU (ADR 0015), and the CPU reference rasteriser uses
     * it directly, so the two paths are comparable by construction rather than by
     * inspection. Change one and you must change the other — the parity check in
     * `check:star-optics` is what makes that fail loudly.
     *
     * IT FACTORISES NOW, which is why this is shorter than it was. The previous
     * version had the core on a compressed display signal and the wing on a linear
     * flux — two different drives, so the profile could not be separated from the
     * star's brightness. With the Lupton path every term rides the SAME per-channel
     * band flux, because scattered light and diffraction are both fixed fractions of
     * the light that entered the instrument at that wavelength. So
     *
     *     raw_k(rho) = f_k * [ core(rho) + wing(rho) + spike(rho, theta) ]
     *
     * and the whole profile is one SCALAR shape multiplied by a vec3 at the end. The
     * pedestal subtraction commutes with that multiply because f_k is non-negative
     * and the shape is monotonically decreasing inside the quad, so `max(0, ...)`
     * can be applied to the shape alone.
     *
     * Written out twice rather than via a helper because TSL's node types do not
     * survive a generic callback parameter.
     */
    const core = (r: typeof rho) => float(1).add(r.mul(r)).pow(uBeta.negate());
    const wing = (r: typeof rho) => uAurAmp.div(float(1).add(r.div(uAurScale)).pow(uAurP));

    /*
     * DIFFRACTION, TIER 3 ONLY. The spider's spikes are an instrument signature of
     * genuinely bright sources, so evaluating them everywhere would be both slower
     * and wrong — ADR 0015's whole reason for having tiers.
     *
     * `theta` is the angle in the IMAGE PLANE, taken from the billboard's own uv, so
     * the pattern is bolted to the instrument and does not rotate when the cluster
     * does. The angular term has exactly `spikes` maxima because cos(n*phi) peaks
     * wherever n*phi is a multiple of 2pi; the high power narrows each lobe into a
     * spike while staying smooth and branch-free.
     *
     * The gate is a MULTIPLY by 0/1 rather than a branch: every fragment in a warp
     * pays for the term anyway once any lane needs it, and a select() keeps the
     * profile a single expression that the CPU mirror can match exactly.
     */
    const theta = atan(uv().y.sub(0.5), uv().x.sub(0.5));
    const isTier3 = iTier.greaterThan(float(2.5)).select(float(1), float(0));
    const lobe = uSpikeCount.mul(theta.sub(uSpikeAngle)).cos().max(float(0));
    const spike = (r: typeof rho) =>
      uSpikeAmp
        .mul(lobe.pow(uSpikeSharp))
        .div(float(1).add(r.div(uSpikeScale)).pow(uSpikeP))
        .mul(isTier3);

    const atRho = core(rho).add(wing(rho)).add(spike(rho));
    const atEdge = core(edge).add(wing(edge)).add(spike(edge));

    /*
     * PEDESTAL SUBTRACTION. The profile is still ~1e-3 at the quad edge, which
     * survives the sRGB transfer against a black sky and crops every star into a
     * visible SQUARE. Subtracting the edge value makes it reach exactly zero
     * there, so the billboard boundary disappears without widening the quad.
     *
     * This is also why `quadExtentPx` has to derive its wing allowance from the
     * aureole's own parameters and the same `halo` drive: whatever the profile
     * still is out here gets subtracted from the WHOLE star, so a halo that has
     * not yet faded by the quad edge is not clipped, it is cancelled.
     */
    const profile = atRho.sub(atEdge).max(float(0));

    /*
     * LINEAR band radiance, three channels, UNCOMPRESSED. Nothing is clamped and no
     * display transfer is applied here — that happens once per pixel at the end of the
     * pipeline (`./luptonNode`), after every star's contribution has been summed.
     *
     * This is the fix for a real error, not just a restructuring: the previous graph
     * emitted an already-compressed `signal`, so two overlapping stars summed two
     * compressed values, which is not the transfer of their summed flux. Additive
     * blending is only correct on linear radiance.
     *
     * ALPHA IS 1. It must not carry the profile: `AdditiveBlending` multiplies rgb by
     * alpha, so returning the profile there applied it twice and squared it (see the
     * blending note above). Alpha has no compositing role for an emitter — the
     * radiance is already the contribution.
     */
    const radiance = iBandFlux.mul(profile).mul(uGain);
    return vec4(radiance, float(1));
  })();

  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;

  return {
    mesh,
    uniforms,
    dispose() {
      geometry.dispose();
      plane.dispose();
      material.dispose();
    },
  };
}

