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
 * Sanity: breakout occurs at only 2-4% of the pre-SN window, i.e. in the purely
 * adiabatic limit winds alone would disrupt every one of these clouds within
 * ~0.1 Myr. Real embedded clusters survive far longer, which is independent
 * evidence that f_leak sits near the leaky end — the same conclusion Lancaster,
 * Ostriker, Kim & Kim (2021) reach from mixing at a fractal interface, and their
 * "momentum 10-10^2 below Weaver" maps this eta_max of 30-71 onto eta ~ 1-7,
 * the momentum-driven floor.
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
