/*
 * integrate.ts — kick-drift-kick leapfrog, knowing nothing about gravity (Layer 0, pure).
 *
 * ADR 0016 chose leapfrog over RK4 for one stated reason: it is SYMPLECTIC, so the energy
 * error is bounded and oscillatory rather than secular. A naive RK4 demo looks fine for a
 * minute and is embarrassing after ten, which matters when the thing is projected in front
 * of a class. It is also short enough to read, which is the other half of why it is here.
 *
 * ── WHAT SYMPLECTIC DOES AND DOES NOT PROMISE ──
 *
 * It does NOT promise conserved energy. A leapfrog's energy oscillates with amplitude O(h^2)
 * forever; what it does not do is TREND. That distinction is why `integrate.test.ts` compares
 * the error in the second half of a run against the first rather than asserting a maximum —
 * a maximum-only test passes for forward Euler over a short run, and the test file proves
 * that by running Euler and watching it fail the comparison.
 *
 * ── ONE FORCE EVALUATION PER STEP ──
 *
 * The textbook form evaluates the force twice per step. The end-of-step acceleration is the
 * same one the next step opens with, so it is cached. The cache is keyed on POSITION only,
 * which is why reversing a trajectory (negate the velocities, keep stepping) needs no
 * invalidation and comes back exactly. A caller that writes `state.pos` directly must call
 * `invalidateAcceleration()`; nothing else invalidates it, and nothing else needs to.
 *
 * ── SUB-STEPPING IS A POLICY, AND IT BELONGS TO THE CALLER ──
 *
 * `maxStep` bounds the internal step so a caller can hand over "advance one crossing time"
 * or "advance one animation frame" without either becoming an accuracy decision. What the
 * right bound IS depends on the physics — `gasExpulsion` measured 200 sub-steps per crossing
 * time as its accuracy plateau — so the integrator enforces a limit it does not choose.
 */
import type { Energy, ForceModel, State } from "./types.ts";

export interface Leapfrog {
  /** Advance by `dt` [Myr], subdividing so no internal step exceeds `maxStep`. */
  step(dt: number): void;
  /** Simulation time [Myr]. */
  readonly t: number;
  readonly state: State;
  readonly force: ForceModel;
  /** Kinetic, potential and total energy at the CURRENT synchronized state. */
  energy(): Energy;
  /** Total linear momentum [Msun pc/Myr], as an (x,y,z) triple. */
  momentum(): [number, number, number];
  /** Total angular momentum [Msun pc^2/Myr] about the origin, as an (x,y,z) triple. */
  angularMomentum(): [number, number, number];
  /** Call after writing `state.pos` from outside. Velocity changes do NOT need this. */
  invalidateAcceleration(): void;
}

export interface LeapfrogOptions {
  /** Largest internal step [Myr]. Default: no limit, so `step(dt)` takes one step of dt. */
  maxStep?: number;
  /** Starting simulation time [Myr]. Default 0. */
  t0?: number;
}

export function createLeapfrog(
  state: State,
  force: ForceModel,
  opts: LeapfrogOptions = {},
): Leapfrog {
  const { mass, pos, vel, n } = state;
  const acc = new Float64Array(n * 3);
  const maxStep = opts.maxStep ?? Infinity;
  let t = opts.t0 ?? 0;
  let accValid = false;

  const ensureAcc = (): void => {
    if (!accValid) {
      force.accelerations(pos, mass, acc, t);
      accValid = true;
    }
  };

  function one(h: number): void {
    ensureAcc();
    const hh = 0.5 * h;
    // KICK by a half step, using the acceleration at the current position.
    for (let i = 0; i < acc.length; i++) vel[i] += acc[i] * hh;
    // DRIFT a full step at the half-step velocity.
    for (let i = 0; i < pos.length; i++) pos[i] += vel[i] * h;
    t += h;
    // KICK the second half at the NEW position; that acceleration opens the next step.
    force.accelerations(pos, mass, acc, t);
    for (let i = 0; i < acc.length; i++) vel[i] += acc[i] * hh;
  }

  return {
    step(dt: number): void {
      if (!(dt > 0)) return;
      /* Uniform sub-steps rather than a full-size step plus a short remainder: an uneven
         final step would break the reversibility the scheme is chosen for. */
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
      let kinetic = 0;
      for (let i = 0; i < n; i++) {
        const vx = vel[i * 3];
        const vy = vel[i * 3 + 1];
        const vz = vel[i * 3 + 2];
        kinetic += 0.5 * mass[i] * (vx * vx + vy * vy + vz * vz);
      }
      // The potential comes from the force model — see the note in types.ts on why.
      const potential = force.potentialEnergy(pos, mass, t);
      return { kinetic, potential, total: kinetic + potential };
    },
    momentum(): [number, number, number] {
      let px = 0;
      let py = 0;
      let pz = 0;
      for (let i = 0; i < n; i++) {
        px += mass[i] * vel[i * 3];
        py += mass[i] * vel[i * 3 + 1];
        pz += mass[i] * vel[i * 3 + 2];
      }
      return [px, py, pz];
    },
    angularMomentum(): [number, number, number] {
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
    },
    invalidateAcceleration(): void {
      accValid = false;
    },
  };
}
