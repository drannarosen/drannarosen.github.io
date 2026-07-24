/*
 * stellar.ts — zero-age main-sequence stellar properties for a star of given
 * mass (and metallicity), physics-grounded and provenance-carrying.
 *
 * Ported to TypeScript from startrax's VERIFIED relations — coefficients
 * transcribed from `startrax/src/startrax/hurley/sse/foundations/zams.py`
 * (digest `tout1996-zams`, whose cells were checked 75/75 against the rendered
 * Tout 1996 PDF; NOT line-translated from any GPL code). The web copy inherits
 * that provenance. Every value is validated against a startrax reference fixture
 * by scripts/check-stellar.mjs (a build gate), so the port cannot silently
 * diverge from its source.
 *
 * Units: M [Msun] -> L [Lsun], R [Rsun], Teff [K]. Everything here is the
 * ZERO-AGE main sequence (a just-born star): the ZAMS Sun is L≈0.70, Teff≈5597 K,
 * dimmer/cooler than today's Sun, which is correct — the Sun has since brightened.
 *
 * Source: Tout, Pols, Eggleton & Han (1996), MNRAS 281, 257, eqs (1)-(2),
 * Tables 1-2. Valid 0.1 <= M/Msun <= 100; Tout forbids metallicity extrapolation,
 * so Z is clipped to [1e-4, 0.03] before forming zeta = log10(Z / 0.02).
 */

import { T_SUN_K } from "../constants/index.ts";

/** Tout 1996 fit-normalization metallicity (the tables' "solar" anchor). */
const Z_REF = 0.02;
const Z_MIN = 1e-4;
const Z_MAX = 0.03;

/*
 * Teff reference: (Lsun / (4 pi Rsun^2 sigma_SB))^(1/4), which core/constants
 * derives from the IAU 2015 nominal Lsun/Rsun and CODATA sigma_SB — the same
 * CGS constants startrax/jaxstro use, so Teff = TEFF_REF * L^(1/4) / R^(1/2)
 * reproduces zams.py's Stefan-Boltzmann closure exactly. Imported rather than
 * typed (it was 5772.003429145849 here) so this anchor cannot drift from the
 * constants it is built from; check-constants asserts they agree bit-for-bit.
 */
const TEFF_REF = T_SUN_K;

/* Tout 1996 Table 1: L(M,Z). Each row is a degree-4 polynomial in
 * zeta = log10(Z/0.02) for one coefficient of eq. (1):
 * [alpha, beta, gamma, delta, epsilon, zeta_lum, eta]. Verbatim from zams.py. */
const TOUT_L_COEFFS: number[][] = [
  [0.39704170, -0.32913574, 0.34776688, 0.37470851, 0.09011915], // alpha
  [8.52762600, -24.41225973, 56.43597107, 37.06152575, 5.45624060], // beta
  [0.00025546, -0.00123461, -0.00023246, 0.00045519, 0.00016176], // gamma
  [5.43288900, -8.62157806, 13.44202049, 14.51584135, 3.39793084], // delta
  [5.56357900, -10.32345224, 19.44322980, 18.97361347, 4.16903097], // epsilon
  [0.78866060, -2.90870942, 6.54713531, 4.05606657, 0.53287322], // zeta_lum
  [0.00586685, -0.01704237, 0.03872348, 0.02570041, 0.00383376], // eta
];

/* Tout 1996 Table 2: R(M,Z). Rows: theta, iota, kappa, lambda, mu, xi, omicron,
 * pi (same degree-4 zeta polynomial). Verbatim from zams.py. */
const TOUT_R_COEFFS: number[][] = [
  [1.71535900, 0.62246212, -0.92557761, -1.16996966, -0.30631491], // theta
  [6.59778800, -0.42450044, -12.13339427, -10.73509484, -2.51487077], // iota
  [10.08855000, -7.11727086, -31.67119479, -24.24848322, -5.33608972], // kappa
  [1.01249500, 0.32699690, -0.00923418, -0.03876858, -0.00412750], // lambda
  [0.07490166, 0.02410413, 0.07233664, 0.03040467, 0.00197741], // mu
  [3.08223400, 0.94472050, -2.15200882, -2.49219496, -0.63848738], // xi
  [17.84778000, -7.45345690, -48.96066856, -40.05386135, -9.09331816], // omicron
  [0.00022582, -0.00186899, 0.00388783, 0.00142402, -0.00007671], // pi
];
/** Z-independent denominator scalar nu (Tout 1996 Table 2). */
const TOUT_R_NU = 0.01077422;

/** Evaluate each row's degree-4 zeta polynomial at metallicity Z. */
function metallicityCoeffs(matrix: number[][], Z: number): number[] {
  const zeta = Math.log10(Math.min(Math.max(Z, Z_MIN), Z_MAX) / Z_REF);
  const powers = [1, zeta, zeta ** 2, zeta ** 3, zeta ** 4];
  return matrix.map((row) => row.reduce((sum, c, k) => sum + c * powers[k], 0));
}

/** ZAMS luminosity [Lsun] from mass [Msun]. Tout 1996 eq. (1). */
export function zamsLuminosity(mass: number, Z = Z_REF): number {
  const M = mass;
  const [alpha, beta, gamma, delta, epsilon, zetaLum, eta] = metallicityCoeffs(
    TOUT_L_COEFFS,
    Z,
  );
  const num = alpha * M ** 5.5 + beta * M ** 11;
  const den =
    gamma + M ** 3 + delta * M ** 5 + epsilon * M ** 7 + zetaLum * M ** 8 + eta * M ** 9.5;
  return num / den;
}

/** ZAMS radius [Rsun] from mass [Msun]. Tout 1996 eq. (2). */
export function zamsRadius(mass: number, Z = Z_REF): number {
  const M = mass;
  const [theta, iota, kappa, lam, mu, xi, omicron, pi_] = metallicityCoeffs(
    TOUT_R_COEFFS,
    Z,
  );
  const num =
    theta * M ** 2.5 + iota * M ** 6.5 + kappa * M ** 11 + lam * M ** 19 + mu * M ** 19.5;
  const den = TOUT_R_NU + xi * M ** 2 + omicron * M ** 8.5 + M ** 18.5 + pi_ * M ** 19.5;
  return num / den;
}

/** Effective temperature [K] from L [Lsun] and R [Rsun], Stefan-Boltzmann. */
export function effectiveTemperature(L: number, R: number): number {
  return TEFF_REF * L ** 0.25 / R ** 0.5;
}

/**
 * Luminosity [Lsun] from Teff [K] and R [Rsun] — the exact inverse of
 * `effectiveTemperature`, L = (Teff/Teff_sun)^4 R^2.
 *
 * Lives here, beside its inverse, so the Stefan-Boltzmann relation has ONE
 * definition: the feedback channels need L per star from the realization's
 * exported (teff, radius), and deriving it there would mean a second sigma_SB
 * that could drift from this one.
 */
export function luminosity(teff: number, R: number): number {
  return (teff / TEFF_REF) ** 4 * R ** 2;
}

/** ZAMS effective temperature [K] from mass [Msun]. */
export function zamsTeff(mass: number, Z = Z_REF): number {
  return effectiveTemperature(zamsLuminosity(mass, Z), zamsRadius(mass, Z));
}

/*
 * Teff -> MK spectral type (dwarfs, luminosity class V). Anchor Teff values for
 * subclasses along the main sequence, from Pecaut & Mamajek (2013), ApJS 208, 9
 * — specifically Mamajek's online "Modern Mean Dwarf Stellar Colour and Teff
 * Sequence" compilation. Approximate (rounded to the sequence's own precision):
 * a classification aid, not a fit. Sorted hot -> cool; a star is labelled by the
 * nearest anchor in Teff. ZAMS stars are all dwarfs, so the class is always V.
 */
const SPECTRAL_ANCHORS: Array<[teff: number, type: string]> = [
  [44900, "O3"], [41400, "O5"], [37000, "O7"], [33300, "O9"],
  [31400, "B0"], [26000, "B1"], [20600, "B2"], [15200, "B5"], [12300, "B8"], [10700, "B9"],
  [9700, "A0"], [8800, "A2"], [8080, "A5"], [7500, "A7"],
  [7200, "F0"], [6810, "F2"], [6510, "F5"], [6170, "F8"],
  [5930, "G0"], [5770, "G2"], [5660, "G5"], [5440, "G8"],
  [5280, "K0"], [4830, "K3"], [4410, "K5"], [4050, "K7"],
  [3870, "M0"], [3550, "M2"], [3200, "M4"], [2810, "M6"], [2500, "M8"],
];

/** MK spectral type (e.g. "O7V", "G2V") for an effective temperature [K]. */
export function spectralType(teff: number): string {
  let best = SPECTRAL_ANCHORS[0];
  let bestDiff = Infinity;
  for (const anchor of SPECTRAL_ANCHORS) {
    const diff = Math.abs(teff - anchor[0]);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = anchor;
    }
  }
  return `${best[1]}V`;
}

/*
 * Main-sequence lifetime — Hurley, Pols & Tout (2000), MNRAS 315, 543, eqs
 * (4)-(7): t_MS = max(t_hook, x * t_BGB), in Myr. Ported from startrax
 * `.../foundations/times.py`. The a-coefficients and zeta are the Hurley
 * Appendix-A set evaluated at Z = 0.02 (from startrax `coefficients(0.02)`);
 * the site fixes solar metallicity, so they are stored as constants rather than
 * re-deriving the full zeta-polynomial generator (that is the variable-Z work).
 * At Z=0.02, zeta = 0 and the metallicity factor x = 0.95.
 */
const HURLEY_ZETA = 0.0;
// Index 0 is unused so HURLEY_A[i] matches Hurley's 1-based a_i.
const HURLEY_A: number[] = [
  0, 1593.89, 2706.708, 146.6143, 0.0414196, 0.3426349, 19.49814, 4.90383,
  0.05212154, 1.312179, 0.8073972,
];

/** Base-of-giant-branch time [Myr]. Hurley eq (4). */
function tBGB(m: number): number {
  const a = HURLEY_A;
  const num = a[1] + a[2] * m ** 4 + a[3] * m ** 5.5 + m ** 7;
  const den = a[4] * m ** 2 + a[5] * m ** 7;
  return num / den;
}

/** Hook-time fraction mu. Hurley eq (7). */
function hurleyMu(m: number): number {
  const a = HURLEY_A;
  const inner = Math.max(a[6] / m ** a[7], a[8] + a[9] / m ** a[10]);
  return Math.max(0.5, 1.0 - 0.01 * inner);
}

/** Metallicity factor x for t_MS. Hurley eq (5). */
const hurleyX = Math.max(0.95, Math.min(0.95 - 0.03 * (HURLEY_ZETA + 0.30103), 0.99));

/** Main-sequence lifetime [Myr] for mass [Msun] at solar metallicity. Hurley eq (5). */
export function msLifetime(mass: number): number {
  const bgb = tBGB(mass);
  return Math.max(hurleyMu(mass) * bgb, hurleyX * bgb);
}

export type RemnantFate = "white dwarf" | "neutron star" | "black hole";

/*
 * Remnant fate from ZAMS mass at ~solar metallicity — approximate thresholds
 * from Heger et al. (2003), ApJ 591, 288 (Fig. 2, solar-Z track): stars below
 * ~8 Msun end as white dwarfs; ~8-25 Msun core-collapse to neutron stars;
 * above ~25 Msun form black holes. Deliberately coarse — the true boundaries are
 * metallicity- and model-dependent, and a precise remnant MASS needs the pre-SN
 * CO-core from full stellar evolution (out of scope here). Kind only.
 */
export function remnantFate(mass: number): RemnantFate {
  if (mass < 8) return "white dwarf";
  if (mass < 25) return "neutron star";
  return "black hole";
}

/* ── Intrinsic colour ─────────────────────────────────────────────────
 * Teff → linear RGB in [0,1]. A star's INTRINSIC colour is a stellar property
 * (Architecture §5) — the observation face (`observe()`) later reddens it, it
 * does not own it. Blackbody-colour approximation after Tanner Helland (2012),
 * valid ~1000–40000 K: O/B blue-white, G yellow, M red. */
export function teffToRGB(teff: number): [number, number, number] {
  const t = Math.min(40000, Math.max(1000, teff)) / 100;
  let r: number, g: number, b: number;
  if (t <= 66) {
    r = 255;
    g = 99.4708025861 * Math.log(t) - 161.1195681661;
  } else {
    r = 329.698727446 * Math.pow(t - 60, -0.1332047592);
    g = 288.1221695283 * Math.pow(t - 60, -0.0755148492);
  }
  if (t >= 66) b = 255;
  else if (t <= 19) b = 0;
  else b = 138.5177312231 * Math.log(t - 10) - 305.0447927307;
  const c01 = (v: number) => Math.min(1, Math.max(0, v / 255));
  return [c01(r), c01(g), c01(b)];
}

/* ── The star() contract ──────────────────────────────────────────────
 * The single function every engine reads (Architecture §1, §9.1). Its backend
 * is on rung 0 today: Tout ZAMS values, with Hurley's t_MS as a lifetime clock —
 * a star sits at its ZAMS point until t ≥ t_MS, then it is a remnant. No giant
 * branch yet (that arrives with startrax tracks); `phase: "postMS"` is reserved. */

/** Model validity domain (Tout et al. 1996). Outside it, values are clamped. */
const M_MIN_VALID = 0.1;
const M_MAX_VALID = 100;
const Z_MIN_VALID = 1e-4;
const Z_MAX_VALID = 0.03;

export type Phase = "MS" | "postMS" | "remnant";

export interface StarState {
  L: number; // L☉
  R: number; // R☉
  Teff: number; // K
  phase: Phase;
  color: [number, number, number]; // intrinsic sRGB in [0,1]
  spectralType: string;
  Mdot: number; // M☉/yr — 0 until the winds engine
  remnant: RemnantFate | null; // non-null iff phase === "remnant"
  inRange: boolean; // false ⇒ inputs were clamped to the model's validity
}

/**
 * Derive a star's observable-truth state from its latent (mass, Z) at age t.
 * Pure and total: out-of-domain inputs are CLAMPED and flagged (`inRange:false`),
 * never thrown and never silently extrapolated (§9.1).
 */
export function star(mass: number, Z: number = Z_REF, t: number = 0): StarState {
  const m = Math.min(M_MAX_VALID, Math.max(M_MIN_VALID, mass));
  const z = Math.min(Z_MAX_VALID, Math.max(Z_MIN_VALID, Z));
  const inRange = mass === m && Z === z;

  if (t >= msLifetime(m)) {
    // Collapsed: no MS L/R/Teff at rung 0. The consumer renders a remnant, not
    // a point on the main sequence; colour is a neutral placeholder.
    return {
      L: 0,
      R: 0,
      Teff: 0,
      phase: "remnant",
      color: [0.5, 0.5, 0.55],
      spectralType: "—",
      Mdot: 0,
      remnant: remnantFate(m),
      inRange,
    };
  }

  const L = zamsLuminosity(m, z);
  const R = zamsRadius(m, z);
  const Teff = zamsTeff(m, z);
  return {
    L,
    R,
    Teff,
    phase: "MS",
    color: teffToRGB(Teff),
    spectralType: spectralType(Teff),
    Mdot: 0,
    remnant: null,
    inRange,
  };
}
