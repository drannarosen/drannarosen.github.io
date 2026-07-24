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

/* G in [pc (km/s)^2 / Msun] — IAU 2015 nominal, same value and epoch as
 * sources.ts, winds.ts and the export pipeline. */
const G_PC_KMS2_MSUN = 4.300917270e-3;

export interface CloudBinding {
  /** Dimensionless profile coefficient. */
  alpha: number;
  /** Binding energy [Msun (km/s)^2] — the ledger's energy threshold. */
  energy: number;
  /**
   * Momentum needed to unbind the cloud [Msun km/s]: M v_esc, the impulse that
   * would lift the gas out of its own potential. The ledger's momentum
   * threshold, and the reason both bars are shown — a channel can clear one
   * without clearing the other.
   */
  momentum: number;
  /** Escape speed at the truncation radius [km/s]. */
  vEsc: number;
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
  const alpha = effBindingCoefficient(gamma, rtPc / aPc);
  const energy = (alpha * G_PC_KMS2_MSUN * mCloudMsun * mCloudMsun) / rtPc;
  const vEsc = Math.sqrt((2 * G_PC_KMS2_MSUN * mCloudMsun) / rtPc);
  return { alpha, energy, momentum: mCloudMsun * vEsc, vEsc };
}
