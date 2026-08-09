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
 * are taken as solar here and stated rather than silently assumed.
 *
 * EVERY RATE FUNCTION OWNS THE Z_sun ITS OWN PAPER NORMALIZES TO, AND TAKES AN
 * ABSOLUTE Z. Both metallicity terms are log10(Z/Z_sun) — Vink eqs (24)/(25)
 * and Björklund eq (7) alike — but Z_sun is NOT the same number in the two
 * papers, because they are written on different solar abundance scales:
 *
 *   Vink et al. (2001)       Z_sun = 0.02    classic ("old") solar — the same
 *                                            scale Tout et al. (1996) is
 *                                            normalized to, see core/stellar's
 *                                            Z_REF, and the scale this site's
 *                                            stellar layer works on throughout
 *   Björklund et al. (2023)  Z_sun = 0.014   their sec 3.1, verbatim: "Each
 *                                            model is calculated with a solar
 *                                            metallicity of Z_sun = 0.014"
 *
 * The anchor is therefore part of the published equation, not a caller's
 * choice: it is applied INSIDE each rate function and is not a parameter.
 * There is no argument a caller could get wrong, and no way for the two
 * recipes to share one.
 *
 * A single shared Z_SUN divided BOTH recipes by 0.02, silently evaluating
 * Björklund against an anchor 43% above its own. It produced no visible error
 * only because the default z equalled the shared anchor, so the term was
 * exactly log10(1) = 0 — a bug that fires the moment anyone passes a non-solar
 * composition. startrax hit the same class from the other direction (dividing
 * Björklund by jaxstro's 0.0134 until 2026-08-03); see its registry note on
 * bjorklund2023hotmassloss.
 *
 * `Z_ABS` is the realizations' metal mass fraction as an ABSOLUTE value. Anna
 * confirmed (2026-08-09) that 0.02 is the classic/old solar number, and it is
 * carried as an absolute abundance rather than as a "solar" label. So on
 * Björklund's 0.014 scale these stars are 1.43x solar and eq (7)'s metallicity
 * term fires (+0.134 dex, +31.3% in Mdot over the `orion` realization's
 * driving stars); under Vink the ratio is exactly 1 and the term vanishes.
 *
 * The constants are exported so a gate can assert each recipe is flat in Z at
 * its OWN anchor — the property that would break first if either drifted.
 */
/** Vink's normalization: classic ("old") solar. Applied inside the Vink branch. */
export const Z_SUN_VINK = 0.02;
/** Björklund's normalization, their sec 3.1. Applied inside eq (7). */
export const Z_SUN_BJORKLUND = 0.014;
/** Absolute metal mass fraction of the shipped realizations (classic solar). */
export const Z_ABS = 0.02;
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

/**
 * Bi-stability jump temperature [K] — Vink eqs (11) -> (23) -> (15).
 *
 * Vink's own relation, so it normalizes to Vink's Z_SUN_VINK internally.
 *
 * @param z ABSOLUTE metal mass fraction (not a ratio)
 */
export function bistabilityTeff(
  lSun: number,
  mSun: number,
  z: number = Z_ABS,
  hydrogenX: number = X_H,
): number {
  const g = gammaE(lSun, mSun, hydrogenX);
  const logRho = RHO_C0 + RHO_CZ * Math.log10(z / Z_SUN_VINK) + RHO_CG * g; // eq (23)
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

/**
 * Vink eq (24), hot side. log10 Mdot [Msun/yr].
 * Normalizes to Vink's own Z_SUN_VINK; `z` is an ABSOLUTE metal mass fraction.
 */
function logMdotHot(logL5: number, logM30: number, teff: number, z: number): number {
  const lt = Math.log10(teff / 40000);
  return (
    -6.697 +
    2.194 * logL5 -
    1.313 * logM30 -
    1.226 * Math.log10(VRATIO_HOT / VPIVOT) +
    0.933 * lt -
    10.92 * lt * lt +
    0.85 * Math.log10(z / Z_SUN_VINK)
  );
}

/**
 * Vink eq (25), cool side. log10 Mdot [Msun/yr].
 * Normalizes to Vink's own Z_SUN_VINK; `z` is an ABSOLUTE metal mass fraction.
 */
function logMdotCool(logL5: number, logM30: number, teff: number, z: number): number {
  return (
    -6.688 +
    2.210 * logL5 -
    1.339 * logM30 -
    1.601 * Math.log10(VRATIO_COOL / VPIVOT) +
    1.07 * Math.log10(teff / 20000) +
    0.85 * Math.log10(z / Z_SUN_VINK)
  );
}

/* ── Björklund et al. (2023) ──────────────────────────────────────────────
 * Björklund, Sundqvist, Singh, Puls & Najarro (2023), A&A 676, A109,
 * DOI 10.1051/0004-6361/202141948, arXiv:2203.08218 — eq (7), read from the
 * paper PDF. Dynamically-consistent models solving the steady-state
 * equation-of-motion with NLTE radiative transfer in the co-moving frame.
 *
 * Cited as "(2022)" here until 2026-08-09: that is the arXiv preprint year, and
 * the published record is 2023, A&A 676, A109 (the paper's own masthead). Same
 * DOI throughout, so the reference always resolved — which is exactly why the
 * wrong year survived.
 *
 *   log Mdot = -5.52 + 2.39 log(L/1e6 Lsun)
 *                    - 1.48 log(M_eff/45 Msun)
 *                    + 2.12 log(Teff/45 kK)
 *                    + [0.75 - 1.87 log(Teff/45 kK)] log(Z/Zsun)
 *
 * with M_eff = M(1 - Gamma_e) the EFFECTIVE stellar mass. That the modern fit
 * is written in the Eddington-reduced mass independently confirms the same
 * reasoning applied to v_esc above.
 *
 * Structurally different from Vink in three ways that matter here:
 *  - rates are ~3x LOWER for O stars;
 *  - there is NO bi-stability jump — the paper finds rates through that region
 *    follow the same scaling as O stars, so this is a single branch;
 *  - v_inf/v_esc,eff ~ 4.5 rather than 2.6, which is why the lower rate does
 *    NOT translate into a proportionally lower budget: momentum falls only
 *    ~1.7x and the mechanical luminosity is nearly unchanged.
 * The authors flag their own terminal speeds as high relative to observation.
 */
/*
 * v_inf / v_esc,eff — Björklund et al. (2023) sec 5.1, rendered PDF p. 9,
 * verbatim: "Across the grid, we have mean values of about 3300 km s^-1 and
 * v_inf/v_esc,eff ~ 4.5". Verified against the brain-library PDF, sha256
 * f59d24a2…906657 — the same copy startrax's registry audit is pinned to.
 *
 * It is the ratio against the EDDINGTON-REDUCED escape speed, which is why it
 * multiplies `effectiveEscapeSpeed` and not the plain sqrt(2GM/R); the paper
 * gives v_inf/v_esc ~ 4 for the unreduced one, and pairing 4.5 with the plain
 * speed would silently evaluate a different relation.
 *
 * TWO CAVEATS THAT TRAVEL WITH IT, both the paper's own.
 *
 * 1. It is a GRID MEAN, not a law. Björklund publish no v_inf(M, R, L) fit, so
 *    applying 4.5 per star is an extrapolation from a population mean — it
 *    carries the M-R dependence through v_esc,eff, which is the right scaling
 *    (CAK ties v_inf to the effective escape speed), but it is our composition
 *    and not their result.
 *
 * 2. That composition lands ABOVE their own grid. Their grid is built from MESA
 *    evolutionary tracks spanning the main sequence (sec 3.1); our stars are
 *    ZAMS Tout points, hence more compact. Measured over the shipped
 *    realizations: mean v_esc,eff = 1137-1151 km/s against the 733 km/s their
 *    3300/4.5 implies, so mean v_inf = 5115-5180 km/s — 1.55x their grid mean.
 *    Momentum scales with v and wind ENERGY with v^2, so the energy channel
 *    carries ~2.4x of this.
 *
 * The paper already flags its own 3300 km/s as "not generally found in the
 * observational literature" (sec 5.1) and offers candidate causes. Ours sits
 * further out still. This is a rung mismatch — an evolved-track coefficient on
 * a ZAMS backend — recorded rather than corrected, because correcting it would
 * mean inventing a v_inf law the paper does not publish.
 */
const BJ_VRATIO = 4.5;

/** Björklund validity box (their sec 4). Outside it the recipe is not defined. */
export const BJ_LOGL_MIN = 4.5;
export const BJ_LOGL_MAX = 6.0;
export const BJ_MASS_MIN = 15;
export const BJ_MASS_MAX = 80;
export const BJ_TEFF_MIN = 15000;
export const BJ_TEFF_MAX = 50000;

/** Which mass-loss prescription to use. */
export type WindPrescription = "bjorklund" | "vink";

export interface Wind {
  /** Mass-loss rate [Msun/yr]; 0 below the calibration floor. */
  mdot: number;
  /** Terminal velocity [km/s]; 0 where there is no wind. */
  vInf: number;
  /** True on the hot side of the bi-stability jump (Vink only; false for Björklund). */
  hot: boolean;
  /** True when the star fell outside the prescription's stated validity box. */
  outOfRange?: boolean;
}

/**
 * Björklund eq (7). log10 Mdot [Msun/yr]. Single branch — no bi-stability.
 *
 * The metallicity exponent q(Teff) = 0.75 - 1.87 log10(Teff/45000) is NOT a
 * constant: the paper found q correlates with log Teff rather than log L and
 * re-derived the fit on that basis, so q grows toward cooler stars (~1.41 at
 * 20 kK against 0.75 at 45 kK). An error in the metallicity RATIO is therefore
 * amplified at low Teff — which is the reason this recipe must normalize to its
 * OWN Z_SUN_BJORKLUND (0.014) and never to a shared or caller-supplied anchor.
 *
 * @param z ABSOLUTE metal mass fraction (not a ratio)
 */
function logMdotBjorklund(
  lSun: number,
  mEff: number,
  teff: number,
  z: number,
): number {
  const lt = Math.log10(teff / 45000);
  return (
    -5.52 +
    2.39 * Math.log10(lSun / 1e6) -
    1.48 * Math.log10(mEff / 45) +
    2.12 * lt +
    (0.75 - 1.87 * lt) * Math.log10(z / Z_SUN_BJORKLUND)
  );
}

/**
 * Line-driven wind for one star from the export's (mass, teff, radius) and the
 * luminosity derived from them.
 *
 * Returns zero outside the chosen prescription's calibrated range rather than
 * extrapolating, and marks `outOfRange` when a star is dropped, so a caller can
 * report how much of the population a recipe actually covers instead of
 * silently summing over a subset.
 *
 * @param z ABSOLUTE metal mass fraction (not a ratio); defaults to the
 *          realizations' Z_ABS = 0.02. Each branch normalizes it to ITS OWN
 *          paper's Z_sun internally — see the composition note at the top of
 *          this file — so there is no anchor for a caller to get wrong.
 */
export function starWind(
  mSun: number,
  teffK: number,
  rSun: number,
  lSun: number,
  z: number = Z_ABS,
  hydrogenX: number = X_H,
  prescription: WindPrescription = "bjorklund",
): Wind {
  const vEsc = effectiveEscapeSpeed(mSun, rSun, lSun, hydrogenX);

  if (prescription === "bjorklund") {
    const m = clampMass(mSun);
    const inRange =
      Math.log10(lSun) >= BJ_LOGL_MIN &&
      Math.log10(lSun) <= BJ_LOGL_MAX &&
      m >= BJ_MASS_MIN &&
      m <= BJ_MASS_MAX &&
      teffK >= BJ_TEFF_MIN &&
      teffK <= BJ_TEFF_MAX;
    if (!inRange) return { mdot: 0, vInf: 0, hot: false, outOfRange: true };
    const mEff = m * (1 - Math.min(gammaE(lSun, m, hydrogenX), 1));
    if (!(mEff > 0)) return { mdot: 0, vInf: 0, hot: false, outOfRange: true };
    return {
      mdot: 10 ** logMdotBjorklund(lSun, mEff, teffK, z),
      vInf: BJ_VRATIO * vEsc,
      hot: false,
    };
  }

  // Vink: Mdot and v_inf must travel together — the fit takes v_inf/v_esc as an
  // input term, so the branch choice sets both.
  if (!(teffK >= VINK_TEFF_MIN)) return { mdot: 0, vInf: 0, hot: false, outOfRange: true };
  const hot = teffK >= bistabilityTeff(lSun, mSun, z, hydrogenX);
  const logL5 = Math.log10(lSun / 1e5);
  const logM30 = Math.log10(clampMass(mSun) / 30);
  const logMdot = hot
    ? logMdotHot(logL5, logM30, teffK, z)
    : logMdotCool(logL5, logM30, teffK, z);
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
  /** How many stars cleared the prescription's calibration range. */
  nDriving: number;
  /** How many were dropped as outside it — reported, never hidden. */
  nOutOfRange: number;
}

/**
 * @param z ABSOLUTE metal mass fraction; defaults to the realizations' Z_ABS.
 *          Each recipe normalizes it to its own paper's Z_sun internally.
 */
export function windBudget(
  mass: ArrayLike<number>,
  teff: ArrayLike<number>,
  radius: ArrayLike<number>,
  lum: ArrayLike<number>,
  z: number = Z_ABS,
  prescription: WindPrescription = "bjorklund",
): WindBudget {
  let mdot = 0;
  let pDot = 0;
  let eDot = 0;
  let nDriving = 0;
  let nOutOfRange = 0;
  for (let i = 0; i < mass.length; i++) {
    const w = starWind(mass[i]!, teff[i]!, radius[i]!, lum[i]!, z, X_H, prescription);
    if (w.mdot <= 0) {
      if (w.outOfRange) nOutOfRange++;
      continue;
    }
    nDriving++;
    mdot += w.mdot;
    pDot += w.mdot * w.vInf;
    eDot += 0.5 * w.mdot * w.vInf * w.vInf;
  }
  return { mdot, pDot, eDot, nDriving, nOutOfRange };
}
