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
import { createHermite, supportsJerk, type Hermite } from "./hermite.ts";
import { createLeapfrog, type Leapfrog } from "./integrate.ts";
import type { ForceModel, State } from "./types.ts";

/** The common surface of every integrator — what a caller needs to drive a run. */
export type Integrator = Leapfrog | Fsi4 | Hermite;

/** Which scheme is running. Reported, never assumed. */
export type Scheme = "fsi4" | "hermite" | "leapfrog";

export interface ChooseOptions {
  maxStep?: number;
  t0?: number;
  /**
   * Ask for a specific scheme instead of the best available.
   *
   * THROWS if the force model cannot supply it, rather than falling back. A caller comparing
   * schemes needs the arm it asked for or an error — silently substituting one would make the
   * comparison a comparison of something else, which is the failure this whole seam exists to
   * prevent. Omit it to get the default.
   */
  prefer?: Scheme;
  /**
   * Let Hermite size its own sub-steps from the Aarseth criterion. IGNORED by the two symplectic
   * schemes, which have no adaptive mode — varying h forfeits the bounded-energy property that is
   * the reason to use one, so this is not a knob they could honour even in principle.
   *
   * Passed through here rather than requiring `createHermite` directly, because a caller building
   * a scheme selector should not have to special-case which factory takes which option.
   */
  adaptive?: boolean;
}

/**
 * The best integrator this force model supports, or the one explicitly asked for.
 *
 * FSI4 IS THE DEFAULT and Hermite does not change that (Anna, 2026-07-27). Hermite is fourth
 * order too, but it is not symplectic — its energy error is secular rather than bounded — and
 * measured on the shared fixture it is ~50x less accurate than FSI4 at equal step count. It is
 * carried as an INSTRUMENT: the only scheme here that adapts its own step, and an independent
 * kernel against which FSI4's results can be cross-checked. See `hermite.ts`.
 *
 * The `order` and `scheme` fields are reported so a caller can SAY what ran rather than assume.
 * A lab that silently fell back to second order while labelling itself fourth would be the exact
 * confidently-wrong readout this codebase keeps designing against.
 */
export function chooseIntegrator(
  state: State,
  force: ForceModel,
  opts: ChooseOptions = {},
): { integrator: Integrator; scheme: Scheme; order: 2 | 4 } {
  const { prefer, adaptive, ...rest } = opts;

  if (prefer === "leapfrog") {
    return { integrator: createLeapfrog(state, force, rest), scheme: "leapfrog", order: 2 };
  }
  if (prefer === "hermite") {
    // Throws with its own diagnostic if the model has no jerk.
    return {
      integrator: createHermite(state, force, { ...rest, adaptive }),
      scheme: "hermite",
      order: 4,
    };
  }
  if (prefer === "fsi4") {
    // Likewise for forceGradient.
    return { integrator: createFsi4(state, force, rest), scheme: "fsi4", order: 4 };
  }

  if (supportsForceGradient(force)) {
    return { integrator: createFsi4(state, force, rest), scheme: "fsi4", order: 4 };
  }
  /* The leapfrog, not Hermite, is the fallback. `meanField/` supplies neither capability, so the
     question never arises there; but a hypothetical model with jerk and no force-gradient should
     still not silently acquire a secular energy error just because it happens to be higher
     order. Choosing Hermite is a decision a caller makes explicitly. */
  return { integrator: createLeapfrog(state, force, rest), scheme: "leapfrog", order: 2 };
}

/** Which schemes this force model can actually run, best first. Useful for building a UI. */
export function availableSchemes(force: ForceModel): Scheme[] {
  const out: Scheme[] = [];
  if (supportsForceGradient(force)) out.push("fsi4");
  if (supportsJerk(force)) out.push("hermite");
  out.push("leapfrog");
  return out;
}
