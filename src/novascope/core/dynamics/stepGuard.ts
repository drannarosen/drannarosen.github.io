/*
 * stepGuard.ts — shorten the step BEFORE the run breaches its own trust limit (Layer 0, pure).
 *
 * ── WHY THE TRIGGER IS THE DRIFT AND NOT THE BINARY ──
 *
 * `/explore/dynamics` fails in one specific way: a hard binary forms in the core, hardens past
 * what a fixed step can follow, and the energy error crosses the limit the page checks itself
 * against. The obvious response is to shorten the step when that binary appears — and the
 * obvious trigger, the page's own `pairWatch`, is STRUCTURALLY TOO LATE.
 *
 * Measured, N = 400, FSI4 at t_cr/2048, three seeds:
 *
 *   seed   first breach of 1e-4     pairWatch confirmed     verdict
 *   2026        19.2 t_cr                 14.1              in time
 *   2028         7.3                       7.9              LATE by 0.6
 *   2029         6.7                       9.1              LATE by 2.4
 *
 * Two draws in three the damage is already done. And it cannot be fixed by lowering the
 * threshold: the raw `stepsPerOrbit < 400` first fires at 0.8, 2.5 and 6.7 t_cr across those
 * seeds and `< 1000` at 0.0 to 1.0 — flybys, not binaries. Confirmation needs half a crossing
 * time of persistence BY DESIGN, because that is what tells a binary from two stars passing.
 * The property that makes the banner honest is the property that makes it a late trigger, and
 * the two requirements are in direct opposition.
 *
 * So this watches the quantity actually at risk. It cannot be late, because it fires at a
 * FRACTION of the limit rather than after it. Measured with gates at 10% and 30% of tolerance:
 *
 *   seed 2026   no guard: worst 1.02e-4, BREACHED   guarded: 2.44e-5, safe, 1 drop at 6.0 t_cr
 *   seed 2028   no guard: worst 2.22e-4, BREACHED   guarded: 3.01e-5, safe, 2 drops at 5.8, 10.4
 *
 * Note the fire times — 5.8 and 6.0 — on two seeds whose binaries confirm at 7.9 and 14.1. It
 * is watching the common cause rather than one of its symptoms.
 *
 * ── WHY A FEW DISCRETE CHANGES ARE SAFE WHERE PER-STEP CONTROL IS NOT ──
 *
 * A symplectic map does not conserve H; it exactly conserves a nearby shadow Hamiltonian
 * H~ = H + O(h^p). That is where its BOUNDED error comes from. Change h every step and each
 * step conserves a different H~, the mismatches accumulate as a random walk, and the error goes
 * secular — which is why `fsi4.ts` refuses a step controller and why `logh.ts` adapts by
 * transforming time instead.
 *
 * Changing h a HANDFUL of times is a different object: H~_1 before, H~_2 after, and the error is
 * a sum of a few offsets rather than a walk. That is a prediction, and it was tested — after a
 * drop the drift is FLAT: 4.2e-5 at the start of the post-drop window and 4.2e-5 at the end, at
 * every drop factor from 2x to 8x. Hence `maxDrops`, which is a correctness bound and not a
 * tuning knob: raise it far and this becomes the step controller it is designed not to be.
 *
 * ── COST ──
 *
 * Halving the step halves the model time per second. Measured on seed 2028, same wall budget:
 * 20.7 crossing times unguarded against 11.7 guarded. Anything using this must say so.
 */

/** One step change: what tripped it, when, and what the step scale became. */
export interface StepGuardEvent {
  /** Model time of the change, in whatever units the caller feeds `update` [Myr]. */
  at: number;
  /** The drift that tripped this gate. */
  drift: number;
  /** The gate's fraction of tolerance. */
  gate: number;
  /** The step scale AFTER the change: 1/2, 1/4, … */
  scale: number;
}

export interface StepGuardOptions {
  /** The limit the run is checked against. Gates are fractions of it. */
  tolerance: number;
  /**
   * Fractions of `tolerance` at which to shorten, in order.
   *
   * Staged rather than a single gate so an early, mild climb costs one halving and only a run
   * that keeps climbing pays for more. Defaults to a tenth, a third and six tenths — the first
   * measured to fire around 6 crossing times, comfortably before breaches at 6.7 and 7.3.
   */
  gates?: readonly number[];
  /** Divisor applied at each gate. Default 2. */
  factor?: number;
}

export interface StepGuard {
  /**
   * Feed one drift sample. Returns the event if this sample tripped a gate, else null.
   *
   * Call it on EVERY sample, not once a frame: the error arrives as narrow spikes at the
   * binary's periapsis, and `/explore/dynamics` already learned that sampling every eighth step
   * aliases them away — the run sailed past the limit it claimed to enforce.
   */
  update(drift: number, t: number): StepGuardEvent | null;
  /** Multiply the base step by this. Starts at 1 and only ever falls. */
  readonly scale: number;
  readonly drops: number;
  readonly events: readonly StepGuardEvent[];
  reset(): void;
}

export function createStepGuard(opts: StepGuardOptions): StepGuard {
  const gates = opts.gates ?? [0.1, 0.3, 0.6];
  const factor = opts.factor ?? 2;
  if (!(opts.tolerance > 0)) throw new Error("stepGuard needs a positive tolerance.");
  if (!(factor > 1)) throw new Error("stepGuard factor must be greater than 1.");
  /* Ascending, or a later gate could trip before an earlier one and the staging would be a
     fiction — the caller would see three drops from one spike. */
  for (let i = 1; i < gates.length; i++) {
    if (!(gates[i]! > gates[i - 1]!)) throw new Error("stepGuard gates must ascend.");
  }

  let scale = 1;
  let drops = 0;
  const events: StepGuardEvent[] = [];

  return {
    update(drift, t) {
      if (drops >= gates.length) return null;
      if (!Number.isFinite(drift)) return null;
      const gate = gates[drops]!;
      if (drift <= gate * opts.tolerance) return null;
      scale /= factor;
      drops++;
      const ev: StepGuardEvent = { at: t, drift, gate, scale };
      events.push(ev);
      return ev;
    },
    get scale() {
      return scale;
    },
    get drops() {
      return drops;
    },
    get events() {
      return events;
    },
    reset() {
      scale = 1;
      drops = 0;
      events.length = 0;
    },
  };
}
