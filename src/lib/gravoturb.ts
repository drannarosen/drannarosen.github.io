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

/*
 * Cell occupancy of the shipped realization, DERIVED from stars.f32 rather than
 * recorded in prose. The star positions are drawn on the gas grid, so the density
 * each star couples to is quantized to the cell it landed in — a real limitation
 * a page may want to state, and one whose numbers move with every re-export.
 *
 * It has already gone stale twice. Before the per-cell gas budget landed the
 * placement collapsed into ~123 cells, and /explore/mass-segregation shipped
 * "the densest single cell holds 7,973 of them" against a 6,557-star cluster —
 * a number larger than the population it described, surviving two re-exports
 * because it was typed into a paragraph instead of read from the data.
 */
export interface CellOccupancy {
  /** Distinct grid cells holding at least one star. */
  occupied: number;
  /** Cell size in parsecs (box / ngrid). */
  cellPc: number;
  /** Stars in the most populated cell. */
  densest: number;
  /** Densest cell as a percentage of the cluster, e.g. "9.2". */
  densestPercent: string;
}

export function cellOccupancy(name?: string): CellOccupancy {
  const dir = name ? `public/data/gravoturb/${name}` : "public/data/gravoturb";
  const meta = gravoturbMeta(name) as GravoturbMeta & { box_pc: number };
  const buf = readFileSync(resolve(process.cwd(), dir, "stars.f32"));
  const f = new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
  const n = f.length / 6;
  const ngrid = meta.ngrid;
  const cellPc = meta.box_pc / ngrid;
  const counts = new Map<number, number>();
  for (let i = 0; i < n; i++) {
    const c = [0, 1, 2].map((k) => {
      const v = Math.floor((f[i * 6 + k]! + meta.box_pc / 2) / cellPc);
      return Math.min(Math.max(v, 0), ngrid - 1);
    });
    const key = (c[0]! * ngrid + c[1]!) * ngrid + c[2]!;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const densest = Math.max(...counts.values());
  return {
    occupied: counts.size,
    cellPc,
    densest,
    densestPercent: ((100 * densest) / n).toFixed(1),
  };
}
