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

/**
 * Zero-point luminosity of the bolometric magnitude scale [erg/s].
 *
 * IAU 2015 Resolution B2 fixes this EXACTLY at 3.0128e28 W, precisely so that
 * bolometric magnitudes stop depending on an adopted solar luminosity. It is the
 * only absolute magnitude zero point this package can state honestly: the
 * passbands here are calibrated relative to Vega for COLOUR indices only, so there
 * is no V-band zero point to quote, and inventing one would be a fabricated
 * number on a page that reports magnitudes.
 */
export const L_ZERO_BOL_ERG_S = 3.0128e35;

/* ── Derived ── */

/**
 * Solar bolometric absolute magnitude, DERIVED from the two luminosities above:
 * M = -2.5 log10(L / L_0).
 *
 * Derived rather than typed as 4.74 for the same reason as `T_SUN_K`. It comes out
 * at 4.7398…, which is the familiar value to the precision the inputs justify.
 */
export const M_BOL_SUN = -2.5 * Math.log10(L_SUN_ERG_S / L_ZERO_BOL_ERG_S);

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

/* ── Photometric zero points ── */

/**
 * AB magnitude zero point [erg s^-1 cm^-2 Hz^-1].
 *
 * The AB system is DEFINED by f_nu = 3631 Jy at m = 0 (Oke & Gunn 1983), and
 * 1 Jy = 1e-23 erg s^-1 cm^-2 Hz^-1 exactly, so this is a definition rather than a
 * measurement. Written as the product so both halves stay visible.
 *
 * This is the second absolute zero point in the package, and the two answer different
 * questions: `L_ZERO_BOL_ERG_S` calibrates BOLOMETRIC magnitudes (total output), this
 * calibrates magnitudes THROUGH A FILTER. A bolometric correction is exactly the
 * difference between them, which is why both are needed to state one.
 */
export const AB_ZERO_JY = 3631;
export const AB_ZERO_CGS = AB_ZERO_JY * 1e-23;

/* ── Dynamics units ──
 *
 * An N-body integrator does not want CGS. Its natural units are parsecs, solar masses and
 * megayears, and the conversions between those and the CGS constants above are the kind of
 * fact that gets hand-typed once per solver and then disagrees with itself.
 *
 * All three below are DERIVED from `GM_SUN_CGS` and `PC_CM`. That is worth more than
 * accuracy: it makes them mutually consistent BY CONSTRUCTION. Two independently typed
 * conversion factors can disagree; two computed from one root cannot.
 */

/**
 * Megayear [s], from the IAU Julian year of exactly 365.25 days.
 *
 * Written as the product so both halves stay visible, and so the year DEFINITION is the
 * thing on the page rather than the number it produces (3.15576e13 s). Which year is meant
 * matters more than it looks: a tropical year (365.2422 d) would move this by 2.1e-5, and
 * G below by twice that — small enough to pass a loose check and large enough to be wrong.
 */
export const MYR_S = 365.25 * 86_400 * 1e6;

/**
 * Velocity conversion: 1 km/s expressed in pc/Myr.
 *
 * Comes out at 1.02271…, which is close enough to 1 to be genuinely dangerous. `LatentStar`
 * stores velocities in km/s (a stellar-kinematics convention) while the integrators work in
 * pc/Myr, so this factor sits on the boundary between them. Dropping it is a 2.3% error in
 * every velocity and a 4.6% error in every kinetic energy — which looks like a mediocre
 * integrator rather than like a units bug.
 */
export const KM_S_TO_PC_MYR = (1e5 * MYR_S) / PC_CM;

/**
 * Gravitational constant in the integrator's units [pc^3 M_sun^-1 Myr^-2].
 *
 * G is never measured directly to useful precision; GM_sun is, and IAU 2015 B3 fixes the
 * nominal value this derives from. So this is a unit conversion of `GM_SUN_CGS`, not an
 * independent constant, and writing it as one is what keeps it honest.
 *
 * Derives to 4.4985e-3, against progenax's exported 4.4984798e-3 — a 5e-6 difference that
 * does not matter and is not worth reconciling. novascope is teaching-grade and its star
 * data is float32; the research codes are the ones carrying float64 and a precision claim.
 * `check-constants` compares the two anyway, because it is the only external reference
 * available, and because the comparison catches a wrong YEAR — which does matter.
 */
export const G_PC3_MSUN_MYR2 = (GM_SUN_CGS * MYR_S ** 2) / PC_CM ** 3;
