/*
 * sources.ts — per-star feedback SOURCES (Layer 0, pure).
 *
 * Turns the realization's exported (mass, teff, radius) into the quantities the
 * three channels consume: bolometric luminosity, surface escape speed, and the
 * ionizing photon rate. No DOM, no fetch, no renderer — the numbers must be
 * provable before anything draws them.
 *
 * Stellar properties come from the EXPORT (progenax's own teff/radius), never
 * re-derived here, so the stars the ledger reasons about are the stars the
 * scene renders.
 */
import { luminosity, msLifetime } from "../stellar/index.ts";
import { R_SUN_CM } from "../constants/index.ts";

/* ── mass clamp — the export's own bounds ─────────────────────────────────
 * progenax samples the IMF to 300 Msun (Maschberger, m_max=300) but computes
 * each star's teff/radius from mass CLIPPED to [0.08, 150]
 * (feasibility_figure.py: jnp.clip(masses, 0.08, 150.0)). Verified against the
 * data: the 195.3 Msun star in the `compact` realization carries exactly
 * zamsTeff(150) and zamsRadius(150).
 *
 * Every mass-dependent term here uses the SAME clip so each star's
 * (M, Teff, R, L) stay mutually consistent — pairing a 195 Msun mass with a
 * 150 Msun luminosity would understate Gamma_e by ~1.3x. These are progenax's
 * bounds, matched rather than chosen.
 *
 * Noted honestly: 150 already exceeds the Tout et al. (1996) validity ceiling
 * that core/stellar declares (M_MAX_VALID = 100). That extension is inherited
 * from the model that generated the data, not adopted here; core/stellar's
 * constant still states Tout's range and must not be edited to hide this.
 * Affected stars are few (7 above 100 Msun, 2 above 150, in `compact`) but they
 * are the most massive, so they dominate Q and the wind budget.
 */
export const MASS_MIN = 0.08;
export const MASS_MAX = 150;

/** Clamp a sampled mass to the export's stellar-property range. */
export function clampMass(mSun: number): number {
  return Math.min(MASS_MAX, Math.max(MASS_MIN, mSun));
}

/* ── constants ────────────────────────────────────────────────────────────
 * G in [pc (km/s)^2 / Msun]: IAU 2015 nominal GM_sun (1.327124400e20 m^3 s^-2)
 * / parsec (3.0856775814913673e16 m) / 1e6. Same value and epoch as
 * scripts/gravoturb/export_cluster.py, so the site and the data agree. */
const G_PC_KMS2_MSUN = 4.300917270e-3;

/** Solar radius in parsec: IAU 2015 nominal R_sun 6.957e8 m / parsec. */
const RSUN_PC = 2.2546101516841093e-8;

/** Solar radius in cm. IAU 2015 nominal — see @novascope/core/constants. */
const RSUN_CM = R_SUN_CM;

/**
 * Bolometric luminosity [Lsun] from the exported (teff [K], radius [Rsun]).
 * Thin re-export of core/stellar's Stefan-Boltzmann inverse — feedback does not
 * own that relation.
 */
export function starLuminosity(teffK: number, radiusRsun: number): number {
  return luminosity(teffK, radiusRsun);
}

/**
 * Surface escape speed [km/s], v_esc = sqrt(2GM/R).
 *
 * This is the STELLAR surface escape speed the Vink wind recipe scales its
 * terminal velocity to — not the cloud escape speed the ledger compares against.
 */
export function escapeSpeed(massMsun: number, radiusRsun: number): number {
  const m = clampMass(massMsun);
  return Math.sqrt((2 * G_PC_KMS2_MSUN * m) / (radiusRsun * RSUN_PC));
}

/**
 * Integration window for the v1 budget [Myr]: the time before the FIRST
 * supernova, i.e. t_MS of the most massive star present.
 *
 * v1 tallies photoionization, winds and radiation pressure — the pre-SN
 * channels — so the budget is only well posed up to the moment that set stops
 * being complete. Supernovae arrive with the time axis in v2.
 *
 * This is EMERGENT, not a knob: it falls out of each realization's own IMF draw
 * via Hurley, Pols & Tout (2000) t_MS, so a richer cluster samples a more
 * massive star and gets a SHORTER window (diffuse 5.65 Myr at 31 Msun; orion
 * 3.20; compact 3.07 before clamping). Mass is clamped to the export's range
 * first, so t_MS is evaluated at the same mass whose Teff/R the star carries.
 */
export function preSNWindowMyr(mass: ArrayLike<number>): number {
  let mMax = MASS_MIN;
  for (let i = 0; i < mass.length; i++) {
    const m = clampMass(mass[i]!);
    if (m > mMax) mMax = m;
  }
  return msLifetime(mMax);
}

/* ── ionizing photon rate ─────────────────────────────────────────────────
 * Sternberg, Hoffmann & Pauldrach (2003), ApJ, DOI 10.1086/379506,
 * arXiv:astro-ph/0312232 — Table 1, luminosity class V. WM-basic
 * radiation-driven wind atmospheres at solar metallicity.
 *
 * Per that table's header the stellar parameters (Teff, log g, R) are as
 * specified by Vacca, Garmany & Shull (1996); Sternberg et al. supply the
 * ionizing fluxes. Class V is correct here: the realization population is ZAMS.
 *
 * log_qH is the SURFACE flux [cm^-2 s^-1]; log_QH is the paper's total rate for
 * ITS radius. We interpolate q_H and multiply by OUR 4 pi R^2, so the export's
 * own radius is used rather than silently importing Vacca's. log_QH is retained
 * only so the gate can round-trip against the paper's own column.
 */
export interface SternbergRow {
  readonly sp: string;
  readonly teff: number;
  readonly rStar: number;
  readonly logQH: number;
  readonly logqH: number;
}

export const STERNBERG_CLASS_V: readonly SternbergRow[] = [
  { sp: "O3", teff: 51230, rStar: 13.2, logQH: 49.87, logqH: 24.84 },
  { sp: "O4", teff: 48670, rStar: 12.3, logQH: 49.68, logqH: 24.72 },
  { sp: "O4.5", teff: 47400, rStar: 11.8, logQH: 49.59, logqH: 24.66 },
  { sp: "O5", teff: 46120, rStar: 11.4, logQH: 49.49, logqH: 24.59 },
  { sp: "O5.5", teff: 44840, rStar: 11.0, logQH: 49.39, logqH: 24.52 },
  { sp: "O6", teff: 43560, rStar: 10.7, logQH: 49.29, logqH: 24.45 },
  { sp: "O6.5", teff: 42280, rStar: 10.3, logQH: 49.18, logqH: 24.37 },
  { sp: "O7", teff: 41010, rStar: 10.0, logQH: 49.06, logqH: 24.28 },
  { sp: "O7.5", teff: 39730, rStar: 9.6, logQH: 48.92, logqH: 24.17 },
  { sp: "O8", teff: 38450, rStar: 9.3, logQH: 48.75, logqH: 24.03 },
  { sp: "O8.5", teff: 37170, rStar: 9.0, logQH: 48.61, logqH: 23.92 },
  { sp: "O9", teff: 35900, rStar: 8.8, logQH: 48.47, logqH: 23.80 },
  { sp: "O9.5", teff: 34620, rStar: 8.5, logQH: 48.26, logqH: 23.62 },
  { sp: "B0", teff: 33340, rStar: 8.3, logQH: 48.02, logqH: 23.40 },
  { sp: "B0.5", teff: 32060, rStar: 8.0, logQH: 47.71, logqH: 23.12 },
] as const;

/** Cool edge of the Sternberg grid [K]. Below this the calibration does not exist. */
export const STERNBERG_TEFF_MIN = 32060;
/** Hot edge of the Sternberg grid [K]. */
export const STERNBERG_TEFF_MAX = 51230;

/**
 * Ionizing (Lyman-continuum) photon rate Q [s^-1] for one star.
 *
 * Q = 4 pi R^2 q_H(Teff), with log q_H interpolated linearly in Teff across the
 * Sternberg class-V grid and R taken from the CALLER (the export's radius).
 *
 * Returns exactly 0 below STERNBERG_TEFF_MIN. That gate is deliberate and
 * load-bearing: log Q_H falls by more than a factor of 100 from O3 to B0.5, so
 * cooler stars are negligible anyway — and extrapolating a calibration past its
 * range is precisely what would stop the budget being selective by environment.
 * Above the hot edge the top row is held (no extrapolation upward either).
 */
export function ionizingRate(teffK: number, radiusRsun: number): number {
  if (!(teffK >= STERNBERG_TEFF_MIN)) return 0;
  const t = Math.min(teffK, STERNBERG_TEFF_MAX);

  // rows run hot -> cool; find the bracketing pair
  const rows = STERNBERG_CLASS_V;
  let hi = 0;
  while (hi < rows.length - 1 && rows[hi + 1]!.teff > t) hi++;
  const a = rows[hi]!;
  const b = rows[Math.min(hi + 1, rows.length - 1)]!;

  let logq: number;
  if (a.teff === b.teff) {
    logq = a.logqH;
  } else {
    const f = (t - a.teff) / (b.teff - a.teff); // 0 at a (hotter), 1 at b (cooler)
    logq = a.logqH + f * (b.logqH - a.logqH);
  }

  const areaCm2 = 4 * Math.PI * (radiusRsun * RSUN_CM) ** 2;
  return areaCm2 * 10 ** logq;
}

/** Total ionizing rate S [s^-1] over a population. */
export function totalIonizingRate(
  teff: ArrayLike<number>,
  radius: ArrayLike<number>,
): number {
  let s = 0;
  for (let i = 0; i < teff.length; i++) s += ionizingRate(teff[i]!, radius[i]!);
  return s;
}

/** Total bolometric luminosity [Lsun] over a population. */
export function totalLuminosity(
  teff: ArrayLike<number>,
  radius: ArrayLike<number>,
): number {
  let l = 0;
  for (let i = 0; i < teff.length; i++) l += starLuminosity(teff[i]!, radius[i]!);
  return l;
}
