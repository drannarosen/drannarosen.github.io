/*
 * ic.ts — turning a ClusterIdentity into particles the integrator can step (Layer 0, pure).
 *
 * This is not new architecture. ADR 0012 pinned `ClusterIdentity` with two fields reserved
 * for exactly this and never used:
 *
 *     kinematics: { virialRatio: number }   // "Reserved for N-body; theory-only engines ignore it"
 *     vx: number;  // km/s — 0 until the dynamics engine draws velocities
 *
 * So the cluster the census, the HR diagram and the star renderer already share is the same
 * cluster the dynamics runs — one `(seed, params, t)`, as the ADR requires, rather than a
 * second population that happens to look similar.
 *
 * ── THE UNITS BOUNDARY LIVES HERE AND NOWHERE ELSE ──
 *
 * `LatentStar` stores velocities in km/s. The integrators work in pc/Myr. The factor is
 * 1.0227, which is close enough to 1 that omitting it does not look like a units bug — it
 * looks like a 2.3% velocity error and a 4.6% energy error, i.e. like a mediocre integrator.
 * `toState` applies `KM_S_TO_PC_MYR` and `toLatent` reverses it; nothing else in
 * `core/dynamics` should ever perform that conversion.
 *
 * ── WHY THE PIECES ARE SEPARATE FUNCTIONS ──
 *
 * Sampling, drawing velocities, removing bulk motion and virial scaling are four steps that
 * fail in four different ways, and a single `makeInitialConditions()` would make it
 * impossible to test which one was wrong. They compose in `clusterState`, which is the
 * convenience path, but each is exported because each is separately checkable.
 */
import type { ClusterIdentity, LatentStar } from "../cluster/params.ts";
import { sampleCluster } from "../cluster/sample.ts";
import { subStream } from "../random/index.ts";
import { KM_S_TO_PC_MYR } from "../constants/index.ts";
import { createState, type ForceModel, type State } from "./types.ts";
import { centreOfMass, kineticEnergy, totalMass } from "./quantities.ts";

/** Positions and masses from latent stars; velocities converted km/s -> pc/Myr. */
export function toState(stars: readonly LatentStar[]): State {
  const s = createState(stars.length);
  for (let i = 0; i < stars.length; i++) {
    const star = stars[i];
    s.mass[i] = star.mass;
    s.pos[i * 3] = star.x;
    s.pos[i * 3 + 1] = star.y;
    s.pos[i * 3 + 2] = star.z;
    s.vel[i * 3] = star.vx * KM_S_TO_PC_MYR;
    s.vel[i * 3 + 1] = star.vy * KM_S_TO_PC_MYR;
    s.vel[i * 3 + 2] = star.vz * KM_S_TO_PC_MYR;
  }
  return s;
}

/** Write an evolved state back onto latent stars, converting pc/Myr -> km/s. */
export function toLatent(state: State, stars: LatentStar[]): void {
  for (let i = 0; i < stars.length; i++) {
    stars[i].x = state.pos[i * 3];
    stars[i].y = state.pos[i * 3 + 1];
    stars[i].z = state.pos[i * 3 + 2];
    stars[i].vx = state.vel[i * 3] / KM_S_TO_PC_MYR;
    stars[i].vy = state.vel[i * 3 + 1] / KM_S_TO_PC_MYR;
    stars[i].vz = state.vel[i * 3 + 2] / KM_S_TO_PC_MYR;
  }
}

/**
 * Draw isotropic Gaussian velocities of unit dispersion, in place.
 *
 * The AMPLITUDE is meaningless here and is fixed immediately afterwards by `scaleToVirial` —
 * what this function owns is the SHAPE (isotropic, no preferred direction, no rotation) and
 * its reproducibility. A Maxwellian is the equilibrium distribution for a relaxed system and
 * the honest default for one that is not yet relaxed; it is not claimed to be the
 * equilibrium DF of the density profile it is paired with, which is a real approximation and
 * is why a settling phase exists in `../gasExpulsion/`.
 *
 * Box-Muller, on its own named sub-stream so that changing the velocity model cannot shift
 * the masses or positions drawn from the same seed.
 */
export function drawMaxwellian(state: State, rng: () => number): void {
  for (let i = 0; i < state.n * 3; i += 2) {
    const u1 = Math.max(rng(), 1e-12);
    const u2 = rng();
    const r = Math.sqrt(-2 * Math.log(u1));
    const theta = 2 * Math.PI * u2;
    state.vel[i] = r * Math.cos(theta);
    if (i + 1 < state.n * 3) state.vel[i + 1] = r * Math.sin(theta);
  }
}

/**
 * Remove net momentum and net displacement, in place.
 *
 * Without this the cluster translates across the frame, which is not wrong physics but is a
 * distracting rendering and makes every centre-referenced diagnostic (half-mass radius,
 * enclosed mass) meaningless. `meanField/` additionally REQUIRES the centre at the origin,
 * since its whole force law is defined about that point.
 */
export function removeBulkMotion(state: State): void {
  const { n, pos, vel } = state;
  if (!(totalMass(state) > 0)) return;
  const { position, velocity } = centreOfMass(state);
  for (let i = 0; i < n; i++) {
    for (let k = 0; k < 3; k++) {
      pos[i * 3 + k] -= position[k];
      vel[i * 3 + k] -= velocity[k];
    }
  }
}

/**
 * Scale every velocity so the system starts at virial ratio Q = T/|U|. Returns the Q it
 * measured BEFORE scaling, which is worth having: a wildly sub-virial draw is a signal about
 * the density profile, not about the velocities.
 *
 * Q = 1/2 is equilibrium (2T + U = 0). Q < 1/2 collapses, Q > 1/2 expands.
 *
 * SCALING IS NOT THE SAME AS SAMPLING AN EQUILIBRIUM DF, and the difference matters enough
 * that `../gasExpulsion/` was built around it: positions drawn from a density profile and
 * velocities drawn isotropically are not a stationary solution together, so the system
 * rearranges for a while whatever Q it starts at. Scaling sets the ENERGY correctly; it does
 * not make the configuration stationary. That is what a settling phase is for.
 */
export function scaleToVirial(state: State, force: ForceModel, qTarget: number): number {
  const u = force.potentialEnergy(state.pos, state.mass, 0);
  const q = kineticEnergy(state) / Math.abs(u);
  if (!(q > 0) || !(qTarget > 0)) return q;
  const s = Math.sqrt(qTarget / q);
  for (let i = 0; i < state.vel.length; i++) state.vel[i] *= s;
  return q;
}

export interface ClusterStateOptions {
  /** Overrides `identity.kinematics.virialRatio` when set. */
  virialRatio?: number;
}

/**
 * The convenience path: identity -> particles ready to integrate.
 *
 * The force model is a parameter because the virial scaling has to measure the potential
 * with the SAME law that will then step the system. Scaling against `direct` and integrating
 * with `meanField` would start the cluster at a Q it is not actually at — the two disagree
 * on total potential energy by about 1% (measured), which is small, but the point is that
 * the number would be describing a different model than the one running.
 */
export function clusterState(
  identity: ClusterIdentity,
  force: ForceModel,
  opts: ClusterStateOptions = {},
): State {
  const state = toState(sampleCluster(identity));
  drawMaxwellian(state, subStream(identity.seed, "dynamics:velocity"));
  removeBulkMotion(state);
  scaleToVirial(state, force, opts.virialRatio ?? identity.kinematics.virialRatio);
  removeBulkMotion(state); // scaling is multiplicative, so it cannot reintroduce net momentum
  return state;
}

export interface ClumpPlacement {
  /** Displacement of this clump's centre [pc]. */
  offset: readonly [number, number, number];
  /** Bulk velocity added to every member [pc/Myr]. */
  velocity?: readonly [number, number, number];
}

/**
 * Combine several states into one, each shifted and given a bulk velocity.
 *
 * Two clumps on a collision course is the cheapest interesting initial condition the lab
 * has: it is visibly not spherically symmetric, so it shows immediately what `meanField/`
 * cannot represent — that model would smear the two into shells about the origin and
 * collapse them radially, which looks plausible and is wrong.
 */
export function combineStates(parts: readonly { state: State; place: ClumpPlacement }[]): State {
  const total = parts.reduce((sum, p) => sum + p.state.n, 0);
  const out = createState(total);
  let at = 0;
  for (const { state, place } of parts) {
    const v = place.velocity ?? [0, 0, 0];
    for (let i = 0; i < state.n; i++) {
      const to = (at + i) * 3;
      out.mass[at + i] = state.mass[i];
      for (let k = 0; k < 3; k++) {
        out.pos[to + k] = state.pos[i * 3 + k] + place.offset[k];
        out.vel[to + k] = state.vel[i * 3 + k] + v[k];
      }
    }
    at += state.n;
  }
  return out;
}
