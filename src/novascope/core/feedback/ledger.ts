/*
 * ledger.ts — the feedback budget (Layer 0, pure).
 *
 * Assembles the three v1 channels against the cloud's binding energy and
 * momentum and returns a verdict. This is the thesis of the whole engine: it is
 * an ACCOUNTING tool, and the spectacle exists to make the accounting legible.
 *
 * Two bars, not one. A channel can clear the energy threshold without clearing
 * the momentum one, or the reverse, and which of the two actually unbinds a
 * cloud is the tension the tool exists to show.
 */
import { windBudget, type WindBudget, type WindPrescription } from "./winds.ts";
import { bubbleCeiling } from "./bubble.ts";
import { hiiBudget, hiiTrapped, type HiiBudget } from "./photoionization.ts";
import { radiationBudget, type RadiationBudget, fTrapKM09 } from "./radiation.ts";
import { cloudBinding, type CloudBinding } from "./binding.ts";
import { starLuminosity, ionizingRate, preSNWindowMyr } from "./sources.ts";

/* CGS conversions, only for the Weaver ceiling (which works in erg/s and
 * g cm/s^2). The ledger itself stays in Msun, km/s and Myr throughout. */
const MSUN_G = 1.989e33;
const KMS_CM = 1e5;
const YR_S = 3.156e7;
const PC_CM = 3.086e18;

/**
 * Per-channel leakage. One knob per channel, because the three fail for
 * physically different reasons — a single global efficiency would impose one
 * failure mode on unrelated mechanisms.
 *
 * For winds and photoionization this is `f_leak`, the fraction of injected
 * ENERGY lost to cooling and venting. It drives BOTH bars through a single
 * value, deliberately: cooling and the momentum boost fail together, so
 * exposing them separately would admit states with no physical referent (eta of
 * 50 with 95% of the energy radiated).
 *
 *   E_ret = (1 - f_leak) E_inj
 *   eta   = 1 + (eta_max - 1)(1 - f_leak)
 *   p_ret = eta p_inj
 *
 * The endpoints are physical, not chosen: f_leak = 0 is adiabatic (full energy,
 * maximum boost) and f_leak = 1 is radiative (no energy retained, eta = 1,
 * momentum-conserving). Those are the same limiting regimes Fall, Krumholz &
 * Matzner (2010) use to bracket realistic cases. The INTERPOLATION between them
 * is a parameterization and must be labelled as such wherever it is shown.
 *
 * Radiation pressure is different by construction: it has no hot phase, so it
 * never obeys the f_leak/eta lock. Its boost is f_trap (Krumholz & Matzner 2009
 * eq 22), computed per environment as 1 + f_trap,IR + f_trap,Lyalpha. Their
 * published fiducial of 2 is NOT used: it includes f_trap,w, the hot shocked
 * wind pushing the shell, which they must fold in because they have a single
 * shell equation and we must not because that is our wind channel.
 */
export interface LeakageKnobs {
  /**
   * Wind COOLING fraction [0,1]: hot gas radiating its thermal energy away.
   * Removes energy and kills the eta boost, but the mass stays in the bubble.
   */
  windLeak: number;
  /**
   * Wind VENTING fraction [0,1]: shocked gas physically escaping the cloud
   * through low-density channels.
   *
   * Tracked SEPARATELY from cooling because the two are different processes.
   * Cooling radiates energy while the mass remains; venting removes the mass
   * AND carries its momentum out of the cloud, so it attenuates the injected
   * momentum itself rather than only the boost on top of it. Sharing one knob
   * would have asserted that gas cannot escape without cooling, and that a
   * fully-cooled bubble still delivers 100% of its momentum to the cloud —
   * neither of which is true.
   *
   *   p_ret = eta (1 - f_vent) p_inj
   *
   * Note this can take the coupled momentum BELOW the momentum-conserving
   * limit, which is correct: that limit assumes the wind is contained.
   */
  windVent: number;
  /** H II confinement loss (champagne flow) [0,1]. */
  hiiLeak: number;
  /**
   * Radiation trapping factor; null = compute it from KM09 eq (22), omitting
   * their wind term because winds are a separate channel here.
   */
  fTrap: number | null;
}

export const DEFAULT_LEAKAGE: LeakageKnobs = {
  // Lancaster, Ostriker, Kim & Kim (2021) find mixing at a fractal interface
  // radiates away most of the wind energy, leaving real bubbles momentum-driven
  // rather than energy-driven. So the default sits near the leaky end rather
  // than at a neutral 0.5, and it is a sourced default, not a chosen one.
  windLeak: 0.9,
  // No sourced value yet — 0 is the deliberately CONSERVATIVE default (nothing
  // escapes), so the shipped budget never claims more disruption-suppression
  // than it can defend. Raising it is an explicit act by the reader.
  windVent: 0.0,
  hiiLeak: 0.5,
  // Sentinel: compute f_trap per environment from KM09 eq (22) as
  // 1 + f_trap,IR + f_trap,Lyalpha. NOT their fiducial 2 — that includes
  // f_trap,w, and our wind channel already carries it.
  fTrap: null,
};

export interface ChannelEntry {
  name: "winds" | "photoionization" | "radiation";
  /** Energy retained after leakage [Msun (km/s)^2]. */
  energy: number;
  /** Momentum retained after leakage/boost [Msun km/s]. */
  momentum: number;
  /** Momentum boost applied (1 where the channel has no bubble). */
  eta: number;
  /** True when this channel cannot act in this environment at all. */
  disabled?: boolean;
  /** Why it is disabled, for the UI to state rather than imply. */
  disabledReason?: string;
}

export type Verdict = "blow-out" | "bound" | "marginal";

export interface Ledger {
  /** Integration window: time to the first supernova [Myr]. */
  windowMyr: number;
  channels: ChannelEntry[];
  /** Totals after leakage. */
  totalEnergy: number;
  totalMomentum: number;
  binding: CloudBinding;
  /** Retained energy / binding energy. >1 clears the energy threshold. */
  energyRatio: number;
  /** Retained momentum / M v_esc. >1 clears the momentum threshold. */
  momentumRatio: number;
  verdict: Verdict;
  /**
   * Energy ratio across the OBSERVED spread in cluster concentration (EFF
   * gamma_3D 3.2-4.2), as [low, high]. The MOMENTUM threshold M v_esc depends
   * only on M and R, so it carries no gamma dependence and gets no band —
   * putting one there would have been a decorative interval around a number
   * that cannot move. The energy threshold does depend on gamma through
   * alpha(gamma), so the structural uncertainty is reported where it is real.
   */
  energyRatioRange: [low: number, high: number];
  diagnostics: {
    windBudget: WindBudget;
    hii: HiiBudget;
    radiation: RadiationBudget;
    etaMaxWind: number;
    tBreakoutMyr: number;
    hiiTrapped: boolean;
  };
}

export interface LedgerInput {
  /** Per-star arrays from the realization export. */
  mass: ArrayLike<number>;
  teff: ArrayLike<number>;
  radius: ArrayLike<number>;
  localDensity: ArrayLike<number>;
  /** Cloud properties from meta.json. */
  mCloud: number;
  rCloudPc: number;
  effGamma: number;
  effAPc: number;
  vEscCloud: number;
  /** Mass-loss prescription; Björklund (2022) by default, Vink (2001) optional. */
  prescription?: WindPrescription;
  /** Which channels are switched on. */
  enabled?: { winds?: boolean; photoionization?: boolean; radiation?: boolean };
  leakage?: Partial<LeakageKnobs>;
}

/**
 * Observed EFF young-cluster concentration range (3-D convention). The shipped
 * realizations sit at the CONCENTRATED end (gamma_3D = 4.2, the natal default),
 * so this band reports how the energy comparison would move if the cloud were
 * LESS concentrated (more like an evolved, expanded EFF cluster) — a one-sided
 * robustness statement toward the shallow end, which is the honest direction of
 * the uncertainty for a natal profile.
 */
const GAMMA_RANGE: [number, number] = [3.2, 4.2];

export function computeLedger(input: LedgerInput): Ledger {
  const knobs = { ...DEFAULT_LEAKAGE, ...(input.leakage ?? {}) };
  const on = { winds: true, photoionization: true, radiation: true, ...(input.enabled ?? {}) };

  const n = input.mass.length;
  const lum = new Float64Array(n);
  const q = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    lum[i] = starLuminosity(input.teff[i]!, input.radius[i]!);
    q[i] = ionizingRate(input.teff[i]!, input.radius[i]!);
  }
  let lTotal = 0;
  let sTotal = 0;
  for (let i = 0; i < n; i++) {
    lTotal += lum[i]!;
    sTotal += q[i]!;
  }

  const windowMyr = preSNWindowMyr(input.mass);

  /* ── winds ─────────────────────────────────────────────────────────── */
  const wb = windBudget(input.mass, input.teff, input.radius, lum, undefined, input.prescription ?? "bjorklund");
  // Use windBudget's own eDot and pDot rather than reconstructing them from a
  // mean terminal velocity: L_w is sum(1/2 mdot_i v_i^2), and rebuilding it as
  // 1/2 sum(mdot) <v>^2 UNDERSTATES it, since <v^2> >= <v>^2 whenever the wind
  // speeds differ — which they do, across three decades of stellar mass.
  const lWindErgS = (wb.eDot * MSUN_G * KMS_CM ** 2) / YR_S;
  const pDotCgs = (wb.pDot * MSUN_G * KMS_CM) / YR_S;
  const ceiling = bubbleCeiling(
    lWindErgS,
    pDotCgs,
    input.mCloud,
    input.rCloudPc,
    windowMyr,
  );
  const windEta = 1 + (ceiling.etaMax - 1) * (1 - knobs.windLeak);
  // Injected over the window. The rates are already in ledger units per year,
  // so this needs no CGS round-trip.
  const windPInj = wb.pDot * windowMyr * 1e6;
  const windEInj = wb.eDot * windowMyr * 1e6;
  const winds: ChannelEntry = {
    name: "winds",
    energy: on.winds ? (1 - knobs.windLeak) * windEInj : 0,
    momentum: on.winds ? windEta * (1 - knobs.windVent) * windPInj : 0,
    eta: windEta,
  };

  /* ── photoionization ───────────────────────────────────────────────── */
  const hii = hiiBudget(q, input.localDensity, windowMyr, input.rCloudPc);
  const trapped = hiiTrapped(input.vEscCloud);
  const hiiOn = on.photoionization && !trapped;
  const photo: ChannelEntry = {
    name: "photoionization",
    // No eta: ionizing photons carry negligible momentum, so the delivered
    // momentum IS the D-front shell momentum, already computed directly.
    energy: hiiOn ? (1 - knobs.hiiLeak) * hii.energy : 0,
    momentum: hiiOn ? (1 - knobs.hiiLeak) * hii.momentum : 0,
    eta: 1,
    disabled: trapped,
    disabledReason: trapped
      ? `H II region trapped: cloud escape speed ${input.vEscCloud.toFixed(1)} km/s exceeds the ~10 km/s sound speed of photoionized gas, so thermal expansion cannot drive material out however large Q becomes`
      : undefined,
  };

  /* ── radiation pressure ────────────────────────────────────────────── */
  // Shell column Sigma_sh = M_sh/(4 pi r^2) in g/cm^2, for KM09 eq (34). Taking
  // M_sh as the whole cloud mass at the cloud radius is the GENEROUS bound —
  // the real shell has swept only part of the cloud — so the trapping this
  // yields is an over-estimate of an already-upper-limit expression.
  const rShellCm = input.rCloudPc * PC_CM;
  const sigmaShellCgs = (input.mCloud * MSUN_G) / (4 * Math.PI * rShellCm ** 2);
  const fTrap = knobs.fTrap ?? fTrapKM09(lTotal, input.rCloudPc, sigmaShellCgs);
  const rad = radiationBudget(lTotal, sTotal, windowMyr, input.rCloudPc, fTrap);
  const radiation: ChannelEntry = {
    name: "radiation",
    // Radiation deposits momentum, not thermal energy, into the cloud.
    energy: 0,
    momentum: on.radiation ? rad.momentum : 0,
    eta: 1,
  };

  const channels = [winds, photo, radiation];
  const totalEnergy = channels.reduce((s, c) => s + c.energy, 0);
  const totalMomentum = channels.reduce((s, c) => s + c.momentum, 0);

  const binding = cloudBinding(input.mCloud, input.rCloudPc, input.effGamma, input.effAPc);
  const energyRatio = binding.energy > 0 ? totalEnergy / binding.energy : 0;
  const momentumRatio = binding.momentum > 0 ? totalMomentum / binding.momentum : 0;

  // Robustness band: the momentum threshold M v_esc does not depend on gamma,
  // but the ENERGY threshold does, so the band is carried on whichever ratio
  // the verdict rests on. Momentum is the robust currency (energy-driven
  // bubbles leak), so the verdict is keyed on momentum and the band reports how
  // the ENERGY comparison would move across the observed concentration range.
  // Steeper gamma => larger alpha => MORE binding => a LOWER energy ratio.
  const eBindSteep = cloudBinding(input.mCloud, input.rCloudPc, GAMMA_RANGE[1], input.effAPc).energy;
  const eBindShallow = cloudBinding(input.mCloud, input.rCloudPc, GAMMA_RANGE[0], input.effAPc).energy;
  const energyRatioRange: [number, number] = [
    eBindSteep > 0 ? totalEnergy / eBindSteep : 0,
    eBindShallow > 0 ? totalEnergy / eBindShallow : 0,
  ];

  let verdict: Verdict;
  if (momentumRatio >= 1.2) verdict = "blow-out";
  else if (momentumRatio <= 0.8) verdict = "bound";
  else verdict = "marginal";

  return {
    windowMyr,
    channels,
    totalEnergy,
    totalMomentum,
    binding,
    energyRatio,
    momentumRatio,
    verdict,
    energyRatioRange,
    diagnostics: {
      windBudget: wb,
      hii,
      radiation: rad,
      etaMaxWind: ceiling.etaMax,
      tBreakoutMyr: ceiling.tBreakoutMyr,
      hiiTrapped: trapped,
    },
  };
}
