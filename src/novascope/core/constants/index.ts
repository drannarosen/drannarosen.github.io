/*
 * constants/index.ts — the ONE home for physical constants (Layer 0).
 *
 * ADR 0012 declared this module as part of the science core; it was never built,
 * so the same IAU 2015 nominal values ended up declared independently in
 * core/feedback/radiation.ts, core/feedback/sources.ts, viz/clusterArt.ts and
 * viz/webgl/engine.ts. Four copies of a constant are four values that can drift.
 * Nothing outside this file may declare a physical constant.
 *
 * Every value carries its provenance. These are the IAU 2015 Resolution B3
 * NOMINAL solar conversion constants — defined values, not measurements, chosen
 * precisely so results stay comparable when the measured solar parameters are
 * revised. CODATA 2018 supplies sigma_SB.
 *
 * Units are CGS (cm, g, s, erg) per the project convention, with solar units for
 * stellar quantities. Each export names its unit in the identifier.
 */

/* ── IAU 2015 Resolution B3 nominal solar conversion constants ── */

/** Nominal solar luminosity [erg/s]. IAU 2015 B3: L_sun = 3.828e33. */
export const L_SUN_ERG_S = 3.828e33;

/** Nominal solar radius [cm]. IAU 2015 B3: R_sun = 6.957e10. */
export const R_SUN_CM = 6.957e10;

/** Nominal solar mass parameter GM_sun [cm^3 s^-2]. IAU 2015 B3: 1.3271244e26. */
export const GM_SUN_CGS = 1.3271244e26;

/* ── SI-exact defining constants (2019 redefinition) ──
 * These are DEFINED values, not measurements, so unifying a duplicate copy of
 * one can never move a result — unlike the rounded astronomical constants. */

/** Speed of light in vacuum [cm/s]. Exact by SI definition (299792458 m/s). */
export const C_CM_S = 2.99792458e10;

/** Planck constant [erg s]. Exact by SI definition (6.62607015e-34 J s). */
export const PLANCK_H_CGS = 6.62607015e-27;

/** Boltzmann constant [erg/K]. Exact by SI definition (1.380649e-23 J/K). */
export const K_B_CGS = 1.380649e-16;

/* ── CODATA ── */

/** Stefan-Boltzmann constant [erg cm^-2 s^-1 K^-4]. CODATA 2018. */
export const SIGMA_SB_CGS = 5.670374419e-5;

/* ── Derived ── */

/**
 * Solar effective temperature [K], DERIVED from the nominal constants above via
 * Stefan-Boltzmann: T = (L / (4 pi R^2 sigma))^(1/4).
 *
 * Derived rather than typed as 5772 so it cannot disagree with the constants it
 * is built from — the drift this module exists to prevent. It equals the IAU
 * nominal 5772 K to the precision the nominal values justify (5772.0034…), and
 * `core/stellar` uses it as the anchor of its Stefan-Boltzmann closure.
 */
export const T_SUN_K = (L_SUN_ERG_S / (4 * Math.PI * R_SUN_CM ** 2 * SIGMA_SB_CGS)) ** 0.25;

/* ── Astronomical distances ── */

/** Parsec [cm]. IAU 2015 B2 exact definition: 648000/pi au, with au = 1.495978707e13 cm. */
export const PC_CM = (648000 / Math.PI) * 1.495978707e13;

/** Astronomical unit [cm]. IAU 2012 B2 exact definition. */
export const AU_CM = 1.495978707e13;
