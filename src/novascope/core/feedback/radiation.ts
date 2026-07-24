/*
 * radiation.ts — the radiation-pressure channel (Layer 0, pure).
 *
 * Krumholz & Matzner (2009), ApJ 703, 1352 (arXiv:0906.4343). The radiation term
 * of their thin-shell momentum equation (eq 1) is
 *
 *   f_trap * L / (4 pi r^2 c)
 *
 * and the characteristic radius r_ch (eqs 4-5) is where it equals the
 * gas-pressure term. Radiation forces fall as r^-2 while the gas term falls more
 * slowly, so radiation dominates INSIDE r_ch and gas pressure outside.
 *
 * Like photoionization and unlike winds, this channel has no eta: the injected
 * momentum L/c is delivered directly, and f_trap is its boost. The two are
 * different physical statements and must not be conflated -- eta comes from PdV
 * work by a hot bubble, f_trap from a photon interacting more than once.
 */
import { ALPHA_B, PHI_DUST, T_II, EPS_0_ERG } from "./photoionization.ts";

/* ── constants ────────────────────────────────────────────────────────────
 * Speed of light [cm/s] — exact by SI definition. */
const C_CM_S = 2.99792458e10;
/** Solar luminosity [erg/s]. IAU 2015 nominal L_sun = 3.828e33. */
const LSUN_ERG_S = 3.828e33;
const PC_CM = 3.086e18;
const MSUN_G = 1.989e33;
const KMS_CM_S = 1e5;
const K_B = 1.380649e-16;

/**
 * Trapping factor: the factor by which radiation-pressure force is enhanced by
 * photons interacting with the shell more than once.
 *
 * KM09 enumerate three routes -- line-driven winds off stellar surfaces
 * colliding with the shell, dust-reprocessed IR trapped in an optically thick
 * shell, and Lyman-alpha resonant scattering -- conclude it is "always likely to
 * be of order a few", and DELIBERATELY leave it a free parameter of constant
 * value, adopting 2 for numerical evaluation.
 *
 * So this knob and its default are the paper's own choice, not ours. Limits:
 * f_trap = 0 is optically thin (every photon escapes, no momentum deposited);
 * f_trap = 1 is one absorption per photon.
 */
export const F_TRAP_FIDUCIAL = 2.0;

/**
 * Radiation-pressure force [dyn] on a shell at radius r, from KM09 eq (1):
 * F = f_trap L / (4 pi r^2 c) integrated over the shell area gives f_trap L/c,
 * so the total force on the swept shell is simply f_trap L / c.
 *
 * Returned as the force; the ledger multiplies by the window to get momentum.
 */
export function radiationForce(lSun: number, fTrap: number = F_TRAP_FIDUCIAL): number {
  return (fTrap * lSun * LSUN_ERG_S) / C_CM_S;
}

/**
 * Momentum [Msun km/s] delivered by radiation pressure over `tMyr`.
 * p = f_trap (L/c) t -- direct, with no bubble to do extra work.
 */
export function radiationMomentum(
  lSun: number,
  tMyr: number,
  fTrap: number = F_TRAP_FIDUCIAL,
): number {
  const tS = tMyr * 3.156e13;
  const pCgs = radiationForce(lSun, fTrap) * tS; // g cm/s
  return pCgs / (MSUN_G * KMS_CM_S);
}

/**
 * Characteristic radius r_ch [pc] — KM09 eqs (4)-(5), where radiation and gas
 * pressure are equal:
 *
 *   r_ch = [alpha_B / (12 (1,4) pi phi)] (eps_0 / k T_II)^2 (psi^2 S / c^2) f_trap^2
 *
 * with (1, 4) for a (spherical, hemispherical/blister) region. Their numerical
 * evaluation for the fiducial set is (9.2, 2.3)e-2 S_49 pc.
 *
 * This is the quantitative form of the environment thesis: r_ch scales with the
 * ionizing rate S, hence with cluster mass, so a massive compact cloud is
 * radiation-dominated where a diffuse one is gas-pressure dominated. The engine
 * COMPUTES which regime an environment is in rather than asserting it.
 *
 * @param sPerS  total ionizing photon rate [s^-1]
 * @param psi    L/(S eps_0), bolometric over ionizing power -- COMPUTED from our
 *               own L and S, not assumed (KM09 note psi ~ 1 when massive stars
 *               dominate the luminosity)
 */
export function characteristicRadius(
  sPerS: number,
  psi: number,
  fTrap: number = F_TRAP_FIDUCIAL,
  spherical = true,
): number {
  if (!(sPerS > 0)) return 0;
  const geom = spherical ? 1 : 4;
  const rCm =
    (ALPHA_B / (12 * geom * Math.PI * PHI_DUST)) *
    (EPS_0_ERG / (K_B * T_II)) ** 2 *
    ((psi * psi * sPerS) / C_CM_S ** 2) *
    fTrap * fTrap;
  return rCm / PC_CM;
}

/**
 * psi = L / (S eps_0): the ratio of bolometric to ionizing power, counting only
 * eps_0 per ionizing photon (KM09). Computable from the population, so it is not
 * a free parameter for us.
 */
export function psiRatio(lSun: number, sPerS: number): number {
  if (!(sPerS > 0)) return 0;
  return (lSun * LSUN_ERG_S) / (sPerS * EPS_0_ERG);
}

export interface RadiationBudget {
  /** Total bolometric luminosity [Lsun]. */
  lTotal: number;
  /** Momentum delivered over the window [Msun km/s]. */
  momentum: number;
  /** psi = L/(S eps_0). */
  psi: number;
  /** Characteristic radius [pc] — radiation dominates inside this. */
  rCh: number;
  /**
   * True when r_ch exceeds the cloud radius, i.e. radiation pressure dominates
   * gas pressure throughout the cloud. This is the regime KM09 identify with
   * massive protoclusters, and Fall, Krumholz & Matzner (2010) with the
   * radiation-pressure-predominant corner of the M-Sigma plane.
   */
  radiationDominated: boolean;
}

export function radiationBudget(
  lTotalSun: number,
  sTotalPerS: number,
  tMyr: number,
  cloudRadiusPc: number,
  fTrap: number = F_TRAP_FIDUCIAL,
): RadiationBudget {
  const psi = psiRatio(lTotalSun, sTotalPerS);
  const rCh = characteristicRadius(sTotalPerS, psi, fTrap);
  return {
    lTotal: lTotalSun,
    momentum: radiationMomentum(lTotalSun, tMyr, fTrap),
    psi,
    rCh,
    radiationDominated: rCh >= cloudRadiusPc,
  };
}
