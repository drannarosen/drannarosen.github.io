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
 * approximately. Measured in `direct.test.ts`; in plain TypeScript this stays interactive to
 * roughly N = 2000, which is a real range for a young cluster and is stated on the lab page
 * rather than apologized for.
 *
 * A caution that belongs with the model, not with the renderer: at N in the hundreds this is
 * an honest model OF a cluster of that size. Using a few thousand particles to stand in for
 * a 10^6-star cluster would import an artificial relaxation time set by the particle count
 * one could afford, which is why `meanField/` remains the right tool at large N.
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
 * The conventional softening for an N-body cluster: the mean interparticle separation at
 * the half-mass radius, eps ~ r_h / N^(1/3).
 *
 * PROVENANCE, stated because a softening length silently chosen is a physics result silently
 * chosen. This is the standard order-of-magnitude scaling — it sets eps at the distance below
 * which the discrete particle distribution stops representing a smooth density field, so
 * softening there suppresses two-body encounters the particle count cannot resolve anyway.
 * `core/dynamics`'s shell code uses the same reasoning for its own 0.02 pc.
 *
 * It is a SCALING, not a derived optimum. There is a literature on choosing softening to
 * minimize force error for a given N, and no result from it is claimed here; a lab that
 * wants a different value should pass one and say why.
 */
export function softeningForCluster(rHalfPc: number, n: number): number {
  return rHalfPc / Math.cbrt(Math.max(n, 1));
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
