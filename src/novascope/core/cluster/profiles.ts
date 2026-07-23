/*
 * core/cluster/profiles.ts — spatial density profiles for a sampled cluster.
 *
 * The canonical home for cluster geometry. Plummer (1911) first; a truncated EFF
 * and Bonnor–Ebert profile can be added here later without touching callers,
 * because sampleCluster only asks a profile for a position.
 *
 * Units: the scale radius `a` is in pc, so returned positions are in pc.
 */

/** Plummer half-mass radius in units of the scale radius (Plummer 1911). */
export const PLUMMER_RH_OVER_A = 1.305;

/**
 * One isotropic 3-D draw from a Plummer sphere. `u` is the enclosed-mass
 * fraction M(<r)/M_tot ∈ (0,1); the radius inverts M(<r): r = a / √(u^(−2/3) − 1)
 * (Aarseth, Hénon & Wielen 1974). `rng` supplies the two angles. 3-D positions
 * are kept authoritative — the on-screen 2-D is a projection, never a flatten.
 */
export function samplePlummer(
  u: number,
  rng: () => number,
  a: number,
): [number, number, number] {
  const r = a / Math.sqrt(Math.pow(Math.max(u, 1e-6), -2 / 3) - 1);
  return isotropic(r, rng);
}

/** A radius r into an isotropic 3-D position, consuming two randoms (θ, φ). */
function isotropic(r: number, rng: () => number): [number, number, number] {
  const cosTheta = 2 * rng() - 1;
  const sinTheta = Math.sqrt(Math.max(0, 1 - cosTheta * cosTheta));
  const phi = 2 * Math.PI * rng();
  return [r * sinTheta * Math.cos(phi), r * sinTheta * Math.sin(phi), r * cosTheta];
}

/**
 * EFF (Elson, Fall & Freeman 1987) profile, ported from progenax's EFFProfile:
 * ρ(r) = (1 + r²/a²)^(−γ/2), truncated at r_t, sampled by a numerical
 * enclosed-mass inverse-CDF. `gamma` is the 3-D density slope (γ=3 typical young
 * cluster; γ=5 reduces to Plummer). Returns cdf/r grids for interpolation.
 */
export function buildEFFCDF(
  a: number,
  gamma: number,
  rt: number,
  nGrid = 512,
): { cdf: Float64Array; rGrid: Float64Array } {
  const rGrid = new Float64Array(nGrid);
  const cdf = new Float64Array(nGrid);
  let cum = 0;
  let prevInteg = 0;
  for (let i = 0; i < nGrid; i++) {
    const r = (i / (nGrid - 1)) * rt;
    const rho = Math.pow(1 + (r / a) ** 2, -gamma / 2); // ∝ 3-D density
    const integ = 4 * Math.PI * r * r * rho; // dM/dr
    if (i > 0) cum += 0.5 * (integ + prevInteg) * (rt / (nGrid - 1)); // trapezoid
    rGrid[i] = r;
    cdf[i] = cum;
    prevInteg = integ;
  }
  const total = cum || 1;
  for (let i = 0; i < nGrid; i++) cdf[i] /= total;
  return { cdf, rGrid };
}

/** Monotone-CDF inverse: u ∈ [0,1] → interpolated radius. */
function invCDF(u: number, cdf: Float64Array, rGrid: Float64Array): number {
  const n = cdf.length;
  if (u <= cdf[0]) return rGrid[0];
  if (u >= cdf[n - 1]) return rGrid[n - 1];
  let lo = 0;
  let hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (cdf[mid] <= u) lo = mid;
    else hi = mid;
  }
  const t = (u - cdf[lo]) / (cdf[hi] - cdf[lo] || 1);
  return rGrid[lo] + t * (rGrid[hi] - rGrid[lo]);
}

/**
 * Half-mass radius of a (truncated) EFF(γ) profile in units of the scale radius
 * a — i.e. r_h / a — from the enclosed-mass CDF. γ=5 gives ≈1.30 (the Plummer
 * value 1.305), and shallower γ gives a larger ratio (more extended). Lets a UI
 * quote a real half-mass radius for any γ instead of assuming the Plummer ratio.
 */
export function effRhOverA(gamma: number): number {
  const { cdf, rGrid } = buildEFFCDF(1, gamma, 15);
  return invCDF(0.5, cdf, rGrid); // a = 1, so this is r_h / a
}

export interface ProfileSpec {
  kind: "plummer" | "eff";
  scaleRadius: number;
  gamma?: number;
}

/**
 * A position sampler for a profile: `(rng) => [x,y,z]`, drawing exactly three
 * randoms (radius u, then θ, φ) so the draw order matches the analytic Plummer
 * path — determinism is preserved when the profile switches.
 */
export function makeProfileSampler(profile: ProfileSpec): (rng: () => number) => [number, number, number] {
  const a = profile.scaleRadius;
  if (profile.kind === "eff") {
    const gamma = profile.gamma ?? 5; // 5 = Plummer-equivalent
    const { cdf, rGrid } = buildEFFCDF(a, gamma, a * 15); // truncate at 15 a
    return (rng) => isotropic(invCDF(rng(), cdf, rGrid), rng);
  }
  return (rng) => {
    const u = rng();
    const r = a / Math.sqrt(Math.pow(Math.max(u, 1e-6), -2 / 3) - 1);
    return isotropic(r, rng);
  };
}
