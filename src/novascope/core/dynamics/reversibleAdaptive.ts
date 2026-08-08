/*
 * reversibleAdaptive.ts — an adaptive step that does NOT forfeit the bounded error
 * (Layer 0, pure).
 *
 * PORTED FROM gravax `integrators/symplectic/reversible_adaptive.py`
 * (`HairerSoderlindFSIIntegrator` and `reversible_fsi_density`). Method: Hairer &
 * Söderlind (2005), SIAM J. Sci. Comput. 26, 1838, "Explicit, time reversible, adaptive
 * step size control"; see also Hairer & Wanner (2006), *Geometric Numerical Integration*, §VIII.
 *
 * ── THE PROBLEM EVERY OTHER SCHEME HERE RUNS INTO ──
 *
 * `/explore/dynamics` builds a hard binary that outruns a fixed step, and the three obvious
 * answers each fail differently:
 *
 *   FSI4     symplectic, bounded error, CANNOT adapt — varying h forfeits the shadow
 *            Hamiltonian that makes the error bounded in the first place.
 *   LogH     adapts by transformation (dt/ds = 1/(-U)), so it stays symplectic — but -U is the
 *            SYSTEM total and cannot see one pair. Measured in `logh.ts`: it LENGTHENS its step
 *            exactly where the pair needs it shorter.
 *   Hermite  adapts by Aarseth's criterion, which is local and nearly free — and it is a
 *            controller, so the scheme is not symplectic and its error is SECULAR.
 *
 * `timestep.ts` states the missing piece outright: doing step control correctly on a symplectic
 * map "needs a reversible or Hairer-Soderlind controller, which gravax has and this package does
 * not". This file is that controller.
 *
 * ── WHY IT DOES NOT BREAK WHAT IT CONTROLS ──
 *
 * The failure mode of naive step control is that h is recomputed FROM THE STATE each step. That
 * makes the map state-dependent and irreversible: run it backwards and you get a different
 * sequence of steps, so the error no longer cancels and goes secular.
 *
 * Hairer-Söderlind carry the step density as an AUXILIARY VARIABLE rho, integrated symmetrically
 * alongside the state:
 *
 *     rho_mid = rho     + (eta/2) * (d ln Q / dt)|start
 *     dt      = eta / rho_mid
 *     <one complete FSI4 map of size dt>
 *     rho_new = rho_mid + (eta/2) * (d ln Q / dt)|end
 *
 * The two half-updates are the same shape as a leapfrog kick, and that is exactly the point: the
 * density update is time-symmetric, and `d ln Q / dt` changes sign under velocity reversal, so
 * reversing the trajectory reproduces the same step sequence backwards. The composed scheme is
 * TIME-REVERSIBLE, and for a reversible system that is what buys a non-secular error — the same
 * argument `ttl.ts` rests on, and it is asserted in the tests rather than assumed.
 *
 * ── WHAT IT IS NOT ──
 *
 * NOT SYMPLECTIC. rho is not a canonical variable, so the extended system is not Hamiltonian and
 * the shadow-Hamiltonian argument does not apply to the composition. Anything reporting this to a
 * reader must say "time-reversible", never "symplectic" — `fsi4.ts` and `logh.ts` are the
 * symplectic ones. Getting this label wrong would be the exact class of quiet untruth the
 * `/explore/dynamics` energy strip exists to prevent.
 *
 * ── Q: A SMOOTH MAXIMUM OVER PAIR FREQUENCIES, WHICH IS WHY IT SEES THE BINARY ──
 *
 *     omega_ij = sqrt(G (m_i + m_j) / r_ij^3)        the pair's own orbital frequency
 *     Q        = ( SUM_{i<j} omega_ij^p + (eta/dtMax)^p )^(1/p)
 *
 * The p-norm is a SMOOTH maximum, and smoothness is load-bearing rather than cosmetic: the
 * controller differentiates ln Q along the trajectory, and a hard `min` over pairs has a
 * discontinuous derivative at every exchange of which pair is tightest — which would put a jump
 * into rho and destroy the reversibility this whole file exists for.
 *
 * At p = 8 (gravax's default) Q is within a few percent of the fastest pair while staying
 * analytic. That is the difference from LogH: -U is a SUM, so four hundred stars drown out one
 * pair; this is a MAX, so one pair dominates it as soon as it is the fastest thing present.
 *
 * The extra `(eta/dtMax)^p` term is the step cap folded into the same norm rather than clamped
 * afterwards — a clamp would reintroduce a non-smooth point for the same reason `min` does.
 *
 *     d ln Q / dt = SUM_ij w_ij * (-1.5 * (r_ij . v_ij) / r_ij^2),
 *                   w_ij = omega_ij^p / (SUM omega^p + cap^p)
 *
 * (From ln Q = (1/p) ln SUM omega^p, so d ln Q/dt = SUM w_ij d ln omega_ij/dt, and
 * d ln omega/dt = -1.5 d ln r/dt. Each pair contributes in proportion to how much of Q it is.)
 *
 * ── ONE DELIBERATE DEVIATION FROM THE PORT, AND WHY ──
 *
 * gravax computes omega from the BARE separation. This package's force model is SOFTENED, and a
 * bare-r density diverges as r -> 0 while the force it is controlling saturates at
 * sqrt(GM/eps^3). The controller would then drive dt -> 0 chasing an encounter the force model
 * has already smoothed away, and the integrator stalls rather than fails — the worst failure
 * shape, because it looks like slowness.
 *
 * So `softening` is an option and the caller passes the force model's own eps, exactly as
 * `binaries.ts` requires for the same reason: a diagnostic computed from a different potential
 * than the one being integrated describes a different simulation. Passing 0 reproduces gravax's
 * behaviour and is what the parity test uses.
 */
import { createFsi4, supportsForceGradient } from "./fsi4.ts";
import { kineticEnergy } from "./quantities.ts";
import { G_PC3_MSUN_MYR2 } from "../constants/index.ts";
import type { Energy, ForceModel, State } from "./types.ts";

/** gravax's default accuracy parameter for this controller. */
export const DEFAULT_ETA = 0.01;
/** gravax's default p. High enough to track the fastest pair, low enough to stay conditioned. */
export const DEFAULT_DENSITY_POWER = 8;

export interface PairFrequencyDensity {
  /** Q [1/Myr] — the smooth maximum pair frequency, including the dtMax cap term. */
  value: number;
  /** eta / Q [Myr]: the step this state alone would ask for. Diagnostic; the run uses rho. */
  timestep: number;
  /** d ln Q / dt [1/Myr], along the Newtonian trajectory. Sign-flips under velocity reversal. */
  logarithmicRate: number;
  /** Closest pair separation [pc], softened as the force model softens it. */
  minimumPairSeparation: number;
  /** False if anything above is non-finite or non-positive; the caller must not step on it. */
  valid: boolean;
}

export interface DensityOptions {
  eta?: number;
  /** Largest step the cap term permits [Myr]. Required — it is what bounds Q from below. */
  dtMax: number;
  densityPower?: number;
  /** Pair softening [pc], matching the force model. See the header. */
  softening?: number;
  G?: number;
}

/**
 * Q and d ln Q/dt for the current state. O(N^2), allocation-free.
 *
 * Computed in logs throughout: omega^8 over a hard binary's separation overflows a double long
 * before the physics does — at r = 1e-3 pc and p = 8, omega^p is around 1e36, and the sum over
 * pairs is what would lose the small terms. The log-sum-exp form is not defensive tidiness, it
 * is the only way this is evaluable at the separations the page reaches.
 */
export function pairFrequencyDensity(
  state: State,
  opts: DensityOptions,
): PairFrequencyDensity {
  const { n, mass, pos, vel } = state;
  if (n < 2) {
    return {
      value: 0,
      timestep: Infinity,
      logarithmicRate: 0,
      minimumPairSeparation: Infinity,
      valid: false,
    };
  }
  const eta = opts.eta ?? DEFAULT_ETA;
  const p = opts.densityPower ?? DEFAULT_DENSITY_POWER;
  const G = opts.G ?? G_PC3_MSUN_MYR2;
  const eps2 = (opts.softening ?? 0) ** 2;

  /* The cap enters the norm as one more term, so it can never be the thing that makes Q
     non-smooth. Its log is p ln(eta/dtMax). */
  const capLog = p * Math.log(eta / opts.dtMax);

  /* Pass one: the maximum log term, so the exponentials below are all <= 1. */
  let maxLog = capLog;
  let minSep2 = Infinity;
  for (let i = 0; i < n; i++) {
    const ix = i * 3;
    for (let j = i + 1; j < n; j++) {
      const jx = j * 3;
      const dx = pos[ix]! - pos[jx]!;
      const dy = pos[ix + 1]! - pos[jx + 1]!;
      const dz = pos[ix + 2]! - pos[jx + 2]!;
      const r2 = dx * dx + dy * dy + dz * dz + eps2;
      if (r2 < minSep2) minSep2 = r2;
      // ln omega = 0.5 ln(G (m_i + m_j)) - 0.75 ln(r^2)
      const lw = 0.5 * Math.log(G * (mass[i]! + mass[j]!)) - 0.75 * Math.log(r2);
      const term = p * lw;
      if (term > maxLog) maxLog = term;
    }
  }

  /* Pass two: the shifted sum, and the rate weighted by each pair's share. */
  let sumExp = Math.exp(capLog - maxLog); // the cap contributes to Q but has no rate
  let rateAcc = 0;
  for (let i = 0; i < n; i++) {
    const ix = i * 3;
    for (let j = i + 1; j < n; j++) {
      const jx = j * 3;
      const dx = pos[ix]! - pos[jx]!;
      const dy = pos[ix + 1]! - pos[jx + 1]!;
      const dz = pos[ix + 2]! - pos[jx + 2]!;
      const r2 = dx * dx + dy * dy + dz * dz + eps2;
      const lw = 0.5 * Math.log(G * (mass[i]! + mass[j]!)) - 0.75 * Math.log(r2);
      const w = Math.exp(p * lw - maxLog);
      sumExp += w;
      const dvx = vel[ix]! - vel[jx]!;
      const dvy = vel[ix + 1]! - vel[jx + 1]!;
      const dvz = vel[ix + 2]! - vel[jx + 2]!;
      /* d ln omega/dt = -1.5 (r.v)/r^2. Softened in r^2 for the same reason the log term is:
         the rate must describe the density that is actually being controlled. */
      rateAcc += w * (-1.5 * ((dx * dvx + dy * dvy + dz * dvz) / r2));
    }
  }

  const logSum = maxLog + Math.log(sumExp);
  const value = Math.exp(logSum / p);
  /* The weights were computed against `maxLog`; normalising by the same shifted sum turns them
     into the shares that sum to 1. */
  const logarithmicRate = rateAcc / sumExp;
  const timestep = eta / value;
  const minimumPairSeparation = Math.sqrt(minSep2);
  const valid =
    Number.isFinite(value) &&
    value > 0 &&
    Number.isFinite(logarithmicRate) &&
    Number.isFinite(timestep) &&
    timestep > 0 &&
    Number.isFinite(minimumPairSeparation) &&
    minimumPairSeparation > 0;

  return { value, timestep, logarithmicRate, minimumPairSeparation, valid };
}

export interface ReversibleAdaptive {
  /**
   * Advance by AT LEAST `dt` [Myr] in whole controller steps; `t` is authoritative.
   *
   * Whole steps only, overshooting rather than truncating — for the same reason `logh.ts`
   * overshoots. Truncating the last step would make the step sequence depend on where the
   * caller happened to ask for a boundary, which is precisely the state-dependence the
   * auxiliary density exists to remove.
   */
  step(dt: number): void;
  readonly t: number;
  readonly state: State;
  readonly force: ForceModel;
  energy(): Energy;
  invalidateAcceleration(): void;
  /** The physical step the last controller step actually took [Myr]. */
  readonly lastPhysicalStep: number;
  /** The auxiliary density rho [1/Myr]. Diagnostic — it drifts from Q, and that is the point. */
  readonly density: number;
  /** |Q_end/rho_end - Q_start/rho_start| on the last step: how far rho has left the state. */
  readonly controllerResidual: number;
}

export interface ReversibleAdaptiveOptions extends Omit<DensityOptions, "dtMax"> {
  /** Largest physical step [Myr]. Required: it is the cap folded into Q. */
  dtMax: number;
  t0?: number;
  /**
   * Seed for the auxiliary density rho [1/Myr]. Defaults to Q at the initial state.
   *
   * Exposed because rho is genuinely part of the state: the scheme's reversibility is a
   * statement about the map (q, p, rho) -> (q', p', rho'), so reversing a trajectory means
   * flipping the velocities and CARRYING rho, not re-seeding it. The reversibility test does
   * exactly that, and a resume would need the same.
   */
  density0?: number;
  /** Hard cap on controller steps inside one `step()`, so a collapsing pair cannot hang a tab. */
  maxStepsPerCall?: number;
}

/**
 * FSI4 under an explicit reversible step-density controller.
 *
 * The map is a COMPLETE FSI4 step of the controller's size — not FSI4's own subdivision, which
 * is why the inner integrator is built with no `maxStep`. Handing the controller's dt to a map
 * that then subdivides it uniformly would put a second, fixed step-size policy underneath the
 * adaptive one and quietly undo it.
 */
export function createReversibleAdaptive(
  state: State,
  force: ForceModel,
  opts: ReversibleAdaptiveOptions,
): ReversibleAdaptive {
  if (!supportsForceGradient(force)) {
    throw new Error(
      `reversibleAdaptive wraps FSI4, which needs a force model with forceGradient(); ` +
        `'${force.id}' does not provide one. Use createHermite for '${force.id}'.`,
    );
  }
  const eta = opts.eta ?? DEFAULT_ETA;
  const maxStepsPerCall = opts.maxStepsPerCall ?? 100_000;
  const densityOpts: DensityOptions = {
    eta,
    dtMax: opts.dtMax,
    densityPower: opts.densityPower,
    softening: opts.softening,
    G: opts.G,
  };

  /* No maxStep: `step(h)` is then exactly one complete FSI4 map. See the note above. */
  const map = createFsi4(state, force, { t0: opts.t0 ?? 0 });

  let start = pairFrequencyDensity(state, densityOpts);
  /* rho is SEEDED from the state and then evolves on its own. Re-seeding it from the state
     each step is exactly the irreversible controller this scheme replaces. */
  let rho = opts.density0 ?? start.value;
  let lastPhysicalStep = 0;
  let controllerResidual = 0;

  function one(): boolean {
    if (!start.valid) return false;
    const rhoMid = rho + 0.5 * eta * start.logarithmicRate;
    if (!(rhoMid > 0) || !Number.isFinite(rhoMid)) return false;
    const h = eta / rhoMid;
    if (!(h > 0) || !Number.isFinite(h)) return false;

    map.step(h);

    const end = pairFrequencyDensity(state, densityOpts);
    if (!end.valid) return false;
    const rhoNew = rhoMid + 0.5 * eta * end.logarithmicRate;
    if (!(rhoNew > 0) || !Number.isFinite(rhoNew)) return false;

    controllerResidual = Math.abs(end.value / rhoNew - start.value / rho);
    rho = rhoNew;
    lastPhysicalStep = h;
    /* The endpoint state IS the next step's start state, so its density is reused rather than
       recomputed. That halves the pair sums — one per step against gravax's two — and is an
       identity, not an approximation: same positions and velocities, same Q. */
    start = end;
    return true;
  }

  return {
    step(dt: number): void {
      if (!(dt > 0)) return;
      const target = map.t + dt;
      let taken = 0;
      while (map.t < target) {
        if (++taken > maxStepsPerCall) {
          throw new Error(
            `reversibleAdaptive exceeded ${maxStepsPerCall} controller steps advancing ` +
              `dt = ${dt} Myr (reached ${map.t - (target - dt)}). The step density has ` +
              `collapsed — usually a pair at or inside the softening. Raise the softening, ` +
              `or raise eta.`,
          );
        }
        if (!one()) {
          throw new Error(
            `reversibleAdaptive step density became invalid at t = ${map.t} Myr. ` +
              `Q = ${start.value}, rho = ${rho}. This is a collapsed or non-finite ` +
              `configuration rather than a step-size problem.`,
          );
        }
      }
    },
    get t() {
      return map.t;
    },
    state,
    force,
    energy(): Energy {
      const kinetic = kineticEnergy(state);
      const potential = force.potentialEnergy(state.pos, state.mass, map.t);
      return { kinetic, potential, total: kinetic + potential };
    },
    invalidateAcceleration(): void {
      map.invalidateAcceleration();
      start = pairFrequencyDensity(state, densityOpts);
    },
    get lastPhysicalStep() {
      return lastPhysicalStep;
    },
    get density() {
      return rho;
    },
    get controllerResidual() {
      return controllerResidual;
    },
  };
}
