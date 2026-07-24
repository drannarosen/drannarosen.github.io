/*
 * winds.ts — line-driven stellar winds (Layer 0, pure).
 *
 * Vink, de Koter & Lamers (2001), A&A 369, 574 — eqs (24) hot side and (25)
 * cool side of the bi-stability jump, with the jump temperature computed per
 * star from eqs (11) -> (23) -> (15) rather than fixed at 25 kK.
 *
 * The coefficients below were cross-checked in three independent places:
 *   - Vink et al. (2001) A&A 369, 574, eqs (24)/(25);
 *   - Rosen (2022) ApJ 941, 202, sec 2.4.3 eqs (14)/(15) (solar Z);
 *   - startrax src/startrax/hurley/sse/winds.py, itself verified against the
 *     rendered Vink PDF (its header notes: NOT OCR, NOT COMPAS).
 * All three agree coefficient-for-coefficient.
 *
 * v_inf and Mdot travel TOGETHER and must not be mixed with another
 * prescription: the Vink fit takes v_inf/v_esc as an INPUT term
 * (-1.601 log10[(v_inf/v_esc)/2.0]), so Mdot is evaluated AT an assumed ratio.
 */
import { clampMass } from "./sources.ts";

/* ── composition ──────────────────────────────────────────────────────────
 * The realizations are solar-metallicity by construction (progenax gravoturb),
 * and the export carries no per-star Z or surface hydrogen fraction, so both
 * are taken as solar here and stated rather than silently assumed. */
const Z_SUN = 0.02;
/** Surface hydrogen mass fraction; solar-composition ZAMS. Sets sigma_e. */
const X_H = 0.7;

/** Electron-scattering opacity [cm^2/g], sigma_e = 0.2(1+X). Lamers & Leitherer (1993). */
export function sigmaE(hydrogenX: number = X_H): number {
  return 0.2 * (1 + hydrogenX);
}

/**
 * Eddington factor for electron scattering — Vink et al. (2001) eq (11):
 *   Gamma_e = L sigma_e / (4 pi c G M) = 7.66e-5 sigma_e (L/Lsun) (M/Msun)^-1
 *
 * The ratio of radiative to gravitational acceleration. Both go as 1/r^2, so it
 * is radius-independent and acts as an effective-mass factor (1 - Gamma_e).
 */
export function gammaE(lSun: number, mSun: number, hydrogenX: number = X_H): number {
  return 7.66e-5 * sigmaE(hydrogenX) * (lSun / clampMass(mSun));
}

/* G in [pc (km/s)^2 / Msun] and Rsun in pc — same values/epoch as
 * core/feedback/sources.ts and the export pipeline (IAU 2015 nominal). */
const G_PC_KMS2_MSUN = 4.300917270e-3;
const RSUN_PC = 2.2546101516841093e-8;

/**
 * EFFECTIVE surface escape speed [km/s]: v_esc = sqrt(2 G M (1 - Gamma_e) / R).
 *
 * The (1 - Gamma_e) factor is not a correction bolted onto an escape velocity —
 * it IS the escape velocity, computed from the net inward acceleration the
 * outflowing gas actually feels once electron scattering has cancelled part of
 * gravity. The limiting case settles it: as Gamma_e -> 1 the star reaches the
 * Eddington limit, radiation alone supports the envelope, and material is
 * marginally unbound with vanishing effort, so v_esc must -> 0. The plain
 * sqrt(2GM/R) stays finite and large there, which is the wrong limit.
 *
 * It is also why v_inf/v_esc is an approximate CONSTANT (~2.6 for O stars;
 * Lamers et al. 1995): CAK ties v_inf to the effective escape speed, so
 * dividing by the plain value would make the ratio drift with L/M.
 *
 * Clamped at Gamma_e -> 1: at or above the Eddington limit the star is not
 * bound and a line-driven-wind escape speed has no meaning.
 */
export function effectiveEscapeSpeed(
  mSun: number,
  rSun: number,
  lSun: number,
  hydrogenX: number = X_H,
): number {
  const m = clampMass(mSun);
  const g = Math.min(gammaE(lSun, m, hydrogenX), 1);
  return Math.sqrt((2 * G_PC_KMS2_MSUN * m * (1 - g)) / (rSun * RSUN_PC));
}

/* ── bi-stability jump ────────────────────────────────────────────────────
 * Vink eqs (23) then (15): the jump sits near 25 kK but MOVES with metallicity
 * and Eddington factor, so it is computed per star. Fixing it at 25 kK would
 * put stars on the wrong branch near the boundary — where the mass-loss rate
 * changes by a factor of ~5 and v_inf by a factor of 2. */
const RHO_C0 = -14.94;
const RHO_CZ = 0.85;
const RHO_CG = 3.2;
const TJUMP_C0 = 61.2;
const TJUMP_CRHO = 2.59;

/** Bi-stability jump temperature [K] — Vink eqs (11) -> (23) -> (15). */
export function bistabilityTeff(
  lSun: number,
  mSun: number,
  z: number = Z_SUN,
  hydrogenX: number = X_H,
): number {
  const g = gammaE(lSun, mSun, hydrogenX);
  const logRho = RHO_C0 + RHO_CZ * Math.log10(z / Z_SUN) + RHO_CG * g; // eq (23)
  return 1e3 * (TJUMP_C0 + TJUMP_CRHO * logRho); // eq (15), kK -> K
}

/* v_inf/v_esc either side of the jump — Lamers et al. (1995) for Galactic
 * stars: ~2.6 earlier than B1, dropping to ~1.3 later. Vink sec 4. */
export const VRATIO_HOT = 2.6;
export const VRATIO_COOL = 1.3;
/** The fit's pivot in the -c*log10[(v_inf/v_esc)/2.0] term. */
const VPIVOT = 2.0;

/**
 * Cool-side validity floor [K]. Vink eq (25) is calibrated only for
 * Teff >= 12500 K; below it the line-driven recipe is UNDEFINED and Mdot is 0.
 * Not extrapolated — startrax records that COMPAS extrapolates below this floor
 * and that doing so is not paper-faithful. This gate is what makes the wind
 * budget selective by environment.
 */
export const VINK_TEFF_MIN = 12500;

/** Vink eq (24), hot side. log10 Mdot [Msun/yr]. */
function logMdotHot(logL5: number, logM30: number, teff: number, logZ: number): number {
  const lt = Math.log10(teff / 40000);
  return (
    -6.697 +
    2.194 * logL5 -
    1.313 * logM30 -
    1.226 * Math.log10(VRATIO_HOT / VPIVOT) +
    0.933 * lt -
    10.92 * lt * lt +
    0.85 * logZ
  );
}

/** Vink eq (25), cool side. log10 Mdot [Msun/yr]. */
function logMdotCool(logL5: number, logM30: number, teff: number, logZ: number): number {
  return (
    -6.688 +
    2.210 * logL5 -
    1.339 * logM30 -
    1.601 * Math.log10(VRATIO_COOL / VPIVOT) +
    1.07 * Math.log10(teff / 20000) +
    0.85 * logZ
  );
}

export interface Wind {
  /** Mass-loss rate [Msun/yr]; 0 below the calibration floor. */
  mdot: number;
  /** Terminal velocity [km/s]; 0 where there is no wind. */
  vInf: number;
  /** True on the hot side of the bi-stability jump. */
  hot: boolean;
}

/**
 * Line-driven wind for one star from the export's (mass, teff, radius) and the
 * luminosity derived from them. Returns zero below VINK_TEFF_MIN.
 */
export function starWind(
  mSun: number,
  teffK: number,
  rSun: number,
  lSun: number,
  z: number = Z_SUN,
  hydrogenX: number = X_H,
): Wind {
  if (!(teffK >= VINK_TEFF_MIN)) return { mdot: 0, vInf: 0, hot: false };

  const hot = teffK >= bistabilityTeff(lSun, mSun, z, hydrogenX);
  const logL5 = Math.log10(lSun / 1e5);
  const logM30 = Math.log10(clampMass(mSun) / 30);
  const logZ = Math.log10(z / Z_SUN);
  const logMdot = hot
    ? logMdotHot(logL5, logM30, teffK, logZ)
    : logMdotCool(logL5, logM30, teffK, logZ);

  const vEsc = effectiveEscapeSpeed(mSun, rSun, lSun, hydrogenX);
  return {
    mdot: 10 ** logMdot,
    vInf: (hot ? VRATIO_HOT : VRATIO_COOL) * vEsc,
    hot,
  };
}

/* ── population sums ──────────────────────────────────────────────────────
 * Injection terms follow Rosen (2022) sec 2.4.3: p_w = Mdot v_inf and
 * E_k,w = 1/2 Mdot v_inf^2. Returned as RATES; the ledger integrates them. */
export interface WindBudget {
  /** Total mass-loss rate [Msun/yr]. */
  mdot: number;
  /** Momentum injection rate [Msun km/s /yr]. */
  pDot: number;
  /** Kinetic-energy injection rate (mechanical luminosity) [Msun (km/s)^2 /yr]. */
  eDot: number;
  /** How many stars cleared the 12500 K calibration floor. */
  nDriving: number;
}

export function windBudget(
  mass: ArrayLike<number>,
  teff: ArrayLike<number>,
  radius: ArrayLike<number>,
  lum: ArrayLike<number>,
  z: number = Z_SUN,
): WindBudget {
  let mdot = 0;
  let pDot = 0;
  let eDot = 0;
  let nDriving = 0;
  for (let i = 0; i < mass.length; i++) {
    const w = starWind(mass[i]!, teff[i]!, radius[i]!, lum[i]!, z);
    if (w.mdot <= 0) continue;
    nDriving++;
    mdot += w.mdot;
    pDot += w.mdot * w.vInf;
    eDot += 0.5 * w.mdot * w.vInf * w.vInf;
  }
  return { mdot, pDot, eDot, nDriving };
}
