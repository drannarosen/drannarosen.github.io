/*
 * ttl.ts — Time-Transformed Leapfrog: an adaptive step keyed on a CHOSEN quantity
 * (Mikkola & Aarseth 2002, Cel. Mech. Dyn. Astron. 84, 343). Layer 0, pure.
 *
 * ── WHY, GIVEN logh.ts ALREADY EXISTS ──
 *
 * LogH gets its adaptivity from dt/ds = 1/(-U), and that is not a design choice — it is the
 * one time transformation for which the extended Hamiltonian SEPARATES, so it is the only one
 * an explicit symplectic splitting can integrate. For a few bodies that is also the right
 * physics, because -U is dominated by the close pair. For a few hundred stars it is not, and
 * `logh.ts` records the trace: -U_total spans a factor of 1.4 across a run in which the core
 * binary tightens 4x, and the two are ANTI-CORRELATED at the moment it matters — the cluster
 * expands while the pair hardens, so -U falls and LogH LENGTHENS its step exactly where the
 * pair needed a shorter one.
 *
 * TTL breaks the constraint by carrying the time-transformation function as an AUXILIARY
 * DYNAMICAL VARIABLE W rather than evaluating a function of q inside the split:
 *
 *   DRIFT  holds W fixed, so dt = h/W is a constant over the sub-step and q += v dt is exact.
 *   KICK   holds q fixed, so Omega(q) is exact, and W is advanced by its own rate
 *          Omega' = dOmega/dt = sum_i (dOmega/dq_i) . v_i.
 *
 * Neither sub-map needs Omega to be of any particular form, so Omega is FREE. That is the
 * whole point of the scheme, and the reason it can be pointed at close pairs.
 *
 * ── HOW Omega WAS CHOSEN, AND IT WAS MEASURED ──
 *
 *   Omega = sum_{i<j} m_i m_j / (r_ij^2 + eps^2)^(beta/2)
 *
 * beta = 1 reproduces -U/G exactly, i.e. TTL at beta = 1 IS LogH — which is the consistency
 * check this file's tests use. The mass weighting is kept, and that is not incidental: the
 * hardening pair is made of the two MOST MASSIVE stars, so dropping the masses makes it
 * invisible. Measured share of Omega carried by the tightest pair, N = 400, seed 2028:
 *
 *   t/t_cr    m_i m_j / r   (LogH)     1/r      1/r^2     1/r^3      <- no mass weighting
 *       18            58.75%          0.09%     2.05%     5.63%
 *
 * With the masses kept, the radial exponent is the lever:
 *
 *   t/t_cr   beta=1 (LogH)   beta=1.5   beta=2    beta=3
 *       10          23.27%     48.41%    64.90%    60.11%
 *       18          58.75%     86.16%    95.70%    99.26%
 *
 * and what that does to the step, from t/t_cr = 2 to 18 (a fixed step would be 1.00):
 *
 *   beta=1  1.18x   <- LONGER: the failure
 *   beta=1.5  0.62x
 *   beta=2  0.32x
 *   beta=3  0.16x
 *
 * DEFAULT beta = 2. beta = 1 does not respond; beta = 3 responds hardest but concentrates the
 * whole step budget on one pair, which starves the cluster the page is actually about. 2 is
 * the middle, and it is a knob rather than a constant precisely because that trade is a
 * judgement and should be visible.
 *
 * ── AND IT LOSES ON THIS PROBLEM. READ THIS BEFORE REACHING FOR IT. ──
 *
 * Everything above is true and the scheme does what it was built to do — and on a cost-fair
 * comparison it is still the wrong choice for `/explore/dynamics`. The first benchmark
 * calibrated every scheme to the same initial STEP, which flatters this one: it was simply
 * doing several times the work per unit of simulated time.
 *
 * N = 400, seed 2028, to t/t_cr = 8, worst |dE/E| against wall time:
 *
 *   FSI4      div=2048   1.11e-5     23s
 *   LogH      div=2048   3.51e-5     27s
 *   TTL b=2   div=2048   1.17e-7    200s   <- 8.7x the cost
 *   TTL b=2   div= 512   1.02e-4     97s   <- coarsened to compete: now WORSE than FSI4
 *   TTL b=2   div= 256   1.54e-2     62s
 *   TTL b=2   div= 128   threw: W went negative
 *
 * Spend that 8.7x on a finer FIXED step instead and FSI4 lands near 1e-8. The reason is
 * per-step cost: Omega and Omega' are extra O(N^2) pair sums, so a step here costs about three
 * force evaluations against FSI4's two, and the adaptivity gain does not repay that at this N
 * and this softening.
 *
 * Nor does it win in the regime it was built for. At a tenth of the shipped softening, where
 * LogH collapses, with an equal wall budget:
 *
 *   eps        scheme    reached t/t_cr   worst |dE/E|
 *   8.80e-3    FSI4                 6.0        1.10e-5
 *              LogH                 6.0        2.14e-5
 *              TTL b=2              0.9        1.17e-7   <- accurate, barely moving
 *              Hermite              6.0        3.65e-7   <- best
 *   8.80e-4    FSI4                 6.0        9.18e+0
 *              LogH                 5.6        1.08e+0
 *              TTL b=2              0.8        4.58e-5
 *              Hermite              4.9        1.11e-6   <- best
 *   8.80e-5    FSI4                 6.0        2.85e+5
 *              LogH                 2.3        7.83e+2
 *              TTL b=2              1.0        4.12e-4
 *              Hermite              5.0        1.12e-5   <- best
 *
 * ADAPTIVE HERMITE WINS AT EVERY SOFTENING, and structurally rather than by luck: Aarseth's
 * criterion is a LOCAL controller riding on the acceleration and jerk Hermite already computes,
 * so its adaptivity is nearly free, while this scheme pays two extra pair sums for adaptivity
 * that is still global.
 *
 * So this file is kept as a correct, verified implementation and as the record of that
 * measurement — not as a recommendation. It is NOT wired into `/explore/dynamics`. Where it
 * would earn its place is a configuration dominated by one hard pair with few enough bodies
 * that the O(N^2) Omega is cheap, which is exactly the few-body regime LogH already handles.
 *
 * ── WHAT THIS IS AND IS NOT ──
 *
 * It is TIME-SYMMETRIC, not symplectic. W is not a canonical variable, so the extended system
 * is not Hamiltonian and the shadow-Hamiltonian argument does not apply. Time-symmetry is what
 * buys a non-secular error here, and the tests assert it directly rather than assuming it.
 * Anything reporting this scheme to a reader must say "time-symmetric" and not "symplectic";
 * `logh.ts` is the symplectic one.
 *
 * It is also DIRECT-FORCE ONLY. Omega and Omega' are pair sums computed here, so a force model
 * with no pair structure (`meanField/`) has no Omega to transform by. That is checked in the
 * constructor rather than assumed.
 */
import type { Energy, ForceModel, State } from "./types.ts";
import { kineticEnergy } from "./quantities.ts";

export interface TTL {
  /** Advance by AT LEAST `dt` [Myr]; `t` is authoritative. See `logh.ts` for why not exactly. */
  step(dt: number): void;
  /** Advance exactly one fictitious-time step. The primitive; `step` wraps it. */
  stepFictitious(h: number): void;
  readonly t: number;
  readonly s: number;
  /** The physical step the last WHOLE fictitious step took [Myr]. */
  readonly lastPhysicalStep: number;
  /** The auxiliary variable. Compare with `omegaNow()` to see whether it is tracking. */
  readonly w: number;
  /** Omega evaluated at the current positions — what `w` is supposed to be following. */
  omegaNow(): number;
  readonly state: State;
  readonly force: ForceModel;
  energy(): Energy;
  invalidateAcceleration(): void;
}

export interface TTLOptions {
  /** Softening [pc]. MUST match the force model's, or Omega describes a different problem. */
  softening: number;
  /**
   * Radial exponent of Omega. Default 2. See the header for the measurements behind that.
   * 1 makes this scheme identical to LogH, which is how the tests pin the two together.
   */
  beta?: number;
  /** The INITIAL physical step [Myr] — a calibration, not a cap. Same meaning as in logh.ts. */
  maxStep?: number;
  t0?: number;
  /** 2 for the plain leapfrog in s, 4 for Yoshida's triple jump. Default 4. */
  order?: 2 | 4;
  /** G, for Omega's mass weighting. Only a scale on Omega, so it cancels in dt. Default 1. */
  G?: number;
}

const CBRT2 = Math.cbrt(2);
const YOSHIDA_W1 = 1 / (2 - CBRT2);
const YOSHIDA_W0 = -CBRT2 / (2 - CBRT2);

export function createTTL(state: State, force: ForceModel, opts: TTLOptions): TTL {
  const { mass, pos, vel, n } = state;
  const acc = new Float64Array(n * 3);
  const beta = opts.beta ?? 2;
  const order = opts.order ?? 4;
  const G = opts.G ?? 1;
  const eps2 = opts.softening * opts.softening;
  let t = opts.t0 ?? 0;
  let s = 0;
  let accValid = false;
  let lastPhysicalStep = 0;

  /**
   * Omega' alone, for the second half of the symmetric kick.
   *
   * Positions do not move inside a kick, so Omega is unchanged across it and recomputing it
   * there is a whole O(N^2) pair sum thrown away. Measured on the cluster benchmark, the kick
   * was doing three N^2 passes (accelerations + two full Omega sums) against FSI4's two.
   */
  function rateOnly(): number {
    let rate = 0;
    for (let i = 0; i < n; i++) {
      const ix = i * 3;
      const mi = mass[i];
      for (let j = i + 1; j < n; j++) {
        const jx = j * 3;
        const dx = pos[ix] - pos[jx];
        const dy = pos[ix + 1] - pos[jx + 1];
        const dz = pos[ix + 2] - pos[jx + 2];
        const r2 = dx * dx + dy * dy + dz * dz + eps2;
        const dvx = vel[ix] - vel[jx];
        const dvy = vel[ix + 1] - vel[jx + 1];
        const dvz = vel[ix + 2] - vel[jx + 2];
        rate +=
          G * mi * mass[j] * -beta * (dx * dvx + dy * dvy + dz * dvz) * (Math.pow(r2, -beta / 2) / r2);
      }
    }
    return rate;
  }

  /**
   * Omega = sum_{i<j} m_i m_j / (r^2 + eps^2)^(beta/2), and its time derivative
   * Omega' = -beta sum_{i<j} m_i m_j (dr . dv) / (r^2 + eps^2)^(beta/2 + 1).
   *
   * Returned together because they share the pair loop, which is the expensive part.
   */
  function omegaAndRate(): { omega: number; rate: number } {
    let omega = 0;
    let rate = 0;
    for (let i = 0; i < n; i++) {
      const ix = i * 3;
      const mi = mass[i];
      for (let j = i + 1; j < n; j++) {
        const jx = j * 3;
        const dx = pos[ix] - pos[jx];
        const dy = pos[ix + 1] - pos[jx + 1];
        const dz = pos[ix + 2] - pos[jx + 2];
        const r2 = dx * dx + dy * dy + dz * dz + eps2;
        const mm = G * mi * mass[j];
        const invR = Math.pow(r2, -beta / 2);
        omega += mm * invR;
        const dvx = vel[ix] - vel[jx];
        const dvy = vel[ix + 1] - vel[jx + 1];
        const dvz = vel[ix + 2] - vel[jx + 2];
        /* d/dt (r^2 + eps^2)^(-beta/2) = -beta (dr.dv) (r^2 + eps^2)^(-beta/2 - 1) */
        rate += mm * -beta * (dx * dvx + dy * dvy + dz * dvz) * (invR / r2);
      }
    }
    return { omega, rate };
  }

  const omega0 = omegaAndRate().omega;
  if (!(omega0 > 0) || !Number.isFinite(omega0)) {
    throw new Error(
      `TTL needs a positive, finite Omega and got ${omega0}. Omega is a pair sum over the ` +
        `configuration, so a single particle — or a force model with no pair structure, such ` +
        `as meanField — has nothing to transform time by.`,
    );
  }

  /* W starts ON Omega. It is a separate variable thereafter and is allowed to drift from it;
     `omegaNow()` exists so a caller can see by how much rather than trust that it does not. */
  let w = omega0;

  const ensureAcc = (): void => {
    if (!accValid) {
      force.accelerations(pos, mass, acc, t);
      accValid = true;
    }
  };

  /** DRIFT: W is held fixed, so dt is constant across the sub-step and this is exact. */
  function drift(h: number): void {
    if (!(w > 0) || !Number.isFinite(w)) {
      throw new Error(
        `TTL's auxiliary W went non-positive (${w}) at t = ${t}. Omega has collapsed — the ` +
          `configuration has dispersed, or beta is steep enough that one pair's term dominated ` +
          `and then left.`,
      );
    }
    const dt = h / w;
    for (let i = 0; i < pos.length; i++) pos[i] += vel[i] * dt;
    t += dt;
    accValid = false;
  }

  /**
   * KICK: q is held fixed, so Omega(q) is exact.
   *
   * W is advanced by its own rate in TWO HALVES, around the velocity update. That is what makes
   * the sub-map time-symmetric: Omega' depends on v, so applying the whole increment before or
   * after the kick would make the step read differently forwards and backwards, and the
   * non-secular error this scheme has instead of symplecticity rests on reversibility.
   */
  function kick(h: number): void {
    ensureAcc();
    const before = omegaAndRate();
    if (!(before.omega > 0) || !Number.isFinite(before.omega)) {
      throw new Error(`TTL found Omega = ${before.omega} at t = ${t}; the transformation is undefined.`);
    }
    const dt = h / before.omega;
    w += 0.5 * dt * before.rate;
    for (let i = 0; i < vel.length; i++) vel[i] += acc[i] * dt;
    /* Re-read the rate with the NEW velocities. Positions have not moved, so Omega itself is
       unchanged — only Omega' is needed, and `rateOnly` skips the sum that would recompute it. */
    w += 0.5 * dt * rateOnly();
  }

  function leap(h: number): void {
    drift(h / 2);
    kick(h);
    drift(h / 2);
  }

  function one(h: number): void {
    const before = t;
    if (order === 2) {
      leap(h);
    } else {
      leap(YOSHIDA_W1 * h);
      leap(YOSHIDA_W0 * h);
      leap(YOSHIDA_W1 * h);
    }
    lastPhysicalStep = t - before;
    s += h;
  }

  /* Calibrated once so the run BEGINS at the requested physical step, exactly as logh.ts does,
     which is what makes the two comparable at t = 0. */
  const hs = omega0 * (opts.maxStep ?? 1 / omega0);

  return {
    step(dt: number): void {
      if (!(dt > 0)) return;
      const target = t + dt;
      let guard = 0;
      const MAX = 1_000_000;
      while (t < target) {
        if (guard++ >= MAX) {
          throw new Error(
            `TTL exceeded ${MAX} fictitious steps advancing dt = ${dt}. Omega has grown far ` +
              `enough that the physical step has collapsed — a pair has hardened past what this ` +
              `configuration can follow.`,
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
    get w() {
      return w;
    },
    omegaNow(): number {
      return omegaAndRate().omega;
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
