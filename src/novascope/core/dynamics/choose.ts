/*
 * choose.ts — pick the integrator a force model can actually run (Layer 0, pure).
 *
 * FSI4 is the DEFAULT (Anna, 2026-07-26): fourth-order, forward, and measured at 16.1x error
 * reduction per halving against the leapfrog's 4.0. At the operating softening eps ~ d it is
 * roughly 500x more accurate for about 4x the work per step.
 *
 * The leapfrog is NOT retired, for two reasons that are structural rather than sentimental:
 *
 *   1. It is the only integrator `meanField/` can use. FSI4 needs `forceGradient`, which is
 *      inherently pairwise — a binned radial profile has no pair structure to differentiate —
 *      and `gasExpulsion/` runs on `meanField`. Removing the leapfrog would delete the
 *      gas-expulsion page.
 *   2. It is the second-order baseline that DEMONSTRATES FSI4 is fourth order. A convergence
 *      claim with nothing to converge against is a claim about a single curve.
 *
 * So the choice is made by capability, not by preference, and a caller that wants one
 * specifically still calls `createLeapfrog` or `createFsi4` directly.
 */
import { createFsi4, supportsForceGradient, type Fsi4 } from "./fsi4.ts";
import { createLeapfrog, type Leapfrog } from "./integrate.ts";
import type { ForceModel, State } from "./types.ts";

/** The common surface of both integrators — everything a caller needs to drive a run. */
export type Integrator = Leapfrog | Fsi4;

export interface ChooseOptions {
  maxStep?: number;
  t0?: number;
  /** Force the second-order scheme even where FSI4 is available, e.g. for an A/B comparison. */
  preferLeapfrog?: boolean;
}

/**
 * The best integrator this force model supports.
 *
 * Returns FSI4 wherever `forceGradient` exists, the leapfrog otherwise. The `order` field is
 * reported so a caller can SAY which scheme is running rather than assume — a lab that
 * silently fell back to second order while labelling itself fourth would be the exact
 * confidently-wrong readout this codebase keeps designing against.
 */
export function chooseIntegrator(
  state: State,
  force: ForceModel,
  opts: ChooseOptions = {},
): { integrator: Integrator; scheme: "fsi4" | "leapfrog"; order: 2 | 4 } {
  const { preferLeapfrog, ...rest } = opts;
  if (!preferLeapfrog && supportsForceGradient(force)) {
    return { integrator: createFsi4(state, force, rest), scheme: "fsi4", order: 4 };
  }
  return { integrator: createLeapfrog(state, force, rest), scheme: "leapfrog", order: 2 };
}
