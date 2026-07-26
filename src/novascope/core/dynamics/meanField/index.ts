/*
 * meanField/index.ts — force from a spherically-averaged density (Layer 0, pure).
 *
 * The COLLISIONLESS force model. Particles are binned in radius, and each feels only the
 * enclosed mass M(<r) — Newton's shell theorem applied to a smoothed density. This is the
 * standard semi-analytic treatment of cluster gas expulsion (Hills 1980; Lada, Margulis &
 * Dearborn 1984; Baumgardt & Kroupa 2007), and `../gasExpulsion/` is built on it.
 *
 * ── WHAT IS ABSENT BY CONSTRUCTION, NOT BY RESOLUTION ──
 *
 * Every acceleration is parallel to the position vector, so there is no torque anywhere in
 * this model. Two stars at the same radius feel identical accelerations regardless of what
 * sits beside them. Two-body relaxation, dynamical mass segregation, escapers from close
 * encounters and core collapse therefore have no term here, and no amount of accuracy
 * produces them: refining the bins converges on the collisionless Boltzmann equation, which
 * genuinely lacks the relaxation term. Use `../direct/` for those.
 *
 * What it buys is O(N) instead of O(N^2), and — more subtly — the ABSENCE of the artificial
 * two-body relaxation a direct code suffers when its particle count stands in for a much
 * larger real one. At N = 10^4 representing a cluster of 10^4, direct is honest. At N = 10^4
 * representing 10^6, this model is.
 *
 * ── THE FORCE IS NOT THE EXACT GRADIENT OF THE POTENTIAL, AND THAT IS STATED ──
 *
 * M(<r) is a step function of radius, so the binned force is piecewise-smooth while the
 * binned potential is piecewise-linear in the shell sum — differentiating one does not
 * return the other except in the limit of infinitely fine bins. `../direct/` satisfies that
 * contract exactly and is tested for it; this model cannot, and `meanField.test.ts` tests
 * what is actually true instead of a weakened version of the wrong thing.
 *
 * The practical consequence is a small energy drift that does not vanish with smaller
 * timesteps, because it is a spatial-discretization error rather than a temporal one.
 * `../gasExpulsion/` measured it at -1.6e-4 over ten crossing times, which is why that code
 * treats energy drift as a diagnostic to watch rather than a conserved quantity.
 *
 * ── THE EXTERNAL COMPONENT ──
 *
 * A second spherically-symmetric mass distribution can be supplied — the natal gas cloud,
 * whose profile is fixed while its total mass decays. It is passed as functions of (r, t)
 * rather than as another particle set because it is a BACKGROUND: it acts on the stars and
 * the stars do not act back on it. That asymmetry is a modelling choice and naming it here
 * keeps it from looking like an oversight.
 */
import type { ForceModel, Vec3Array } from "../types.ts";
import { G_PC3_MSUN_MYR2 } from "../../constants/index.ts";

/** A spherically-symmetric background acting on the particles but not acted upon. */
export interface ExternalSpherical {
  /** Enclosed background mass inside radius r [pc] at time t [Myr], in Msun. */
  enclosedMass(r: number, t: number): number;
  /** Background potential per unit mass at radius r, time t [(pc/Myr)^2]. */
  potential(r: number, t: number): number;
}

export interface MeanFieldOptions {
  /** Gravitational constant [pc^3 Msun^-1 Myr^-2]. Defaults to the derived IAU value. */
  G?: number;
  /**
   * Softening [pc]. Only regularizes r -> 0 in the binned profile — it is not the pairwise
   * softening of a direct code, because there are no pairs here. Default 0.02 pc, the value
   * `../gasExpulsion/` uses, chosen as far below the mean interparticle spacing at the
   * half-mass radius (~0.03 pc for its cluster) as to affect nothing it resolves.
   */
  softening?: number;
  /** Number of log-spaced radial bins. Default 320. */
  nBins?: number;
  /** Inner grid radius [pc]; everything inside lands in bin 0. Default 0.01. */
  rMin?: number;
  /** Outer grid radius [pc]; everything beyond lands in the last bin. Default 200. */
  rMax?: number;
  external?: ExternalSpherical;
}

export interface MeanFieldForce extends ForceModel {
  /**
   * Rebuild the binned profile from the given positions.
   *
   * Explicit because `enclosedMass` and `radii` are only meaningful after a build, and every
   * other entry point rebuilds as a SIDE EFFECT. A consumer reading those arrays would
   * otherwise depend on having called something else first — the kind of ordering coupling
   * that works until someone reorders two lines.
   */
  refreshProfile(pos: Vec3Array, mass: Float64Array): void;
  /** Enclosed STELLAR mass at each bin's outer edge, after the last force evaluation. */
  readonly enclosedMass: Float64Array;
  /** Outer edge radius [pc] of each bin. */
  readonly binEdges: Float64Array;
  /** Radius [pc] of each particle, after the last force evaluation. */
  readonly radii: Float64Array;
  /** Bin index for a radius, clamped to the grid. */
  binOf(r: number): number;
}

export function createMeanFieldForce(n: number, opts: MeanFieldOptions = {}): MeanFieldForce {
  const G = opts.G ?? G_PC3_MSUN_MYR2;
  const softening = opts.softening ?? 0.02;
  const nBins = opts.nBins ?? 320;
  const rMin = opts.rMin ?? 0.01;
  const rMax = opts.rMax ?? 200;
  const external = opts.external;

  /* Log-spaced: the core needs the resolution and escapers run to large radii where it does
     not matter. Same grid as the shell code this model was extracted from. */
  const logRMin = Math.log(rMin);
  const invDlog = nBins / (Math.log(rMax) - logRMin);

  const binOf = (r: number): number => {
    if (r <= rMin) return 0;
    const k = Math.floor((Math.log(r) - logRMin) * invDlog);
    return k >= nBins ? nBins - 1 : k;
  };

  const binEdges = new Float64Array(nBins);
  for (let k = 0; k < nBins; k++) binEdges[k] = Math.exp(logRMin + (k + 1) / invDlog);

  const radii = new Float64Array(n);
  const binMass = new Float64Array(nBins);
  const enclosedMass = new Float64Array(nBins);
  /* phiOuter[k] = sum over shells STRICTLY OUTSIDE bin k of m/r — the potential contributed
     by mass exterior to a star, which exerts no net force but does set the escape energy.
     Bin k's own mass is already carried by enclosedMass[k]/edge[k] and must not appear twice. */
  const phiOuter = new Float64Array(nBins);

  function buildProfile(pos: Vec3Array, mass: Float64Array): void {
    binMass.fill(0);
    for (let i = 0; i < n; i++) {
      const x = pos[i * 3];
      const y = pos[i * 3 + 1];
      const z = pos[i * 3 + 2];
      const r = Math.sqrt(x * x + y * y + z * z);
      radii[i] = r;
      binMass[binOf(r)] += mass[i];
    }
    let cum = 0;
    for (let k = 0; k < nBins; k++) {
      cum += binMass[k];
      enclosedMass[k] = cum;
    }
    let outer = 0;
    for (let k = nBins - 1; k >= 0; k--) {
      phiOuter[k] = outer;
      const rMid = k === 0 ? binEdges[0] * 0.5 : 0.5 * (binEdges[k] + binEdges[k - 1]);
      outer += binMass[k] / Math.max(rMid, softening);
    }
  }

  /** Stellar potential per unit mass at bin k. Includes the exterior shells. */
  const phiStarAt = (k: number): number =>
    -G * (enclosedMass[k] / Math.max(binEdges[k], softening) + phiOuter[k]);

  return {
    id: "meanField",
    enclosedMass,
    binEdges,
    radii,
    binOf,
    refreshProfile: buildProfile,

    accelerations(pos: Vec3Array, mass: Float64Array, accOut: Vec3Array, t: number): void {
      buildProfile(pos, mass);
      for (let i = 0; i < n; i++) {
        const r = radii[i];
        const k = binOf(r);
        const mIn = enclosedMass[k] + (external ? external.enclosedMass(r, t) : 0);
        const soft = r * r + softening * softening;
        const f = (-G * mIn) / (soft * Math.sqrt(soft));
        accOut[i * 3] = f * pos[i * 3];
        accOut[i * 3 + 1] = f * pos[i * 3 + 1];
        accOut[i * 3 + 2] = f * pos[i * 3 + 2];
      }
    },

    potentialEnergy(pos: Vec3Array, mass: Float64Array, t: number): number {
      buildProfile(pos, mass);
      let u = 0;
      for (let i = 0; i < n; i++) {
        const k = binOf(radii[i]);
        /* Factor 1/2 on the SELF-energy (each stellar pair is counted twice by summing every
           star's potential), and no factor on the external term, which is a background the
           stars sit in rather than a mutual interaction. */
        u += 0.5 * mass[i] * phiStarAt(k);
        if (external) u += mass[i] * external.potential(radii[i], t);
      }
      return u;
    },

    potentials(pos: Vec3Array, mass: Float64Array, out: Float64Array, t: number): void {
      buildProfile(pos, mass);
      for (let i = 0; i < n; i++) {
        /* The FULL potential the star sits in, including the shells OUTSIDE it. Those exert
           no net force — which is why `accelerations` ignores them — but they absolutely set
           the escape energy, so boundness must count them. Getting this wrong makes a star
           deep inside an extended gas cloud look unbound because only the interior mass was
           holding it. */
        out[i] = phiStarAt(binOf(radii[i])) + (external ? external.potential(radii[i], t) : 0);
      }
    },
  };
}
