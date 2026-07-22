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
  const cosTheta = 2 * rng() - 1;
  const sinTheta = Math.sqrt(Math.max(0, 1 - cosTheta * cosTheta));
  const phi = 2 * Math.PI * rng();
  return [r * sinTheta * Math.cos(phi), r * sinTheta * Math.sin(phi), r * cosTheta];
}
