/*
 * kepler.testutil.ts — the shared two-body fixture every integrator test measures against.
 *
 * TEST SUPPORT ONLY; nothing in the package imports this.
 *
 * It exists because `fsi4.test.ts` and `hermite.test.ts` need the SAME orbit, and a convergence
 * comparison between two schemes is meaningless if they are quietly measured on two different
 * problems. Copying the fixture would make that divergence possible and invisible — the same
 * shape as the four separate kinetic-energy implementations the 2026-07-26 review found.
 *
 * ── WHY ECCENTRIC, AND WHY THE PEAK ERROR ──
 *
 * An earlier version of the FSI4 test used a CIRCULAR orbit and measured |E(end) - E(0)|. On a
 * circular orbit speed and |a| are constant, a symplectic scheme's periodic energy error cancels
 * after whole periods, and what remains is not the error being measured: FSI4 reported 4.4e-16
 * with nothing left to converge, and the leapfrog reported ratios near 270, which is not second
 * order or any other order. An eccentric orbit sampled for its MAXIMUM error fixes both — the
 * error does not cancel, and the peak near periapsis is where a scheme is actually tested.
 */
import { createState, type State } from "./types.ts";

/** Test units: G = 1 keeps the analytic algebra readable. */
export const KEPLER = {
  G: 1,
  /** Mass of each of the two bodies. */
  m: 1,
  /** Semi-major axis of the relative orbit. */
  a: 1,
  eccentricity: 0.5,
  /** Softening, small enough to be negligible against the periapsis separation of 0.5. */
  softening: 1e-5,
} as const;

/** Period of the relative orbit: T = 2 pi sqrt(a^3 / G M_total). */
export const KEPLER_PERIOD =
  2 * Math.PI * Math.sqrt(KEPLER.a ** 3 / (KEPLER.G * 2 * KEPLER.m));

/** Two equal masses on an eccentric orbit about their common centre of mass, at apoapsis. */
export function keplerPair(): State {
  const { m, a, eccentricity: e, G } = KEPLER;
  const rApo = a * (1 + e);
  // Relative speed at apoapsis for the two-body problem with total mass 2m.
  const vApo = Math.sqrt((G * 2 * m * (1 - e)) / (a * (1 + e)));
  const s = createState(2);
  s.mass[0] = m;
  s.mass[1] = m;
  // Equal masses: each sits at half the separation and moves at half the relative speed.
  s.pos[0] = -rApo / 2;
  s.pos[3] = rApo / 2;
  s.vel[1] = -vApo / 2;
  s.vel[4] = vApo / 2;
  return s;
}

/** Current separation of the pair [same units as pos]. */
export function keplerSeparation(s: State): number {
  return Math.hypot(s.pos[3] - s.pos[0], s.pos[4] - s.pos[1], s.pos[5] - s.pos[2]);
}
