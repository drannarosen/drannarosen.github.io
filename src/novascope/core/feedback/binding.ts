/*
 * binding.ts — the cloud's gravitational binding energy (Layer 0, pure).
 *
 * The ledger's denominator: whatever the channels deliver is measured against
 * this. Written as E_bind = alpha G M^2 / r_t, where alpha is a pure number set
 * by the density profile's SHAPE.
 *
 * alpha is DERIVED here, not cited. A tabulated coefficient for "an EFF profile"
 * would not describe our cloud: alpha depends jointly on the slope gamma AND on
 * how far out the profile is truncated (r_t/a), and our realizations are
 * truncated EFF with a/r_t = 0.32 fixed by the export. Deriving it from the same
 * enclosed-mass construction the sampler uses keeps one source of truth for the
 * profile — and it generalizes to any gamma for free, so nothing here is
 * hardcoded to the gamma = 3 the shipped realizations happen to use.
 */
import { buildEFFCDF } from "../cluster/profiles.ts";

/**
 * Dimensionless binding-energy coefficient alpha for a truncated EFF profile,
 * defined by E_bind = alpha G M^2 / r_t.
 *
 * From the standard potential-energy integral for a spherical mass
 * distribution, W = -integral G M(<r)/r dM. Writing m(r) = M(<r)/M and
 * substituting dM = M dm,
 *
 *   |W| = G M^2 integral_0^rt (m/r) (dm/dr) dr    =>    alpha = r_t |W| / (G M^2)
 *
 * The integrand is well behaved at the origin: m ~ r^3 for small r, so
 * m/r ~ r^2 -> 0.
 *
 * @param gamma    3-D density slope (3 = typical young cluster; 5 = Plummer)
 * @param rtOverA  truncation radius in units of the scale radius a
 */
export function effBindingCoefficient(gamma: number, rtOverA: number, nGrid = 4096): number {
  // a = 1 so radii are in units of a; alpha is dimensionless either way.
  const { cdf, rGrid } = buildEFFCDF(1, gamma, rtOverA, nGrid);
  let integral = 0;
  for (let i = 1; i < cdf.length; i++) {
    const dr = rGrid[i]! - rGrid[i - 1]!;
    if (dr <= 0) continue;
    const dm = cdf[i]! - cdf[i - 1]!;
    // midpoint of m/r across the step; both endpoints finite (m/r -> 0 at r=0)
    const lo = rGrid[i - 1]! > 0 ? cdf[i - 1]! / rGrid[i - 1]! : 0;
    const hi = cdf[i]! / rGrid[i]!;
    integral += 0.5 * (lo + hi) * dm;
  }
  return rtOverA * integral;
}

/**
 * Mass-weighted escape-speed coefficient beta, defined by
 * <v_esc> = beta sqrt(2 G M / r_t), the average over the MASS of the cloud.
 *
 * WHY THIS EXISTS. sqrt(2GM/r_t) is the escape speed from OUTSIDE a point
 * mass, i.e. the value at the truncation radius. But the gas that feedback has
 * to expel is not at the truncation radius — it is distributed through the
 * profile, and most of it sits where the potential is deeper. Charging the
 * whole gas mass the surface escape speed understates the cost of removing it.
 *
 * Measured on the shipped realizations, 2026-08-09: beta = 1.38 for the natal
 * gamma = 4.2 profile and 1.27 for the shallow gamma = 3.2 one. So the momentum
 * threshold was ~38% too low, which made every environment easier to blow out
 * than it is.
 *
 * Derived from the same enclosed-mass construction as `effBindingCoefficient`
 * (and therefore the same one the sampler uses), so the profile has one source
 * of truth and beta generalizes to any gamma rather than being tabulated.
 *
 *   Phi(r) = -G[ M(<r)/r + integral_r^rt dM/r' ]
 *   v_esc(r) = sqrt(2|Phi(r)|)
 *   beta = < v_esc(r) >_mass / sqrt(2 G M / r_t)
 *
 * At r = r_t the integral vanishes and m = 1, so the integrand is exactly 1
 * there — beta > 1 measures how much deeper the interior is.
 */
export function effEscapeCoefficient(gamma: number, rtOverA: number, nGrid = 4096): number {
  const { cdf, rGrid } = buildEFFCDF(1, gamma, rtOverA, nGrid);
  const n = cdf.length;
  // Outer term I(r) = integral_r^rt (dm/dr')/r' dr', accumulated inward so each
  // radius reuses the tail already summed.
  const outer = new Float64Array(n);
  for (let i = n - 2; i >= 0; i--) {
    const dm = cdf[i + 1]! - cdf[i]!;
    const rMid = 0.5 * (rGrid[i]! + rGrid[i + 1]!);
    outer[i] = outer[i + 1]! + (rMid > 0 ? dm / rMid : 0);
  }
  let num = 0;
  let den = 0;
  for (let i = 1; i < n; i++) {
    const dm = cdf[i]! - cdf[i - 1]!;
    const r = rGrid[i]!;
    if (!(dm > 0) || !(r > 0)) continue;
    // Dimensionless well depth in units of GM/r_t (radii are in units of a, so
    // multiplying by r_t/a converts GM/a to GM/r_t).
    const depth = (cdf[i]! / r + outer[i]!) * rtOverA;
    num += dm * Math.sqrt(depth);
    den += dm;
  }
  return den > 0 ? num / den : 1;
}

/* G in [pc (km/s)^2 / Msun] — IAU 2015 nominal, same value and epoch as
 * sources.ts, winds.ts and the export pipeline. */
const G_PC_KMS2_MSUN = 4.300917270e-3;

export interface CloudBinding {
  /** Dimensionless profile coefficient. */
  alpha: number;
  /** Binding energy [Msun (km/s)^2] — the ledger's energy threshold. */
  energy: number;
  /**
   * Momentum needed to unbind the cloud [Msun km/s]: M <v_esc>, the impulse
   * that would lift the gas out of its own potential. The ledger's momentum
   * threshold, and the reason both bars are shown — a channel can clear one
   * without clearing the other.
   *
   * Uses the MASS-WEIGHTED escape speed, not the surface value: the gas is
   * distributed through the profile, not sitting at r_t.
   */
  momentum: number;
  /**
   * Escape speed at the truncation radius [km/s] — sqrt(2GM/r_t).
   *
   * Kept because it is the value the export reports (`env_v_esc_km_s`) and the
   * one the H II trapping test is posed against, but it is NOT what a mass of
   * gas spread through the cloud has to overcome. Use `vEscMassWeighted` for
   * anything that moves the gas.
   */
  vEsc: number;
  /** Mass-weighted escape speed [km/s] — beta sqrt(2GM/r_t). */
  vEscMassWeighted: number;
  /** The dimensionless beta, reported so a page can state the correction. */
  beta: number;
}

/**
 * Binding budget for a truncated-EFF cloud.
 *
 * @param mCloudMsun cloud mass (gas + stars) [Msun]
 * @param rtPc       truncation radius [pc]
 * @param gamma      EFF slope
 * @param aPc        EFF scale radius [pc]
 */
export function cloudBinding(
  mCloudMsun: number,
  rtPc: number,
  gamma: number,
  aPc: number,
): CloudBinding {
  const rtOverA = rtPc / aPc;
  const alpha = effBindingCoefficient(gamma, rtOverA);
  const energy = (alpha * G_PC_KMS2_MSUN * mCloudMsun * mCloudMsun) / rtPc;
  const vEsc = Math.sqrt((2 * G_PC_KMS2_MSUN * mCloudMsun) / rtPc);
  const beta = effEscapeCoefficient(gamma, rtOverA);
  const vEscMassWeighted = beta * vEsc;
  return {
    alpha,
    energy,
    momentum: mCloudMsun * vEscMassWeighted,
    vEsc,
    vEscMassWeighted,
    beta,
  };
}
