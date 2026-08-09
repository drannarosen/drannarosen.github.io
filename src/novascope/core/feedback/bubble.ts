/*
 * bubble.ts — the adiabatic wind-bubble ceiling (Layer 0, pure).
 *
 * Supplies eta_max: the momentum BOOST a wind bubble achieves in the
 * energy-conserving limit, which is the f_leak = 0 endpoint of the ledger's
 * leakage interpolation.
 *
 *   eta = p_shell / p_injected = (momentum delivered) / (Mdot v_inf t)
 *
 * eta = 1 is momentum-conserving: the shocked gas cools instantly, no PdV work,
 * the shell receives exactly the wind's own momentum. eta >> 1 is adiabatic: the
 * hot bubble does work on the swept shell, converting thermal energy into extra
 * momentum. Both endpoints are physically defined, which is what makes f_leak a
 * legitimate interpolation variable rather than a fudge — Fall, Krumholz &
 * Matzner (2010) use the same energy-driven / momentum-driven bracketing.
 *
 * DERIVED, not chosen, from Weaver, McCray, Castor, Shapiro & Moore (1977),
 * ApJ 218, 377 — eq (21), R = a (L_w t^3 / rho_0)^(1/5) with a = 0.76
 * (the paper notes the coefficient falls from 0.88 in the pure adiabatic
 * similarity solution, eq 5, to 0.76 once region (c) collapses; 0.76 is the
 * "classical Weaver77" value later work compares against):
 *
 *   v    = dR/dt = (3/5) R/t
 *   M_sh = (4/3) pi R^3 rho_0
 *   p_sh = M_sh v = (4 pi/5) rho_0 R^4 / t
 *   =>  eta = (4 pi/5)(a^4/2) v_inf (rho_0/L_w)^(1/5) t^(2/5)
 *
 * So eta_max is NOT a universal constant: it grows as t^(2/5) and depends on the
 * ambient density, the mechanical luminosity and the wind speed.
 */

/** Weaver+1977 eq (21) coefficient (with conduction; eq 5 gives 0.88). */
export const WEAVER_A = 0.76;

/* ── the calibration target for eta ───────────────────────────────────────
 * Lancaster, Kim, Kim, Ostriker & Bryan (2025), ApJ — "The Coevolution of
 * Stellar Wind-blown Bubbles and Photoionized Gas. II. 3D RMHD Simulations and
 * Tests of Semianalytic Models", sec 4.2 and Fig. 3, read from the paper PDF.
 *
 * Their "momentum enhancement factor" alpha_p is defined by their eq (4),
 * p(t) = alpha_p p_w,MD(t) — shell momentum over the momentum-driven
 * (injected) momentum. That is EXACTLY this module's eta, so their measured
 * values calibrate ours directly.
 *
 * Fig. 3 caption, time- and resolution-averaged over their simulations:
 *
 *   with LyC radiation      alpha_p = 4.66 (HWR), 6.20 (MWR)
 *   without LyC radiation   alpha_p = 2.55 (HW),  4.09 (MW)
 *   reference lines drawn at alpha_p = 3 and 8
 *
 * WE USE THE WITH-LyC PAIR, and the paper says why it is the right one: the
 * photoionized region sits at the bubble interface, so the wind no longer
 * touches neutral gas and cools less efficiently through Lyman-alpha. This
 * engine has a photoionization channel, so the irradiated case is ours.
 *
 * This REPLACES a paraphrase. The header used to reason from Lancaster et al.
 * (2021)'s "momentum 10-10^2 below Weaver" to "eta ~ 1-7" — a mapping performed
 * against Vink-era eta_max values, which silently stopped describing the code
 * when the default prescription became Björklund. A directly measured alpha_p
 * cannot drift that way.
 */
export const LANCASTER_ALPHA_P_LYC: readonly [number, number] = [4.66, 6.20];
export const LANCASTER_ALPHA_P_NO_LYC: readonly [number, number] = [2.55, 4.09];
/** The paper's own reference lines — the band a calibrated eta must sit in. */
export const LANCASTER_ALPHA_P_BRACKET: readonly [number, number] = [3, 8];
/** Geometric midpoint of the two with-LyC averages: the single target value. */
export const ALPHA_P_TARGET = Math.sqrt(
  LANCASTER_ALPHA_P_LYC[0] * LANCASTER_ALPHA_P_LYC[1],
);

/**
 * The leakage fraction f_leak that places eta at `targetEta`, given a bubble
 * ceiling `etaMax`. Inverts the ledger's interpolation
 * eta = 1 + (eta_max - 1)(1 - f_leak).
 */
export function windLeakForEta(etaMax: number, targetEta: number): number {
  if (!(etaMax > 1)) return 0;
  return 1 - (targetEta - 1) / (etaMax - 1);
}

/**
 * How the shell's porosity is coupled across channels.
 *
 * `C_f`, `f_vent` and `f_leak` are three consequences of ONE structure — how
 * full of holes the swept shell is — and KM09 use the same `C_f` for the
 * radiation term and for the hot wind gas (their eqs 24-25, where the hot fluid
 * "escapes through holes"). Treating them as independent let the shipped
 * defaults contradict each other: C_f = 0.5 says half the sky is holes while
 * f_vent = 0 says no hot gas escapes.
 *
 *  - `independent` — the historical behaviour. C_f drives radiation only,
 *    f_vent stays whatever the caller set. Kept so the change is measurable.
 *  - `simple`      — f_vent = 1 - C_f. Solid angle that is holes is the share
 *    of hot gas that escapes rather than pushing. Not derived; the minimal way
 *    to stop the two knobs disagreeing.
 *  - `km09`        — the porous bubble solved properly, `etaPorousKM09` below.
 *
 * See docs/feedback-derivations.md §M for both derivations and for why they
 * disagree with each other by a factor of ~5.
 */
export type PorosityCoupling = "independent" | "simple" | "km09";

/**
 * Momentum boost of a POROUS wind bubble — Krumholz & Matzner (2009) eqs
 * (26)-(30), reduced to its closed form.
 *
 * Their balance: the wind injects mass and energy into the hot interior; both
 * escape through the holes at rate proportional to (1 - C_f); ionized gas
 * ablates off the shell's inner face at a rate proportional to C_f (their eq
 * 26, after Canto & Raga 1991). In steady state with pressure balance
 * rho_II c_II^2 = rho_X c_X^2, eqs (27)-(28) eliminate c_X to give eq (29),
 *
 *   rho_X c_X^2 = [Mdot_w v_w / (4 pi r^2)] / [5(1-C_f)(1-1.045 C_f)]^(1/2)
 *
 * The force on the shell is 4 pi r^2 rho_X c_X^2 and the injected rate is
 * Mdot_w v_w, so with KM09's own simplification
 * (1-C_f)(1-1.045C_f) ~ (1-1.02C_f)^2 the boost depends on NOTHING but the
 * covering fraction.
 *
 * BOTH LIMITS ARE KM09'S OWN, and both are stated by them to be artefacts:
 *  - the floor at 1, because "values of f_trap,w less than f_w are not
 *    realistic, because the wind force is always present";
 *  - the divergence as C_f -> 1/1.02, which "is not real, as our neglect of
 *    adiabatic losses and of accumulation within the shell are incorrect when
 *    the holes close up".
 *
 * NOTE THE DISAGREEMENT THIS ENCODES. At KM09's own realistic C_f <= 1/2 this
 * returns exactly 1 — a purely momentum-driven bubble, no boost — against the
 * 4.5-6.5 that Lancaster+2025's measured alpha_p calibrates. Reproducing
 * Lancaster here needs C_f = 0.899, which KM09 call implausible. The two are
 * losing energy by different mechanisms (bulk escape vs turbulent mixing with
 * Lyman-alpha suppression); this function is selectable so the gap is visible
 * rather than buried in a default.
 */
export function etaPorousKM09(coveringFraction: number): number {
  const cf = Math.min(1, Math.max(0, coveringFraction));
  const denom = Math.sqrt(5) * (1 - 1.02 * cf);
  if (!(denom > 0)) return Infinity; // C_f past 1/1.02 — KM09's unreal divergence
  return Math.max(1, 1 / denom);
}

/** eta at a given leakage — the forward direction, for gates and callers. */
export function etaAtLeak(etaMax: number, fLeak: number): number {
  return 1 + (etaMax - 1) * (1 - fLeak);
}

/**
 * Calibrate one f_leak against a SPREAD of environment ceilings.
 *
 * eta_max varies environment to environment (it depends on ambient density and
 * mechanical luminosity), so no single f_leak puts every environment at the
 * target. Centering on the median overshoots the extremes — measured on the
 * shipped set it pushed `diffuse` under Vink to eta = 11.6, outside the paper's
 * 3-8 bracket. Centering the resulting RANGE geometrically keeps the whole set
 * inside it, which is the property that actually matters.
 */
export function calibrateWindLeak(
  etaMaxValues: readonly number[],
  targetEta: number = ALPHA_P_TARGET,
): number {
  const lo = Math.min(...etaMaxValues);
  const hi = Math.max(...etaMaxValues);
  if (!(lo > 1)) return 0;
  // Bisect on x = 1 - f_leak rather than solving the quadratic by hand: the
  // algebra is easy to get subtly wrong and this cannot be.
  const g = (x: number) =>
    Math.sqrt((1 + (lo - 1) * x) * (1 + (hi - 1) * x)) - targetEta;
  let a = 0;
  let b = 1;
  for (let i = 0; i < 200; i++) {
    const m = (a + b) / 2;
    if (g(m) > 0) b = m;
    else a = m;
  }
  return 1 - (a + b) / 2;
}

/* CGS conversions — IAU 2015 nominal solar mass; parsec; Julian year. */
const MSUN_G = 1.989e33;
const PC_CM = 3.086e18;
const YR_S = 3.156e7;
const MYR_S = 3.156e13;
const KMS_CMS = 1e5;

/** Adiabatic bubble radius [cm] at time t [s]. Weaver eq (21). */
export function weaverRadius(lWindErgS: number, rho0GCm3: number, tS: number): number {
  return WEAVER_A * Math.pow((lWindErgS * tS ** 3) / rho0GCm3, 0.2);
}

/**
 * Time [s] at which the adiabatic bubble reaches `rCm` — inverting eq (21).
 * Used to find BREAKOUT, when the bubble leaves the cloud.
 */
export function weaverTimeToRadius(
  lWindErgS: number,
  rho0GCm3: number,
  rCm: number,
): number {
  return Math.cbrt(((rCm / WEAVER_A) ** 5 * rho0GCm3) / lWindErgS);
}

export interface BubbleCeiling {
  /** Momentum boost in the adiabatic limit — the f_leak = 0 endpoint. */
  etaMax: number;
  /** Time the adiabatic bubble takes to reach the cloud radius [Myr]. */
  tBreakoutMyr: number;
  /** True if breakout happens before the budget window closes. */
  breaksOut: boolean;
}

/**
 * eta_max for one environment, evaluated AT BREAKOUT.
 *
 * Weaver assumes expansion into a uniform medium extending indefinitely. Past
 * the cloud radius there is no more cloud to sweep, so evaluating eta at the
 * full pre-SN window would report momentum delivered to material that is not
 * there: for these realizations the adiabatic bubble reaches 18-24 pc against
 * cloud radii of 2-3 pc, and eta would be inflated ~3-4x (137-260 rather than
 * 30-71). The ceiling that means anything for a BUDGET is the momentum
 * delivered to the cloud, so it is capped at breakout.
 *
 * Sanity: in the purely adiabatic limit winds alone would disrupt every one of
 * these clouds inside a small fraction of the pre-SN window. Real embedded
 * clusters survive far longer, which is independent evidence that f_leak sits
 * near the leaky end — the conclusion Lancaster et al. reach from mixing at the
 * bubble interface.
 *
 * MEASURED ON THE SHIPPED SET, 2026-08-09 — and the numbers depend on the wind
 * prescription, which is why the previous version of this paragraph went stale:
 *
 *   prescription   eta_max      breakout (% of window)
 *   Björklund      96.2-149.4   4.0-4.7
 *   Vink           30.4-71.0    2.3-3.9
 *
 * The old text stated 30-71 and 2-4% as if they were properties of the module.
 * They are Vink's, and the default had become Björklund. Any figure here is a
 * measurement of one configuration and must name it.
 *
 * f_leak is then CALIBRATED rather than chosen — see `calibrateWindLeak` and
 * WIND_LEAK_DEFAULT in ledger.ts — so that eta lands on Lancaster's measured
 * alpha_p instead of on a value picked to look reasonable.
 *
 * @param lWindErgS  total wind mechanical luminosity sum(1/2 Mdot v_inf^2) [erg/s]
 * @param pDotCgs    total wind momentum injection rate sum(Mdot v_inf) [g cm/s^2]
 * @param mCloudMsun cloud mass [Msun]
 * @param rCloudPc   cloud radius [pc]
 * @param windowMyr  budget window (pre-SN) [Myr]
 */
export function bubbleCeiling(
  lWindErgS: number,
  pDotCgs: number,
  mCloudMsun: number,
  rCloudPc: number,
  windowMyr: number,
): BubbleCeiling {
  if (!(lWindErgS > 0) || !(pDotCgs > 0)) {
    return { etaMax: 1, tBreakoutMyr: Infinity, breaksOut: false };
  }
  const rCm = rCloudPc * PC_CM;
  const rho0 = (mCloudMsun * MSUN_G) / ((4 / 3) * Math.PI * rCm ** 3);

  const tBreak = weaverTimeToRadius(lWindErgS, rho0, rCm);
  const tEval = Math.min(tBreak, windowMyr * MYR_S);

  const rb = weaverRadius(lWindErgS, rho0, tEval);
  const pShell = ((4 * Math.PI) / 5) * rho0 * rb ** 4 / tEval;
  const pInj = pDotCgs * tEval;

  return {
    // eta cannot fall below the momentum-conserving floor
    etaMax: Math.max(1, pShell / pInj),
    tBreakoutMyr: tBreak / MYR_S,
    breaksOut: tBreak <= windowMyr * MYR_S,
  };
}

/** Convert a wind budget in [Msun/yr, km/s] units to the CGS rates used here. */
export function windRatesToCgs(
  mdotMsunYr: number,
  vInfKmS: number,
): { lWindErgS: number; pDotCgs: number } {
  const mdot = (mdotMsunYr * MSUN_G) / YR_S;
  const v = vInfKmS * KMS_CMS;
  return { lWindErgS: 0.5 * mdot * v * v, pDotCgs: mdot * v };
}
