/*
 * direct/index.ts — pairwise gravity, summed over every pair (Layer 0, pure).
 *
 * The COLLISIONAL force model. Every star feels every other star individually, so two-body
 * relaxation, dynamical mass segregation, escapers and core collapse all emerge from the sum
 * rather than being put in by hand. None of them exists in `meanField/`, which is not a
 * matter of accuracy — a spherically-averaged force has no term for any of it.
 *
 * ── PLUMMER SOFTENING, AND WHY THE POTENTIAL IS WRITTEN BESIDE THE FORCE ──
 *
 *     Phi_ij = -G m_i m_j / sqrt(r^2 + eps^2)
 *     a_i    = -G sum_j m_j (r_i - r_j) / (r^2 + eps^2)^{3/2}
 *
 * The second is exactly the gradient of the first. That is not decoration: an energy check
 * against an unsoftened potential would report drift while the integrator was perfect (see
 * `../types.ts`). `direct.test.ts` verifies it numerically rather than trusting the algebra,
 * by finite-differencing `potentialEnergy` and comparing against `accelerations`.
 *
 * Softening regularizes the r -> 0 divergence. It is not a small correction to be minimized:
 * too small and a close pair takes an arbitrarily short timestep the integrator does not
 * have; too large and the cluster is artificially puffy. `softeningForCluster` states the
 * usual scaling and its provenance rather than hiding a number in a default.
 *
 * ── COST, AND THE HONEST N ──
 *
 * O(N^2). Newton's third law halves the work — each pair is computed once and applied to
 * both members — which is also what makes total momentum conserved to round-off rather than
 * approximately.
 *
 * MEASURED 2026-07-26, because the first version of this comment guessed and was wrong. Cost
 * of one full KDK step in node on an M-series Mac:
 *
 *      N      ms/step    steps per 16.7 ms frame
 *    256       1.13        14.8
 *    512       2.52         6.6
 *   1024       8.41         2.0
 *   2048      31.77         0.5
 *
 * So the honest interactive ceiling is **N ~ 512**, with ~1024 usable if a frame takes only
 * one or two sub-steps. It is NOT 2000 — at 2048 a SINGLE step already costs twice a frame
 * budget, before anything is drawn. The earlier claim of "interactive to roughly N = 2000"
 * was written without measuring and is corrected here rather than quietly dropped.
 *
 * N ~ 500 is a real cluster rather than a concession: plenty of young clusters have a few
 * hundred members, and at that N this is an honest model OF a 500-star cluster. Using a few
 * thousand particles to stand in for a 10^6-star cluster would be the dishonest direction —
 * it imports an artificial relaxation time set by the particle count one could afford, which
 * is why `meanField/` remains the right tool at large N.
 */
import type { ForceModel, Vec3Array } from "../types.ts";
import { G_PC3_MSUN_MYR2 } from "../../constants/index.ts";

export interface DirectOptions {
  /**
   * Plummer softening length [pc]. REQUIRED — there is no default.
   *
   * A default here would be a physics choice hidden in a constructor, and the right value
   * depends on the system being modelled. `softeningForCluster` computes the usual one.
   */
  softening: number;
  /** Gravitational constant [pc^3 Msun^-1 Myr^-2]. Defaults to the derived IAU value. */
  G?: number;
}

/**
 * Leapfrog sub-steps per crossing time. MEASURED, not guessed — the same treatment
 * `../gasExpulsion/` gives its own 200, and for the same reason: a timestep chosen by eye is
 * an accuracy claim nobody checked.
 *
 * Total-energy drift over 10 crossing times, N = 512, three independent realizations:
 *
 *     steps/t_cross      8        16        32        64       128       256
 *     seed 2026       3.2e-1    3.5e-1    1.1e-2    2.5e-5    1.3e-5    1.8e-5
 *     seed 7          5.2e-2    7.7e-3    9.5e-5    1.5e-5    1.4e-5    1.9e-6
 *     seed 99         2.7e-1    4.1e-3    2.2e-3    1.0e-4    5.4e-6    4.6e-6
 *
 * 128 is the choice, for a reason visible only across seeds. At 32 the drift varies by a
 * factor of 100 between realizations — the answer depends on whether that particular cluster
 * happened to have a close encounter, which is exactly the regime to stay out of. By 128 every
 * seed sits at or below 1.4e-5 and going finer buys nothing consistent: at 256 one seed
 * improves and another gets worse, because the residual is no longer the timestep but
 * individual close encounters, which are chaotic and do not average down.
 *
 * That last point is the real content. Beyond ~128 this is not "more accurate", it is a
 * different trajectory of an equally valid chaotic system, and treating a smaller number as a
 * better answer would be misreading noise as convergence.
 *
 * Cost at N = 512: 68 ms per crossing time.
 *
 * THIS IS THE REFERENCE POINT FOR fraction = 1. A different softening needs a different step —
 * see `stepsForSoftening`, which derives it, and `softeningForCluster` for the measurement
 * showing why the two must move together.
 */
export const DIRECT_STEPS_PER_TCROSS = 128;

/**
 * Softening length [pc] for a collisional cluster: eps = fraction * r_h * N^(-1/3).
 *
 * DEFAULT fraction 0.5, giving eps/r_h ~ 0.086 at N = 200. See below for why it is not 1, and
 * note that `stepsForSoftening` must move with it — eps and the timestep are coupled.
 *
 * ── THE ERROR THIS REPLACED, BECAUSE IT WAS CONCEPTUAL, NOT NUMERICAL ──
 *
 * This function previously defaulted to fraction 1 and described r_h N^(-1/3) as "the mean
 * interparticle separation", presenting that as the natural choice. Two things were wrong.
 *
 * FIRST, softening at the mean separation is the COLLISIONLESS convention. Its explicit
 * purpose in galaxy and cosmological simulations is to SUPPRESS two-body relaxation, which
 * there is a numerical artefact: the particles are tracers of a smooth distribution function,
 * not stars. `direct/` exists for the opposite reason — its entire justification is that
 * relaxation, segregation and escapers emerge from the pair sum. It was being run with the
 * softening designed to kill the physics it is for.
 *
 * gravax states the correct convention in one line (`clusters.py`): "Default softening=0.0 is
 * the collisional convention." It can afford zero because it has Hermite, IAS15 and adaptive
 * schemes with regularised close pairs. A fixed-step symplectic map cannot, so this is a
 * compromise — but the compromise is now measured rather than inherited.
 *
 * SECOND, the quantity is not even the mean separation. With N/2 stars inside r_h the true
 * mean spacing is r_h (8pi/3 / N)^(1/3) = 0.227 pc at N = 200, twice this formula's 0.112.
 * The N^(-1/3) SCALING is right; the coefficient was never derived.
 *
 * ── WHAT THE SOFTENING ACTUALLY COSTS, IN COULOMB LOGARITHMS ──
 *
 * Relaxation is driven by encounters across a range of impact parameters, contributing equally
 * per decade — hence a logarithm. Softening at eps removes everything closer, so the effective
 * Coulomb log falls from ln(r_h/r_90) to ln(r_h/eps), where r_90 = 2G<m>/v^2 is the
 * 90-degree deflection radius. At N = 200, r_h = 0.6525 pc:
 *
 *     r_90            = 0.0065 pc   eps/r_h = 0.010   ln(r_h/r_90) = 4.61
 *     eps = 1.0 * d   = 0.1116 pc   eps/r_h = 0.171   ln(r_h/eps)  = 1.77
 *
 * So the old default was throwing away 62% of the Coulomb logarithm — relaxation suppressed by
 * a factor of 2.6.
 *
 * ── MEASURED, WITH THE TIMESTEP SCALED PROPERLY ──
 *
 * FSI4, N = 200, 15 crossing times, six seeds, steps = 128 sqrt(d/eps) so the encounters stay
 * resolved as eps shrinks. d_rho is the change in the mass-radius rank correlation; more
 * negative means more segregation actually happened.
 *
 *     eps/r_h   ln(r_h/eps)  steps   |dE/E|     d_rho +/- SE      r_h/r_h0
 *      0.171        1.77       128   1.36e-8   -0.0592 +/- 0.0390   1.159
 *      0.086        2.46       181   9.82e-6   -0.0771 +/- 0.0166   1.266
 *      0.043        3.15       256   3.25e-3   -0.1043 +/- 0.0393   1.226
 *      0.021        3.85       362   2.60e-1   -0.0753 +/- 0.0399   1.537
 *      0.011        4.54       512   1.11e+0   -0.0359 +/- 0.0295   2.372
 *      0.005        5.23       724   8.41e+0   +0.0104 +/- 0.0272   4.923
 *
 * Segregation strengthens 1.8x from eps/r_h 0.171 to 0.043, while ln(r_h/eps) grows 1.77 to
 * 3.15 — also 1.8x. The Coulomb-log prediction tracks quantitatively, which is the evidence
 * that the mechanism is understood rather than merely observed.
 *
 * Below eps/r_h ~ 0.04 it collapses: the energy error passes 10% and the cluster inflates,
 * so the falling correlation there is numerical destruction, not relaxation.
 *
 * HONEST LIMIT ON THE CLAIM: the individual differences between adjacent rows are within
 * their standard errors. What is solid is the monotone trend over the first three, its
 * agreement with the log prediction, and the unambiguous breakdown below 0.04.
 *
 * fraction 0.5 is chosen as the largest step down from the old default that keeps the energy
 * excellent (9.8e-6) while recovering a measurable part of the relaxation, and it carries the
 * tightest error bar in the scan. fraction 0.25 buys the strongest segregation at 300x worse
 * energy and is available for a run that wants it.
 */
export function softeningForCluster(rHalfPc: number, n: number, fraction = 0.5): number {
  return (fraction * rHalfPc) / Math.cbrt(Math.max(n, 1));
}

/**
 * Sub-steps per crossing time for a given softening fraction.
 *
 * EPS AND THE TIMESTEP ARE COUPLED, and this function exists because forgetting that produced
 * a wrong conclusion. An earlier investigation shrank eps while holding the step at 128 and
 * concluded that small softening was unusable — but the Courant criterion this package already
 * ports says dt ~ sqrt(eps/|a|), so a smaller eps needs a proportionally smaller step. With
 * the step scaled the result reversed: segregation strengthened rather than collapsing.
 *
 * Deriving one from the other makes that mistake unavailable rather than merely documented.
 */
export function stepsForSoftening(fraction: number): number {
  return Math.round(DIRECT_STEPS_PER_TCROSS * Math.sqrt(1 / Math.max(fraction, 1e-6)));
}

export function createDirectForce(opts: DirectOptions): ForceModel {
  const G = opts.G ?? G_PC3_MSUN_MYR2;
  const eps2 = opts.softening * opts.softening;

  return {
    id: "direct",

    accelerations(pos: Vec3Array, mass: Float64Array, accOut: Vec3Array): void {
      const n = mass.length;
      accOut.fill(0);
      /* Each unordered pair once, applied to both members with opposite sign. Halves the
         work AND makes sum(m_i a_i) identically zero in floating point, which is what the
         momentum test in direct.test.ts asserts. Looping j over all i != j instead would
         leave momentum conserved only to accumulated round-off. */
      for (let i = 0; i < n; i++) {
        const ix = i * 3;
        const xi = pos[ix];
        const yi = pos[ix + 1];
        const zi = pos[ix + 2];
        const mi = mass[i];
        for (let j = i + 1; j < n; j++) {
          const jx = j * 3;
          const dx = pos[jx] - xi;
          const dy = pos[jx + 1] - yi;
          const dz = pos[jx + 2] - zi;
          const r2 = dx * dx + dy * dy + dz * dz + eps2;
          const invR3 = 1 / (r2 * Math.sqrt(r2));
          const s = G * invR3;
          const si = s * mass[j];
          const sj = s * mi;
          accOut[ix] += si * dx;
          accOut[ix + 1] += si * dy;
          accOut[ix + 2] += si * dz;
          accOut[jx] -= sj * dx;
          accOut[jx + 1] -= sj * dy;
          accOut[jx + 2] -= sj * dz;
        }
      }
    },

    potentialEnergy(pos: Vec3Array, mass: Float64Array): number {
      const n = mass.length;
      let u = 0;
      // Each pair once, so no factor of 1/2 — the pair energy is counted exactly once.
      for (let i = 0; i < n; i++) {
        const ix = i * 3;
        const xi = pos[ix];
        const yi = pos[ix + 1];
        const zi = pos[ix + 2];
        const mi = mass[i];
        for (let j = i + 1; j < n; j++) {
          const jx = j * 3;
          const dx = pos[jx] - xi;
          const dy = pos[jx + 1] - yi;
          const dz = pos[jx + 2] - zi;
          u -= (G * mi * mass[j]) / Math.sqrt(dx * dx + dy * dy + dz * dz + eps2);
        }
      }
      return u;
    },

    /**
     * Acceleration and the FSI force-gradient term, in two O(N^2) passes.
     *
     * PORTED FROM gravax `core/gravity/newtonian.py::_pairwise_accel_force_gradient`, which
     * implements Rantala, Naab & Springel (2021) equations 27-28. For x_ji = x_j - x_i and
     * a_ji = a_j - a_i,
     *
     *     g_i = 2 G sum_j m_j r_ji^-5 [ r_ji^2 a_ji - 3 (x_ji . a_ji) x_ji ]
     *
     * with r_ji^2 carrying the SAME Plummer softening as the acceleration kernel — the term is
     * the derivative of the softened force, so an unsoftened r here would not be the gradient
     * of what is actually being stepped, which is the trap `../types.ts` is built around.
     *
     * Two passes, not one: g_i needs the full acceleration FIELD (every a_j), so the total
     * acceleration must be complete before the second sum can start. Newton's third law also
     * cannot halve this one — the summand is not antisymmetric in (i, j).
     */
    forceGradient(
      pos: Vec3Array,
      mass: Float64Array,
      accOut: Vec3Array,
      gradOut: Vec3Array,
      t: number,
    ): void {
      const n = mass.length;
      this.accelerations(pos, mass, accOut, t);
      gradOut.fill(0);

      for (let i = 0; i < n; i++) {
        const ix = i * 3;
        const xi = pos[ix];
        const yi = pos[ix + 1];
        const zi = pos[ix + 2];
        const axi = accOut[ix];
        const ayi = accOut[ix + 1];
        const azi = accOut[ix + 2];
        let gx = 0;
        let gy = 0;
        let gz = 0;

        for (let j = 0; j < n; j++) {
          if (j === i) continue;
          const jx = j * 3;
          const dx = pos[jx] - xi;
          const dy = pos[jx + 1] - yi;
          const dz = pos[jx + 2] - zi;
          const r2 = dx * dx + dy * dy + dz * dz + eps2;
          const r = Math.sqrt(r2);
          const invR5 = 1 / (r2 * r2 * r);

          const dax = accOut[jx] - axi;
          const day = accOut[jx + 1] - ayi;
          const daz = accOut[jx + 2] - azi;
          const radial = dx * dax + dy * day + dz * daz;

          const k = 2 * G * mass[j] * invR5;
          gx += k * (r2 * dax - 3 * radial * dx);
          gy += k * (r2 * day - 3 * radial * dy);
          gz += k * (r2 * daz - 3 * radial * dz);
        }
        gradOut[ix] = gx;
        gradOut[ix + 1] = gy;
        gradOut[ix + 2] = gz;
      }
    },

    potentials(pos: Vec3Array, mass: Float64Array, out: Float64Array): void {
      const n = mass.length;
      out.fill(0);
      // Pairs once, contributing to both members: Phi_i gets m_j and Phi_j gets m_i.
      for (let i = 0; i < n; i++) {
        const ix = i * 3;
        const xi = pos[ix];
        const yi = pos[ix + 1];
        const zi = pos[ix + 2];
        for (let j = i + 1; j < n; j++) {
          const jx = j * 3;
          const dx = pos[jx] - xi;
          const dy = pos[jx + 1] - yi;
          const dz = pos[jx + 2] - zi;
          const invR = G / Math.sqrt(dx * dx + dy * dy + dz * dz + eps2);
          out[i] -= invR * mass[j];
          out[j] -= invR * mass[i];
        }
      }
    },
  };
}
