/*
 * hermite.ts — fourth-order Hermite predictor-corrector, with an adaptive step (Layer 0, pure).
 *
 * PORTED FROM gravax `integrators/hermite/`: the order-4 corrector from
 * `direct/kinematics.py::_correct_order4`, the jerk kernel from
 * `core/gravity/newtonian.py::_pairwise_accel_jerk`, and the timestep criterion from
 * `common/timestep.py::aarseth_dt`. Scheme reference: Makino & Aarseth (1992), PASJ 44, 141
 * (1992PASJ...44..141M); criterion: Aarseth (2003), "Gravitational N-Body Simulations", Eq. 4.1.
 *
 * ── WHY THIS EXISTS ALONGSIDE FSI4, WHICH IS ALSO FOURTH ORDER ──
 *
 * Not as a better integrator. As a DIFFERENT ONE, for two things FSI4 structurally cannot do.
 *
 * FIRST, IT ADAPTS. `fsi4.ts` documents its own ceiling: below eps ~ d the energy error explodes,
 * because the force-gradient term diverges as r^-5 and a fixed step cannot resolve a close pair.
 * That measurement could not distinguish "the step is too coarse" from "no fixed step works",
 * because every arm of it was fixed-step. The Aarseth criterion sizes dt from the force
 * derivatives, so it contracts by itself as a pair closes — which makes that question answerable.
 *
 * SECOND, IT IS AN INDEPENDENT KERNEL. The leapfrog and FSI4 are both built from the SAME
 * `accelerations` routine, so a defect there would appear identically in both and they would
 * agree with each other while being wrong together. Hermite is a different family
 * (predictor-corrector, not a symplectic map) driven by a different kernel (jerk). Agreement
 * between FSI4 and Hermite on a physical result is therefore evidence; disagreement localises a
 * bug to one of them.
 *
 * ── WHAT IT COSTS: IT IS NOT SYMPLECTIC ──
 *
 * This is the real trade and it is not a detail. A symplectic map has a bounded, oscillatory
 * energy error — the property ADR 0016 chose the leapfrog for, and the reason a lab stays honest
 * ten minutes into a lecture. A predictor-corrector does not: its energy error is SECULAR and
 * grows with the number of steps. Over a long run Hermite will eventually be worse than FSI4 even
 * though both are fourth order.
 *
 * So Hermite is an INSTRUMENT here, not the default. `chooseIntegrator` still returns FSI4.
 *
 * ── THE MAP ──
 *
 * Predict to the end of the step from the current derivatives (position to dt^3, velocity to
 * dt^2 — the jerk-truncated MA92 predictor; adding the snap/crackle terms here as well would
 * double-count what the corrector supplies and DROP the order):
 *
 *     q_p = q + v dt + a dt^2/2 + j dt^3/6
 *     v_p = v + a dt + j dt^2/2
 *
 * Evaluate (a1, j1) at the predicted state, then recover the higher derivatives by Hermite
 * interpolation of the two endpoints, and correct:
 *
 *     a2 = ( -6 (a0 - a1) - dt (4 j0 + 2 j1) ) / dt^2
 *     a3 = ( 12 (a0 - a1) + 6 dt (j0 + j1)  ) / dt^3
 *     q  = q_p + a2 dt^4/24 + a3 dt^5/120
 *     v  = v_p + a2 dt^3/6  + a3 dt^4/24
 *
 * ── MEASURED (2026-07-27) ──
 *
 * Convergence on the eccentric two-body fixture (e = 0.5, `kepler.testutil.ts`), peak |dE/E|
 * over four orbits. All three schemes on the same orbit, same softening, same sampling:
 *
 *     steps/period   leapfrog  ratio      FSI4    ratio     Hermite  ratio
 *              128   6.35e-3     --    1.82e-6     --     2.28e-4     --
 *              256   1.60e-3    4.0    1.15e-7   15.8     9.36e-6   24.3
 *              512   4.01e-4    4.0    7.17e-9   16.0     4.30e-7   21.7
 *             1024   1.00e-4    4.0    4.48e-10  16.0     2.20e-8   19.5
 *             2048   2.51e-5    4.0    2.80e-11  16.0     1.22e-9   18.0
 *             4096   6.27e-6    4.0    1.76e-12  15.9     7.17e-11  17.1
 *             8192   1.57e-6    4.0    9.41e-14  18.7     4.15e-12  17.3
 *
 * Two honest observations rather than one tidy claim:
 *
 * FIRST, Hermite is fourth order, but its ratio has NOT settled on 16 by 8192 steps/period. The
 * sequence 24.3, 21.7, 19.5, 18.0, 17.1, 17.3 is monotone decreasing and consistent with
 * approaching 16 from above — a higher-order term still dying off — but that is an inference
 * from the shape, not something measured to convergence. It is unambiguously fourth order and
 * not second (4) or sixth (64); where exactly it asymptotes is not established here.
 *
 * SECOND, FSI4 IS ROUGHLY 50x MORE ACCURATE AT THE SAME STEP COUNT. That is the price of not
 * being symplectic, visible immediately. At equal step Hermite is the worse integrator, and it
 * earns its place entirely on the adaptivity below — not on accuracy.
 *
 * ── WHAT THE ADAPTIVITY BUYS, MEASURED ──
 *
 * Same fixture, `adaptive: true`, eta = 0.01, four orbits: peak |dE/E| = 8.03e-6, with the
 * advised step ranging 9.34e-4 .. 9.21e-2 — a factor of 99 between periapsis and apoapsis.
 *
 * That factor is the entire argument. A fixed-step scheme must run the whole orbit at the step
 * the periapsis passage demands, spending 99x more effort than necessary everywhere else. On a
 * cluster the same logic applies to a hard binary: it sets the step for all N particles.
 */
import type { Energy, ForceModel, State, Vec3Array } from "./types.ts";
import { kineticEnergy } from "./quantities.ts";

/** A force model Hermite can step — i.e. one that supplies `accelerationsAndJerk`. */
export type JerkCapable = ForceModel & Required<Pick<ForceModel, "accelerationsAndJerk">>;

/** Narrowing guard, so a caller can offer Hermite only where it is actually available. */
export function supportsJerk(force: ForceModel): force is JerkCapable {
  return typeof force.accelerationsAndJerk === "function";
}

/**
 * Accuracy parameter for the Aarseth criterion. Aarseth (2003) §4.1 recommends 0.01-0.02 for
 * the fourth-order scheme; gravax's `aarseth_dt` docstring gives "typically 0.01".
 *
 * DELIBERATELY SEPARATE from `timestep.ts`'s `DEFAULT_ETA`, despite both being 0.01. They
 * parameterise DIFFERENT criteria — that one is dt = eta sqrt(eps/|a|), this one balances
 * truncation error across the force derivatives — so sharing a constant would assert an
 * equivalence that does not hold, and tuning one would silently move the other.
 */
export const HERMITE_ETA = 0.01;

export interface Hermite {
  /** Advance by `dt` [Myr]. */
  step(dt: number): void;
  readonly t: number;
  readonly state: State;
  readonly force: ForceModel;
  energy(): Energy;
  /** Call after writing `state.pos` or `state.vel` from outside. */
  invalidateAcceleration(): void;
  /**
   * The step [Myr] the Aarseth criterion advises for the CURRENT state.
   *
   * Exposed whether or not `adaptive` is set, because it is a diagnostic in its own right: it
   * says what the configuration is asking for, which is how a fixed-step run reports that it is
   * being run too coarsely rather than merely producing a worse answer.
   */
  advisedStep(): number;
}

export interface HermiteOptions {
  /** Largest internal step [Myr]. Default: no limit. */
  maxStep?: number;
  /** Starting simulation time [Myr]. Default 0. */
  t0?: number;
  /** Aarseth accuracy parameter. Default `HERMITE_ETA`. */
  eta?: number;
  /**
   * Size sub-steps from the Aarseth criterion rather than subdividing `dt` uniformly.
   *
   * Default FALSE, so the default behaviour matches the leapfrog and FSI4 exactly. That makes
   * the fixed-step arm of a three-way comparison a like-for-like measurement — an adaptive
   * default would mean "Hermite vs FSI4" silently compared two different experiments.
   */
  adaptive?: boolean;
}

export function createHermite(
  state: State,
  force: ForceModel,
  opts: HermiteOptions = {},
): Hermite {
  if (!supportsJerk(force)) {
    /* Loud rather than a silent fallback, exactly as FSI4 refuses. A caller that believed it was
       running an adaptive fourth-order scheme and was not would misread every result. */
    throw new Error(
      `Hermite needs a force model with accelerationsAndJerk(); '${force.id}' does not ` +
        `provide one. The jerk of a binned radial profile is not defined by the profile — it ` +
        `knows nothing about which particles moved. Use createLeapfrog for '${force.id}'.`,
    );
  }

  /* Bound to a const so the narrowing survives into the closures below. Same reason as
     `fsi4.ts`: TypeScript drops a guard's narrowing inside a closure, and a non-null assertion
     would hide the one thing this file must be certain of. */
  const jerkForce: JerkCapable = force;

  const { mass, pos, vel, n } = state;
  const acc = new Float64Array(n * 3);
  const jerk = new Float64Array(n * 3);
  const snap = new Float64Array(n * 3);
  const crackle = new Float64Array(n * 3);
  /* Endpoint scratch: (a1, j1) at the predicted state, kept apart from (a0, j0) because the
     corrector needs BOTH ends and overwriting the start in place would silently use a1 twice. */
  const acc1 = new Float64Array(n * 3);
  const jerk1 = new Float64Array(n * 3);
  const pos0 = new Float64Array(n * 3);
  const vel0 = new Float64Array(n * 3);

  const maxStep = opts.maxStep ?? Infinity;
  const eta = opts.eta ?? HERMITE_ETA;
  const adaptive = opts.adaptive ?? false;
  let t = opts.t0 ?? 0;
  let derivsValid = false;
  /* Snap and crackle come from interpolating ACROSS a step, so they do not exist until one has
     been taken. Before that the criterion falls back to the startup form. */
  let haveHighDerivs = false;

  const refreshDerivs = (): void => {
    if (derivsValid) return;
    jerkForce.accelerationsAndJerk(pos, vel, mass, acc, jerk, t);
    derivsValid = true;
  };

  /** One Hermite step of size h, assuming (acc, jerk) are current. */
  function one(h: number): void {
    refreshDerivs();
    pos0.set(pos);
    vel0.set(vel);

    // PREDICT.
    const h2 = h * h;
    const h3 = h2 * h;
    for (let i = 0; i < pos.length; i++) {
      pos[i] = pos0[i] + vel0[i] * h + acc[i] * (h2 / 2) + jerk[i] * (h3 / 6);
      vel[i] = vel0[i] + acc[i] * h + jerk[i] * (h2 / 2);
    }
    t += h;

    // Evaluate at the predicted state.
    jerkForce.accelerationsAndJerk(pos, vel, mass, acc1, jerk1, t);

    // CORRECT, with the higher derivatives recovered from the two endpoints.
    const h4 = h3 * h;
    const h5 = h4 * h;
    for (let i = 0; i < pos.length; i++) {
      const da = acc[i] - acc1[i];
      const a2 = (-6 * da - h * (4 * jerk[i] + 2 * jerk1[i])) / h2;
      const a3 = (12 * da + 6 * h * (jerk[i] + jerk1[i])) / h3;
      snap[i] = a2;
      crackle[i] = a3;
      pos[i] += a2 * (h4 / 24) + a3 * (h5 / 120);
      vel[i] += a2 * (h3 / 6) + a3 * (h4 / 24);
    }

    /* The endpoint field becomes the next step's start. It was evaluated at the PREDICTED state
       rather than the corrected one, which is the standard MA92 economy: re-evaluating after the
       correction would double the force cost for a change of order h^4 that the next corrector
       absorbs anyway. */
    acc.set(acc1);
    jerk.set(jerk1);
    derivsValid = true;
    haveHighDerivs = true;
  }

  /**
   * Aarseth's criterion, minimised over particles.
   *
   *     dt = sqrt( eta (|a||a2| + |j|^2) / (|j||a3| + |a2|^2) )
   *
   * Before the first step there is no a2 or a3, so the startup form dt = eta |a| / |j| is used
   * instead (gravax `aarseth_dt_init`). Both carry a floor in the denominator so an exactly
   * stationary particle — a lone body, or one at a symmetry centre — yields Infinity for itself
   * and drops out of the minimum rather than producing NaN.
   */
  function advised(): number {
    refreshDerivs();
    const FLOOR = 1e-300;
    let best = Infinity;
    for (let i = 0; i < n; i++) {
      const k = i * 3;
      const aMag = Math.hypot(acc[k], acc[k + 1], acc[k + 2]);
      const jMag = Math.hypot(jerk[k], jerk[k + 1], jerk[k + 2]);
      let dt: number;
      if (haveHighDerivs) {
        const sMag = Math.hypot(snap[k], snap[k + 1], snap[k + 2]);
        const cMag = Math.hypot(crackle[k], crackle[k + 1], crackle[k + 2]);
        dt = Math.sqrt((eta * (aMag * sMag + jMag * jMag)) / (jMag * cMag + sMag * sMag + FLOOR));
      } else {
        dt = (eta * aMag) / (jMag + FLOOR);
      }
      if (dt < best) best = dt;
    }
    return best;
  }

  return {
    step(dt: number): void {
      if (!(dt > 0)) return;
      if (!adaptive) {
        // Uniform sub-steps, identical to the leapfrog and FSI4 so the arms are comparable.
        const nSub = Number.isFinite(maxStep) ? Math.max(1, Math.ceil(dt / maxStep)) : 1;
        const h = dt / nSub;
        for (let s = 0; s < nSub; s++) one(h);
        return;
      }
      /* Adaptive: take Aarseth-sized steps, truncating the last one to land exactly on the
         requested dt. Truncation is safe HERE in a way it would not be in a symplectic scheme —
         the leapfrog subdivides uniformly precisely because an uneven final step breaks its
         reversibility, and Hermite has no such property to protect.

         The target is tracked as a REMAINING amount rather than compared against `t`, so the
         loop cannot be defeated by floating-point accumulation in t. */
      const tEnd = t + dt;
      let remaining = dt;
      /* A hard cap on sub-steps. Without one, a pair that hardens without bound takes
         ever-smaller steps and hangs the tab.

         Exhausting it THROWS rather than returning quietly. Returning would leave the caller
         holding a state advanced by an unknown fraction of `dt` while `t` said otherwise, and
         every downstream diagnostic would then be describing a time that never happened. A
         hung close pair is a real physical regime this scheme cannot resolve; saying so is the
         answer, and silently reporting a different simulation is not. */
      let steps = 0;
      const MAX_SUBSTEPS = 1_000_000;
      while (remaining > 0) {
        if (steps++ >= MAX_SUBSTEPS) {
          throw new Error(
            `Hermite exceeded ${MAX_SUBSTEPS} sub-steps advancing dt=${dt} (reached ` +
              `${dt - remaining}). The Aarseth step has collapsed — almost always a close pair ` +
              `hardening below what this scheme can resolve. Raise the softening, or use a ` +
              `regularised scheme for the pair.`,
          );
        }
        const h = Math.min(advised(), maxStep, remaining);
        if (!(h > 0) || !Number.isFinite(h)) {
          throw new Error(
            `Hermite computed a non-positive or non-finite step (${h}) at t=${t}. The force ` +
              `derivatives are degenerate; the state is likely NaN.`,
          );
        }
        one(h);
        remaining = tEnd - t;
      }
      /* Snap to the requested end. The sub-steps summed to `dt` by construction, so this only
         absorbs floating-point accumulation across many additions — and it is reached only when
         the loop completed, never on the error paths above. */
      t = tEnd;
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
      derivsValid = false;
      haveHighDerivs = false;
    },
    advisedStep: advised,
  };
}
