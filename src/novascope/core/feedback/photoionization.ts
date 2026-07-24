/*
 * photoionization.ts — the H II channel (Layer 0, pure).
 *
 * Krumholz & Matzner (2009), ApJ 703, 1352 (arXiv:0906.4343), building on
 * Matzner (2002): ionization balance, the gas-pressure driving term, and the
 * characteristic radius at which radiation pressure overtakes gas pressure.
 *
 * Unlike winds there is no eta here. Ionizing photons carry negligible momentum;
 * the momentum delivered IS the D-front shell momentum from thermal expansion,
 * computed directly. The channel's inefficiency is confinement (champagne flow
 * out of the cloud), which is what its f_leak parameterizes.
 */

/* ── constants, all Krumholz & Matzner (2009) ─────────────────────────────
 * Their fiducial set travels together: alpha_B, phi and T_II were chosen
 * consistently, so mixing one with another paper's value would break the
 * calibration (note T_II = 7000 K here, NOT the 1e4 K often quoted). */

/** Case-B recombination coefficient [cm^3 s^-1]. KM09 fiducial. */
export const ALPHA_B = 3.46e-13;

/**
 * Dimensionless factor for ionizing photons absorbed by dust and for free
 * electrons from elements other than hydrogen. KM09, after McKee & Williams
 * (1997): He singly ionized and 27% of ionizing photons absorbed by dust rather
 * than gas, for Milky Way dust-to-gas ratios.
 */
export const PHI_DUST = 0.73;

/** Ionized-gas temperature [K]. KM09 fiducial. */
export const T_II = 7000;

/** Hydrogen ionization threshold [eV] -> erg. KM09 (13.6 eV). */
export const EPS_0_ERG = 13.6 * 1.602176634e-12;

/**
 * Sound speed of photoionized gas [km/s]. This is the threshold the environment
 * axis is built around: photoionization can only drive material out while the
 * cloud's escape speed stays below it, so where v_esc exceeds ~10 km/s the H II
 * region is trapped and the channel cannot unbind the cloud however much Q the
 * cluster produces.
 */
export const C_II_KMS = 10.0;

/* unit conversions (IAU 2015 nominal; matches sources.ts and the export) */
const PC_CM = 3.086e18;
const MSUN_G = 1.989e33;
const MH_G = 1.6726e-24;
/** Mean molecular weight per hydrogen nucleus for neutral cloud gas. */
const MU = 1.4;
/** km/s -> pc/Myr. */
const KMS_TO_PC_MYR = 1.02271;

/** Number density [cm^-3] from a mass density in [Msun/pc^3]. */
export function numberDensity(rhoMsunPc3: number): number {
  return (rhoMsunPc3 * MSUN_G) / PC_CM ** 3 / (MU * MH_G);
}

/**
 * Strömgren radius [pc] — the initial ionization balance,
 * (4/3) pi R^3 alpha_B n^2 = phi Q  (KM09 eq 2, on-the-spot approximation).
 *
 * These come out TINY for this population (1e-5 to 1e-2 pc) because the stars
 * sit in the densest gas by construction (density-correlated placement) and
 * R_S ~ n^(-2/3). That is physical, not a bug: the observable H II region is the
 * EXPANDED one below, which reaches 0.1-2.7 pc.
 */
export function stromgrenRadius(qPhotonsPerS: number, nH: number): number {
  if (!(qPhotonsPerS > 0) || !(nH > 0)) return 0;
  const rCm = Math.cbrt((3 * PHI_DUST * qPhotonsPerS) / (4 * Math.PI * ALPHA_B * nH * nH));
  return rCm / PC_CM;
}

/**
 * D-type (Spitzer) expansion radius [pc] at age t [Myr]:
 *   R(t) = R_S (1 + 7 c_II t / (4 R_S))^(4/7)
 *
 * The classical thermal-pressure-driven solution: the ionized interior at
 * T_II drives a shock into the neutral cloud. Reduces to R_S at t = 0 and
 * asymptotes to the pressure-driven growth that carries the front to the
 * resolvable 0.1-2.7 pc scale over the pre-SN window.
 */
export function dFrontRadius(rStromgrenPc: number, tMyr: number): number {
  if (!(rStromgrenPc > 0)) return 0;
  const c = C_II_KMS * KMS_TO_PC_MYR;
  return rStromgrenPc * Math.pow(1 + (7 * c * tMyr) / (4 * rStromgrenPc), 4 / 7);
}

/** Shell expansion speed [km/s] from differentiating the Spitzer solution. */
export function dFrontSpeed(rStromgrenPc: number, tMyr: number): number {
  if (!(rStromgrenPc > 0)) return 0;
  const c = C_II_KMS * KMS_TO_PC_MYR;
  const x = 1 + (7 * c * tMyr) / (4 * rStromgrenPc);
  // dR/dt = c * x^(-3/7)
  return (c * Math.pow(x, -3 / 7)) / KMS_TO_PC_MYR;
}

export interface HiiRegion {
  /** Initial Strömgren radius [pc]. */
  rStromgren: number;
  /** Radius at the evaluation time [pc]. */
  radius: number;
  /** Shell speed at the evaluation time [km/s]. */
  speed: number;
  /** Swept shell mass [Msun] at the ambient density. */
  shellMass: number;
  /** Shell momentum [Msun km/s] — the momentum this region delivers. */
  momentum: number;
  /** Thermal energy of the ionized gas [Msun (km/s)^2]. */
  thermalEnergy: number;
}

/**
 * One star's H II region at age `tMyr`, expanding into its own local density.
 *
 * Uses the star's LOCAL gas density from the realization export rather than a
 * cloud average — that is the whole point of shipping local_density.f32, and it
 * is why regions differ star to star instead of being one scaled sphere.
 */
export function hiiRegion(
  qPhotonsPerS: number,
  rhoLocalMsunPc3: number,
  tMyr: number,
): HiiRegion {
  const nH = numberDensity(rhoLocalMsunPc3);
  const rs = stromgrenRadius(qPhotonsPerS, nH);
  if (rs <= 0) {
    return {
      rStromgren: 0, radius: 0, speed: 0,
      shellMass: 0, momentum: 0, thermalEnergy: 0,
    };
  }
  const r = dFrontRadius(rs, tMyr);
  const v = dFrontSpeed(rs, tMyr);
  // Swept mass at the ambient density (thin-shell approximation, KM09 sec 2).
  const shellMass = (4 / 3) * Math.PI * r ** 3 * rhoLocalMsunPc3;
  // Ionized-gas thermal energy: (3/2) N k T over the ionized volume. Expressed
  // in Msun (km/s)^2 so it shares units with the momentum/energy ledger.
  const kT_over_mu = (1.380649e-16 * T_II) / (MU * MH_G); // cm^2/s^2
  const eThermal =
    1.5 * ((4 / 3) * Math.PI * r ** 3 * rhoLocalMsunPc3) * (kT_over_mu / 1e10);
  return {
    rStromgren: rs,
    radius: r,
    speed: v,
    shellMass,
    momentum: shellMass * v,
    thermalEnergy: eThermal,
  };
}

export interface HiiBudget {
  /** Summed shell momentum [Msun km/s]. */
  momentum: number;
  /** Summed ionized-gas thermal energy [Msun (km/s)^2]. */
  energy: number;
  /** Total ionizing rate [s^-1]. */
  qTotal: number;
  /** Number of stars contributing ionizing photons. */
  nSources: number;
  /** Median region radius [pc] — the scale the renderer must resolve. */
  medianRadius: number;
  /**
   * Ratio of median region radius to mean source separation. Above ~1 the
   * regions merge into one cloud-filling H II region; well below, the cloud is
   * riddled with separate trapped bubbles. This is the morphological form of
   * the environment thesis.
   */
  overlap: number;
}

/**
 * Population H II budget at age `tMyr`.
 *
 * @param q           per-star ionizing rate [s^-1] (0 for non-ionizing stars)
 * @param rhoLocal    per-star local gas density [Msun/pc^3]
 * @param cloudRadius cloud radius [pc], for the source-separation estimate
 */
export function hiiBudget(
  q: ArrayLike<number>,
  rhoLocal: ArrayLike<number>,
  tMyr: number,
  cloudRadius: number,
): HiiBudget {
  let momentum = 0;
  let energy = 0;
  let qTotal = 0;
  let nSources = 0;
  const radii: number[] = [];
  for (let i = 0; i < q.length; i++) {
    const qi = q[i]!;
    if (!(qi > 0)) continue;
    const reg = hiiRegion(qi, rhoLocal[i]!, tMyr);
    if (reg.radius <= 0) continue;
    nSources++;
    qTotal += qi;
    momentum += reg.momentum;
    energy += reg.thermalEnergy;
    radii.push(reg.radius);
  }
  radii.sort((a, b) => a - b);
  const medianRadius = radii.length ? radii[Math.floor(radii.length / 2)]! : 0;
  const sep = nSources > 0 ? cloudRadius / Math.cbrt(nSources) : Infinity;
  return {
    momentum,
    energy,
    qTotal,
    nSources,
    medianRadius,
    overlap: sep > 0 ? medianRadius / sep : 0,
  };
}

/**
 * Is the H II region trapped? True when the cloud's escape speed exceeds the
 * ionized-gas sound speed, so thermal expansion cannot drive material out
 * however large Q becomes (KM09; threshold confirmed by A. Rosen 2026-07-23).
 */
export function hiiTrapped(vEscCloudKmS: number): boolean {
  return vEscCloudKmS > C_II_KMS;
}
