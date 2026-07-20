/*
 * dynamics.ts — live stellar dynamics for "does the cluster survive?".
 *
 * Integrates the 10,000 exported progenax stars through a spherically-symmetric,
 * time-dependent potential as the natal gas drains away, and measures the bound
 * fraction. Nothing here is choreographed: the stars move because the potential
 * changes, and the survival verdict is read off the resulting energies.
 *
 * ── The model ───────────────────────────────────────────────────────────────
 * Potential = stars + gas, both spherical:
 *
 *   a(r) = -G [M_star(<r) + M_gas(t) f(<r)] r / (r^2 + eps^2)^{3/2}
 *
 *   M_star(<r)  recomputed every step from the current particle radii, so the
 *               cluster's own expansion feeds back on its own potential.
 *   f(<r)       the exported M_gas(<r)/M_gas table — progenax's truncated-EFF
 *               cloud profile, integrated at export time (gas_menc.f32).
 *   M_gas(t)    M_star (1-eps_SFE)/eps_SFE, decaying as exp(-t/tau) once
 *               expulsion begins.
 *
 * This is a 1-D spherical particle-mesh ("shell") code. It captures the
 * collective response — violent relaxation, the expansion after gas loss — and
 * deliberately omits two-body relaxation, which is the standard semi-analytic
 * treatment of this problem (Hills 1980; Lada, Margulis & Dearborn 1984;
 * Baumgardt & Kroupa 2007). Mass segregation in the dynamics is likewise absent:
 * every star feels the same M(<r).
 *
 * ── Getting to a cluster that is actually in equilibrium ────────────────────
 * The classic gas-expulsion calculation assumes the stars are virialized in the
 * EMBEDDED potential when expulsion begins. The exported IC is not, in two
 * separate ways, and both had to be fixed before any survival number means
 * anything. Both fixes are measured; see the constants below for the numbers.
 *
 *   1. It is deeply sub-virial (Q ~ 0.008). progenax normalizes the turbulent
 *      velocity field to sigma_g = mach * c_s — a cloud-turbulence prescription
 *      that carries no knowledge of the cloud's binding energy. Integrated raw
 *      it is a collapsing cloud, and the collapse is exactly the regime this
 *      solver cannot conserve energy through. So the run VIRIAL-SCALES first:
 *      the turbulent field's directions and spatial coherence are kept, its
 *      amplitude is set so Q = qTarget. This is the operation progenax applies
 *      in VelocitySpec(mode="virial_target"), which its gas path refuses.
 *
 *   2. Even at Q = 0.5 the star positions are not an equilibrium configuration
 *      of the smooth potential — they carry gravoturbulent substructure, and
 *      their velocity distribution is not the matching equilibrium DF. Left
 *      alone the system rearranges and sheds 6-30% of its mass with no gas
 *      expulsion at all, which would masquerade as expulsion unbinding it. So
 *      the run SETTLES for RELAX_TCROSS crossing times before expulsion is
 *      allowed, and survival is reported relative to the settled cluster.
 *
 * With both in place the no-expulsion control returns a survival fraction of
 * exactly 1.000 across the whole SFE range — which is what makes the numbers
 * the page reports trustworthy.
 */

/** Radial grid for the binned mass profile. Log-spaced: the core needs the
 *  resolution, and escapers run to large radii where precision does not matter. */
const NBINS = 320;
const R_MIN = 0.01; // pc — inside this everything lands in bin 0
const R_MAX = 200.0; // pc — beyond this everything lands in the last bin
const LOG_R_MIN = Math.log(R_MIN);
const LOG_R_MAX = Math.log(R_MAX);
const INV_DLOG = NBINS / (LOG_R_MAX - LOG_R_MIN);

/** Force softening [pc]. The mean interparticle spacing at the half-mass radius
 *  is ~r_h/N^(1/3) ~ 0.03 pc; this only regularizes r -> 0 in the binned
 *  profile and is far below any structure the piece resolves. */
const SOFTENING = 0.02;

/* Leapfrog sub-steps per crossing time. Measured, not guessed: with the cluster
   virial-scaled to Q=0.5 the total-energy drift over 10 crossing times is
   -4.9e-3 at 100 sub-steps, -1.6e-4 at 200, +2.1e-4 at 400 and -1.0e-3 at 800,
   so 200 sits on the accuracy plateau at the lowest cost.

   The same measurement integrating the RAW sub-virial IC drifts ~60% and does
   NOT converge with sub-steps (0.89 / 1.28 / 0.61 / 0.55 / 0.60 / 0.60 at
   100..3200). That is why the run virial-scales before integrating: a mean-field
   spherical solver does spurious work through a violent collapse, and this
   page's entire output is an energy verdict. */
const SUBSTEPS = 200;

/** Crossing times of settling before expulsion may begin. Measured: the bound
 *  mass fraction is identical at 30 and 60 crossing times (0.938/0.938,
 *  0.911/0.911, 0.786/0.786 at SFE 0.05/0.20/0.50), so the escaping population
 *  is fixed by 30 even though r_h still oscillates. */
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
  /** Half-mass radius of the bound stars [pc]. */
  rHalf: number;
  /** Total energy of the stellar component [Msun (pc/Myr)^2] — for drift checks. */
  energy: number;
  /** Progress through the settling phase, 0..1. Reaches 1 when expulsion may begin. */
  settleProgress: number;
  /* ── the two numbers the page is actually about ── */
  /** Bound mass now / bound mass when expulsion began. 1 = nothing was lost.
   *  Reported relative to the SETTLED cluster, so the DF-relaxation losses that
   *  happen with or without expulsion are not miscredited to the gas. */
  survivingFraction: number;
  /** SFE inside the settled half-mass radius: M*(<r_h)/(M*(<r_h)+M_gas(<r_h)).
   *  Far exceeds the global SFE, because the stars formed in the densest gas —
   *  which is why the cluster survives expulsion the classic global-SFE
   *  calculation says should destroy it. */
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

/** Bin index for a radius, clamped to the grid. */
function binOf(r: number): number {
  if (r <= R_MIN) return 0;
  const k = Math.floor((Math.log(r) - LOG_R_MIN) * INV_DLOG);
  return k >= NBINS ? NBINS - 1 : k;
}

/** Outer edge radius of bin k. */
function binEdge(k: number): number {
  return Math.exp(LOG_R_MIN + (k + 1) / INV_DLOG);
}

export function createDynamics(init: DynamicsInit): Dynamics {
  const { stars, velocities, gasMenc, gasMencRMax, G } = init;
  const n = stars.length / 6;

  // ── immutable source arrays (reset() restores from these) ──
  const mass = new Float64Array(n);
  const pos0 = new Float64Array(n * 3);
  const vel0 = new Float64Array(n * 3);
  for (let i = 0; i < n; i++) {
    const o = i * 6;
    mass[i] = stars[o + 3];
    pos0[i * 3] = stars[o];
    pos0[i * 3 + 1] = stars[o + 1];
    pos0[i * 3 + 2] = stars[o + 2];
    vel0[i * 3] = velocities[i * 3];
    vel0[i * 3 + 1] = velocities[i * 3 + 1];
    vel0[i * 3 + 2] = velocities[i * 3 + 2];
  }
  let mStar = 0;
  for (let i = 0; i < n; i++) mStar += mass[i];

  // ── live state ──
  const p = new Float64Array(n * 3);
  const v = new Float64Array(n * 3);
  const acc = new Float64Array(n * 3);
  const posOut = new Float32Array(n * 3); // what the renderer reads
  const radius = new Float64Array(n);

  // ── binned profile scratch ──
  const binMass = new Float64Array(NBINS); // stellar mass in each bin
  const mEnc = new Float64Array(NBINS); // stellar M(<outer edge of bin)
  const phiOuter = new Float64Array(NBINS); // sum_{k'>k} m_k' / r_k' (stellar)
  const edge = new Float64Array(NBINS);
  for (let k = 0; k < NBINS; k++) edge[k] = binEdge(k);

  /* Gas potential per unit gas mass, on the bin grid. The gas profile's SHAPE is
     static — only its mass decays — so this is computed once and scaled by
     M_gas(t) every step. phiGasUnit(r) = -G [f(<r)/r + \int_r^inf df/r']. */
  const phiGasUnit = new Float64Array(NBINS);
  const fEncBin = new Float64Array(NBINS); // f(<r) at each bin edge
  {
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
    // outer integral, accumulated inward: \int_r^inf df(r')/r'
    let outer = 0; // sum over shells STRICTLY outside bin k (see buildProfile)
    for (let k = NBINS - 1; k >= 0; k--) {
      phiGasUnit[k] = -G * (fEncBin[k] / Math.max(edge[k], SOFTENING) + outer);
      const fLo = k === 0 ? 0 : fEncBin[k - 1];
      const rMid = k === 0 ? edge[0] * 0.5 : 0.5 * (edge[k] + edge[k - 1]);
      outer += (fEncBin[k] - fLo) / Math.max(rMid, SOFTENING);
    }
  }

  // ── parameters ──
  const params: DynamicsParams = { sfe: 0.3, tauOverTCross: 1, qTarget: 0.5 };
  let mGas0 = 0;
  let tCross = 1;
  let t = 0;
  let tExpel: number | null = null; // time at which expulsion began
  let mBoundAtExpulsion: number | null = null; // bound mass of the settled cluster
  let localSfeAtExpulsion = 0;
  let phase: Phase = "settling";

  /* Has the cluster settled? The tolerance matters: t accumulates one sub-step
     at a time, so an exact >= comparison can sit a few ulps short of the
     threshold after integrating precisely RELAX_TCROSS crossing times, and
     silently refuse to ever start the expulsion. */
  function hasSettled(): boolean {
    return t >= RELAX_TCROSS * tCross * (1 - 1e-9);
  }

  /** Rebuild the stellar M(<r) profile from the current positions. O(n). */
  function buildProfile(): void {
    binMass.fill(0);
    for (let i = 0; i < n; i++) {
      const x = p[i * 3], y = p[i * 3 + 1], z = p[i * 3 + 2];
      const r = Math.sqrt(x * x + y * y + z * z);
      radius[i] = r;
      binMass[binOf(r)] += mass[i];
    }
    let cum = 0;
    for (let k = 0; k < NBINS; k++) {
      cum += binMass[k];
      mEnc[k] = cum;
    }
    /* phiOuter[k] = sum over shells STRICTLY OUTSIDE bin k of m/r — the part of
       the potential that mass exterior to the star contributes. Bin k's own mass
       is already carried by mEnc[k]/edge[k], so it must not appear here too. */
    let outer = 0;
    for (let k = NBINS - 1; k >= 0; k--) {
      phiOuter[k] = outer;
      const rMid = k === 0 ? edge[0] * 0.5 : 0.5 * (edge[k] + edge[k - 1]);
      outer += binMass[k] / Math.max(rMid, SOFTENING);
    }
  }

  function gasMassAt(time: number): number {
    if (tExpel === null) return mGas0;
    const tau = params.tauOverTCross * tCross;
    return mGas0 * Math.exp(-(time - tExpel) / Math.max(tau, 1e-6));
  }

  /** Accelerations from the current profile + the gas mass at time `time`. */
  function computeAcc(time: number): void {
    const mg = gasMassAt(time);
    for (let i = 0; i < n; i++) {
      const r = radius[i];
      const k = binOf(r);
      const mIn = mEnc[k] + mg * fEncBin[k];
      const soft = r * r + SOFTENING * SOFTENING;
      const f = (-G * mIn) / (soft * Math.sqrt(soft));
      acc[i * 3] = f * p[i * 3];
      acc[i * 3 + 1] = f * p[i * 3 + 1];
      acc[i * 3 + 2] = f * p[i * 3 + 2];
    }
  }

  /** Potential per unit mass at bin k from the STARS alone. */
  function phiStarAt(k: number): number {
    return -G * (mEnc[k] / Math.max(edge[k], SOFTENING) + phiOuter[k]);
  }

  /* Virial ratio Q = T/|W|, equal to 1/2 in equilibrium.
   *
   * W here is the VIRIAL term -sum_i m_i r_i . grad(Phi_tot), which for a
   * spherical potential is -sum_i m_i G M_enc(<r_i)/r_i. That is NOT the
   * potential ENERGY: the energy also counts the mass exterior to each star,
   * which contributes to Phi but exerts no net force and so does not enter the
   * virial theorem. The distinction is negligible for an isolated cluster but
   * large inside an extended gas cloud, where using the energy would over-heat
   * the scaled cluster by an SFE-dependent factor.
   *
   * Boundness (diagnostics) correctly uses the potential ENERGY instead: escape
   * is set by Phi, not by the local force. */
  function measureQ(mg: number): number {
    let kinetic = 0;
    let w = 0;
    for (let i = 0; i < n; i++) {
      const vx = v[i * 3], vy = v[i * 3 + 1], vz = v[i * 3 + 2];
      const r = radius[i];
      const k = binOf(r);
      kinetic += 0.5 * mass[i] * (vx * vx + vy * vy + vz * vz);
      w += (mass[i] * G * (mEnc[k] + mg * fEncBin[k])) / Math.max(r, SOFTENING);
    }
    return w !== 0 ? kinetic / w : 0;
  }

  function reset(): void {
    p.set(pos0);
    v.set(vel0);
    t = 0;
    tExpel = null;
    phase = "settling";
    mBoundAtExpulsion = null;
    localSfeAtExpulsion = 0;
    mGas0 = mStar * (1 - params.sfe) / params.sfe;
    buildProfile();
    /* Crossing time of the EMBEDDED system: t_cross = 2 r_h / sigma_virial, with
       sigma_virial from the virial theorem in the full embedded potential. Using
       the virial (rather than the IC's sub-virial) dispersion makes t_cross a
       property of the potential, so it stays meaningful while it settles. */
    let mCum = 0;
    let rHalfNow = edge[NBINS - 1];
    for (let k = 0; k < NBINS; k++) {
      mCum += binMass[k];
      if (mCum >= 0.5 * mStar) { rHalfNow = edge[k]; break; }
    }
    const mTot = mStar + mGas0;
    const sigmaVir = Math.sqrt((G * mTot) / Math.max(rHalfNow, SOFTENING));
    tCross = (2 * rHalfNow) / sigmaVir;

    /* Virial scaling: keep the turbulent field's DIRECTIONS and spatial coherence,
       set its amplitude so the embedded cluster starts at Q = qTarget. This is the
       operation progenax applies in VelocitySpec(mode="virial_target"), which its
       gas path refuses — so it is applied here instead of integrating the deeply
       sub-virial IC through a collapse the mean-field solver cannot conserve
       energy through. See the header note on the sub-virial IC. */
    if (params.qTarget > 0) {
      const q = measureQ(mGas0);
      if (q > 0) {
        const s = Math.sqrt(params.qTarget / q);
        for (let i = 0; i < n * 3; i++) v[i] *= s;
      }
    }
    computeAcc(0);
    syncOut();
  }

  function syncOut(): void {
    for (let i = 0; i < n * 3; i++) posOut[i] = p[i];
  }

  function step(dt: number): void {
    // Leapfrog KDK. Sub-step so the core stays resolved when the cluster
    // collapses: the profile is rebuilt each sub-step, so the potential tracks
    // the contraction rather than lagging a frame behind it.
    const nSub = Math.max(1, Math.ceil(dt / (tCross / SUBSTEPS)));
    const h = dt / nSub;
    for (let s = 0; s < nSub; s++) {
      const hh = 0.5 * h;
      for (let i = 0; i < n * 3; i++) v[i] += acc[i] * hh;
      for (let i = 0; i < n * 3; i++) p[i] += v[i] * h;
      t += h;
      buildProfile();
      computeAcc(t);
      for (let i = 0; i < n * 3; i++) v[i] += acc[i] * hh;
    }
    if (tExpel !== null) phase = "expelling";
    else if (hasSettled()) phase = "settled";
    syncOut();
  }

  function diagnostics(): Diagnostics {
    const mg = gasMassAt(t);
    let kinetic = 0;
    let wStar = 0; // stellar self-energy: 1/2 factor, pairs counted twice
    let uGas = 0; // energy in the EXTERNAL gas potential: no 1/2 factor
    let boundN = 0;
    let boundM = 0;
    for (let i = 0; i < n; i++) {
      const vx = v[i * 3], vy = v[i * 3 + 1], vz = v[i * 3 + 2];
      const v2 = vx * vx + vy * vy + vz * vz;
      const k = binOf(radius[i]);
      const phiStar = phiStarAt(k);
      const phiGas = mg * phiGasUnit[k];
      kinetic += 0.5 * mass[i] * v2;
      wStar += 0.5 * mass[i] * phiStar;
      uGas += mass[i] * phiGas;
      // Boundness uses the FULL potential the star actually sits in.
      if (0.5 * v2 + phiStar + phiGas < 0) { boundN++; boundM += mass[i]; }
    }
    const potential = wStar + uGas;
    // Half-mass radius of the BOUND stars.
    const target = 0.5 * boundM;
    let cum = 0;
    let rHalf = 0;
    for (let k = 0; k < NBINS && boundM > 0; k++) {
      cum += binMass[k];
      if (cum >= target) { rHalf = edge[k]; break; }
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
      energy: kinetic + potential,
      settleProgress: Math.min(1, t / (RELAX_TCROSS * tCross)),
      survivingFraction: mBoundAtExpulsion ? boundM / mBoundAtExpulsion : 1,
      localSfe: localSfeAtExpulsion,
    };
  }

  reset();

  return {
    step,
    reset,
    setParams(next) {
      Object.assign(params, next);
      reset();
    },
    getParams: () => ({ ...params }),
    beginExpulsion() {
      /* Refuse until the cluster has settled: before that, the mass it sheds is
         DF relaxation, not gas expulsion, and crediting it to the gas is exactly
         the error this whole protocol exists to avoid. */
      if (tExpel !== null || !hasSettled()) return;
      tExpel = t;
      phase = "expelling";
      const g = diagnostics();
      mBoundAtExpulsion = g.boundMassFraction * mStar;
      // Local SFE inside the settled half-mass radius, frozen at this moment.
      const rh = g.rHalf;
      let mStarIn = 0;
      for (let k = 0; k < NBINS; k++) { if (edge[k] > rh) break; mStarIn += binMass[k]; }
      const mGasIn = mGas0 * fEncBin[binOf(rh)];
      localSfeAtExpulsion = mStarIn + mGasIn > 0 ? mStarIn / (mStarIn + mGasIn) : 0;
    },
    positions: posOut,
    diagnostics,
    get tCross() { return tCross; },
    n,
    mStar,
  };
}
