/*
 * binaries.ts — find the tightest bound pair, and say whether the integrator can still
 * follow it (Layer 0, pure).
 *
 * ── WHY THIS IS A DIAGNOSTIC AND NOT A CURIOSITY ──
 *
 * `/explore/dynamics` measured where its own energy error comes from, and it is not
 * distributed: mass segregation sinks the heaviest stars, a binary forms in the core, and
 * Heggie's law says a hard binary HARDENS. Its orbital period then falls until a fixed
 * timestep can no longer resolve periapsis, and every passage injects error.
 *
 * Measured on seed 2028 at N = 400, dt = t_cross/2048:
 *
 *   t/t_cr   |dE/E|    E_b/<KE>   a[pc]    m1    m2   P_orb/dt
 *      1.0   3.10e-9        3.0   0.993  10.9  29.9    20551
 *     10.0   1.12e-6      145.1   0.028  38.5  10.0       89
 *     15.0   7.51e-5      102.0   0.042  38.5  29.9      141   <- exchange encounter
 *     22.0   8.16e-5      295.6   0.028  38.5  29.9       76
 *
 * The pair becomes the two most massive stars and stays that pair; at t/t_cr = 15 an
 * exchange swaps the 29.9 Msun star in for the 10.0, and the drift steps with it. After
 * that the error is FLAT — 7.51, 7.52, 7.53, 7.54e-5 — which is the signature of discrete
 * injections rather than secular growth, exactly as a symplectic scheme should behave.
 *
 * So `stepsPerOrbit` is the quantity that predicts trouble, and a page can show a reader
 * why the receipt is degrading instead of just that it is.
 */
import type { State } from "./types.ts";
import { G_PC3_MSUN_MYR2 } from "../constants/index.ts";
import { kineticEnergy } from "./quantities.ts";

export interface HardestPair {
  /** Indices into the state. */
  i: number;
  j: number;
  /** Current separation [pc]. */
  separation: number;
  /** Semi-major axis of the relative orbit [pc]. */
  semiMajorAxis: number;
  /** Binding energy |E_rel| [Msun (pc/Myr)^2]. Positive for a bound pair. */
  bindingEnergy: number;
  /** Keplerian period of the relative orbit [Myr]. */
  period: number;
  /**
   * Binding energy in units of the MEAN STELLAR kinetic energy.
   *
   * The conventional "hard or soft" comparison — a binary is hard when it is more bound
   * than a typical field star's kinetic energy, because encounters then harden it further
   * rather than breaking it up. Reported in those units rather than as a boolean, since the
   * interesting quantity on this page is how far past hard it has gone: measured values run
   * from ~3 at formation to ~430.
   */
  hardness: number;
  masses: [number, number];
}

export interface PairResolution extends HardestPair {
  /**
   * Orbital periods per integrator step. THE number that predicts energy error.
   *
   * A fixed-step scheme needs O(100) steps per orbit to hold periapsis; below that the
   * error grows fast. Measured above: 20551 at formation, 89 by t/t_cr = 10, 76 by 22, with
   * |dE/E| climbing four orders over the same span.
   */
  stepsPerOrbit: number;
}

/**
 * The most bound pair in the state, by two-body relative energy, or null if nothing is bound.
 *
 * O(N^2) and allocation-free apart from the result, but it is NOT free — at N = 800 it costs
 * about what one diagnostics pass does. Callers on a frame budget should throttle it rather
 * than run it every frame.
 *
 * `softening` MUST match the force model's, and is not optional for that reason: the pair
 * this returns has to be the pair the integrator actually feels. Computing the binding energy
 * from an unsoftened potential would report a tighter, more alarming binary than the one being
 * integrated — the diagnostic would be describing a different simulation, which is the exact
 * failure mode this codebase keeps designing against.
 */
export function hardestBoundPair(
  state: State,
  softening: number,
  G = G_PC3_MSUN_MYR2,
): HardestPair | null {
  const { n, mass, pos, vel } = state;
  const eps2 = softening * softening;
  let best: HardestPair | null = null;
  let bestE = 0; // relative energy; bound pairs are negative, so 0 is "nothing found"

  for (let i = 0; i < n; i++) {
    const ix = i * 3;
    const mi = mass[i];
    for (let j = i + 1; j < n; j++) {
      const jx = j * 3;
      const dx = pos[ix] - pos[jx];
      const dy = pos[ix + 1] - pos[jx + 1];
      const dz = pos[ix + 2] - pos[jx + 2];
      const r2 = dx * dx + dy * dy + dz * dz;
      const mj = mass[j];
      const mu = (mi * mj) / (mi + mj);
      const dvx = vel[ix] - vel[jx];
      const dvy = vel[ix + 1] - vel[jx + 1];
      const dvz = vel[ix + 2] - vel[jx + 2];
      /* The SOFTENED pair potential, matching the force model. */
      const e = 0.5 * mu * (dvx * dvx + dvy * dvy + dvz * dvz) - (G * mi * mj) / Math.sqrt(r2 + eps2);
      if (e < bestE) {
        bestE = e;
        const a = (-G * mi * mj) / (2 * e);
        best = {
          i,
          j,
          separation: Math.sqrt(r2),
          semiMajorAxis: a,
          bindingEnergy: -e,
          period: 2 * Math.PI * Math.sqrt(a ** 3 / (G * (mi + mj))),
          hardness: 0, // filled below, once the mean kinetic energy is known
          masses: [mi, mj],
        };
      }
    }
  }

  if (best && n > 0) {
    const meanKe = kineticEnergy(state) / n;
    best.hardness = meanKe > 0 ? best.bindingEnergy / meanKe : 0;
  }
  return best;
}

/** The same pair, with the step size folded in so a caller can ask "can we still follow it?". */
export function pairResolution(
  state: State,
  softening: number,
  dt: number,
  G = G_PC3_MSUN_MYR2,
): PairResolution | null {
  const pair = hardestBoundPair(state, softening, G);
  if (!pair) return null;
  return { ...pair, stepsPerOrbit: dt > 0 ? pair.period / dt : Infinity };
}
