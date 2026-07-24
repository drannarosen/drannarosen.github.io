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
import { ALPHA_B, PHI_DUST, T_II, EPS_0_ERG, hiiPressure } from "./photoionization.ts";
import { L_SUN_ERG_S, SIGMA_SB_CGS } from "../constants/index.ts";

/* ── constants ────────────────────────────────────────────────────────────
 * Speed of light [cm/s] — exact by SI definition. */
const C_CM_S = 2.99792458e10;
/** Solar luminosity [erg/s]. IAU 2015 nominal — see @novascope/core/constants. */
const LSUN_ERG_S = L_SUN_ERG_S;
const PC_CM = 3.086e18;
const MSUN_G = 1.989e33;
const KMS_CM_S = 1e5;
const K_B = 1.380649e-16;

/**
 * KM09's fiducial trapping factor, eq (22):
 *
 *   f_trap = 1 + f_trap,w + f_trap,IR + f_trap,Lyalpha
 *
 * where the 1 is absorption of the DIRECT radiation and the other three are
 * trapping by stellar winds, reprocessed infrared, and Lyman-alpha.
 *
 * DO NOT USE THIS AS OUR DEFAULT. It is the right number for KM09 and the wrong
 * number for us, for a structural reason: they have ONE shell equation, so the
 * hot shocked wind pushing the shell has to enter as f_trap,w (~1, their
 * eq 23 analysis giving 0.22/(1 - C_f)). We model winds as a SEPARATE ledger
 * channel, so adopting 2 would count the wind bubble twice — once in the wind
 * entry, once inside the radiation entry.
 *
 * Kept exported because it is the number the paper evaluates with, and the UI
 * should be able to show where the published fiducial sits.
 */
export const F_TRAP_FIDUCIAL = 2.0;

/**
 * Direct-absorption floor: every photon deposits its momentum once before
 * escaping. The `1` of KM09 eq (22).
 */
export const F_TRAP_DIRECT = 1.0;

/**
 * Lyman-alpha trapping contribution. KM09 sec 3.3 find the pressure of trapped
 * Ly-alpha saturates once dust destroys the photons, and conclude one may
 * "simply set f_trap,Lyalpha ~ 0 without making a significant error" for
 * ionization parameters x_II < 1. Named rather than dropped, so the term is
 * visibly accounted for instead of silently missing.
 */
export const F_TRAP_LYA = 0.0;

/** Stefan-Boltzmann constant [erg cm^-2 s^-1 K^-4]. CODATA — see /core/constants. */
const SIGMA_SB = SIGMA_SB_CGS;

/**
 * Effective temperature of the shell's photosphere [K], from KM09's
 * 4 pi r_II^2 sigma_SB T_eff,sh^4 = L.
 *
 * This is what sets whether IR trapping matters at all, and it is why trapping
 * is a property of COMPACTNESS rather than of mass: T_eff,sh ~ (L/r^2)^(1/4).
 */
export function shellEffectiveTemperature(lSun: number, rPc: number): number {
  if (!(lSun > 0) || !(rPc > 0)) return 0;
  const rCm = rPc * PC_CM;
  return Math.pow((lSun * LSUN_ERG_S) / (4 * Math.PI * rCm ** 2 * SIGMA_SB), 0.25);
}

/**
 * Infrared trapping contribution f_trap,IR — KM09 eq (34), their fit to a
 * diffusion calculation through the Weingartner & Draine (2001) standard dust
 * model "A" at R_V = 5.5:
 *
 *   f_trap,IR = [ Sigma_sh^-3 (132/T_eff,sh)^6
 *               + Sigma_sh^-1.92 (72/T_eff,sh)^1.71 ]^(-2/3)
 *
 * with Sigma_sh in g/cm^2. KM09 use the temperature-dependent Planck and
 * Rosseland means, NOT a constant opacity — there is no kappa_IR in the paper,
 * and a `1 + kappa_IR Sigma` form is not theirs.
 *
 * IMPORTANT: this is the NON-POROUS (C_f = 1) UPPER LIMIT, which KM09
 * immediately call "unrealistically high when radiation can leak away". Their
 * leaky result is eq (37), f_trap,IR = (4/3) C_f/(1 - C_f), and for realistic
 * C_f <~ 1/2 they conclude f_trap,IR <~ 1 — radiation-driven Rayleigh-Taylor
 * punches holes that keep C_f well below 1, "so that f_trap,IR is no more than
 * a few". Use this as a ceiling, not as the answer.
 *
 * Note also that Sigma_sh is the SHELL column M_sh/(4 pi r_II^2), not the
 * cloud's mean surface density M/(pi R^2). They differ by both geometry and by
 * how much of the cloud has actually been swept.
 *
 * WHY THIS IS A FIT AND NOT AN OPACITY. The coefficients 132, 72, -3, -1.92 and
 * -2/3 encode WD01's kappa(T); substituting a different dust model's opacity
 * into them would be meaningless. Using another model means redoing KM09's
 * eq (33) integral, F(P) = integral dP'/kappa_R(T'), with that model's
 * tabulated kappa_R and kappa_P — not editing these numbers.
 *
 * Cross-checked against Hensley & Draine (2023) Astrodust+PAH Rosseland means
 * (M_d/M_H = 0.00708): per gram of GAS those give 0.013 cm^2/g at 11 K, 0.165
 * at 45 K and 1.37 at 132 K. Two things follow, and both matter. A constant
 * opacity cannot represent this — it moves by 100x across the shell
 * temperatures in play, which is exactly why trapping tracks COMPACTNESS rather
 * than column alone. And an earlier version of this file used a constant
 * kappa_IR = 5 cm^2/g of gas, which the same table puts ~30x too high at our
 * shell temperatures. That constant appeared in no source; it was invented to
 * complete a formula.
 */
export function trapIR(sigmaShellCgs: number, teffShellK: number): number {
  if (!(sigmaShellCgs > 0) || !(teffShellK > 0)) return 0;
  const a = sigmaShellCgs ** -3 * (132 / teffShellK) ** 6;
  const b = sigmaShellCgs ** -1.92 * (72 / teffShellK) ** 1.71;
  return (a + b) ** (-2 / 3);
}

/**
 * The trapping factor appropriate to OUR ledger: KM09 eq (22) with the wind
 * term omitted, because winds are their own channel here.
 *
 *   f_trap = 1 + f_trap,IR + f_trap,Lyalpha
 *
 * For every environment in the shipped set this evaluates to ~1: the shells sit
 * at T_eff,sh = 11-45 K and Sigma_sh = 0.003-0.4 g/cm^2, far below the
 * Sigma_sh >~ 1, T_eff,sh > 60 K regime where KM09 note trapping becomes
 * significant. That is a RESULT, not an assumption — it is computed per
 * environment and will rise on its own for a more compact, more luminous one.
 */
export function fTrapKM09(lSun: number, rPc: number, sigmaShellCgs: number): number {
  const teff = shellEffectiveTemperature(lSun, rPc);
  return F_TRAP_DIRECT + trapIR(sigmaShellCgs, teff) + F_TRAP_LYA;
}

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
 * Radiation pressure [dyn/cm^2] at radius r [pc] — the radiation term of KM09's
 * thin-shell equation of motion (eq 1), f_trap L / (4 pi r^2 c).
 *
 * Falls as r^-2, against the H II term's r^(-3/2), so the two cross exactly
 * once: at r_ch. Radiation dominates INSIDE, gas pressure outside.
 */
export function radiationPressure(
  lSun: number,
  rPc: number,
  fTrap: number = F_TRAP_FIDUCIAL,
): number {
  if (!(rPc > 0)) return 0;
  const rCm = rPc * PC_CM;
  return (fTrap * lSun * LSUN_ERG_S) / (4 * Math.PI * rCm ** 2 * C_CM_S);
}

/**
 * Instantaneous pressure comparison at radius r — the criterion KM09 and Fall,
 * Krumholz & Matzner (2010) actually apply.
 *
 * DISTINCT FROM THE LEDGER, deliberately. The ledger integrates each channel's
 * momentum over the pre-SN window and asks which delivered more; this asks
 * which pushes harder RIGHT NOW at radius r. The two can disagree, and the
 * disagreement is physical rather than a discrepancy to tune away: radiation
 * deposits momentum linearly in t, while a D-front decelerates (R ~ t^(4/7),
 * so v ~ t^(-3/7)), so radiation can win the time-integral in an environment
 * where gas pressure wins the instantaneous comparison.
 *
 * Both are reported. Neither is "the" answer.
 */
export function pressureComparison(
  lSun: number,
  sPerS: number,
  rPc: number,
  fTrap: number = F_TRAP_FIDUCIAL,
): { pRad: number; pHii: number; ratio: number } {
  const pRad = radiationPressure(lSun, rPc, fTrap);
  const pHii = hiiPressure(sPerS, rPc);
  return { pRad, pHii, ratio: pHii > 0 ? pRad / pHii : Infinity };
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
  /** Radiation pressure at the cloud radius [dyn/cm^2]. */
  pRadAtCloud: number;
  /** Ionized-gas pressure at the cloud radius [dyn/cm^2]. */
  pHiiAtCloud: number;
  /**
   * P_rad/P_HII at the cloud radius — the INSTANTANEOUS dominance criterion,
   * reported alongside the ledger's integrated-momentum comparison because the
   * two ask different questions and may disagree. Equivalent to
   * `radiationDominated` by construction (both are the r_ch crossing), but a
   * continuous number rather than a boolean, so "marginal" is visible instead
   * of being rounded to one side.
   */
  pressureRatioAtCloud: number;
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
  const cmp = pressureComparison(lTotalSun, sTotalPerS, cloudRadiusPc, fTrap);
  return {
    lTotal: lTotalSun,
    momentum: radiationMomentum(lTotalSun, tMyr, fTrap),
    psi,
    rCh,
    radiationDominated: rCh >= cloudRadiusPc,
    pRadAtCloud: cmp.pRad,
    pHiiAtCloud: cmp.pHii,
    pressureRatioAtCloud: cmp.ratio,
  };
}
