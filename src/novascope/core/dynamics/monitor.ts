/*
 * monitor.ts — is this run still trustworthy? (Layer 0, pure)
 *
 * `diagnostics.ts` answers "what is true of this state RIGHT NOW". This file answers "has the
 * integration gone wrong since it started", which is a different question and needs memory.
 *
 * ── WHY IT EXISTS ──
 *
 * Every conserved quantity was already computable and nothing was watching any of them. The
 * tests sample at the start and the end and discard everything between, which is fine for a
 * test and wrong for a lab: a live instrument runs for minutes in front of a class, and if the
 * energy is drifting you need to see it WHILE IT HAPPENS, not discover it afterwards. A run
 * that has gone bad should be labelled on screen rather than quietly presented as physics.
 *
 * ── THE PART THAT IS EASY TO GET WRONG: NORMALIZATION ──
 *
 * Energy has a natural scale — its own initial value — so |dE/E0| is meaningful.
 *
 * MOMENTUM AND ANGULAR MOMENTUM DO NOT. `removeBulkMotion` sets both to ~0 at the start, so
 * dividing by |p0| divides by a number that is pure round-off, and the answer is noise
 * amplified to infinity. They are normalized against a PHYSICAL scale instead:
 *
 *     momentum scale  =  M * v_rms          (the momentum the cluster's own motions carry)
 *     angular scale   =  M * r_h * v_rms    (the same, given a lever arm)
 *
 * so a reported drift of 1e-6 means "one part in a million of what this cluster actually has",
 * which is a statement about the integrator rather than about how close to zero p0 landed.
 *
 * ── HEALTH IS JUDGED ON ENERGY ALONE, DELIBERATELY ──
 *
 * `direct/` conserves linear momentum to round-off; `meanField/` does NOT, because its force
 * is defined about a fixed origin and that is a preferred point. A monitor that flagged
 * momentum drift as a fault would cry wolf on every mean-field run. Both numbers are still
 * REPORTED — they catch a different class of bug from energy, and a `direct` run whose
 * momentum starts moving is genuinely broken — but only energy sets `healthy`.
 */
import type { Leapfrog } from "./integrate.ts";
import type { Energy } from "./types.ts";
import { crossingTime, lagrangianRadii } from "./diagnostics.ts";
import { angularMomentum, momentum, rmsSpeed, totalMass } from "./quantities.ts";

export interface ConservationSample {
  /** Simulation time [Myr]. */
  t: number;
  /** Elapsed time in crossing times of the INITIAL configuration — the meaningful clock. */
  tCross: number;
  energy: Energy;
  /** |E - E0| / |E0|. The headline number. */
  energyDrift: number;
  /** |p - p0| / (M v_rms). See the header on why not |p0|. */
  momentumDrift: number;
  /** |L - L0| / (M r_h v_rms). */
  angularDrift: number;
  /** Q = T/|U|. 1/2 virialized, below collapsing, above expanding. */
  virialRatio: number;
}

export interface ConservationMonitor {
  /** Take a reading. Cheap: O(n), no sort, no force evaluation beyond the potential. */
  sample(): ConservationSample;
  /** The most recent sample, without taking a new one. */
  readonly latest: ConservationSample | null;
  /** Largest drift seen so far, across every sample. */
  readonly worst: { energy: number; momentum: number; angular: number };
  /** False once the energy drift has ever exceeded the threshold. Latching — see below. */
  readonly healthy: boolean;
  /** The threshold `healthy` is judged against. */
  readonly energyTolerance: number;
  /** Recent samples, oldest first, capped at `historyLimit`. For plotting. */
  readonly history: readonly ConservationSample[];
  /** Re-baseline on the current state, e.g. after the caller resets the simulation. */
  rebase(): void;
}

export interface MonitorOptions {
  /**
   * Energy-drift threshold for `healthy`. Default 1e-3.
   *
   * Set from the measured convergence study rather than by taste: at
   * `DIRECT_STEPS_PER_TCROSS = 128` the drift over ten crossing times is 5e-6..1.4e-5 across
   * three realizations, so 1e-3 is roughly seventy times the worst honest value. It is a
   * "something is wrong" line, not an accuracy target — crossing it means the timestep, the
   * softening or the initial conditions are unsuitable, not that the answer is slightly off.
   */
  energyTolerance?: number;
  /** Samples retained for plotting. Default 600. */
  historyLimit?: number;
}

export function createConservationMonitor(
  lf: Leapfrog,
  opts: MonitorOptions = {},
): ConservationMonitor {
  const energyTolerance = opts.energyTolerance ?? 1e-3;
  const historyLimit = opts.historyLimit ?? 600;

  let e0 = 0;
  let p0: [number, number, number] = [0, 0, 0];
  let l0: [number, number, number] = [0, 0, 0];
  let momentumScale = 1;
  let angularScale = 1;
  let tCross0 = 1;
  let t0 = 0;

  let latest: ConservationSample | null = null;
  let history: ConservationSample[] = [];
  const worst = { energy: 0, momentum: 0, angular: 0 };
  /* LATCHING, on purpose. A run that briefly exceeded the tolerance and came back is not
     trustworthy again — the trajectory diverged and the state on screen is a different one.
     A momentary flicker would otherwise be dismissed as noise, which is exactly the mistake. */
  let breached = false;

  function rebase(): void {
    const s = lf.state;
    e0 = lf.energy().total;
    p0 = momentum(s);
    l0 = angularMomentum(s);

    const m = totalMass(s);
    const v = rmsSpeed(s);
    const rHalf = lagrangianRadii(s, [0.5])[0];
    /* Guarded so a degenerate state (one particle, everything at rest) reports 0 drift rather
       than dividing by zero and reporting NaN, which reads as "broken" when it is "empty". */
    momentumScale = m * v > 0 ? m * v : 1;
    angularScale = m * v * rHalf > 0 ? m * v * rHalf : 1;

    tCross0 = crossingTime(s) || 1;
    t0 = lf.t;

    latest = null;
    history = [];
    worst.energy = 0;
    worst.momentum = 0;
    worst.angular = 0;
    breached = false;
  }

  const magnitudeOfDifference = (
    a: readonly [number, number, number],
    b: readonly [number, number, number],
  ): number => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

  function sample(): ConservationSample {
    const s = lf.state;
    const energy = lf.energy();

    const energyDrift = e0 !== 0 ? Math.abs(energy.total - e0) / Math.abs(e0) : 0;
    const momentumDrift = magnitudeOfDifference(momentum(s), p0) / momentumScale;
    const angularDrift = magnitudeOfDifference(angularMomentum(s), l0) / angularScale;

    const out: ConservationSample = {
      t: lf.t,
      tCross: (lf.t - t0) / tCross0,
      energy,
      energyDrift,
      momentumDrift,
      angularDrift,
      virialRatio: energy.potential !== 0 ? energy.kinetic / Math.abs(energy.potential) : 0,
    };

    worst.energy = Math.max(worst.energy, energyDrift);
    worst.momentum = Math.max(worst.momentum, momentumDrift);
    worst.angular = Math.max(worst.angular, angularDrift);
    if (energyDrift > energyTolerance) breached = true;

    latest = out;
    history.push(out);
    if (history.length > historyLimit) history.shift();
    return out;
  }

  rebase();

  return {
    sample,
    get latest() {
      return latest;
    },
    get worst() {
      return { ...worst };
    },
    get healthy() {
      return !breached;
    },
    energyTolerance,
    get history() {
      return history;
    },
    rebase,
  };
}
