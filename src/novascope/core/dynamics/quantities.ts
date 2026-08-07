/*
 * quantities.ts — scalars and vectors that are properties of a State (Layer 0, pure).
 *
 * These depend on nothing but the particles: no force law, no integrator, no time. That is
 * the whole membership rule, and it is why they live in their own module rather than in
 * whichever file happened to need one first.
 *
 * ── WHY THIS FILE EXISTS, RECORDED SO IT IS NOT UNDONE ──
 *
 * The 2026-07-26 core/dynamics review found kinetic energy implemented FOUR times — in
 * `integrate.ts`, in `ic.ts`, and twice in `gasExpulsion/` — while `ic.ts` exported a
 * `kineticEnergy()` that none of the other three called.
 *
 * The danger is specific rather than aesthetic. T feeds the virial ratio, the energy readout
 * and the virial scaling target. A factor of 1/2 or a dropped mass in one copy would still
 * CONSERVE, so every integrator test would stay green while the reported physics was wrong by
 * a constant — the same failure that putting `potentialEnergy` on the ForceModel prevents for
 * U (see `./types.ts`). The reasoning was applied to U and not to T.
 *
 * `momentum` and `angularMomentum` were on `Leapfrog` for the same accidental reason. A state
 * has a momentum whether or not anything is stepping it, and their only consumers were tests.
 */
import type { State, Vec3Array } from "./types.ts";

/** Kinetic energy [Msun (pc/Myr)^2]. The one home. */
export function kineticEnergy(state: State): number {
  const { n, mass, vel } = state;
  let t = 0;
  for (let i = 0; i < n; i++) {
    const vx = vel[i * 3];
    const vy = vel[i * 3 + 1];
    const vz = vel[i * 3 + 2];
    t += 0.5 * mass[i] * (vx * vx + vy * vy + vz * vz);
  }
  return t;
}

/** Total linear momentum [Msun pc/Myr]. */
export function momentum(state: State): [number, number, number] {
  const { n, mass, vel } = state;
  let px = 0;
  let py = 0;
  let pz = 0;
  for (let i = 0; i < n; i++) {
    px += mass[i] * vel[i * 3];
    py += mass[i] * vel[i * 3 + 1];
    pz += mass[i] * vel[i * 3 + 2];
  }
  return [px, py, pz];
}

/** Total angular momentum about the origin [Msun pc^2/Myr]. */
export function angularMomentum(state: State): [number, number, number] {
  const { n, mass, pos, vel } = state;
  let lx = 0;
  let ly = 0;
  let lz = 0;
  for (let i = 0; i < n; i++) {
    const m = mass[i];
    const x = pos[i * 3];
    const y = pos[i * 3 + 1];
    const z = pos[i * 3 + 2];
    const vx = vel[i * 3];
    const vy = vel[i * 3 + 1];
    const vz = vel[i * 3 + 2];
    lx += m * (y * vz - z * vy);
    ly += m * (z * vx - x * vz);
    lz += m * (x * vy - y * vx);
  }
  return [lx, ly, lz];
}

/** Total mass [Msun]. */
export function totalMass(state: State): number {
  let m = 0;
  for (let i = 0; i < state.n; i++) m += state.mass[i];
  return m;
}

/** Distance of each particle from the origin [pc], written into `out` (length n). */
export function radii(state: State, out: Float64Array): void {
  radiiAbout(state, [0, 0, 0], out);
}

/**
 * Distance of each particle from an arbitrary CENTRE [pc], into `out` (length n).
 *
 * The origin is not the cluster. Total momentum is conserved, so the whole
 * system's centre of mass stays put — but a dissolving cluster ejects stars
 * anisotropically and the BOUND remnant recoils against them. Measured on the
 * `/explore/dynamics` configuration, the bound subset's centre of mass walks to
 * 12.3 pc by 800 crossing times while a half-mass radius quoted about the origin
 * reads 11.6 pc: at that point the "radius" is almost entirely displacement, and
 * the quantity has stopped describing the cluster's size at all.
 */
export function radiiAbout(
  state: State,
  centre: readonly [number, number, number] | Float64Array,
  out: Float64Array,
): void {
  const { n, pos } = state;
  const cx = centre[0] ?? 0;
  const cy = centre[1] ?? 0;
  const cz = centre[2] ?? 0;
  for (let i = 0; i < n; i++) {
    const x = pos[i * 3] - cx;
    const y = pos[i * 3 + 1] - cy;
    const z = pos[i * 3 + 2] - cz;
    out[i] = Math.sqrt(x * x + y * y + z * z);
  }
}

/** Root-mean-square speed [pc/Myr]. */
export function rmsSpeed(state: State): number {
  const { n, vel } = state;
  if (n === 0) return 0;
  let s = 0;
  for (let i = 0; i < n * 3; i++) s += vel[i] * vel[i];
  return Math.sqrt(s / n);
}

/**
 * Mass-weighted centre of position [pc] and centre-of-mass velocity [pc/Myr].
 *
 * `include` restricts it to a subset — the bound stars, typically. The whole
 * system's centre is conserved and therefore uninformative once stars start
 * escaping; the bound remnant's centre is the one a radius should be measured
 * about. See `radiiAbout`.
 */
export function centreOfMass(
  state: State,
  include?: (i: number) => boolean,
): { position: Vec3Array; velocity: Vec3Array } {
  const { n, mass, pos, vel } = state;
  const position = new Float64Array(3);
  const velocity = new Float64Array(3);
  let mTot = 0;
  for (let i = 0; i < n; i++) if (!include || include(i)) mTot += mass[i]!;
  if (!(mTot > 0)) return { position, velocity };
  for (let i = 0; i < n; i++) {
    if (include && !include(i)) continue;
    for (let k = 0; k < 3; k++) {
      position[k] += mass[i] * pos[i * 3 + k];
      velocity[k] += mass[i] * vel[i * 3 + k];
    }
  }
  for (let k = 0; k < 3; k++) {
    position[k] /= mTot;
    velocity[k] /= mTot;
  }
  return { position, velocity };
}
