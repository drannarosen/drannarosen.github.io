/*
 * gravoturb.ts — build-time read of the shipped realization metadata.
 *
 * Pages must never RETYPE a number the dataset already states. The realization
 * set is regenerated whenever the physics changes, and when the Mach ladder
 * became the environment set every hardcoded "10,000 stars" in a page lede
 * silently became false — the pages kept rendering, so nothing caught it.
 *
 * This reads meta.json at BUILD time (the file ships in public/, so the browser
 * fetches it separately at runtime for the live figures; this is only so
 * server-rendered copy can quote the same numbers).
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

export interface GravoturbMeta {
  realization: string;
  label: string;
  n_stars: number;
  n_gas_points: number;
  ngrid: number;
  mach: number;
  b_forcing: number;
  sigma_turb: number;
  env_sigma_msun_pc2: number;
  env_v_esc_km_s: number;
  env_radius_pc: number;
  env_m_cloud_actual_msun: number;
  lambda_corr: number;
}

/** Metadata for one shipped realization; `name` omitted = the root (fiducial). */
export function gravoturbMeta(name?: string): GravoturbMeta {
  const dir = name ? `public/data/gravoturb/${name}` : "public/data/gravoturb";
  return JSON.parse(
    readFileSync(resolve(process.cwd(), dir, "meta.json"), "utf8"),
  ) as GravoturbMeta;
}

/** Star count formatted for prose, e.g. "10,301". */
export function starCount(name?: string): string {
  return gravoturbMeta(name).n_stars.toLocaleString("en-US");
}
