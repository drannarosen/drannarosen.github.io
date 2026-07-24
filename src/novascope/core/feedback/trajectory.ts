/*
 * trajectory.ts — the feedback budget as a function of time (Layer 0, pure).
 *
 * The stars are static ZAMS over the pre-SN window (no evolution before the
 * first supernova, by construction), so the budget's TIME dependence is free:
 * it comes entirely from how each channel deposits momentum, not from the
 * sources changing. This is what the evacuation animation scrubs and what the
 * component-vs-time plot draws.
 *
 * Two channels are linear in t because their injection RATE is constant while
 * the stars are fixed:
 *   - winds:     p(t) = eta (1 - vent) Pdot t     -> straight line
 *   - radiation: p(t) = f_trap (L/c) t            -> straight line
 * Photoionization is NOT: the D-front decelerates (R ~ t^{4/7}, so the shell
 * momentum M_sh v ~ t^{9/7}), so it is recomputed from the Spitzer solution at
 * each sample rather than scaled. Treating it as linear would overstate the
 * early H II contribution and misplace the moment a channel takes the lead.
 *
 * One consequence: the total does NOT start at exactly zero. Winds and radiation
 * do, but the H II curve begins at the initial Stromgren-sphere shell momentum
 * (radius R_S, expanding at the ionized sound speed) -- a negligible seed
 * (~1e-7 of the window total), the physical initial condition rather than a
 * discontinuity to zero out.
 */
import { computeLedger, type LedgerInput } from "./ledger.ts";
import { hiiBudget } from "./photoionization.ts";
import { ionizingRate } from "./sources.ts";
import { DEFAULT_LEAKAGE } from "./ledger.ts";

export interface MomentumTrajectory {
  /** Sample times [Myr], from 0 to the pre-SN window. */
  tMyr: number[];
  /** Per-channel retained momentum at each sample [Msun km/s]. */
  windMomentum: number[];
  hiiMomentum: number[];
  radMomentum: number[];
  totalMomentum: number[];
  /** Total / (M_gas v_esc): the gas-clearing progress. */
  gasRatio: number[];
  /** min(1, gasRatio): the fraction of gas cleared, for the evacuation. */
  clearedFraction: number[];
  windowMyr: number;
  /** Stellar crossing time [Myr] — reference line for the removal regime. */
  tCrossMyr: number;
  /** First time the gas threshold is reached [Myr]; Infinity if never. */
  tRemoveMyr: number;
  /** Momentum needed to expel the gas [Msun km/s]. */
  gasMomentumNeeded: number;
}

/**
 * Sample the feedback momentum budget over [0, window].
 *
 * @param input   the same realization input the static ledger takes
 * @param nSteps  number of time samples (>= 2)
 */
export function momentumTrajectory(input: LedgerInput, nSteps = 60): MomentumTrajectory {
  const steps = Math.max(2, Math.floor(nSteps));
  const ledger = computeLedger(input);
  const windowMyr = ledger.windowMyr;
  const knobs = { ...DEFAULT_LEAKAGE, ...(input.leakage ?? {}) };
  const on = { winds: true, photoionization: true, radiation: true, ...(input.enabled ?? {}) };

  // Linear channels: scale their window-end value by t/window.
  const windEnd = ledger.channels.find((c) => c.name === "winds")!.momentum;
  const radEnd = ledger.channels.find((c) => c.name === "radiation")!.momentum;

  // Photoionization is recomputed at each t, so we need q and the on/off state.
  const hiiOn = on.photoionization && !ledger.diagnostics.hiiTrapped;
  const n = input.mass.length;
  const q = new Float64Array(n);
  if (hiiOn) {
    for (let i = 0; i < n; i++) q[i] = ionizingRate(input.teff[i]!, input.radius[i]!);
  }

  const gasNeeded = ledger.gasExpulsion.gasMomentumNeeded;

  const tMyr: number[] = [];
  const windMomentum: number[] = [];
  const hiiMomentum: number[] = [];
  const radMomentum: number[] = [];
  const totalMomentum: number[] = [];
  const gasRatio: number[] = [];
  const clearedFraction: number[] = [];
  let tRemoveMyr = Infinity;

  for (let s = 0; s < steps; s++) {
    const t = (windowMyr * s) / (steps - 1);
    const frac = windowMyr > 0 ? t / windowMyr : 0;
    const pWind = windEnd * frac;
    const pRad = radEnd * frac;
    const pHii = hiiOn
      ? (1 - knobs.hiiLeak) * hiiBudget(q, input.localDensity, t, input.rCloudPc).momentum
      : 0;
    const total = pWind + pHii + pRad;
    const ratio = gasNeeded > 0 ? total / gasNeeded : 0;
    if (ratio >= 1 && tRemoveMyr === Infinity) {
      // Linear-interpolate the crossing between this sample and the last.
      const prev = totalMomentum[s - 1] ?? 0;
      const prevRatio = gasNeeded > 0 ? prev / gasNeeded : 0;
      const prevT = tMyr[s - 1] ?? 0;
      tRemoveMyr =
        ratio === prevRatio ? t : prevT + (t - prevT) * ((1 - prevRatio) / (ratio - prevRatio));
    }
    tMyr.push(t);
    windMomentum.push(pWind);
    hiiMomentum.push(pHii);
    radMomentum.push(pRad);
    totalMomentum.push(total);
    gasRatio.push(ratio);
    clearedFraction.push(Math.min(1, ratio));
  }

  return {
    tMyr,
    windMomentum,
    hiiMomentum,
    radMomentum,
    totalMomentum,
    gasRatio,
    clearedFraction,
    windowMyr,
    tCrossMyr: input.tCrossMyr,
    tRemoveMyr,
    gasMomentumNeeded: gasNeeded,
  };
}
