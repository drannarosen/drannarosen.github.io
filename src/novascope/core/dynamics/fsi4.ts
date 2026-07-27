/*
 * fsi4.ts — fourth-order FORWARD symplectic integrator (Layer 0, pure).
 *
 * PORTED FROM gravax: `integrators/symplectic/coefficients.py::FSI4` and
 * `integrators/symplectic/kernels.py::_fsi4_map`, implementing the Chin/Rantala
 * force-gradient map. Reference: Rantala, Naab & Springel (2021), equations 27-28.
 *
 * ── THE MAP ──
 *
 *     kick(h/6) -> drift(h/2) -> MODIFIED kick(2h/3) -> drift(h/2) -> kick(h/6)
 *
 * with the middle kick using a corrected acceleration
 *
 *     a_tilde = a + (h^2 / 48) g
 *
 * where g is the force-gradient term from `ForceModel.forceGradient`.
 *
 * ── WHY THIS RATHER THAN YOSHIDA OR PEFRL ──
 *
 * The standard route to fourth order is a symmetric composition of leapfrogs (Yoshida 1990;
 * PEFRL), and gravax carries both. Every such composition has a NEGATIVE substep — Yoshida's
 * middle weight is -2^(1/3)/(2 - 2^(1/3)) ~ -1.70. Stepping backwards through a close
 * encounter is exactly where a gravitational N-body integration is least well behaved.
 *
 * The force-gradient map is FORWARD: every drift and every kick coefficient above is positive.
 * It buys that with one extra piece of physics — the gradient of the force — instead of with a
 * backwards step. That is the trade, and it is why gravax's own comment notes that its
 * sixth-order sibling, which composes this map, is "not a fully forward map".
 *
 * ── WHAT IT COSTS ──
 *
 * Per step: two plain acceleration evaluations and one gradient evaluation. The gradient
 * evaluation is itself two O(N^2) passes, because g_i depends on the complete acceleration
 * FIELD and cannot start until every a_j exists. So roughly four pairwise passes per step
 * against leapfrog's one.
 *
 * That is only worth it if the error really falls as h^4 — four times the work per step must
 * buy more than four times the step size. `fsi4.test.ts` measures the convergence order rather
 * than assuming it, which is the whole point of porting a scheme rather than trusting its name.
 *
 * ── IT DOES NOT REMOVE THE NEED FOR SOFTENING. IT MAKES IT SHARPER. ──
 *
 * The natural hope is that a fourth-order scheme could run at eps -> 0. Measured, N = 200,
 * five crossing times, mean |dE/E| over three seeds (d = the mean interparticle separation):
 *
 *     eps        leapfrog@128    FSI4@128    FSI4@1024
 *     d            9.61e-6        1.80e-8     4.34e-12
 *     0.1 d        6.76e-1        1.34e+0     2.68e-2
 *     0.01 d       4.13e+0        5.87e+1     9.54e+0
 *     0            --             1.10e+1     5.05e+1
 *
 * At eps = d it is 500x better than the leapfrog and superb. Below that IT IS WORSE THAN THE
 * LEAPFROG, and at eps = 0 more steps make it worse still.
 *
 * The reason is structural rather than a tuning failure. The acceleration diverges as r^-2;
 * the force-gradient term diverges as r^-5. For a close pair the correction (h^2/48) g does
 * not correct anything — it dominates, and the scheme's extra order is precisely what makes it
 * MORE sensitive to an encounter the step cannot resolve. Higher order buys accuracy in the
 * smooth regime at the cost of robustness in the singular one.
 *
 * Removing softening honestly needs individual/adaptive timesteps plus regularisation of close
 * pairs (KS/Mikkola), which gravax has in `integrators/hermite`, `ias15` and
 * `symplectic/reversible_adaptive`. A fixed-step symplectic map cannot: varying h forfeits the
 * bounded-energy property that is the reason to use one. So eps ~ d remains the operating
 * point, and FSI4's gain is spent on accuracy there rather than on reaching smaller eps.
 */
import type { Energy, ForceModel, State, Vec3Array } from "./types.ts";
import { kineticEnergy } from "./quantities.ts";

/** A force model that can be stepped by FSI4 — i.e. one that supplies `forceGradient`. */
export type ForceGradientCapable = ForceModel &
  Required<Pick<ForceModel, "forceGradient">>;

/** Narrowing guard, so a caller can offer FSI4 only where it is actually available. */
export function supportsForceGradient(force: ForceModel): force is ForceGradientCapable {
  return typeof force.forceGradient === "function";
}

export interface Fsi4 {
  /** Advance by `dt` [Myr], subdividing so no internal step exceeds `maxStep`. */
  step(dt: number): void;
  readonly t: number;
  readonly state: State;
  readonly force: ForceModel;
  energy(): Energy;
  /** Call after writing `state.pos` from outside. Velocity changes do NOT need this. */
  invalidateAcceleration(): void;
}

export interface Fsi4Options {
  /** Largest internal step [Myr]. Default: no limit. */
  maxStep?: number;
  /** Starting simulation time [Myr]. Default 0. */
  t0?: number;
}

export function createFsi4(state: State, force: ForceModel, opts: Fsi4Options = {}): Fsi4 {
  if (!supportsForceGradient(force)) {
    /* Loud rather than a silent fallback to leapfrog. A caller that thinks it is running a
       fourth-order scheme and is not would draw exactly the wrong conclusion from a
       convergence plot, and `meanField/` reaching here is a wiring mistake worth surfacing. */
    throw new Error(
      `FSI4 needs a force model with forceGradient(); '${force.id}' does not provide one. ` +
        `Only pairwise models can — a binned radial profile has no pair structure to ` +
        `differentiate. Use createLeapfrog for '${force.id}'.`,
    );
  }

  /* Bound to a const so the narrowing survives into `one()`. A guard narrows `force` here, but
     TypeScript drops that inside a closure it cannot prove the binding outlives unreassigned —
     and a non-null assertion would have hidden the one thing this file must be sure of. */
  const gradientForce: ForceGradientCapable = force;

  const { mass, pos, vel, n } = state;
  const acc = new Float64Array(n * 3);
  const grad = new Float64Array(n * 3);
  const maxStep = opts.maxStep ?? Infinity;
  let t = opts.t0 ?? 0;
  let accValid = false;

  const kick = (scale: number, a: Vec3Array): void => {
    for (let i = 0; i < a.length; i++) vel[i] += a[i] * scale;
  };
  const drift = (scale: number): void => {
    for (let i = 0; i < pos.length; i++) pos[i] += vel[i] * scale;
  };

  function one(h: number): void {
    /* The opening kick reuses the acceleration the previous step's closing kick left behind —
       identical positions, so it is the same field. Same cache discipline as the leapfrog, and
       it is why the map costs two plain evaluations per step rather than three. */
    if (!accValid) {
      force.accelerations(pos, mass, acc, t);
      accValid = true;
    }
    kick(h / 6, acc);

    drift(h / 2);
    t += h / 2;

    // MODIFIED kick: a_tilde = a + (h^2/48) g, both evaluated at the current positions.
    gradientForce.forceGradient(pos, mass, acc, grad, t);
    const gradScale = (h * h) / 48;
    const kickScale = (2 * h) / 3;
    for (let i = 0; i < acc.length; i++) vel[i] += (acc[i] + gradScale * grad[i]) * kickScale;

    drift(h / 2);
    t += h / 2;

    force.accelerations(pos, mass, acc, t);
    kick(h / 6, acc);
    // acc now holds the field at the end-of-step positions: valid for the next opening kick.
  }

  return {
    step(dt: number): void {
      if (!(dt > 0)) return;
      // Uniform sub-steps, as in the leapfrog: an uneven final step breaks reversibility.
      const nSub = Number.isFinite(maxStep) ? Math.max(1, Math.ceil(dt / maxStep)) : 1;
      const h = dt / nSub;
      for (let s = 0; s < nSub; s++) one(h);
    },
    get t() {
      return t;
    },
    state,
    force,
    energy(): Energy {
      const kinetic = kineticEnergy(state);
      const potential = force.potentialEnergy(pos, mass, t);
      return { kinetic, potential, total: kinetic + potential };
    },
    invalidateAcceleration(): void {
      accValid = false;
    },
  };
}
