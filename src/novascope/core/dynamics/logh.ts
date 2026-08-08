/*
 * logh.ts — the logarithmic-Hamiltonian method: a SYMPLECTIC scheme whose physical
 * timestep adapts itself (Layer 0, pure).
 *
 * References: Mikkola & Tanikawa (1999), MNRAS 310, 745, "Explicit symplectic algorithms
 * for time-transformed Hamiltonians"; Preto & Tremaine (1999), AJ 118, 2532.
 *
 * ── WHY THIS EXISTS ──
 *
 * `/explore/dynamics` measured its own failure mode: mass segregation sinks the heaviest
 * stars, a binary forms in the core and then HARDENS (Heggie), and its orbital period falls
 * below what a fixed step can follow. Measured on seed 2028 at N = 400, the tightest pair
 * went from 20551 steps per orbit at t/t_cr = 1 to 76 by t/t_cr = 22, and |dE/E| stepped up
 * with it — 3.1e-9 -> 1.1e-6 -> 7.5e-5, jumping at the exchange encounter that swapped the
 * 29.9 Msun star in as companion.
 *
 * The obvious fix — let FSI4 size its own step — is not available, and not because nobody
 * implemented it:
 *
 *   A symplectic map with a FIXED step h does not conserve H. It exactly conserves a nearby
 *   "shadow" Hamiltonian H~ = H + O(h^p). That is the whole reason its energy error is
 *   BOUNDED: the trajectory really is an exact solution of something close by, so the error
 *   oscillates and returns rather than accumulating. Vary h and H~ changes with it — each
 *   step now conserves a DIFFERENT nearby Hamiltonian, the mismatches accumulate as a random
 *   walk, and the error goes secular. Naive step control does not make a symplectic scheme
 *   adaptive; it converts it into a worse non-symplectic one.
 *
 * The way out is to change the problem rather than the controller. Introduce a fictitious
 * time s with dt = g(q) ds through a Poincare transformation; the transformed system is
 * Hamiltonian again, so a FIXED step in s — symplectic, bounded error — produces a VARIABLE
 * step in t. This file is the g = 1/(-U) case, which is the one that separates.
 *
 * ── THE DERIVATION, because a sign error here would look completely plausible ──
 *
 * Write H(q, p) = T(p) + U(q), and extend the phase space with time t and its conjugate
 * momentum w, initialised w = -E0. Take
 *
 *     GAMMA(q, p, t, w) = ln(T(p) + w) - ln(-U(q)).
 *
 * GAMMA has no explicit t, so dw/ds = -dGAMMA/dt = 0: w stays -E0 for the whole run.
 * On the physical manifold T + w = T - E = -U, so writing V = -U > 0 (bound, self-gravitating)
 * both halves agree that
 *
 *     dt/ds = 1/V.
 *
 * THAT is the adaptivity, and it is not a heuristic: as two stars close in, |U| grows, V grows,
 * and the physical step shrinks on its own. No criterion, no controller, no eta.
 *
 * GAMMA is separable — one term in p and w only, one in q only — so an explicit symplectic
 * splitting applies. The two exact sub-maps are:
 *
 *   DRIFT, from ln(T + w).  p and w are fixed, so (T + w) is CONSTANT across the sub-step:
 *       q_i += v_i * h / (T + w)
 *       t   += h / (T + w)
 *
 *   KICK, from -ln(V).  q is fixed, so V is CONSTANT across the sub-step:
 *       v_i += a_i * h / V
 *
 * Each is exact, which is what makes the composition symplectic rather than merely accurate.
 *
 * ── WHAT IT BUYS, AND WHAT IT DOES NOT ──
 *
 * For the pure two-body problem LogH is famously good: the leapfrog composition traces the
 * Kepler ellipse with NO secular energy error at any eccentricity, the error appearing as a
 * phase shift instead. That is the regime a hardening binary lives in.
 *
 * The transformation is GLOBAL, though — V is the system's total potential — so it responds to
 * a binary only insofar as that binary contributes to the total. Measured on seed 2028 at
 * t/t_cr = 22 the pair carried ~37% of |U|, so the response is real and large; but a pair that
 * hardens without bound would eventually dominate V and freeze the cluster's own evolution to
 * resolve it. The production answer to that is per-pair regularisation (KS, or AR-chain), which
 * is a different and much larger piece of machinery. This is the global version, and its limit
 * should be stated wherever it is used rather than discovered.
 */
import type { Energy, ForceModel, State } from "./types.ts";
import { kineticEnergy } from "./quantities.ts";

export interface LogH {
  /**
   * Advance by AT LEAST `dt` [Myr], then stop on the next whole fictitious-time step.
   *
   * IT DOES NOT LAND EXACTLY ON `dt`, and that is deliberate. Truncating the final step to
   * hit a requested physical time is what every adaptive non-symplectic scheme does — Hermite
   * does it here and says why it is safe there — but for a symplectic map the fixed step IS
   * the property. A truncated step conserves a different shadow Hamiltonian, so landing
   * exactly on the clock would reintroduce, once per call, the secular error this whole file
   * exists to avoid.
   *
   * So `t` is authoritative and a caller MUST read it rather than accumulating its own dt.
   * A caller that adds dt to its own clock will drift away from the integrator's.
   */
  step(dt: number): void;
  /** Advance exactly one fictitious-time step of `h`. The primitive; `step` is a wrapper. */
  stepFictitious(h: number): void;
  /** Simulation time [Myr]. Authoritative — see `step`. */
  readonly t: number;
  /** Fictitious time elapsed. Diagnostic: it is the clock the map is uniform in. */
  readonly s: number;
  /** The physical step the last sub-step actually took [Myr]. Diagnostic for "is it adapting?" */
  readonly lastPhysicalStep: number;
  readonly state: State;
  readonly force: ForceModel;
  energy(): Energy;
  /** Call after writing `state.pos` from outside. Velocity changes do NOT need this. */
  invalidateAcceleration(): void;
}

export interface LogHOptions {
  /**
   * The INITIAL physical step [Myr]. Converted once to a fixed fictitious step via h_s = V0 * dt.
   *
   * Named for physical time because that is what a caller can reason about — a crossing time
   * over some number of steps. What is held fixed thereafter is h_s, so the physical step then
   * moves on its own, which is the point.
   */
  maxStep?: number;
  /** Starting simulation time [Myr]. Default 0. */
  t0?: number;
  /**
   * 4 for Yoshida's fourth-order triple jump, 2 for the plain leapfrog in s. Default 4.
   *
   * The composition is applied in FICTITIOUS time, so its order is the order in s. Yoshida's
   * construction only preserves symplecticity because each sub-map is exact and the weights
   * sum correctly; do not "tune" them.
   */
  order?: 2 | 4;
}

/* Yoshida (1990) triple jump: S(w1 h) S(w0 h) S(w1 h) raises a symmetric second-order map to
   fourth order. w0 is negative — the middle step runs BACKWARDS, which is not a bug and is
   why the scheme cannot be used with irreversible physics. */
const CBRT2 = Math.cbrt(2);
const YOSHIDA_W1 = 1 / (2 - CBRT2);
const YOSHIDA_W0 = -CBRT2 / (2 - CBRT2);

export function createLogH(state: State, force: ForceModel, opts: LogHOptions = {}): LogH {
  const { mass, pos, vel, n } = state;
  const acc = new Float64Array(n * 3);
  const order = opts.order ?? 4;
  let t = opts.t0 ?? 0;
  let s = 0;
  let accValid = false;
  let lastPhysicalStep = 0;

  /** V = -U > 0 for a bound self-gravitating configuration. The time transformation's engine. */
  const potentialV = (): number => -force.potentialEnergy(pos, mass, t);

  /*
   * THE POTENTIAL MUST BE AUTONOMOUS, and this MEASURES it rather than trusting a flag.
   *
   * The whole derivation rests on GAMMA carrying no explicit t, which is what makes
   * dw/ds = 0 and lets w stay -E0 for the run. Against a time-dependent potential every one
   * of those steps is still arithmetically valid and physically meaningless — energy is not
   * conserved, T + w no longer equals V, and the scheme would report a beautifully bounded
   * error for a trajectory that is not a solution of anything.
   *
   * `gasExpulsion/` is not hypothetical: its potential is literally
   * `(r, t) => gasMassAt(t) * phiGasUnit[...]`, and it runs on `meanField/`, which supplies
   * everything this constructor otherwise asks for. So the wrong pairing is reachable today.
   *
   * Probed at two separations in t because a single probe could land on a plateau of a
   * slowly-varying model. Positions are untouched, so any difference IS explicit t-dependence.
   */
  {
    const uRef = force.potentialEnergy(pos, mass, t);
    for (const dt of [1e-3, 1]) {
      const uLater = force.potentialEnergy(pos, mass, t + dt);
      const scale = Math.max(Math.abs(uRef), Math.abs(uLater), Number.MIN_VALUE);
      if (Math.abs(uLater - uRef) / scale > 1e-12) {
        throw new Error(
          `LogH needs a TIME-INDEPENDENT potential, but '${force.id}' changed by ` +
            `${(((uLater - uRef) / scale) * 100).toPrecision(3)}% between t = ${t} and ` +
            `t = ${t + dt} at fixed positions. The log-Hamiltonian transformation assumes the ` +
            `momentum conjugate to time is conserved, which is false for an explicitly ` +
            `time-varying potential (gas expulsion is the case here) — the scheme would report ` +
            `a bounded error for a trajectory that solves nothing. Use createLeapfrog or ` +
            `createFsi4 for time-dependent models.`,
        );
      }
    }
  }

  const v0 = potentialV();
  if (!(v0 > 0) || !Number.isFinite(v0)) {
    /* Not a recoverable state: ln(V) is undefined and every step would produce NaN silently.
       A single particle, or a configuration with no self-gravity, is the usual cause. */
    throw new Error(
      `LogH needs a self-gravitating configuration: -U must be positive and finite, got ${v0}. ` +
        `A single particle or a purely external potential has no -U to transform time by; ` +
        `use createFsi4 or createLeapfrog for those.`,
    );
  }

  /*
   * w IS FIXED FOR THE RUN. It is the momentum conjugate to t, and GAMMA carries no explicit
   * t, so dw/ds = 0 exactly. Recomputing it — the obvious "keep it in sync" instinct — would
   * silently re-baseline the shadow Hamiltonian every step and destroy the bounded error.
   */
  const w = -(kineticEnergy(state) + force.potentialEnergy(pos, mass, t));

  /** T + w. Equals V on the physical manifold; the drift's own denominator, computed from p. */
  const driftDenominator = (): number => kineticEnergy(state) + w;

  const ensureAcc = (): void => {
    if (!accValid) {
      force.accelerations(pos, mass, acc, t);
      accValid = true;
    }
  };

  /** DRIFT: p and w fixed, so (T + w) is constant across the sub-step and this is exact. */
  function drift(h: number): void {
    const denom = driftDenominator();
    if (!(denom > 0) || !Number.isFinite(denom)) {
      throw new Error(
        `LogH drift denominator T + w = ${denom} is not positive at t = ${t}. The system has ` +
          `become unbound or the state is degenerate; the log transformation is undefined there.`,
      );
    }
    const dt = h / denom;
    for (let i = 0; i < pos.length; i++) pos[i] += vel[i] * dt;
    t += dt;
    lastPhysicalStep = dt;
    accValid = false;
  }

  /** KICK: q fixed, so V is constant across the sub-step and this is exact. */
  function kick(h: number): void {
    ensureAcc();
    const V = potentialV();
    if (!(V > 0) || !Number.isFinite(V)) {
      throw new Error(
        `LogH kick found -U = ${V} at t = ${t}; the configuration is no longer bound and the ` +
          `time transformation is undefined.`,
      );
    }
    const scale = h / V;
    for (let i = 0; i < vel.length; i++) vel[i] += acc[i] * scale;
  }

  /** The symmetric second-order map in s: half drift, full kick, half drift. */
  function leap(h: number): void {
    drift(h / 2);
    kick(h);
    drift(h / 2);
  }

  function one(h: number): void {
    if (order === 2) {
      leap(h);
    } else {
      leap(YOSHIDA_W1 * h);
      leap(YOSHIDA_W0 * h);
      leap(YOSHIDA_W1 * h);
    }
    /* The Yoshida weights sum to 1, so the composition advances s by exactly h either way. */
    s += h;
  }

  /* h_s is set ONCE, from the initial V, and then held. That is the fixed step the
     symplecticity rests on; the physical step it produces is free to move. */
  const hs = v0 * (opts.maxStep ?? 1 / v0);

  return {
    step(dt: number): void {
      if (!(dt > 0)) return;
      const target = t + dt;
      /* Whole steps only, overshooting the target rather than truncating — see the note on
         `step` in the interface for why the alternative is worse than the overshoot. */
      let guard = 0;
      const MAX = 1_000_000;
      while (t < target) {
        if (guard++ >= MAX) {
          throw new Error(
            `LogH exceeded ${MAX} fictitious steps advancing dt = ${dt} (reached ${t - (target - dt)}). ` +
              `The time transformation has collapsed the physical step — a pair has hardened far ` +
              `enough that -U is dominated by it. This is the documented limit of the GLOBAL ` +
              `transformation; resolving it needs per-pair regularisation.`,
          );
        }
        one(hs);
      }
    },
    stepFictitious(h: number): void {
      one(h);
    },
    get t() {
      return t;
    },
    get s() {
      return s;
    },
    get lastPhysicalStep() {
      return lastPhysicalStep;
    },
    state,
    force,
    energy(): Energy {
      const kinetic = kineticEnergy(state);
      const potential = force.potentialEnergy(pos, mass, t);
      return { kinetic, potential, total: kinetic + potential };
    },
    invalidateAcceleration(): void {
      accValid = false;
    },
  };
}
