/*
 * timestep.ts — how big a step this configuration can take (Layer 0, pure).
 *
 * PORTED FROM gravax `simulation/timestep_criteria.py::soften_accel_criterion`.
 *
 *     dt_i = eta * sqrt(eps / |a_i|)
 *
 * A Courant-like condition: the time for a particle to fall one softening length under its own
 * acceleration. Reference: Aarseth (2003), Eq. 4.2, softening-based form — where the error
 * scaling is stated as O(eta^2) for the two-body problem and O(eta^(2/3)) for N-body.
 *
 * gravax's default is eta = 0.01, documented there as ~1% energy error, with 0.001 for
 * ultra-high precision and 0.1 for fast evolution.
 *
 * ── WHY THIS EXISTS ALONGSIDE `DIRECT_STEPS_PER_TCROSS` ──
 *
 * They answer different questions and both are wanted.
 *
 * `DIRECT_STEPS_PER_TCROSS` is a GLOBAL, STATIC choice: one number for the whole run, measured
 * against energy drift across seeds. It is what a fixed-step symplectic scheme needs, because
 * varying h destroys the symplectic property that is the whole reason for using one.
 *
 * This criterion is LOCAL and DYNAMIC: it asks what the current configuration can tolerate,
 * and its minimum over particles is the step the tightest pair demands. Used as a diagnostic
 * it answers the question the static choice cannot — "is the step I picked still adequate now
 * that the core has contracted?" — and that is how it is used here.
 *
 * IT IS NOT WIRED INTO THE INTEGRATORS AS AN ADAPTIVE CONTROLLER, deliberately. Feeding a
 * per-step varying h into a symplectic map forfeits the bounded-energy property; doing it
 * correctly needs a reversible or Hairer-Soderlind controller, which gravax has
 * (`symplectic/reversible_adaptive.py`) and this package does not. Reporting the number and
 * letting a human or a preset act on it is the honest scope.
 */
import type { ForceModel, State } from "./types.ts";

/** gravax's default accuracy parameter: ~1% energy error. */
export const DEFAULT_ETA = 0.01;

export interface TimestepAdvice {
  /** The most restrictive per-particle step [Myr] — the one the tightest pair demands. */
  dtMin: number;
  /** Median per-particle step [Myr]. Far larger than `dtMin` in a centrally concentrated cluster. */
  dtMedian: number;
  /** Index of the particle setting `dtMin`. */
  limitingParticle: number;
  /** eta used. */
  eta: number;
}

/**
 * Per-particle Courant-like timestep, reduced to the numbers a caller can act on.
 *
 * `softening` is passed rather than read off the force model because `ForceModel` deliberately
 * does not expose it — the two models mean different things by it (`direct/` a pairwise
 * Plummer length, `meanField/` a profile regulariser), and inventing a shared accessor would
 * imply they are the same quantity.
 */
export function softenAccelTimestep(
  state: State,
  force: ForceModel,
  softening: number,
  eta: number = DEFAULT_ETA,
  t = 0,
): TimestepAdvice {
  const acc = new Float64Array(state.n * 3);
  force.accelerations(state.pos, state.mass, acc, t);

  let dtMin = Infinity;
  let limitingParticle = -1;
  const all: number[] = [];

  for (let i = 0; i < state.n; i++) {
    const ax = acc[i * 3];
    const ay = acc[i * 3 + 1];
    const az = acc[i * 3 + 2];
    const mag = Math.hypot(ax, ay, az);
    /* A particle at zero acceleration has no constraint, not an infinitely small step. It
       happens exactly at the centre of a symmetric configuration and would otherwise poison
       the minimum with an Infinity or a NaN. */
    const dt = mag > 0 ? eta * Math.sqrt(softening / mag) : Infinity;
    all.push(dt);
    if (dt < dtMin) {
      dtMin = dt;
      limitingParticle = i;
    }
  }

  all.sort((a, b) => a - b);
  const dtMedian = all.length > 0 ? all[Math.floor(all.length / 2)] : Infinity;
  return { dtMin, dtMedian, limitingParticle, eta };
}
