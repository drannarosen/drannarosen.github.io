/*
 * transfer/volume.ts — the volume-rendering integral, in pure TypeScript (Layer 0).
 *
 * ── WHY THIS IS HERE AND NOT ONLY IN A SHADER ──
 *
 * `/explore/feedback-budget`'s cloud is about to exist twice: once as the WebGL 2 raymarch that
 * ships today, once as a TSL graph on three.js/WebGPU
 * (docs/plans/2026-08-09-feedback-volumetric-renderer-design.md). ADR 0015 permits writing an
 * equation twice ON ONE CONDITION — that divergence is DETECTED rather than merely unlikely — and
 * the `DEFAULT_AUREOLE` bug is what happens when that lapses: amplitude 0.06 in `core/optics`
 * while the shader used 0.012, which made "does the GPU match the CPU?" unanswerable.
 *
 * This file is the answer for the volume. It is the reference the TSL graph is checked against,
 * and it runs in node with no GPU, so the arithmetic can be tested before any of it is a picture.
 *
 * ── WHAT IS PHYSICS HERE AND WHAT IS PRESENTATION ──
 *
 * Physics: the density decode, the two expulsion transforms, and the emission-absorption
 * compositing integral. Those have right answers and are tested as such.
 *
 * Presentation: the colour ramp and `gamma`. A yt-style log colorbar is a display choice, and it
 * is kept here anyway — beside the physics rather than inside a shader — because it is the thing
 * the two implementations are most likely to disagree about in a way no summary statistic shows.
 * It asserts nothing about the cloud and the page must never present it as if it did.
 *
 * ── THE DENSITY UNITS ARE DERIVED, NOT DECLARED ──
 *
 * `meta.json` records `volume_encoding` as "uint8 log10(rho) rescaled 0..255" and stops, so the
 * unit was recovered by mass closure: decoding each cube and integrating over the box against
 * `env_m_cloud_actual_msun` gives rho in **Msun/pc^3**. See `scripts/check-volume-mass.mjs`, which
 * gates it, and the plan for the two export defects that fell out of the same exercise.
 */

/** Natural log of 10, so the log-space shifts below read as the algebra they are. */
const LN10 = Math.LN10;

/**
 * Decode a stored byte to normalized log density in [0, 1].
 *
 * The cube stores `log10(rho)` linearly rescaled over `[logMin, logMax]`. Everything downstream
 * works in this normalized space, which is why the expulsion shifts below are divided by
 * `logRange` — they are dex, and this axis is dex/logRange.
 */
export function decodeNormalized(byte: number): number {
  return byte / 255;
}

/** Normalized log density back to absolute log10(rho) [Msun/pc^3]. */
export function toLog10Rho(normalized: number, logMin: number, logMax: number): number {
  return logMin + normalized * (logMax - logMin);
}

/**
 * The log-space offset for homologous expansion by a factor S.
 *
 * Feedback expands the cloud self-similarly: r -> S r with mass conserved, so rho -> rho / S^3.
 * In the normalized-log encoding that is a CONSTANT SUBTRACTION of 3 log10(S) / logRange, which is
 * why the renderer can show expansion by sampling the original cube at a contracted coordinate
 * instead of rebuilding it.
 */
export function expansionShift(S: number, logRange: number): number {
  if (!(S > 0) || !(logRange > 0)) return 0;
  return (3 * (Math.log(S) / LN10)) / logRange;
}

/**
 * The log-space offset for mass loss at FIXED SHAPE: rho -> gasFrac * rho everywhere.
 *
 * A different mode from the expansion above and not interchangeable with it. The survival
 * explorable's integrator assumes the cloud's radial profile f(<r) is fixed while M_gas(t) decays,
 * so the render has to show exactly that; showing homologous expansion instead would depict a
 * cloud the dynamics never modelled.
 */
export function massLossShift(gasFrac: number, logRange: number): number {
  if (!(logRange > 0)) return 0;
  return -(Math.log(Math.max(gasFrac, 1e-4)) / LN10) / logRange;
}

/**
 * Window the normalized log density to the display range, as a yt log colorbar does.
 *
 * `s = (d - floor) / (1 - floor)` is log10(rho / rho_floor) rescaled to 0..1; everything below the
 * floor is transparent. No geometric mask is applied anywhere — the EFF profile truncates the
 * density at r_t, so the cloud is physically round out to the box walls and its roundness is real.
 */
export function windowed(d: number, floor: number): number {
  const denom = 1 - floor;
  if (!(denom > 0)) return d >= floor ? 1 : 0;
  return Math.min(1, Math.max(0, (d - floor) / denom));
}

/** Per-sample opacity over a step of length `dt`. Beer-Lambert, so it cannot exceed 1. */
export function sampleOpacity(sg: number, absorb: number, dt: number): number {
  return 1 - Math.exp(-sg * absorb * dt);
}

export type RGB = [number, number, number];

/** The ramp's three anchors. Presentation, stated once so both implementations share it. */
export const RAMP_DEEP: RGB = [0.09, 0.4, 0.44];
export const RAMP_PALE: RGB = [0.6, 0.96, 0.92];
export const RAMP_WARM: RGB = [0.92, 0.66, 0.55];

const mix = (a: number, b: number, t: number): number => a + (b - a) * t;
const mix3 = (a: RGB, b: RGB, t: number): RGB => [
  mix(a[0], b[0], t),
  mix(a[1], b[1], t),
  mix(a[2], b[2], t),
];

/** GLSL's smoothstep, reproduced exactly — the shader's and this must not differ. */
export function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/** The colour a windowed density maps to, before emission scaling. */
export function rampColour(s: number): RGB {
  const base = mix3(RAMP_DEEP, RAMP_PALE, Math.pow(s, 0.7));
  return mix3(base, RAMP_WARM, smoothstep(0.72, 1, s) * 0.5);
}

export interface RayStep {
  /** Normalized log density at this sample, AFTER any expulsion shifts. */
  d: number;
  /** Step length in the same units `absorb` is calibrated against. */
  dt: number;
}

export interface CompositeOptions {
  floor: number;
  gamma: number;
  absorb: number;
  emit: number;
  /** Front-to-back accumulation stops here; the shader breaks at the same value. */
  alphaCutoff?: number;
}

export interface CompositeResult {
  rgb: RGB;
  alpha: number;
  /** How many samples were consumed before the cutoff — the shader's early-out, made observable. */
  used: number;
}

/**
 * Front-to-back emission-absorption compositing.
 *
 * `acc += (1-alpha) * a * col; alpha += (1-alpha) * a` — the standard over-operator, accumulating
 * from the eye outward so the loop can stop once the ray is effectively opaque.
 *
 * Front-to-back rather than back-to-front because the early-out is what makes a dense cloud cheap,
 * and because it is what the shipped shader does; a reference that composited the other way would
 * agree on transparent rays and diverge exactly where the picture is interesting.
 */
export function compositeRay(steps: readonly RayStep[], opts: CompositeOptions): CompositeResult {
  const cutoff = opts.alphaCutoff ?? 0.99;
  let acc: RGB = [0, 0, 0];
  let alpha = 0;
  let used = 0;
  for (const step of steps) {
    used++;
    const s = windowed(step.d, opts.floor);
    const sg = Math.pow(s, opts.gamma);
    const a = sampleOpacity(sg, opts.absorb, step.dt);
    const base = rampColour(s);
    const scale = sg * opts.emit;
    const t = 1 - alpha;
    acc = [acc[0] + t * a * base[0] * scale, acc[1] + t * a * base[1] * scale, acc[2] + t * a * base[2] * scale];
    alpha += t * a;
    if (alpha > cutoff) break;
  }
  return { rgb: acc, alpha, used };
}

/**
 * Analytic transmittance through a uniform slab — the closed form the composite must reproduce.
 *
 * Exists so the integral is checked against mathematics rather than against itself: N steps of
 * `1 - exp(-k dt)` composited front-to-back must equal `1 - exp(-k L)` for the whole slab,
 * independently of N. A discretisation error, a doubled `dt`, or an over-operator written the
 * wrong way round all break this and nothing else in the pipeline would notice.
 */
export function slabTransmittance(sg: number, absorb: number, length: number): number {
  return Math.exp(-sg * absorb * length);
}
