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

/** Tout 1996 fit-normalization metallicity (the tables' "solar" anchor). */
const Z_REF = 0.02;
const Z_MIN = 1e-4;
const Z_MAX = 0.03;

/*
 * Teff reference: (Lsun / (4 pi Rsun^2 sigma_SB))^(1/4) with startrax/jaxstro's
 * CGS constants (Lsun=3.828e33 erg/s, Rsun=6.957e10 cm, sigma=5.670374419e-5).
 * Equals the IAU nominal solar Teff. So Teff = TEFF_REF * L^(1/4) / R^(1/2)
 * reproduces zams.py's Stefan-Boltzmann closure exactly.
 */
const TEFF_REF = 5772.003429145849;

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
