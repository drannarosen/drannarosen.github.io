/*
 * core/dynamics — stellar dynamics, in two force models and one integrator (Layer 0, pure).
 *
 * ADR 0016 decided that novascope COMPUTES the physics it shows rather than replaying an
 * export, and named leapfrog as the way dynamics arrives. This module is that, and it carries
 * two force laws because they answer different questions rather than because one is a better
 * version of the other:
 *
 *   direct/      pairwise O(N^2). COLLISIONAL — two-body relaxation, dynamical mass
 *                segregation, escapers and core collapse emerge from the pair sum. Honest at
 *                the N it actually runs (a few hundred to ~2000 in a browser), because at
 *                that N it is modelling a cluster of that size.
 *
 *   meanField/   spherically-averaged M(<r), O(N). COLLISIONLESS — none of those effects has
 *                a term, at any resolution. In exchange it has no ARTIFICIAL relaxation
 *                either, which is what makes it the right tool when 10^4 particles stand in
 *                for a much larger real cluster.
 *
 *   gasExpulsion/  the application: a draining natal gas cloud on top of meanField, with the
 *                  virial scaling and settling protocol that make its survival verdict mean
 *                  something.
 *
 * The leapfrog in `integrate.ts` steps either. It is symplectic, so the energy error is
 * bounded and oscillatory rather than secular — the property that keeps a demo honest ten
 * minutes into a lecture, and the reason ADR 0016 chose it over RK4.
 *
 * ── FILE LAYOUT NOTE ──
 *
 * `index.ts` used to BE the gas-expulsion code: 481 lines with its own leapfrog and its own
 * radial binning. It is a barrel now. The re-home was made safe by freezing
 * `scripts/fixtures/dynamics-gasexpulsion.json` from the old code FIRST, in its own commit;
 * `check-dynamics` holds 69 quantities across three star-formation efficiencies, so the move
 * is a move only if those numbers survive it.
 */

export type { ForceModel, State, Energy, Vec3Array } from "./types.ts";
export { createState } from "./types.ts";

export type { Leapfrog, LeapfrogOptions } from "./integrate.ts";
export { createLeapfrog } from "./integrate.ts";

export type { DirectOptions } from "./direct/index.ts";
export { createDirectForce, softeningForCluster } from "./direct/index.ts";

export type { MeanFieldForce, MeanFieldOptions, ExternalSpherical } from "./meanField/index.ts";
export { createMeanFieldForce } from "./meanField/index.ts";

export type { ClusterStateOptions, ClumpPlacement } from "./ic.ts";
export {
  clusterState,
  combineStates,
  drawMaxwellian,
  kineticEnergy,
  removeBulkMotion,
  scaleToVirial,
  toLatent,
  toState,
} from "./ic.ts";

export { lagrangianRadii, measure, radii } from "./diagnostics.ts";
/* Renamed on the way out: `gasExpulsion` already owns the name `Diagnostics` in this barrel,
   because `viz/webgl` and the shipped /explore pages import it from here. */
export type { Diagnostics as StateDiagnostics } from "./diagnostics.ts";

export type {
  Dynamics,
  DynamicsInit,
  DynamicsParams,
  Phase,
  Diagnostics,
} from "./gasExpulsion/index.ts";
export { createDynamics, RELAX_TCROSS } from "./gasExpulsion/index.ts";
