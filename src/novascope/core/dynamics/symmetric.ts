/*
 * symmetric.ts — time-symmetric Hermite with a time-symmetric adaptive step (Layer 0, pure).
 *
 * PORTED FROM gravax `integrators/hermite/symmetric/`: the Kokubo P(EC)^n kinematics from
 * `kinematics.py` (eqs 1-8) and the Hut shared-step controller from `adaptive_integrator.py`.
 *
 *   Kokubo, E., Yoshinaga, K. & Makino, J. 1998, MNRAS 297, 1067 — "On a time-symmetric
 *     Hermite integrator for planetary N-body simulation" (the P(EC)^n corrector, eqs 1-8).
 *   Hut, P., Makino, J. & McMillan, S. 1995, ApJ 443, L93 — the time-symmetric shared step
 *     dt = 1/2 [ h(xi_0) + h(xi_1) ].
 *
 * Both references are as cited by gravax's own module headers; they were not recalled here.
 *
 * ── WHY A FOURTH INTEGRATOR ──
 *
 * `hermite.ts` is adaptive and fourth order, and it is STILL not enough, for a reason the
 * /dynamics-lab measurements made concrete: at the finest softening it reached |dE/E| = 5.7e-4
 * while spending 9809 force evaluations per crossing time, against 1.3e-5 at 1928. It got worse
 * the harder it worked.
 *
 * That is the signature of a SECULAR error. A predictor-corrector with an asymmetric step rule
 * accumulates error with the NUMBER of steps, so buying accuracy with more steps eventually
 * buys the opposite. Softening was the lab's only lever against it, which is why the page had a
 * softening slider at all.
 *
 * The cause is not the corrector. It is the step rule. `hermite.ts` sizes its step from the
 * state it is LEAVING — dt = h(xi_0) — and a map whose step depends on only one endpoint is not
 * invariant under time reversal, so it has no reason to conserve anything over the long run.
 * Hut's rule takes the step from BOTH endpoints, dt = 1/2 [h(xi_0) + h(xi_1)], which is
 * symmetric under swapping them and therefore under reversing time. Solving it needs a fixed
 * point, because xi_1 depends on dt which depends on xi_1.
 *
 * So: `hermite.ts` is not superseded. It is the CONTROL. Keeping an asymmetric scheme beside a
 * symmetric one is what makes "the symmetry of the step rule is what conserves the energy" a
 * measurement rather than an assertion — the same role the leapfrog plays for FSI4.
 *
 * ── THE TRAP, RECORDED HERE BECAUSE IT INVERTS THE RESULT ──
 *
 * The criterion h MUST be a pure function of the state. gravax hit this and wrote it down: an
 * earlier version built h from INTERPOLATED derivatives, which depend on the previous state and
 * on dt, so h was not a state function, the symmetric averaging was no longer symmetric, and —
 * their words — "the 'symmetric' scheme then drifted MORE than the asymmetric baseline".
 *
 * This is a live hazard here rather than a hypothetical, because `hermite.ts`'s own `advised()`
 * uses exactly that interpolated snap/crackle form. Reusing it would have looked like sensible
 * code reuse and silently produced a scheme worse than the one it replaced. So h is
 * eta |a| / |j| computed from DIRECTLY evaluated derivatives at the state, every time, and
 * `symmetric.test.ts` asserts that two different step histories reaching the same state advise
 * the same step.
 *
 * ── WHAT IT COSTS ──
 *
 * Force evaluations, and not a small number. Nothing is cached across steps: gravax records
 * that stale derivatives in a symmetric corrector reintroduce the drift the scheme exists to
 * remove, so (a0, j0) is recomputed fresh at the start of every attempt. One step costs
 * (1 + N_ITER) evaluations, and an adaptive step costs OUTER times that plus OUTER criterion
 * evaluations. Against `hermite.ts`'s one evaluation per sub-step that is roughly 9x per step.
 *
 * It buys that back by not needing the steps. The whole point is that the error stops growing
 * with step count, so the run does not have to be short to be trustworthy.
 *
 * ── MEASURED, AND THE COST IS THE REASON THIS IS NOT THE CLUSTER DEFAULT ──
 *
 * The property, on the eccentric two-body fixture at 128 steps per orbit — peak |dE/E| against
 * how long the run is. This is the whole argument in one table:
 *
 *     orbits     symmetric    asymmetric (hermite.ts)
 *          4      2.38e-5      2.28e-4
 *         16      2.39e-5      7.77e-4
 *         64      2.43e-5      2.96e-3
 *        256      2.56e-5      1.16e-2
 *
 * The symmetric column is FLAT — 7% growth across a 64x longer run. The asymmetric one grows by
 * a factor of 51, close to linear in the number of steps, which is what "secular" means and why
 * running it harder made /dynamics-lab worse rather than better.
 *
 * The price, on a cluster: N = 200, seed 2026, 10 crossing times, adaptive, softening EXACTLY
 * zero.
 *
 *     scheme      worst |dE/E|   evals / t_cross   wall clock
 *     symmetric      4.77e-10        147806          222 s
 *     asymmetric     3.40e-5           3758            7 s
 *
 * Five orders of accuracy for 39x the work and 30x the wall clock. At eta = 0.1 that falls to
 * about 12000 evaluations per crossing time, which is still ~6x the asymmetric scheme, because
 * one symmetric step costs 8 force evaluations against 1.
 *
 * THE CONSEQUENCE IS A DESIGN CONSTRAINT, NOT A DEFECT. At N = 2 to 10 the cost is irrelevant
 * and the demonstration is exact, so this is the right scheme for a two-body or few-body
 * scenario — where it can also run at zero softening and be run BACKWARDS to its starting
 * point. At N = 200 in a browser at 60 fps it is not interactive, so a cluster scenario should
 * offer it as a deliberate slow-and-exact mode rather than as its default.
 */
import type { Energy, ForceModel, State, Vec3Array } from "./types.ts";
import { kineticEnergy } from "./quantities.ts";
import { supportsJerk, type JerkCapable } from "./hermite.ts";

/**
 * Corrector iterations per step, the `n` of P(EC)^n.
 *
 * 2 is the smallest number that is actually a fixed-point iteration rather than a single
 * correction: at n = 1 this scheme degenerates into ordinary Hermite and loses the symmetry,
 * because the corrector never revisits the endpoint it just moved. Kokubo's scheme IS the
 * iteration; the iteration is not an accuracy tweak on top of it.
 */
export const SYMMETRIC_ITERATIONS = 2;

/**
 * Outer refinements of the Hut dt fixed point.
 *
 * 2 means: make an endpoint at the seed step, read h at it, average, remake. One would take
 * dt = 1/2[h0 + h(xi_1 at the SEED step)], which is an average involving an endpoint that is
 * not the one returned — symmetric in form only. More than 2 converges dt further at a full
 * (1 + N_ITER)-evaluation cost per refinement, and the residual is already below the corrector's
 * own fixed-point residual.
 */
export const SYMMETRIC_OUTER = 2;

/**
 * Accuracy parameter for h(xi) = eta |a| / |j|.
 *
 * 0.1, MEASURED HERE, and deliberately NOT gravax's 0.01. That value parameterises the FULL
 * Aarseth criterion, which uses snap and crackle; this is the cheaper curvature-blind
 * |a|/|j| form, and carrying 0.01 across from a different criterion would be assuming an
 * equivalence that does not hold — the same reason `hermite.ts` keeps its own eta separate
 * from `timestep.ts`'s.
 *
 * Scan: cluster, N = 100, seed 2026, 2 crossing times, adaptive, worst |dE/E|.
 *
 *     eps = 0                        eps = 0.056 pc
 *     eta    |dE/E|     evals/t_c    |dE/E|     evals/t_c
 *     0.01   3.34e-11    114080      2.65e-11     38080
 *     0.03   2.66e-09     38180      2.16e-09     12860
 *     0.10   3.27e-07     11628      2.50e-07      4036
 *
 * Cost is exactly 1/eta and error is close to eta^4, which is the fourth order showing up in
 * the step size rather than in the step count. So eta buys accuracy at a steep price, and at
 * 0.01 the scheme is spending four orders of magnitude of energy accuracy that no reader can
 * see, for ten times the work.
 *
 * 0.1 is chosen as the largest step that still holds the drift below 1e-6 — the level at which
 * `monitor.ts` would call a run healthy with three orders to spare — because on THIS scheme the
 * thing being demonstrated is that the error does not GROW, and a smaller eta does not improve
 * that. See the header: at 128 steps per orbit the drift is flat at 2.4e-5 whether the run is 4
 * orbits or 256.
 */
export const SYMMETRIC_ETA = 0.1;

export interface SymmetricHermite {
  /** Advance by `dt` [Myr]. */
  step(dt: number): void;
  readonly t: number;
  readonly state: State;
  readonly force: ForceModel;
  energy(): Energy;
  /** No-op: this scheme caches no derivatives, so there is nothing to invalidate. */
  invalidateAcceleration(): void;
  /** h(xi) = eta |a| / |j| at the CURRENT state, minimised over particles. */
  advisedStep(): number;
}

export interface SymmetricHermiteOptions {
  /** Largest internal step [Myr]. Default: no limit. */
  maxStep?: number;
  /** Starting simulation time [Myr]. Default 0. */
  t0?: number;
  /** Accuracy parameter for the step criterion. Default `SYMMETRIC_ETA`. */
  eta?: number;
  /**
   * Size sub-steps from the Hut symmetric criterion rather than subdividing `dt` uniformly.
   *
   * Default FALSE, matching every other scheme here, so a fixed-step three-way comparison stays
   * like-for-like. The time-symmetry of the CORRECTOR is present either way; `adaptive` adds the
   * time-symmetry of the STEP CHOICE, which is what lets it follow a close pair.
   */
  adaptive?: boolean;
  /** Corrector iterations. Default `SYMMETRIC_ITERATIONS`. */
  iterations?: number;
}

export function createSymmetricHermite(
  state: State,
  force: ForceModel,
  opts: SymmetricHermiteOptions = {},
): SymmetricHermite {
  if (!supportsJerk(force)) {
    throw new Error(
      `Symmetric Hermite needs a force model with accelerationsAndJerk(); '${force.id}' does ` +
        `not provide one. Use createLeapfrog for '${force.id}'.`,
    );
  }
  /* Bound to a const so the narrowing survives into the closures, as fsi4.ts and hermite.ts
     both do — TypeScript drops a guard's narrowing inside a closure. */
  const jerkForce: JerkCapable = force;

  const { mass, pos, vel, n } = state;
  const len = n * 3;

  // Step-start snapshot. Every attempt at a different dt restarts from here.
  const pos0 = new Float64Array(len);
  const vel0 = new Float64Array(len);
  const acc0 = new Float64Array(len);
  const jerk0 = new Float64Array(len);
  // The predictor, computed once per attempt and held FIXED across corrector iterations.
  const posP = new Float64Array(len);
  const velP = new Float64Array(len);
  // The moving force-evaluation point.
  const posC = new Float64Array(len);
  const velC = new Float64Array(len);
  const acc1 = new Float64Array(len);
  const jerk1 = new Float64Array(len);
  // Scratch for evaluating the criterion at a state without disturbing the above.
  const accH = new Float64Array(len);
  const jerkH = new Float64Array(len);

  const maxStep = opts.maxStep ?? Infinity;
  const eta = opts.eta ?? SYMMETRIC_ETA;
  const adaptive = opts.adaptive ?? false;
  const iterations = Math.max(1, opts.iterations ?? SYMMETRIC_ITERATIONS);
  let t = opts.t0 ?? 0;

  const FLOOR = 1e-300;

  /**
   * h(xi) = eta |a| / |j|, minimised over particles, from DIRECTLY evaluated derivatives.
   *
   * A pure function of the phase-space state and nothing else — not of dt, not of the previous
   * state. That is the whole requirement; see the header on what happens when it is violated.
   */
  function criterion(p: Vec3Array, v: Vec3Array, tt: number): number {
    jerkForce.accelerationsAndJerk(p, v, mass, accH, jerkH, tt);
    let best = Infinity;
    for (let i = 0; i < n; i++) {
      const k = i * 3;
      const aMag = Math.hypot(accH[k], accH[k + 1], accH[k + 2]);
      const jMag = Math.hypot(jerkH[k], jerkH[k + 1], jerkH[k + 2]);
      const dt = (eta * aMag) / (jMag + FLOOR);
      if (dt < best) best = dt;
    }
    return best;
  }

  /**
   * Build the endpoint of a step of size `h` from the snapshot, into (posC, velC).
   *
   * Kokubo P(EC)^n: predict ONCE, then iterate the corrector onto that FIXED predictor while
   * only the force-evaluation point moves. Correcting onto the previous iteration's corrected
   * value instead would double-count the correction and destroy the fixed point — which is the
   * single easiest way to write this function wrong, because the result still looks convergent.
   */
  function attempt(h: number): void {
    // (a0, j0) fresh at the snapshot every time. No cache: see the header.
    jerkForce.accelerationsAndJerk(pos0, vel0, mass, acc0, jerk0, t);

    const h2 = h * h;
    const h3 = h2 * h;
    const h4 = h3 * h;
    const h5 = h4 * h;

    for (let i = 0; i < len; i++) {
      posP[i] = pos0[i] + vel0[i] * h + acc0[i] * (h2 / 2) + jerk0[i] * (h3 / 6);
      velP[i] = vel0[i] + acc0[i] * h + jerk0[i] * (h2 / 2);
    }
    posC.set(posP);
    velC.set(velP);

    for (let k = 0; k < iterations; k++) {
      jerkForce.accelerationsAndJerk(posC, velC, mass, acc1, jerk1, t + h);
      for (let i = 0; i < len; i++) {
        const da = acc0[i] - acc1[i];
        // Kokubo eqs 5-6: the interpolated 2nd and 3rd derivatives at the step start.
        const a2 = (-6 * da - h * (4 * jerk0[i] + 2 * jerk1[i])) / h2;
        const a3 = (12 * da + 6 * h * (jerk0[i] + jerk1[i])) / h3;
        // Kokubo eqs 3-4, onto the FIXED predictor.
        posC[i] = posP[i] + a2 * (h4 / 24) + a3 * (h5 / 120);
        velC[i] = velP[i] + a2 * (h3 / 6) + a3 * (h4 / 24);
      }
    }
  }

  /** Commit the attempt: the endpoint becomes the state, and the clock advances by `h`. */
  function commit(h: number): void {
    pos.set(posC);
    vel.set(velC);
    t += h;
  }

  /** One fixed-size symmetric step. */
  function oneFixed(h: number): void {
    pos0.set(pos);
    vel0.set(vel);
    attempt(h);
    commit(h);
  }

  /**
   * One Hut symmetric-adaptive step, no larger than `limit`.
   *
   * Solves dt = 1/2 [h(xi_0) + h(xi_1)] by refinement, where xi_1 is itself made at dt. Returns
   * the step actually taken, which is the step that PRODUCED the committed endpoint — the two
   * cannot be allowed to differ, or every downstream diagnostic describes a time that did not
   * happen.
   */
  function oneAdaptive(limit: number): number {
    pos0.set(pos);
    vel0.set(vel);

    const h0 = criterion(pos0, vel0, t);
    let h = Math.min(h0, limit);
    if (!(h > 0) || !Number.isFinite(h)) {
      throw new Error(
        `Symmetric Hermite computed a non-positive or non-finite step (${h}) at t=${t}. ` +
          `The force derivatives are degenerate; the state is likely NaN.`,
      );
    }

    attempt(h);
    for (let r = 1; r < SYMMETRIC_OUTER; r++) {
      const h1 = criterion(posC, velC, t + h);
      const proposed = 0.5 * (h0 + h1);
      const clamped = Math.min(proposed, limit);
      if (!(clamped > 0) || !Number.isFinite(clamped)) break;
      h = clamped;
      /* Remake the endpoint AT the new step. Reusing the previous endpoint would return a state
         that no single dt produced, which is exactly the inconsistency the symmetry depends on
         not having. When the clamp binds this is still correct — the endpoint is simply remade
         at the clamped step, fixed rather than adaptive, as gravax's controller also does. */
      attempt(h);
    }
    commit(h);
    return h;
  }

  return {
    step(dt: number): void {
      if (!(dt > 0)) return;
      if (!adaptive) {
        const nSub = Number.isFinite(maxStep) ? Math.max(1, Math.ceil(dt / maxStep)) : 1;
        const h = dt / nSub;
        for (let s = 0; s < nSub; s++) oneFixed(h);
        return;
      }
      const tEnd = t + dt;
      let remaining = dt;
      let steps = 0;
      const MAX_SUBSTEPS = 1_000_000;
      while (remaining > 0) {
        if (steps++ >= MAX_SUBSTEPS) {
          throw new Error(
            `Symmetric Hermite exceeded ${MAX_SUBSTEPS} sub-steps advancing dt=${dt} (reached ` +
              `${dt - remaining}). The step has collapsed — almost always a close pair ` +
              `hardening below what an unregularised scheme can resolve.`,
          );
        }
        oneAdaptive(Math.min(maxStep, remaining));
        remaining = tEnd - t;
      }
      // Absorb floating-point accumulation across many additions; reached only on success.
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
      /* Nothing to do. This scheme deliberately holds no cross-step derivative cache — see the
         header on why a stale derivative reintroduces exactly the drift it exists to remove. The
         method exists so the type matches the other integrators. */
    },
    advisedStep(): number {
      return criterion(pos, vel, t);
    },
  };
}
