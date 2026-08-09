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
import { K_B_CGS } from "../constants/index.ts";

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

/**
 * Ionized-gas number density [cm^-3] at radius r [pc] inside an H II region
 * driven by ionizing rate S, from the same balance as `stromgrenRadius`
 * (KM09 eq 2) read the other way round — solving for n at a GIVEN r rather than
 * for r at a given n:
 *
 *   (4/3) pi r^3 alpha_B n^2 = phi S   =>   n = sqrt(3 phi S / (4 pi alpha_B r^3))
 *
 * so n ~ r^(-3/2), which is what makes the gas-pressure term fall more slowly
 * than the r^-2 radiation term and gives the two curves exactly one crossing.
 */
export function ionizedDensity(sPerS: number, rPc: number): number {
  if (!(sPerS > 0) || !(rPc > 0)) return 0;
  const rCm = rPc * PC_CM;
  return Math.sqrt((3 * PHI_DUST * sPerS) / (4 * Math.PI * ALPHA_B * rCm ** 3));
}

/**
 * Ionized-gas pressure [dyn/cm^2] at radius r [pc] — the gas-pressure term of
 * KM09's thin-shell equation of motion, P_II = n_II k T_II.
 *
 * ON THE PARTICLE-COUNT CONVENTION. Writing this as n k T rather than 2 n k T
 * is not an oversight about electrons. KM09 express the term as
 * rho_II c_II^2 (u_II/c_II) (eq 3), and the coefficient that reproduces their
 * PUBLISHED r_ch of 9.2e-2 S_49 pc (fiducial alpha_B, phi, T_II, f_trap = 2,
 * psi = 1) is exactly this one — verified numerically, and gated below. Their
 * quoted blister value 2.3e-2 is the same number over 4, and that 4 is the
 * GEOMETRIC (u_II/c_II = 2, squared) factor already carried by
 * `characteristicRadius`'s `spherical` flag, not a second particle-count.
 *
 * The normalization is therefore anchored to a published number rather than to
 * a counting argument reconstructed here, which is the direction that cannot
 * silently drift.
 */
export function hiiPressure(sPerS: number, rPc: number): number {
  return ionizedDensity(sPerS, rPc) * K_B_CGS * T_II;
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
  const kT_over_mu = (K_B_CGS * T_II) / (MU * MH_G); // cm^2/s^2
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

/**
 * Enclosed gas mass [Msun] inside radius r, read from the realization's own
 * tabulated M_gas(<r)/M_gas profile (`gas_menc.f32`, 1024 uniform samples out
 * to `gas_menc_r_max_pc`). Linear interpolation; clamped to the total beyond
 * the table.
 *
 * This is the SAME profile binding.ts integrates for E_bind and the evacuation
 * animation reads, so the swept mass, the binding energy and the picture on
 * screen cannot disagree about where the gas is.
 */
export function enclosedGasMass(
  rPc: number,
  mGasTotal: number,
  mencFrac: ArrayLike<number>,
  rMaxPc: number,
): number {
  const n = mencFrac.length;
  if (n === 0 || !(rPc > 0)) return 0;
  if (rPc >= rMaxPc) return mGasTotal;
  const x = (rPc / rMaxPc) * (n - 1);
  const i = Math.min(n - 2, Math.floor(x));
  const f = x - i;
  return mGasTotal * (mencFrac[i]! * (1 - f) + mencFrac[i + 1]! * f);
}

/**
 * The cluster's H II region as ONE merged, cloud-centred region.
 *
 * WHY MERGED RATHER THAN SUMMED PER STAR. Ionizing photons from every massive
 * star feed a common ionized volume; once the individual Stromgren spheres
 * touch there are not N separate D-fronts but one front driven by S_total. The
 * per-star sum also has no way to notice that the regions have run out of cloud
 * to sweep — and it did not: summing them gave a swept mass 450-577x the entire
 * residual gas reservoir of the cloud (measured 2026-08-09), out of a volume
 * only 1-14% of it.
 *
 * WHY THE SWEPT MASS COMES FROM THE PROFILE, NOT rho x volume. The old form was
 *
 *     M_sh = (4/3) pi r^3 rho_local
 *
 * with rho_local the density in the STAR'S OWN GRID CELL — a point value
 * applied uniformly across a sphere of radius 0.08-1.45 pc. It is also the most
 * extreme value in the box: on the 128^3 export, 77% of stars share one
 * saturated cell density of 7.3e6 Msun/pc^3 (n_H = 2.1e8 cm^-3), 2.4e4x the
 * cloud mean. Using the enclosed-mass profile removes both problems at once,
 * because M_gas(<r) is bounded by construction and is measured, not sampled.
 *
 * rho_local is still used for the STROMGREN radius, where it belongs: that
 * radius is set by the gas immediately around the source.
 */
export interface MergedHiiRegion {
  /** Initial Stromgren radius of the combined region [pc]. */
  rStromgren: number;
  /** Ionization-front radius at the evaluation time [pc]. */
  radius: number;
  /** Front speed at the evaluation time [km/s]. */
  speed: number;
  /** Swept neutral mass [Msun] — enclosed gas inside `radius`. */
  shellMass: number;
  /** Shell momentum [Msun km/s]. */
  momentum: number;
  /** Ionized-gas thermal energy [Msun (km/s)^2]. */
  thermalEnergy: number;
  /** True when the front has reached the cloud edge and swept all the gas. */
  cloudFilling: boolean;
}

export function mergedHiiRegion(
  sTotalPerS: number,
  nHMean: number,
  tMyr: number,
  mGasTotal: number,
  mencFrac: ArrayLike<number>,
  rMencMaxPc: number,
  rCloudPc: number,
): MergedHiiRegion {
  const empty: MergedHiiRegion = {
    rStromgren: 0, radius: 0, speed: 0,
    shellMass: 0, momentum: 0, thermalEnergy: 0, cloudFilling: false,
  };
  if (!(sTotalPerS > 0) || !(nHMean > 0)) return empty;

  const rs = stromgrenRadius(sTotalPerS, nHMean);
  if (!(rs > 0)) return empty;

  // The front cannot run past the cloud: beyond r_cloud there is nothing left
  // to ionize or to sweep, and letting it continue would credit momentum to gas
  // that is not there (the same error bubble.ts avoids by capping eta at
  // breakout).
  //
  // Once it fills the cloud the region FREEZES rather than stopping. Evaluating
  // the speed at t instead of at t_fill would keep decelerating a shell that is
  // no longer gaining mass, so its momentum would fall — and a delivered
  // momentum that decreases with time is not physical, it is just the Spitzer
  // solution being read outside its domain. Setting the speed to zero is worse
  // still: it makes the channel's contribution vanish, which is what first
  // showed up as a non-monotonic trajectory.
  //
  // t_fill inverts the Spitzer solution: r_cloud = R_S(1 + 7 c t/(4 R_S))^(4/7).
  const c = C_II_KMS * KMS_TO_PC_MYR;
  const rFree = dFrontRadius(rs, tMyr);
  const cloudFilling = rFree >= rCloudPc;
  const tFill = ((4 * rs) / (7 * c)) * ((rCloudPc / rs) ** (7 / 4) - 1);
  const tEval = cloudFilling ? Math.max(0, tFill) : tMyr;
  const radius = Math.min(rFree, rCloudPc);
  const speed = dFrontSpeed(rs, tEval);

  const shellMass = enclosedGasMass(radius, mGasTotal, mencFrac, rMencMaxPc);
  const kT_over_mu = (K_B_CGS * T_II) / (MU * MH_G); // cm^2/s^2
  return {
    rStromgren: rs,
    radius,
    speed,
    shellMass,
    momentum: shellMass * speed,
    // (3/2) N k T over the ionized gas, in Msun (km/s)^2 to match the ledger.
    thermalEnergy: 1.5 * shellMass * (kT_over_mu / 1e10),
    cloudFilling,
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
   * Ratio of median PER-STAR region radius to mean source separation. Above ~1
   * the regions have merged, which is the regime the budget assumes; well
   * below, the cloud is riddled with separate trapped bubbles and the merged
   * treatment is an approximation. Reported so the assumption is visible.
   */
  overlap: number;
  /** Radius of the merged ionization front [pc]. */
  radius: number;
  /** Gas mass swept by the merged front [Msun] — bounded by M_gas. */
  shellMass: number;
  /** True once the front fills the cloud and there is no more gas to sweep. */
  cloudFilling: boolean;
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
  mGasTotal: number,
  mencFrac: ArrayLike<number>,
  rMencMaxPc: number,
): HiiBudget {
  // ── per-star pass: DIAGNOSTICS ONLY ──────────────────────────────────────
  // These no longer feed the budget. They are what tells a reader whether
  // treating the region as merged is justified: `overlap` is the median region
  // radius over the mean source separation, so above ~1 the individual spheres
  // have run together and the merged treatment is the only correct one.
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
    radii.push(reg.radius);
  }
  radii.sort((a, b) => a - b);
  const medianRadius = radii.length ? radii[Math.floor(radii.length / 2)]! : 0;
  const sep = nSources > 0 ? cloudRadius / Math.cbrt(nSources) : Infinity;

  // ── the budget: ONE merged region driven by the total ionizing rate ──────
  // Mean gas density of the cloud sets the combined Stromgren radius; the swept
  // mass then comes from the tabulated enclosed-gas profile, so it is bounded
  // by the gas that actually exists.
  const vCloud = (4 / 3) * Math.PI * cloudRadius ** 3;
  const nHMean = vCloud > 0 ? numberDensity(mGasTotal / vCloud) : 0;
  const merged = mergedHiiRegion(
    qTotal, nHMean, tMyr, mGasTotal, mencFrac, rMencMaxPc, cloudRadius,
  );

  return {
    momentum: merged.momentum,
    energy: merged.thermalEnergy,
    qTotal,
    nSources,
    medianRadius,
    overlap: sep > 0 && isFinite(sep) ? medianRadius / sep : 0,
    radius: merged.radius,
    shellMass: merged.shellMass,
    cloudFilling: merged.cloudFilling,
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
