/*
 * gasExpulsion/index.ts — "does the cluster survive when the gas leaves?" (Layer 0, pure).
 *
 * Integrates an exported progenax population through a spherically-symmetric, time-dependent
 * potential as the natal gas drains away, and measures the bound fraction. Nothing here is
 * choreographed: the stars move because the potential changes, and the survival verdict is
 * read off the resulting energies.
 *
 * ── WHAT THIS FILE IS NOW, AND WHAT IT WAS ──
 *
 * It was `core/dynamics/index.ts`, 481 lines carrying its own leapfrog, its own radial
 * binning and its own shell potential. All three are now shared: `../integrate.ts` steps it
 * and `../meanField/` supplies the force. What is left is what is genuinely about GAS
 * EXPULSION — the draining cloud, the virial scaling, the settling protocol and the survival
 * verdict — which is the right size for one file.
 *
 * The move was made safe by capturing `scripts/fixtures/dynamics-gasexpulsion.json` FIRST,
 * in its own commit, against the old code. `check-dynamics` compares 69 quantities across
 * three star-formation efficiencies, so this rewrite is a rewrite only if those numbers hold.
 *
 * ── THE MODEL ──
 *
 *   a(r) = -G [M_star(<r) + M_gas(t) f(<r)] r / (r^2 + eps^2)^{3/2}
 *
 *   M_star(<r)  rebuilt every step from the current particle radii, so the cluster's own
 *               expansion feeds back on its own potential.
 *   f(<r)       the exported M_gas(<r)/M_gas table — progenax's truncated-EFF cloud profile,
 *               integrated at export time (gas_menc.f32).
 *   M_gas(t)    M_star (1-eps_SFE)/eps_SFE, decaying as exp(-t/tau) once expulsion begins.
 *
 * A 1-D spherical particle-mesh code. It captures the collective response — violent
 * relaxation, the expansion after gas loss — and deliberately omits two-body relaxation,
 * which is the standard semi-analytic treatment of this problem (Hills 1980; Lada, Margulis
 * & Dearborn 1984; Baumgardt & Kroupa 2007). Mass segregation in the dynamics is likewise
 * absent: every star feels the same M(<r). Use `../direct/` when those matter.
 *
 * ── GETTING TO A CLUSTER THAT IS ACTUALLY IN EQUILIBRIUM ──
 *
 * The classic gas-expulsion calculation assumes the stars are virialized in the EMBEDDED
 * potential when expulsion begins. The exported IC is not, in two separate ways, and both
 * had to be fixed before any survival number means anything.
 *
 *   1. It is deeply sub-virial (Q ~ 0.008). progenax normalizes the turbulent velocity field
 *      to sigma_g = mach * c_s — a cloud-turbulence prescription carrying no knowledge of the
 *      cloud's binding energy. Integrated raw it is a collapsing cloud, and the collapse is
 *      exactly the regime this solver cannot conserve energy through. So the run
 *      VIRIAL-SCALES first: the turbulent field's directions and spatial coherence are kept,
 *      its amplitude is set so Q = qTarget. This is what progenax applies in
 *      VelocitySpec(mode="virial_target"), which its gas path refuses.
 *
 *   2. Even at Q = 0.5 the star positions are not an equilibrium configuration of the smooth
 *      potential — they carry gravoturbulent substructure, and their velocity distribution is
 *      not the matching equilibrium DF. Left alone the system rearranges and sheds 6-30% of
 *      its mass with no gas expulsion at all, which would masquerade as expulsion unbinding
 *      it. So the run SETTLES for RELAX_TCROSS crossing times before expulsion is allowed,
 *      and survival is reported relative to the settled cluster.
 *
 * With both in place the no-expulsion control returns a survival fraction of exactly 1.000
 * across the whole SFE range.
 */
import { createLeapfrog, type Leapfrog } from "../integrate.ts";
import { createMeanFieldForce, type MeanFieldForce } from "../meanField/index.ts";
import { createState, type State } from "../types.ts";

/* Grid and softening are the values this model was measured with; `../meanField/` defaults to
   the same, and they are restated here because they are THIS model's calibration, not the
   force module's opinion. */
const NBINS = 320;
const R_MIN = 0.01; // pc
const R_MAX = 200.0; // pc
const SOFTENING = 0.02; // pc — far below the ~0.03 pc mean spacing at r_h

/* Leapfrog sub-steps per crossing time. Measured, not guessed: with the cluster virial-scaled
   to Q=0.5 the total-energy drift over 10 crossing times is -4.9e-3 at 100 sub-steps,
   -1.6e-4 at 200, +2.1e-4 at 400 and -1.0e-3 at 800, so 200 sits on the accuracy plateau at
   the lowest cost.

   The same measurement integrating the RAW sub-virial IC drifts ~60% and does NOT converge
   with sub-steps (0.89 / 1.28 / 0.61 / 0.55 / 0.60 / 0.60 at 100..3200). That is why the run
   virial-scales before integrating: a mean-field spherical solver does spurious work through
   a violent collapse, and this page's entire output is an energy verdict. */
const SUBSTEPS = 200;

/** Crossing times of settling before expulsion may begin. Measured: the bound mass fraction
 *  is identical at 30 and 60 crossing times, so the escaping population is fixed by 30 even
 *  though r_h still oscillates. */
export const RELAX_TCROSS = 30;

export interface DynamicsInit {
  /** n*6 star records (x,y,z,mass,teff,radius) — positions in pc, mass in Msun. */
  stars: Float32Array;
  /** n*3 velocities in pc/Myr, COM frame. */
  velocities: Float32Array;
  /** M_gas(<r)/M_gas on a uniform grid r = [0, gasMencRMax], from meta. */
  gasMenc: Float32Array;
  gasMencRMax: number;
  /** Gravitational constant in pc^3 / (Msun Myr^2). */
  G: number;
}

export interface DynamicsParams {
  /** Star-formation efficiency: M_star / (M_star + M_gas). */
  sfe: number;
  /** Gas removal e-folding time, in units of the initial crossing time. */
  tauOverTCross: number;
  /** Virial ratio the embedded cluster is scaled to at t=0. 0 disables scaling. */
  qTarget: number;
}

export type Phase = "settling" | "settled" | "expelling";

export interface Diagnostics {
  /** Time since the run began [Myr]. */
  t: number;
  /** Time since expulsion began [Myr]; negative while still relaxing. */
  tSinceExpulsion: number;
  phase: Phase;
  /** Virial ratio T/|W| in the CURRENT potential (gas included while present). */
  qVirial: number;
  /** Gas mass remaining [Msun]. */
  mGas: number;
  /** Fraction of stars (by number) with E < 0 in the current potential. */
  boundFraction: number;
  /** Fraction of stellar MASS that is bound — the quantity the literature quotes. */
  boundMassFraction: number;
  /** Half-mass radius [pc]. See the note in `diagnostics()` — this is not yet restricted to
   *  the bound stars, despite what it is measuring half of. */
  rHalf: number;
  /** Total energy of the stellar component [Msun (pc/Myr)^2] — for drift checks. */
  energy: number;
  /** Progress through the settling phase, 0..1. Reaches 1 when expulsion may begin. */
  settleProgress: number;
  /** Bound mass now / bound mass when expulsion began. 1 = nothing was lost. */
  survivingFraction: number;
  /** SFE inside the settled half-mass radius: M*(<r_h)/(M*(<r_h)+M_gas(<r_h)). */
  localSfe: number;
}

export interface Dynamics {
  /** Advance by dt [Myr]. Safe to call every animation frame. */
  step(dt: number): void;
  /** Rewind to the exported IC and re-arm the relaxation phase. */
  reset(): void;
  /** Change the run parameters. Implies reset(): the potential's depth changes. */
  setParams(p: Partial<DynamicsParams>): void;
  getParams(): DynamicsParams;
  /** Begin draining the gas now, whatever the relaxation phase is doing. */
  beginExpulsion(): void;
  /** Live positions, n*3 in pc — the renderer reads this in place. */
  readonly positions: Float32Array;
  diagnostics(): Diagnostics;
  /** Crossing time of the embedded system at the current SFE [Myr]. */
  readonly tCross: number;
  readonly n: number;
  readonly mStar: number;
}

export function createDynamics(init: DynamicsInit): Dynamics {
  const { stars, velocities, gasMenc, gasMencRMax, G } = init;
  const n = stars.length / 6;

  // ── immutable source arrays (reset() restores from these) ──
  const state: State = createState(n);
  const pos0 = new Float64Array(n * 3);
  const vel0 = new Float64Array(n * 3);
  for (let i = 0; i < n; i++) {
    const o = i * 6;
    state.mass[i] = stars[o + 3];
    pos0[i * 3] = stars[o];
    pos0[i * 3 + 1] = stars[o + 1];
    pos0[i * 3 + 2] = stars[o + 2];
    vel0[i * 3] = velocities[i * 3];
    vel0[i * 3 + 1] = velocities[i * 3 + 1];
    vel0[i * 3 + 2] = velocities[i * 3 + 2];
  }
  let mStar = 0;
  for (let i = 0; i < n; i++) mStar += state.mass[i];

  const posOut = new Float32Array(n * 3); // what the renderer reads
  const phi = new Float64Array(n); // scratch for per-star potentials

  // ── parameters and run state ──
  const params: DynamicsParams = { sfe: 0.3, tauOverTCross: 1, qTarget: 0.5 };
  let mGas0 = 0;
  let tCross = 1;
  let tExpel: number | null = null;
  let mBoundAtSettle: number | null = null;
  let localSfeSettled = 0;
  let phase: Phase = "settling";

  function gasMassAt(time: number): number {
    if (tExpel === null) return mGas0;
    const tau = params.tauOverTCross * tCross;
    return mGas0 * Math.exp(-(time - tExpel) / Math.max(tau, 1e-6));
  }

  /* The gas profile's SHAPE is static — only its mass decays — so the per-bin enclosed
     fraction and the potential per unit gas mass are computed once and scaled by M_gas(t).
     Both are evaluated at BIN EDGES rather than at each star's own radius, which is what the
     pre-refactor code did and what the frozen fixture therefore records. */
  const force: MeanFieldForce = createMeanFieldForce(n, {
    G,
    softening: SOFTENING,
    nBins: NBINS,
    rMin: R_MIN,
    rMax: R_MAX,
    external: {
      enclosedMass: (r, t) => gasMassAt(t) * fEncBin[force.binOf(r)],
      potential: (r, t) => gasMassAt(t) * phiGasUnit[force.binOf(r)],
    },
  });

  const fEncBin = new Float64Array(NBINS);
  const phiGasUnit = new Float64Array(NBINS);
  {
    const edge = force.binEdges;
    const dr = gasMencRMax / (gasMenc.length - 1);
    const fAt = (r: number): number => {
      if (r <= 0) return 0;
      if (r >= gasMencRMax) return 1;
      const x = r / dr;
      const j = Math.floor(x);
      const t = x - j;
      return gasMenc[j] * (1 - t) + gasMenc[j + 1] * t;
    };
    for (let k = 0; k < NBINS; k++) fEncBin[k] = fAt(edge[k]);
    // phiGasUnit(r) = -G [f(<r)/r + integral_r^inf df/r'], accumulated inward.
    let outer = 0;
    for (let k = NBINS - 1; k >= 0; k--) {
      phiGasUnit[k] = -G * (fEncBin[k] / Math.max(edge[k], SOFTENING) + outer);
      const fLo = k === 0 ? 0 : fEncBin[k - 1];
      const rMid = k === 0 ? edge[0] * 0.5 : 0.5 * (edge[k] + edge[k - 1]);
      outer += (fEncBin[k] - fLo) / Math.max(rMid, SOFTENING);
    }
  }

  let leap: Leapfrog = createLeapfrog(state, force, { maxStep: Infinity });

  /* Has the cluster settled? The tolerance matters: t accumulates one sub-step at a time, so
     an exact >= comparison can sit a few ulps short after integrating precisely RELAX_TCROSS
     crossing times, and silently refuse to ever start the expulsion. */
  const hasSettled = (): boolean => leap.t >= RELAX_TCROSS * tCross * (1 - 1e-9);

  /* Virial ratio Q = T/|W|.
   *
   * W here is the VIRIAL term -sum_i m_i r_i . grad(Phi_tot), which for a spherical potential
   * is -sum_i m_i G M_enc(<r_i)/r_i. That is NOT the potential ENERGY: the energy also counts
   * the mass exterior to each star, which contributes to Phi but exerts no net force and so
   * does not enter the virial theorem. The distinction is negligible for an isolated cluster
   * but large inside an extended gas cloud, where using the energy would over-heat the scaled
   * cluster by an SFE-dependent factor.
   *
   * This is why `../diagnostics.ts`'s generic Q = T/|U| is NOT used here: the two answer
   * different questions and only one of them is the right scaling target inside a cloud. */
  function measureQ(mg: number): number {
    force.refreshProfile(state.pos, state.mass);
    let kinetic = 0;
    let w = 0;
    for (let i = 0; i < n; i++) {
      const vx = state.vel[i * 3];
      const vy = state.vel[i * 3 + 1];
      const vz = state.vel[i * 3 + 2];
      const r = force.radii[i];
      const k = force.binOf(r);
      kinetic += 0.5 * state.mass[i] * (vx * vx + vy * vy + vz * vz);
      w += (state.mass[i] * G * (force.enclosedMass[k] + mg * fEncBin[k])) / Math.max(r, SOFTENING);
    }
    return w !== 0 ? kinetic / w : 0;
  }

  /* Freeze the reference quantities the moment the cluster settles, NOT when the user presses
     expel. r_h keeps oscillating after the bound population has stopped changing, so sampling
     it at press time made the reported local SFE depend on how quickly the reader clicked —
     it moved by ~6% between an immediate press and one a few seconds later. */
  function snapshotSettled(): void {
    const g = diagnostics();
    mBoundAtSettle = g.boundMassFraction * mStar;
    const rh = g.rHalf;
    let mStarIn = 0;
    for (let k = 0; k < NBINS; k++) {
      if (force.binEdges[k] > rh) break;
      mStarIn = force.enclosedMass[k];
    }
    const mGasIn = mGas0 * fEncBin[force.binOf(rh)];
    localSfeSettled = mStarIn + mGasIn > 0 ? mStarIn / (mStarIn + mGasIn) : 0;
  }

  function syncOut(): void {
    for (let i = 0; i < n * 3; i++) posOut[i] = state.pos[i];
  }

  function reset(): void {
    state.pos.set(pos0);
    state.vel.set(vel0);
    tExpel = null;
    phase = "settling";
    mBoundAtSettle = null;
    localSfeSettled = 0;
    mGas0 = (mStar * (1 - params.sfe)) / params.sfe;

    force.refreshProfile(state.pos, state.mass);
    /* Crossing time of the EMBEDDED system: t_cross = 2 r_h / sigma_virial, with sigma_virial
       from the virial theorem in the full embedded potential. Using the virial (rather than
       the IC's sub-virial) dispersion makes t_cross a property of the potential, so it stays
       meaningful while the cluster settles. */
    let rHalfNow = force.binEdges[NBINS - 1];
    for (let k = 0; k < NBINS; k++) {
      if (force.enclosedMass[k] >= 0.5 * mStar) {
        rHalfNow = force.binEdges[k];
        break;
      }
    }
    const mTot = mStar + mGas0;
    const sigmaVir = Math.sqrt((G * mTot) / Math.max(rHalfNow, SOFTENING));
    tCross = (2 * rHalfNow) / sigmaVir;

    // Virial scaling: keep the turbulent field's directions and spatial coherence, set its
    // amplitude so the embedded cluster starts at Q = qTarget. See the header.
    if (params.qTarget > 0) {
      const q = measureQ(mGas0);
      if (q > 0) {
        const s = Math.sqrt(params.qTarget / q);
        for (let i = 0; i < n * 3; i++) state.vel[i] *= s;
      }
    }

    /* A fresh integrator: t returns to 0 and the cached acceleration is rebuilt at the
       restored positions. Sub-stepping is bounded so the potential tracks a contraction
       rather than lagging a frame behind it. */
    leap = createLeapfrog(state, force, { maxStep: tCross / SUBSTEPS, t0: 0 });
    syncOut();
  }

  function diagnostics(): Diagnostics {
    const t = leap.t;
    const mg = gasMassAt(t);
    force.potentials(state.pos, state.mass, phi, t);

    let kinetic = 0;
    let boundN = 0;
    let boundM = 0;
    for (let i = 0; i < n; i++) {
      const vx = state.vel[i * 3];
      const vy = state.vel[i * 3 + 1];
      const vz = state.vel[i * 3 + 2];
      const v2 = vx * vx + vy * vy + vz * vz;
      kinetic += 0.5 * state.mass[i] * v2;
      // Boundness uses the FULL potential the star actually sits in, exterior shells included.
      if (0.5 * v2 + phi[i] < 0) {
        boundN++;
        boundM += state.mass[i];
      }
    }

    /* HALF-MASS RADIUS — reproduced exactly as it was before the refactor, INCLUDING a defect.
       The target is half the BOUND mass but the cumulation runs over ALL stars, so when a
       large unbound population sits at small radii the result is biased low. It is preserved
       here because this commit is a move: the frozen fixture certifies that nothing changed,
       and a fix bundled into a move is a fix nothing can verify. Corrected separately. */
    const target = 0.5 * boundM;
    let rHalf = 0;
    for (let k = 0; k < NBINS && boundM > 0; k++) {
      if (force.enclosedMass[k] >= target) {
        rHalf = force.binEdges[k];
        break;
      }
    }

    return {
      t,
      tSinceExpulsion: tExpel === null ? -1 : t - tExpel,
      phase,
      qVirial: measureQ(mg),
      mGas: mg,
      boundFraction: boundN / n,
      boundMassFraction: boundM / mStar,
      rHalf,
      energy: kinetic + force.potentialEnergy(state.pos, state.mass, t),
      settleProgress: Math.min(1, t / (RELAX_TCROSS * tCross)),
      survivingFraction: mBoundAtSettle ? boundM / mBoundAtSettle : 1,
      localSfe: localSfeSettled,
    };
  }

  reset();

  return {
    step(dt: number): void {
      leap.step(dt);
      if (tExpel !== null) phase = "expelling";
      else if (hasSettled() && phase === "settling") {
        phase = "settled";
        snapshotSettled();
      }
      syncOut();
    },
    reset,
    setParams(next) {
      Object.assign(params, next);
      reset();
    },
    getParams: () => ({ ...params }),
    beginExpulsion() {
      /* Refuse until the cluster has settled: before that, the mass it sheds is DF relaxation,
         not gas expulsion, and crediting it to the gas is exactly the error this protocol
         exists to avoid. */
      if (tExpel !== null || !hasSettled()) return;
      tExpel = leap.t;
      phase = "expelling";
    },
    positions: posOut,
    diagnostics,
    get tCross() {
      return tCross;
    },
    n,
    mStar,
  };
}
