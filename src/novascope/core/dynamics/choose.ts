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
import { createSymmetricHermite, type SymmetricHermite } from "./symmetric.ts";
import { createLogH, type LogH } from "./logh.ts";
import { createLeapfrog, type Leapfrog } from "./integrate.ts";
import { createState, type ForceModel, type State } from "./types.ts";

/** The common surface of every integrator — what a caller needs to drive a run. */
export type Integrator = Leapfrog | Fsi4 | Hermite | SymmetricHermite | LogH;

/** Which scheme is running. Reported, never assumed. */
export type Scheme = "fsi4" | "logh" | "symmetric" | "hermite" | "leapfrog";

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
  if (prefer === "symmetric") {
    return {
      integrator: createSymmetricHermite(state, force, { ...rest, adaptive }),
      scheme: "symmetric",
      order: 4,
    };
  }
  if (prefer === "logh") {
    /*
     * The one scheme here that is symplectic AND adaptive, because it adapts by TRANSFORMING
     * TIME rather than by controlling the step: a fixed step in fictitious time s, with
     * dt/ds = 1/(-U), so the physical step shrinks on its own wherever the potential deepens.
     * `adaptive` is not passed and would be meaningless — the adaptivity is the scheme.
     *
     * Measured on the shared eccentric Kepler fixture, peak |dE/E| over 20 orbits at 400
     * steps per orbit:
     *          e = 0.5      e = 0.9      e = 0.95     e = 0.99
     *   FSI4    1.9e-8       3.1e-3       2.3e+0       1.7e+2
     *   LogH    1.2e-13      4.4e-13      2.8e-13      4.2e-11
     * at a flat ~5300 steps for every eccentricity. That is the known result — LogH traces a
     * Kepler orbit with no secular energy error, the truncation appearing as a phase shift.
     */
    return { integrator: createLogH(state, force, rest), scheme: "logh", order: 4 };
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

/**
 * Whether this model's potential is TIME-INDEPENDENT, which is what LogH's time transformation
 * needs and what no method signature can tell you.
 *
 * Probed on a synthetic pair rather than declared, for the same reason `createLogH` probes the
 * real state: a declared flag drifts away from the model, and the failure it would allow is
 * silent — `gasExpulsion/` runs on `meanField/`, supplies every method LogH asks for, and has
 * an explicitly time-varying potential, so the wrong pairing produces a beautifully bounded
 * energy error for a trajectory that solves nothing.
 */
export function supportsTimeTransform(force: ForceModel): boolean {
  const probe = createState(2);
  probe.mass[0] = 1;
  probe.mass[1] = 1;
  probe.pos[0] = -0.5;
  probe.pos[3] = 0.5;
  const u0 = force.potentialEnergy(probe.pos, probe.mass, 0);
  if (!Number.isFinite(u0)) return false;
  for (const t of [1e-3, 1]) {
    const u = force.potentialEnergy(probe.pos, probe.mass, t);
    const scale = Math.max(Math.abs(u0), Math.abs(u), Number.MIN_VALUE);
    if (!Number.isFinite(u) || Math.abs(u - u0) / scale > 1e-12) return false;
  }
  return true;
}

/** Which schemes this force model can actually run, best first. Useful for building a UI. */
export function availableSchemes(force: ForceModel): Scheme[] {
  const out: Scheme[] = [];
  if (supportsForceGradient(force)) out.push("fsi4");
  /* LogH needs only `accelerations` and `potentialEnergy` — which every model has — but it also
     needs the potential to be AUTONOMOUS, and that is a property no method signature reveals.
     `supportsTimeTransform` probes for it. Listed after FSI4 rather than before because on a
     CLUSTER the two are comparable — measured at N = 400 over 22 crossing times, LogH is 3.8x
     to 24x better than FSI4 depending on the draw — and its spectacular advantage is a two-body
     result that a global time transformation dilutes among 400 stars. It is the right scheme
     when a close pair dominates, not universally. */
  if (supportsTimeTransform(force)) out.push("logh");
  /* Symmetric before asymmetric: where both run, the symmetric one is the better scheme and the
     asymmetric one is carried as its control. Neither is the DEFAULT — that is still FSI4 — so
     this order is a statement about quality, not about what `chooseIntegrator` returns. */
  if (supportsJerk(force)) out.push("symmetric", "hermite");
  out.push("leapfrog");
  return out;
}
