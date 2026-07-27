/*
 * types.ts — the seam between an integrator and the physics it steps (Layer 0, pure).
 *
 * novascope carries TWO force models, and they are not two qualities of the same thing —
 * they are two different equations (ADR 0016, and the design note in
 * `docs/plans/2026-07-26-dynamics-and-extinction-labs-design.md`):
 *
 *   direct/     pairwise sum over every other star. Collisional: two-body relaxation,
 *               dynamical mass segregation and escapers all emerge from the sum. O(N^2).
 *   meanField/  force from a spherically-averaged binned M(<r). Collisionless: those
 *               effects have no term and no amount of accuracy produces them. O(N).
 *
 * The leapfrog does not care which it is stepping, so it takes one of these.
 *
 * ── WHY `potentialEnergy` LIVES ON THE FORCE MODEL AND NOT IN `diagnostics.ts` ──
 *
 * This is the load-bearing decision in the file. An energy-conservation test means something
 * only if U is the EXACT potential whose gradient produced the accelerations that were
 * stepped. For Plummer softening,
 *
 *     Phi = -G m / sqrt(r^2 + eps^2)      grad Phi = G m r / (r^2 + eps^2)^{3/2}
 *
 * — consistent. Pair a softened FORCE with an unsoftened POTENTIAL and the reported energy
 * drifts even though the integrator is perfect. That failure looks exactly like a broken
 * symplectic scheme, and it would send a session hunting the integrator while the bug sits
 * in the diagnostic. It is the same species as the dimensionally-wrong softening constant in
 * the asinh transfer (ADR 0015), which passed every example-based assertion it had.
 *
 * The two models also have genuinely different U — a pairwise sum against a shell sum — so
 * keeping each beside its own force is what makes them impossible to mix up.
 *
 * ── UNITS, ONCE, HERE ──
 *
 * Positions pc, velocities pc/Myr, masses Msun, time Myr, so G is `G_PC3_MSUN_MYR2` from
 * core/constants. NOTE that `LatentStar` stores velocities in km/s, which is a different
 * convention by a factor of 1.0227 — `ic.ts` owns that conversion and nothing else should
 * perform it. See `KM_S_TO_PC_MYR`.
 */

/** Flat n*3 array of (x,y,z) triples. Named so a signature says which layout it wants. */
export type Vec3Array = Float64Array;

/**
 * A force law the integrator can step.
 *
 * `t` is passed because a model may be time-dependent — the gas-expulsion potential drains
 * with time — but a model that ignores it is the normal case.
 */
export interface ForceModel {
  /** Stable identifier, e.g. "direct" or "meanField". Reported in diagnostics and the UI. */
  readonly id: string;

  /**
   * Write accelerations [pc/Myr^2] for every particle into `accOut`.
   *
   * Writes rather than allocates: this runs twice per step at up to 60 fps, and a fresh
   * Float64Array per call is the difference between a smooth lab and a stuttering one.
   */
  accelerations(pos: Vec3Array, mass: Float64Array, accOut: Vec3Array, t: number): void;

  /**
   * Total potential energy [Msun (pc/Myr)^2] of this configuration.
   *
   * MUST be the potential whose gradient `accelerations` returns, including any softening.
   * See the header — this requirement is the reason the method is here at all.
   */
  potentialEnergy(pos: Vec3Array, mass: Float64Array, t: number): number;

  /**
   * Potential per unit mass at each particle [(pc/Myr)^2], written into `out` (length n).
   *
   * REQUIRED rather than optional, because "is this star bound?" is the question the whole
   * gas-expulsion story turns on, and it is answered by 1/2 v^2 + Phi_i < 0 — which needs
   * the potential AT the star, not the system total. A model that cannot say how deep each
   * star sits cannot answer it, and an optional method would let that failure be silent.
   *
   * Note the relationship, and that it is not an alternative definition:
   * `potentialEnergy` = 1/2 sum_i m_i Phi_i for the SELF-gravitating part, because each pair
   * is counted twice by summing over every star. An external background carries no such
   * factor. Both models implement the pair accordingly.
   */
  potentials(pos: Vec3Array, mass: Float64Array, out: Float64Array, t: number): void;

  /**
   * Acceleration AND the force-gradient correction, written into `accOut` and `gradOut`.
   *
   * OPTIONAL, because it is not universally definable. It is what a fourth-order FORWARD
   * symplectic map needs (`./fsi4.ts`), and it is inherently PAIRWISE — `meanField/` cannot
   * supply it, since its force comes from a binned radial profile with no pair structure to
   * differentiate. A model without this simply cannot be stepped by FSI4, which the integrator
   * reports rather than working around.
   *
   * Both are returned together because the gradient depends on the full acceleration field and
   * would otherwise repeat the first O(N^2) pass.
   *
   *     g_i = -(1/m_i) grad_i [ -sum_j m_j |a_j|^2 ]
   *
   * the coordinate-only double-commutator term. See `direct/index.ts` for the closed form.
   */
  forceGradient?(
    pos: Vec3Array,
    mass: Float64Array,
    accOut: Vec3Array,
    gradOut: Vec3Array,
    t: number,
  ): void;
}

/** The particles. `pos` and `vel` are mutated in place by the integrator. */
export interface State {
  readonly n: number;
  /** Msun, length n. */
  readonly mass: Float64Array;
  /** pc, length 3n. */
  readonly pos: Vec3Array;
  /** pc/Myr, length 3n. */
  readonly vel: Vec3Array;
}

/** Kinetic, potential and total energy [Msun (pc/Myr)^2]. */
export interface Energy {
  kinetic: number;
  potential: number;
  total: number;
}

/** Allocate an empty state for `n` particles. */
export function createState(n: number): State {
  return {
    n,
    mass: new Float64Array(n),
    pos: new Float64Array(n * 3),
    vel: new Float64Array(n * 3),
  };
}
