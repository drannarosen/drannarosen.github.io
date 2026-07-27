/*
 * diagnostics.ts — the numbers a reader is shown (Layer 0, pure).
 *
 * Every quantity here is DERIVED from the state and the force model, never accumulated as
 * the run proceeds. That is deliberate: an accumulated diagnostic can be right at the start
 * and wrong later without anything failing, and this file exists to be trusted on a page
 * that claims to show physics.
 *
 * The one thing that is NOT here is the potential: it comes from the force model, because it
 * has to be the potential whose gradient was actually stepped (`./types.ts`). Re-deriving it
 * here would be the second home this whole layout exists to avoid, and the failure would be
 * invisible — a plausible energy that drifts.
 */
import type { ForceModel, State } from "./types.ts";
import { kineticEnergy, radii, rmsSpeed, totalMass } from "./quantities.ts";

export interface Diagnostics {
  /** Kinetic energy [Msun (pc/Myr)^2]. */
  kinetic: number;
  /** Potential energy, from the force model. */
  potential: number;
  total: number;
  /** Q = T/|U|. 1/2 in equilibrium; below collapses, above expands. */
  virialRatio: number;
  /** Fraction of stars, by NUMBER, with 1/2 v^2 + Phi < 0. */
  boundFraction: number;
  /** Fraction of stellar MASS that is bound — the quantity the literature quotes. */
  boundMassFraction: number;
  /** Root-mean-square speed [pc/Myr]. */
  rmsSpeed: number;
  /**
   * Which stars are bound, 1 or 0 per particle.
   *
   * Returned rather than a half-mass radius, and that is a deliberate API choice. Every
   * quantity above is O(n); a Lagrangian radius needs a SORT, and measured at n = 10,301 that
   * sort is 2.30 ms against 0.19 ms for a whole profile rebuild — 67% of what this function
   * used to cost. Bundling it in meant a caller wanting energy each frame paid for a radius
   * it never read.
   *
   * So the expensive thing is now explicit at the call site:
   *
   *     const d = measure(state, force);
   *     const rHalf = lagrangianRadii(state, [0.5], (i) => d.bound[i] === 1)[0];
   */
  bound: Uint8Array;
}

/**
 * Radii enclosing the given cumulative mass fractions [pc], for a SUBSET of particles.
 *
 * Lagrangian radii are how cluster expansion and core collapse are actually read: the inner
 * ones contract while the outer ones expand, and a single half-mass radius shows neither.
 *
 * Sorts, rather than binning. A binned estimate of a 1% radius is quantized by the bin grid
 * exactly where the interesting motion is, and the sort costs nothing at these N.
 *
 * INTERPOLATES IN CUMULATIVE MASS rather than returning the radius of the first particle to
 * cross the target, for two reasons found by measuring:
 *
 *   1. The step version is quantized by the particle spacing, so r_h PLOTTED AGAINST TIME is
 *      a staircase — which is what the lab does with it, and a staircase reads as the
 *      cluster twitching rather than as the estimator's resolution.
 *   2. It is biased, not merely coarse. Floating-point partial sums land just below their
 *      target, so the crossing test takes one extra particle essentially every time:
 *      measured 1.1 / 5.1 / 9.0 on a uniform ladder whose exact answers are 1 / 5 / 9. The
 *      error is one-sided, so it does not average away over a run.
 */
export function lagrangianRadii(
  state: State,
  fractions: readonly number[],
  include?: (i: number) => boolean,
): number[] {
  const idx: number[] = [];
  for (let i = 0; i < state.n; i++) if (!include || include(i)) idx.push(i);
  const r = new Float64Array(state.n);
  radii(state, r);
  idx.sort((a, b) => r[a] - r[b]);

  /* Cumulative mass AT each particle, so the interpolation has both endpoints of every
     interval available. cum[k] is the mass enclosed by particle k inclusive. */
  const cum = new Float64Array(idx.length);
  let running = 0;
  for (let k = 0; k < idx.length; k++) {
    running += state.mass[idx[k]];
    cum[k] = running;
  }
  const mTot = running;

  return fractions.map((f) => {
    if (idx.length === 0 || !(mTot > 0)) return 0;
    const target = f * mTot;
    // First particle whose enclosed mass reaches the target.
    let k = 0;
    while (k < idx.length - 1 && cum[k] < target) k++;
    // Interpolate between the previous crossing point and this one. Below the first
    // particle the lower endpoint is (0 mass, 0 radius), which is the physical centre.
    const mLo = k === 0 ? 0 : cum[k - 1];
    const rLo = k === 0 ? 0 : r[idx[k - 1]];
    const span = cum[k] - mLo;
    const frac = span > 0 ? (target - mLo) / span : 0;
    return rLo + frac * (r[idx[k]] - rLo);
  });
}

/**
 * Everything at once, for one state under one force model.
 *
 * BOUNDNESS USES THE FULL POTENTIAL AT THE STAR, not the enclosed mass. Escape is set by
 * Phi, and mass exterior to a star contributes to Phi while exerting no net force on it —
 * so a star inside an extended gas cloud is far more bound than the interior mass alone
 * suggests. Using the force-side quantity here would report a cluster as disrupting while it
 * sat safely at the bottom of a deep well.
 *
 * It is also measured in the frame the state is in. `removeBulkMotion` should have run; a
 * cluster with net momentum would report every star unbound at large enough drift speed.
 */
export function measure(state: State, force: ForceModel, t = 0): Diagnostics {
  const kinetic = kineticEnergy(state);
  const potential = force.potentialEnergy(state.pos, state.mass, t);

  const phi = new Float64Array(state.n);
  force.potentials(state.pos, state.mass, phi, t);

  let boundN = 0;
  let boundM = 0;
  const isBound = new Uint8Array(state.n);
  for (let i = 0; i < state.n; i++) {
    const vx = state.vel[i * 3];
    const vy = state.vel[i * 3 + 1];
    const vz = state.vel[i * 3 + 2];
    if (0.5 * (vx * vx + vy * vy + vz * vz) + phi[i] < 0) {
      isBound[i] = 1;
      boundN++;
      boundM += state.mass[i];
    }
  }
  const mTot = totalMass(state);

  return {
    kinetic,
    potential,
    total: kinetic + potential,
    virialRatio: potential !== 0 ? kinetic / Math.abs(potential) : 0,
    boundFraction: state.n > 0 ? boundN / state.n : 0,
    boundMassFraction: mTot > 0 ? boundM / mTot : 0,
    rmsSpeed: rmsSpeed(state),
    bound: isBound,
  };
}
