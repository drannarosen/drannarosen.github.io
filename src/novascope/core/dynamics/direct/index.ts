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
 */
export const DIRECT_STEPS_PER_TCROSS = 128;

/**
 * Softening from the MEAN DISTANCE BETWEEN STARS: eps = fraction * r_h * N^(-1/3).
 *
 * r_h / N^(1/3) is the mean interparticle separation at the half-mass radius — the scale below
 * which a discrete particle set stops representing a smooth density field. `fraction` scales
 * it, and it is explicit because the right value is a real trade-off rather than a constant.
 *
 * ── WHY THE DEFAULT IS 1 AND NOT SOMETHING SMALLER ──
 *
 * Smaller eps resolves closer encounters, which is where two-body relaxation lives, so a small
 * fraction looks like the more physical choice. With a FIXED GLOBAL TIMESTEP it is not, and
 * the failure is not subtle. Measured at N = 300, r_h = 0.68 pc (so d = 0.102 pc), 20 crossing
 * times, three seeds:
 *
 *     fraction   eps [pc]   |dE/E| @128    |dE/E| @1024   rho(mass, radius)
 *       1        1.02e-1      5.3e-5         3.6e-6         -0.126 / -0.164
 *       0.1      1.02e-2      1.7e+0         4.9e-3         -0.083 / -0.099
 *       0.01     1.02e-3      6.3e+0         5.5e+0         -0.052 / -0.006
 *
 * At 0.01 the energy error is 500-600% and EIGHT TIMES MORE STEPS DOES NOT FIX IT. Worse, the
 * segregation signal — the thing small softening was supposed to buy — gets weaker, not
 * stronger: -0.006 against -0.164. The cluster is not relaxing, it is being torn apart by
 * unresolved close pairs kicking stars out numerically.
 *
 * That is a structural limit, not a tuning failure. Resolving encounters below ~the mean
 * separation needs INDIVIDUAL or ADAPTIVE timesteps, or KS regularisation of close pairs.
 * A fixed-step leapfrog cannot have them: varying h destroys the symplectic property that is
 * the entire reason ADR 0016 chose leapfrog over RK4. eps and h are coupled, and eps ~ d is
 * where a fixed-step scheme can actually live.
 *
 * ── AND THE OTHER SIDE: SOFTENING THAT IS TOO LARGE SUPPRESSES THE PHYSICS ──
 *
 * Energy drift alone cannot choose eps, because MORE softening always improves it — the
 * criterion has to be two-sided. Scanned with FSI4 at N = 200, 15 crossing times, EIGHT seeds,
 * with standard errors so the noise is visible rather than assumed away:
 *
 *     eps/d   |dE/E|      d_rho +/- SE        r_h/r_h0 +/- SE
 *      0.5    2.48e-4   -0.0616 +/- 0.0252   1.311 +/- 0.168
 *      1      1.61e-8   -0.0677 +/- 0.0292   1.293 +/- 0.175
 *      2      7.11e-10  -0.0563 +/- 0.0198   1.420 +/- 0.142
 *      4      7.52e-11  -0.0437 +/- 0.0254   1.721 +/- 0.147
 *
 * d_rho is the change in the mass-radius rank correlation: more negative means more
 * segregation actually happened.
 *
 * WHAT IS NOT RESOLVED, stated because the temptation is to read a trend into it: the
 * segregation signal does NOT differ significantly across 0.5d to 2d. Every value sits within
 * about one standard error of the others, so no optimum can be claimed from that column at
 * this N and duration.
 *
 * WHAT IS RESOLVED, and it is what decides the default:
 *
 *   - Energy strongly favours eps >= d. At 0.5d the drift is 2.5e-4 against 1.6e-8 — four
 *     orders worse for no measurable gain in the physics.
 *   - Expansion rules out eps >= 4d. The cluster puffs to 1.72x its half-mass radius against
 *     1.29x, a gap of ~2.5 standard errors. That is the overpowering-softening failure: an
 *     artificially pressure-supported cluster that looks relaxed and is not. At 8d (from the
 *     coarser first scan) it reaches 3.4x and the segregation correlation goes POSITIVE.
 *
 * So eps = d is the largest softening with no measurable suppression of the collisional
 * physics, and the smallest with excellent energy behaviour. The usable window is roughly
 * 0.5d to 2d; outside it one side or the other is measurably wrong.
 *
 * A smaller fraction is available and honestly documented. Anything below ~0.5 needs a much
 * finer step and its energy watched (`../monitor.ts`).
 *
 * It is a SCALING, not a derived optimum. There is a literature on choosing softening to
 * minimise force error at given N, and no result from it is claimed here.
 */
export function softeningForCluster(rHalfPc: number, n: number, fraction = 1): number {
  return (fraction * rHalfPc) / Math.cbrt(Math.max(n, 1));
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
